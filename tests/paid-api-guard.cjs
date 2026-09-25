'use strict';

// 자동 유료 API 차단(2026-09-22 준희 결정) 회귀 검사. 서버를 임시 복사본으로 띄우고 외부 AI 주소 호출은 가로채 기록만 한다.
// - spendControls.automaticPaidQuotesPaused=true(기본): 자동 대기열·자동 기능은 Claude·OpenAI·Gemini 모두 0회
// - 버튼 호출(파이버 답장 초안, trigger:'manual')은 막지 않는다
// - queueProviders.claude=false(기본): 일반 대기열은 Claude로 가지 않는다
// - 대조군: 차단을 끄면 같은 대기열이 실제로 호출을 시도한다(검사 자체가 동작함을 증명)
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
    const src = path.join(from, entry.name); const dst = path.join(to, entry.name);
    if (skip(src, entry)) continue;
    if (entry.isDirectory()) copyDir(src, dst, skip); else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

// 0) 정책 파일 기본값
const policyFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));
assert.equal(policyFile.spendControls.automaticPaidQuotesPaused, true);
assert.equal(policyFile.queueProviders.claude, false);
assert.equal(policyFile.claudeQuote.enabled, false);
// 9/23 16:05 준희 결정: 답장은 아스트라 전담 → Claude 대체 끔(예외 코드는 남아 있지만 꺼져 있으면 통과하지 않는다).
// 9/24 지시 24: 채팅봇 Claude 답장 스위치는 준희가 chatbot-on/off.bat로 정한다(decisions 7-5). 실제 값은 두 값이 함께 움직였는지만 본다.
// 켜졌을 때도 통과하는 곳이 이 예외 한 곳뿐이고 두 값이 모두 true여야 한다는 것은 아래 코드 검사가 확인한다.
assert.equal(typeof policyFile.customerRoomFallback.claudeEnabled, 'boolean'); assert.equal(policyFile.customerRoomFallback.enabled, policyFile.customerRoomFallback.claudeEnabled); // 9/23 16:26 정책에서 합치기 자체도 끔(답장은 아스트라만, decisions 6번) — 켜짐 여부는 정책이 정한다
// 공용 호출 함수 세 곳이 모두 차단을 거친다
const server = fs.readFileSync(path.join(ROOT, 'server', 'relay-server.js'), 'utf8');
for (const [sig, name] of [['async function runOpenAI(prompt, modelOverride = \'\', options = {}) {', 'OpenAI'], ['async function runGemini(prompt, options = {}) {', 'Gemini'], ['async function runClaude(prompt, options = {}) {', 'Claude']]) {
  const at = server.indexOf(sig); assert.ok(at > 0, sig);
  assert.ok(server.slice(at, at + 200).includes(`assertPaidCallAllowed('${name}', options);`), `${name} 차단 거침`);
}
assert.equal((server.match(/trigger: 'manual'/g) || []).length, 0, '서버 안에서 manual 표시를 붙이는 곳 없음(버튼 도구 모듈에서만)');
// 예외는 고객응대실 합치기의 Claude 한 곳뿐이고, 정책 두 값이 모두 true일 때만 통과한다
assert.equal((server.match(/trigger: 'customer_room_fallback'/g) || []).length, 1, '예외 표시는 고객응대실 합치기 한 곳');
assert.match(server, /runClaude: \(prompt, options = \{\}\) => runClaude\(prompt, \{ \.\.\.options, trigger: 'customer_room_fallback' \}\)/);
assert.match(server, /options\.trigger === 'customer_room_fallback' && provider === 'Claude'[\s\S]{0,260}fallback\?\.enabled === true && fallback\?\.claudeEnabled === true\) return;/);
assert.match(fs.readFileSync(path.join(ROOT, 'server', 'global-reply.js'), 'utf8'), /runClaude\(prompt, \{ trigger: 'manual'/);

function makeSandbox({ paused, queueClaude, productionProvider }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-paid-'));
  copyDir(path.join(ROOT, 'server'), path.join(dir, 'server'), (src, entry) => entry.isDirectory() && ['data', 'storage'].includes(entry.name) && path.dirname(src) === path.join(ROOT, 'server'));
  copyDir(path.join(ROOT, 'services'), path.join(dir, 'services'));
  fs.mkdirSync(path.join(dir, 'server', 'data'), { recursive: true }); fs.mkdirSync(path.join(dir, 'server', 'storage'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server', 'data', 'astra-scheduler-paused'), 'test');
  const pf = path.join(dir, 'server', 'config', 'astra-relay-operating-policy.json');
  const policy = JSON.parse(fs.readFileSync(pf, 'utf8'));
  policy.spendControls = { ...policy.spendControls, automaticPaidQuotesPaused: paused };
  policy.queueProviders = { ...policy.queueProviders, claude: queueClaude };
  policy.production = { ...policy.production, provider: productionProvider };
  policy.astraGate = { ...policy.astraGate, paidProduction: true };
  fs.writeFileSync(pf, JSON.stringify(policy, null, 2));
  const now = new Date().toISOString();
  const state = {
    tasks: [{ id: 'PAID-P', title: '제작', lane: 'soomgo_fulfillment' }, { id: 'PAID-G', title: '일반' }],
    promptPosts: [
      { id: 'POST-PAID-P', taskId: 'PAID-P', lane: 'soomgo_fulfillment', astraProduction: true, nextAI: 'Claude', status: '게시됨', mode: 'analysis', prompt: '시험 제작', qualityPasses: 0, qualityPipeline: true, cycle: 1, maxCycles: 1, createdAt: now },
      { id: 'POST-PAID-G', taskId: 'PAID-G', nextAI: 'Claude', status: '게시됨', mode: 'analysis', prompt: '시험 일반 작업', createdAt: now }
    ],
    soomgoWorkflows: [], soomgoLeads: [], soomgoReplies: []
  };
  fs.writeFileSync(path.join(dir, 'server', 'data', 'state.json'), JSON.stringify(state));
  const log = path.join(dir, 'api-calls.log');
  fs.writeFileSync(path.join(dir, 'preload.cjs'), `
const fs = require('fs'); const original = global.fetch;
global.fetch = async (url, options) => {
  const u = String(url && url.url || url);
  if (/api\\.anthropic\\.com|api\\.openai\\.com|generativelanguage\\.googleapis\\.com|api\\.typesafe\\.ai/.test(u)) { fs.appendFileSync(${JSON.stringify(log)}, u + '\\n'); throw new Error('api_blocked_in_test'); }
  return original(url, options);
};`);
  return { dir, log };
}

async function runVariant(opts, action) {
  const { dir, log } = makeSandbox(opts);
  const port = 18000 + Math.floor(Math.random() * 600);
  const child = spawn(process.execPath, ['--require', path.join(dir, 'preload.cjs'), path.join(dir, 'server', 'relay-server.js')], {
    cwd: dir, env: { ...process.env, RELAY_PORT: String(port), OPENAI_API_KEY: 'test-not-a-key', ANTHROPIC_API_KEY: 'test-not-a-key', GEMINI_API_KEY: 'test-not-a-key', RELAY_DAILY_COST_CAP_USD: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (_) {} await sleep(250); }
    const extra = action ? await action(base) : null;
    await sleep(4500); // 자동 대기열(1.5초 주기)이 여러 번 돈다
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    return { calls, extra };
  } finally { child.kill(); await sleep(200); fs.rmSync(dir, { recursive: true, force: true }); }
}

(async () => {
  // 1) 기본(차단 켜짐): 제작 lane(provider=Claude)·일반 대기열 모두 외부 호출 0회
  let out = await runVariant({ paused: true, queueClaude: false, productionProvider: 'Claude' });
  assert.equal(out.calls.length, 0, `차단 켜짐: 자동 호출 0 (실제 ${out.calls.join(', ')})`);
  console.log('[PASS] 차단 켜짐: 자동 대기열 호출 0회');

  // 2) 차단 켜짐이어도 버튼 호출(파이버 답장 초안)은 나간다
  out = await runVariant({ paused: true, queueClaude: false, productionProvider: 'hold' }, async base => {
    const r = await fetch(`${base}/api/global/reply-draft`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'I need Korean subtitles for a 5 minute video.' }) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  });
  assert.equal(out.calls.filter(u => /anthropic/.test(u)).length, 1, `버튼 호출 1회 (실제 ${out.calls.join(', ')})`);
  assert.equal(out.extra.body.error, 'call_failed', '가짜 차단으로 실패 처리(재시도 없음)');
  console.log('[PASS] 버튼 호출은 차단 대상 아님');

  // 3) 대조군: 차단을 끄면 같은 대기열이 실제로 호출을 시도한다. 일반 대기열은 queueProviders.claude=false라 Claude로 안 간다.
  out = await runVariant({ paused: false, queueClaude: false, productionProvider: 'Claude' });
  assert.ok(out.calls.some(u => /anthropic/.test(u)), `대조군: 제작 lane Claude 호출 시도 (실제 ${out.calls.join(', ')})`);
  const nonClaude = out.calls.filter(u => !/anthropic/.test(u));
  assert.ok(nonClaude.length >= 1, '대조군: 일반 대기열은 Claude 대신 다른 제공자로 시도');
  console.log(`[PASS] 대조군: 호출 시도 ${out.calls.length}회 가로챔(일반 대기열은 Claude 아님)`);

  // 4) 일반 대기열 Claude 허용 시에만 Claude로 간다(제작은 hold로 막아 일반 대기열만 본다)
  out = await runVariant({ paused: false, queueClaude: true, productionProvider: 'hold' });
  assert.ok(out.calls.some(u => /anthropic/.test(u)), `queueProviders.claude=true면 일반 대기열 Claude 시도 (실제 ${out.calls.join(', ')})`);
  out = await runVariant({ paused: false, queueClaude: false, productionProvider: 'hold' });
  assert.ok(!out.calls.some(u => /anthropic/.test(u)), `queueProviders.claude=false면 Claude 0 (실제 ${out.calls.join(', ')})`);
  console.log('[PASS] queueProviders.claude 스위치');
  console.log('paid-api-guard: PASS');
})().catch(error => { console.error(error); process.exit(1); });
