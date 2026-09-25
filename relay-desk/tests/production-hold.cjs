'use strict';

// 제작 hold 회귀 검사(C-2a). 서버를 임시 폴더 복사본으로 띄워 실제 상태 파일을 건드리지 않는다.
// 외부 AI API 주소(anthropic·openai·gemini) 호출은 가로채서 기록만 하고 막는다.
// 대조군(provider=Claude)에서 호출이 잡히는지 확인해 검사 자체가 동작함을 증명한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (skip(src, entry)) continue;
    if (entry.isDirectory()) copyDir(src, dst, skip);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

function makeSandbox(provider) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-hold-'));
  copyDir(path.join(ROOT, 'server'), path.join(dir, 'server'), (src, entry) => entry.isDirectory() && ['data', 'storage'].includes(entry.name) && path.dirname(src) === path.join(ROOT, 'server'));
  copyDir(path.join(ROOT, 'services'), path.join(dir, 'services'));
  fs.mkdirSync(path.join(dir, 'server', 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'server', 'storage'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server', 'data', 'astra-scheduler-paused'), 'test');
  const policyFile = path.join(dir, 'server', 'config', 'astra-relay-operating-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  policy.production = { ...(policy.production || {}), provider };
  policy.astraGate = { ...(policy.astraGate || {}), paidProduction: true };
  // 2026-09-22: 자동 유료 호출 차단(spendControls)은 기본 켜짐. 이 테스트는 제작 hold만 따로 보므로 대조군에서 막히지 않게 끈다.
  policy.spendControls = { ...(policy.spendControls || {}), automaticPaidQuotesPaused: false };
  fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2));
  const now = new Date().toISOString();
  const base = { lane: 'soomgo_fulfillment', astraProduction: true, nextAI: 'OpenAI', openAIModel: 'gpt-6-astra', status: '게시됨', mode: 'analysis', prompt: '시험 제작 지시', qualityPasses: 0, qualityPipeline: true, maxCycles: 2, createdAt: now };
  const state = {
    tasks: [{ id: 'HOLDT-1', title: '시험', lane: 'soomgo_fulfillment', quote: { label: '일반 문서·글 작성', days: '1~2일' }, soomgoRequest: { purpose: '문서/글 작성', deadline: '내일까지' } }],
    promptPosts: [
      { ...base, id: 'POST-HOLDT-1', taskId: 'HOLDT-1', cycle: 1, astraFinalReview: false },
      { ...base, id: 'POST-HOLDT-1-N2', taskId: 'HOLDT-1-N2', cycle: 2, astraFinalReview: false },
      { ...base, id: 'POST-HOLDT-1-REV1', taskId: 'HOLDT-1-REV1', cycle: 1, astraFinalReview: false },
      { ...base, id: 'POST-HOLDT-1-FINAL', taskId: 'HOLDT-1-FINAL', cycle: 3, astraFinalReview: true }
    ],
    soomgoWorkflows: [], soomgoLeads: [], soomgoReplies: []
  };
  fs.writeFileSync(path.join(dir, 'server', 'data', 'state.json'), JSON.stringify(state));
  const log = path.join(dir, 'api-calls.log');
  fs.writeFileSync(path.join(dir, 'preload.cjs'), `
const fs = require('fs'); const original = global.fetch;
global.fetch = async (url, options) => {
  const u = String(url && url.url || url);
  if (/api\\.anthropic\\.com|api\\.openai\\.com|generativelanguage\\.googleapis\\.com/.test(u)) { fs.appendFileSync(${JSON.stringify(log)}, u + '\\n'); throw new Error('api_blocked_in_test'); }
  return original(url, options);
};`);
  return { dir, log };
}

async function runVariant(provider) {
  const { dir, log } = makeSandbox(provider);
  const port = 18700 + Math.floor(Math.random() * 800);
  const child = spawn(process.execPath, ['--require', path.join(dir, 'preload.cjs'), path.join(dir, 'server', 'relay-server.js')], {
    cwd: dir,
    env: { ...process.env, RELAY_PORT: String(port), OPENAI_API_KEY: 'test-not-a-key', ANTHROPIC_API_KEY: 'test-not-a-key', GEMINI_API_KEY: 'test-not-a-key', RELAY_DAILY_COST_CAP_USD: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (_) {} await sleep(250); }
    await sleep(4500); // 자동 큐(1.5초 주기)가 최소 두 번 돈다
    const runs = [];
    for (const postId of ['POST-HOLDT-1', 'POST-HOLDT-1-N2', 'POST-HOLDT-1-REV1', 'POST-HOLDT-1-FINAL']) {
      const response = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postId }) });
      runs.push({ postId, status: response.status, body: await response.json().catch(() => ({})) });
    }
    const attention = await (await fetch(`${base}/api/attention?sinceMinutes=70`)).json();
    await sleep(300);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'server', 'data', 'state.json'), 'utf8'));
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    return { runs, attention, state, calls, stderr };
  } finally {
    child.kill();
    await sleep(200);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  for (const [provider, reason] of [['hold', 'policy_hold'], ['codex_room', 'codex_room'], ['paused', 'invalid_provider:paused'], ['없는값', 'invalid_provider:없는값']]) {
    const out = await runVariant(provider);
    assert.equal(out.calls.length, 0, `${provider}: 외부 API 호출 0 (실제 ${out.calls.join(', ')})`);
    for (const run of out.runs) {
      assert.equal(run.status, 409, `${provider} ${run.postId}: /api/run은 409`);
      assert.equal(run.body.error, 'production_hold');
      assert.equal(run.body.reason, reason);
    }
    for (const post of out.state.promptPosts) assert.equal(post.status, '게시됨', `${provider} ${post.id}: 실패 처리 없이 대기 유지`);
    const holds = out.attention.openProductionHolds || [];
    assert.equal(holds.length, 4, `${provider}: 대기 게시물 4건 알림`);
    const first = holds.find(item => item.postId === 'POST-HOLDT-1');
    assert.equal(first.service, '일반 문서·글 작성');
    assert.equal(first.deadline, '내일까지');
    assert.equal(first.reason, reason);
    assert.deepEqual(holds.map(item => item.postKind).sort(), ['final_review', 'production', 'review_cycle', 'revision']);
    assert.equal(out.attention.items.filter(item => item.type === 'production_hold').length, 4, '새 대기는 알림방 items에도');
    const stored = out.state.attentionItems.filter(item => item.type === 'production_hold');
    assert.equal(stored.length, 4, `${provider}: 큐가 여러 번 돌아도 중복 등록 없음`);
    assert.ok(!/invalid_production_provider|Automatic queue error/.test(out.stderr), `${provider}: 오류 로그 없음`);
    console.log(`[PASS] provider=${provider}: API 0회, 409 production_hold, 대기 유지, 알림 4건`);
  }
  // 대조군: Claude면 자동 큐가 실제로 API를 부르려 한다(가로채기가 동작하는지 증명)
  const control = await runVariant('Claude');
  assert.ok(control.calls.some(url => /api\.anthropic\.com/.test(url)), '대조군: Claude 제작은 API 호출 시도가 잡혀야 함');
  assert.equal((control.attention.openProductionHolds || []).length, 0, '대조군: hold 알림 없음');
  console.log(`[PASS] 대조군 provider=Claude: API 호출 시도 ${control.calls.length}회 가로챔`);
  console.log('production-hold: PASS');
})().catch(error => { console.error(error); process.exit(1); });
