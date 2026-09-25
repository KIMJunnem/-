'use strict';

// B: 숨고 카테고리 우선 분류·외국어 교정·고객 이름 파싱·재방문 방지·첨부 판독 스위치 회귀 검사.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let apiCalls = 0;
global.fetch = async () => { apiCalls += 1; throw new Error('network_disabled_in_test'); };
const ROOT = path.join(__dirname, '..');
const registry = require('../server/service-registry');
const { buildSoomgoQuote } = require('../server/relay-server');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'soomgo-category-regression.json'), 'utf8'));

// 1) 회귀 기준 2건
for (const item of fixture.cases) {
  const { parsed, quote } = buildSoomgoQuote(item.input);
  const e = item.expect;
  assert.equal(parsed.soomgoCategory, e.soomgoCategory, `${item.caseId}: 카테고리`);
  assert.equal(quote.serviceId, e.serviceId, `${item.caseId}: 서비스`);
  if (e.notServiceId) assert.notEqual(quote.serviceId, e.notServiceId);
  assert.equal(Boolean(quote.manualReview), e.manualReview, `${item.caseId}: manualReview`);
  assert.equal(Boolean(quote.autoSend), e.autoSend, `${item.caseId}: autoSend`);
  if (e.reason) assert.equal(quote.reason, e.reason);
  assert.equal(parsed.customerName, e.customerName, `${item.caseId}: 고객 이름 칸`);
  assert.ok(!/견적\s*보낸\s*고수/.test(parsed.customerName));
}

// 2) 카테고리 문자열은 코드가 아니라 정의 파일에 있다
const server = fs.readFileSync(path.join(ROOT, 'server', 'relay-server.js'), 'utf8');
assert.ok(!/SOOMGO_CATEGORY_LINE\s*=/.test(server), '카테고리 정규식 하드코딩 제거');
assert.ok(!/\/속기\|타이핑\|녹취\|교정\|교열\|윤문\//.test(server), '교정·속기 대체 규칙도 정의 파일로');
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', 'document_writing.json'), 'utf8'));
assert.ok(doc.soomgoCategories.some(item => item.name === '교정/교열' && item.foreignLanguage?.action === 'auto_rules'));
assert.equal(registry.matchSoomgoCategory('교정/교열').serviceId, 'document_writing');
assert.equal(registry.matchSoomgoCategory('자막 제작').serviceId, 'subtitle');
assert.equal(registry.matchSoomgoCategory('영상 편집').serviceId, null, '매핑 없는 카테고리는 원문 분류');
assert.equal(registry.matchSoomgoCategory('교정/교열 요청드립니다 영어 보고서입니다 길게 적은 문장입니다'), null, '긴 본문 줄은 카테고리로 보지 않음');
assert.match(registry.definitionsVersion, /^[0-9a-f]{16}$/);
// 카테고리 없는 요청은 기존 원문 분류 그대로
assert.equal(buildSoomgoQuote({ purpose: '자막 제작', volume: '5분', topic: '한국어 인터뷰 SRT 자막', format: 'SRT' }).quote.serviceId, 'subtitle');
assert.equal(buildSoomgoQuote({ text: '요청 상세\n영어 번역\n작업 분량\nA4 2쪽' }).quote.serviceId, 'translation_en');
// 이름 칸이 없으면 빈 값(요약 줄을 이름으로 읽지 않음)
assert.equal(buildSoomgoQuote({ text: '요청 상세\n고객 정보\n견적 보낸 고수 3명\n2시간 전\n문서/글 작성' }).parsed.customerName, '');
assert.equal(apiCalls, 0);

// 3) 서버 경로: 재방문 방지 기록·목록 확인·판독 스위치(임시 복사본 서버, API 가로채기)
function copyDir(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    if (skip && skip(src, entry)) continue;
    if (entry.isDirectory()) copyDir(src, path.join(to, entry.name), skip);
    else if (entry.isFile()) fs.copyFileSync(src, path.join(to, entry.name));
  }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-b-'));
  copyDir(path.join(ROOT, 'server'), path.join(dir, 'server'), (src, entry) => entry.isDirectory() && ['data', 'storage'].includes(entry.name) && path.dirname(src) === path.join(ROOT, 'server'));
  copyDir(path.join(ROOT, 'services'), path.join(dir, 'services'));
  // 9/24 지시 27: 이 시험은 숨고 문서·교정·PPT 자동 견적이 켜져 있을 때의 분류·재방문을 본다(멈춤은 tests/soomgo-pause-27.cjs). 복사본에서만 켠다.
  for (const file of ['document_writing.json', 'presentation.json']) { const f = path.join(dir, 'services', file); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/("soomgoAutoQuote"\s*:\s*)false/, '$1true')); }
  fs.mkdirSync(path.join(dir, 'server', 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'server', 'storage'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server', 'data', 'astra-scheduler-paused'), 'test');
  fs.writeFileSync(path.join(dir, 'server', 'data', 'state.json'), JSON.stringify({ soomgoLeads: [], soomgoReplies: [], promptPosts: [] }));
  const bridge = path.join(dir, 'server', 'config', 'astra-room-bridge.json');
  if (fs.existsSync(bridge)) { const cfg = JSON.parse(fs.readFileSync(bridge, 'utf8')); cfg.enabled = false; fs.writeFileSync(bridge, JSON.stringify(cfg)); }
  const log = path.join(dir, 'api-calls.log');
  fs.writeFileSync(path.join(dir, 'preload.cjs'), `const fs=require('fs');const o=global.fetch;global.fetch=async(u,x)=>{const s=String(u&&u.url||u);if(/api\\.anthropic\\.com|api\\.openai\\.com|generativelanguage/.test(s)){fs.appendFileSync(${JSON.stringify(log)},s+'\\n');throw new Error('api_blocked');}return o(u,x);};`);
  const port = 19500 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, ['--require', path.join(dir, 'preload.cjs'), path.join(dir, 'server', 'relay-server.js')], { cwd: dir, env: { ...process.env, RELAY_PORT: String(port), ANTHROPIC_API_KEY: 'test-not-a-key', OPENAI_API_KEY: 'test-not-a-key' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, body) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  global.fetch = globalThis.__realFetch || require('node:http') && (async (url, options = {}) => {
    const http = require('node:http');
    return await new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: options.method || 'GET', headers: options.headers || {} }, res => {
        let data = ''; res.setEncoding('utf8'); res.on('data', c => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode < 300, json: async () => JSON.parse(data || '{}') }));
      });
      req.on('error', reject); if (options.body) req.write(options.body); req.end();
    });
  });
  try {
    for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (_) {} await sleep(250); }
    const input = fixture.cases[0].input;
    const first = await post('/api/soomgo/quote', input);
    assert.equal(first.status, 200);
    // D': 영어 교정 150쪽(100쪽 초과)은 자동 삭제, 삭제 기록을 남기고 사람 확인 판정은 만들지 않는다.
    assert.equal(first.body.quote.deleteRequest, true, '영어 150쪽 → 자동 삭제');
    assert.equal(first.body.quote.autoRule.ruleId, 'large_document');
    assert.equal(first.body.judgement, null);
    const again = await post('/api/soomgo/quote', input);
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.quote.deleteRequest, true, '다시 열어도 삭제 판정 유지');
    const korean = await post('/api/soomgo/quote', fixture.cases[1].input);
    assert.equal(korean.body.skipRevisit, false, '자동 발송 대상은 재방문 금지 없음');
    const version = await (await fetch(`${base}/api/soomgo/bot-version`)).json();
    // 복사본은 문서·PPT 스위치를 켠 정의 파일이라 그 복사본 기준 버전과 같아야 한다(9/24 지시 27)
    assert.equal(version.definitionsVersion, require(path.join(dir, 'server', 'service-registry')).definitionsVersion);
    // 분류 불가 요청은 1회 재조회 대기(사람 확인 알림 + 재방문 허용), 두 번째에 삭제
    const unknown = { requestId: 'REGRESS-UNKNOWN-1', text: '요청 상세\n고객 정보\n견적 보낸 고수 1명\n로고 디자인 부탁드립니다 심플하게 만들어 주세요 급해요' };
    const u1 = await post('/api/soomgo/quote', unknown);
    assert.equal(u1.body.quote.autoRule.action, 'retry');
    assert.equal(u1.body.skipRevisit, false, '분류 불가 첫 조회는 다시 볼 수 있게');
    // 목록 확인: 열지 않은 요청이 보이면 알림의 마지막 확인 시각만 갱신
    const seen = await post('/api/soomgo/list-seen', { requestIds: ['REGRESS-UNKNOWN-1'] });
    assert.equal(seen.body.touched, 1);
    const attention = await (await fetch(`${base}/api/attention?sinceMinutes=70`)).json();
    assert.ok(attention.openQuoteReviews.find(item => item.requestId === 'REGRESS-UNKNOWN-1'), '분류 불가 알림');
    assert.ok(!attention.openQuoteReviews.find(item => item.requestId === 'REGRESS-FOREIGN-1'), '삭제 건은 알림 없음');
    const u2 = await post('/api/soomgo/quote', unknown);
    assert.equal(u2.body.quote.deleteRequest, true, '두 번째 조회에서 삭제');
    const stateFile = JSON.parse(fs.readFileSync(path.join(dir, 'server', 'data', 'state.json'), 'utf8'));
    assert.deepEqual(stateFile.soomgoAutoDeletes.map(item => item.requestId).sort(), ['REGRESS-FOREIGN-1', 'REGRESS-UNKNOWN-1'], '삭제 기록은 요청당 1건');
    // Claude 견적 판단은 2026-09-22 준희 결정으로 꺼짐(claudeQuote.enabled:false) + 자동 유료 호출 차단 → 호출 0회, 기록 0건
    const quoteCalls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    assert.equal(quoteCalls.length, 0, `Claude 견적 호출 0회 (${quoteCalls.join(',')})`);
    assert.equal((stateFile.claudeQuoteLog || []).length, 0, 'Claude 견적 기록 없음');
    // 첨부 판독 스위치(기본 꺼짐): API 없이 알림만
    const reply = await post('/api/soomgo/reply', { conversationId: 'REGRESSCONV1', messageId: 'm1', message: '[사진]', attachments: [{ kind: 'image', name: '사진', mediaType: 'image/png', data: Buffer.alloc(500, 1).toString('base64') }] });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.reply.templateKey, 'attachment_read');
    assert.equal(reply.body.reply.attention, true);
    assert.match(reply.body.reply.reason, /판독 꺼짐/);
    await sleep(200);
    const calls = (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []).slice(quoteCalls.length);
    assert.equal(calls.length, 0, `판독 꺼짐: 외국 API 호출 0 (${calls.join(',')})`);
    console.log('soomgo-category-classify: PASS');
  } finally {
    child.kill();
    await sleep(200);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
