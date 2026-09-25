// 고객응대실 합치기: Astra가 안 받으면 Claude, Claude가 안 되면 정해진 문구. 가짜 호출만 쓴다(유료 API 호출 없음).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAstraRoomBridge } = require('../server/astra-room-bridge');
const fb = require('../server/customer-room-fallback');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crf-'));
const bridge = createAstraRoomBridge({ dataFile: path.join(dir, 'bridge.json'), configFile: path.join(dir, 'cfg.json') });
const policy = { customerRoomFallback: { enabled: true, waitSeconds: 60, staleDispatchMinutes: 10, maxAgeHours: 3, perTick: 10, claudeEnabled: true, dailyMaxCalls: 2, dailyBudgetKrw: 3000, krwPerUsd: 1500, usdPerMillionInputTokens: 10, usdPerMillionOutputTokens: 50, maxOutputTokens: 400, timeoutMs: 30000 } };
let state = {};
let calls = [];
let claudeReply = '견적 금액은 39,000원이고 2일 안에 보내드립니다. 장수가 늘면 먼저 여쭤보겠습니다.';
let claudeThrows = null;
const T0 = Date.parse('2026-09-22T10:00:00Z');
let clock = T0;
const deps = {
  bridge, readPolicy: () => policy, readState: () => JSON.parse(JSON.stringify(state)), writeState: next => { state = next; },
  runClaude: async (prompt, options) => { calls.push({ prompt, options }); if (claudeThrows) throw new Error(claudeThrows); return { model: 'fake', text: claudeReply, usage: { input_tokens: 4000, output_tokens: 200 } }; },
  hasKey: () => true,
  cleanText: v => String(v || '').trim(),
  validReply: (text, det) => [...String(det).matchAll(/\d[\d,]*\s*(?:원|일)/g)].every(m => text.replace(/[\s,]/g, '').includes(m[0].replace(/[\s,]/g, ''))),
  now: () => clock
};
const dataFile = path.join(dir, 'bridge.json');
// 대기열 파일의 시각을 가짜 시계에 맞춘다.
const setTimes = (eventId, fields) => {
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  Object.assign(data.events.find(item => item.eventId === eventId), fields);
  fs.writeFileSync(dataFile, JSON.stringify(data));
};
const add = (conversationId, messageId, det, extra = {}) => {
  const e = bridge.enqueue({ eventType: 'customer_message', caseId: conversationId, idempotencyKey: `k:${conversationId}:${messageId}`, payload: { conversationId, messageId, replyPrompt: '고객 연락처 010-1234-5678 test@a.com https://x.y', deterministicReply: det, ...extra } }).event;
  setTimes(e.eventId, { createdAt: new Date(clock).toISOString() });
  return e;
};
const DET = { text: '견적 금액은 39,000원입니다. 예상 작업 기간은 2일입니다.', templateKey: 'auto_price', autoSend: true, attachment: '' };

(async () => {
  // 1) 60초 전에는 손대지 않는다.
  const a = add('1001', 'm1', DET);
  clock = T0 + 30000;
  let r = await fb.tick(deps);
  assert.equal(r.handled.length, 0);
  assert.equal(bridge.get(a.eventId).status, 'pending');

  // 2) 60초 뒤 Claude가 답하고, 숫자 검사를 통과하면 SEND(source claude). 연락처는 가려서 보낸다.
  clock = T0 + 61000;
  r = await fb.tick(deps);
  let ev = bridge.get(a.eventId);
  assert.equal(ev.status, 'completed');
  assert.equal(ev.response.decision, 'SEND');
  assert.equal(ev.response.fields.SOURCE, 'claude');
  assert.equal(ev.deliveryStatus, 'ready');
  assert.equal(ev.response.reply, claudeReply);
  assert.ok(!/010-1234|test@a\.com|https:/.test(calls[0].prompt), '연락처·링크는 가려야 한다');
  assert.equal(calls[0].options.maxTokens, 400);
  assert.equal(state.customerRoomFallbackLog.length, 1);
  assert.equal(state.customerRoomFallbackLog[0].krw, 75); // (4000*10+200*50)/1e6*1500
  assert.equal(bridge.outbox({}).length, 1);

  // 3) Claude 답의 숫자가 틀리면 정해진 문구로 SEND(source deterministic). 첨부 파일 이름도 따라간다.
  claudeReply = '견적 금액은 29,000원입니다.';
  const b = add('1002', 'm1', { ...DET, attachment: 'Swan-샘플-01-기관보고형.pdf' });
  clock += 61000;
  await fb.tick(deps);
  ev = bridge.get(b.eventId);
  assert.equal(ev.response.decision, 'SEND');
  assert.equal(ev.response.fields.SOURCE, 'deterministic');
  assert.equal(ev.response.reply, DET.text);
  assert.equal(ev.response.fields.ATTACHMENT, 'Swan-샘플-01-기관보고형.pdf');
  assert.equal(ev.response.fields.REASON, 'claude_reply_validation_failed');

  // 4) 하루 호출 한도(2건)를 넘으면 Claude를 부르지 않고, 정해진 문구로도 보내지 않고 멈춘다(2026-09-24 지시 17, decisions 7-5).
  const before = calls.length;
  const c = add('1003', 'm1', DET);
  clock += 61000;
  await fb.tick(deps);
  assert.equal(calls.length, before);
  assert.equal(bridge.get(c.eventId).response.fields.REASON, 'daily_call_cap');
  assert.equal(bridge.get(c.eventId).response.decision, 'ESCALATE', '한도 도달: 발송 멈춤');

  // 5) 정해진 문구가 자동 발송 대상이 아니면 보내지 않고 ESCALATE.
  policy.customerRoomFallback.dailyMaxCalls = 30;
  claudeThrows = 'claude_500_overloaded';
  const d = add('1004', 'm1', { ...DET, autoSend: false });
  clock += 61000;
  await fb.tick(deps);
  ev = bridge.get(d.eventId);
  assert.equal(ev.response.decision, 'ESCALATE');
  assert.equal(ev.deliveryStatus, 'held');
  claudeThrows = null;

  // 6) 테스트 기록(숫자 아닌 대화 ID)·3시간 넘은 메시지·더 새 메시지가 있는 옛 메시지는 WAIT로 닫는다.
  const t = add('test-room', 'm1', DET);
  const old = add('1005', 'm1', DET);
  clock += 3 * 3600000 + 1000;
  const o1 = add('1006', 'm1', DET);
  clock += 1000;
  const o2 = add('1006', 'm2', DET);
  clock += 61000;
  const n = calls.length;
  await fb.tick(deps);
  assert.equal(bridge.get(t.eventId).response.fields.REASON, 'test_or_invalid_conversation');
  assert.equal(bridge.get(old.eventId).response.fields.REASON, 'older_than_max_age');
  assert.equal(bridge.get(o1.eventId).response.fields.REASON, 'newer_customer_message_exists');
  assert.equal(bridge.get(o1.eventId).response.decision, 'WAIT');
  assert.equal(bridge.get(o2.eventId).response.decision, 'SEND');
  assert.equal(calls.length, n + 1, '닫는 건에는 Claude를 부르지 않는다');

  // 7) Astra가 받고 10분 넘게 멈춘 건은 이어받는다. 10분 전에는 기다린다.
  const s = add('1007', 'm1', DET);
  bridge.claim(s.eventId, 'codex-heartbeat'); setTimes(s.eventId, { claimedAt: new Date(clock).toISOString() });
  clock += 5 * 60000;
  await fb.tick(deps);
  assert.equal(bridge.get(s.eventId).status, 'dispatched');
  clock += 6 * 60000;
  await fb.tick(deps);
  assert.equal(bridge.get(s.eventId).status, 'completed');
  assert.equal(bridge.get(s.eventId).workerId, fb.WORKER_ID);

  // 8) Claude 키가 없어도 정해진 문구로 보낸다. 정책 enabled:false면 아무것도 안 한다.
  const k = add('1008', 'm1', DET);
  clock += 61000;
  await fb.tick({ ...deps, hasKey: () => false });
  assert.equal(bridge.get(k.eventId).response.fields.REASON, 'claude_key_missing');
  const off = add('1009', 'm1', DET);
  clock += 61000;
  policy.customerRoomFallback.enabled = false;
  r = await fb.tick(deps);
  assert.equal(r.enabled, false);
  assert.equal(bridge.get(off.eventId).status, 'pending');

  // 9) 서버 연결: 15초마다 돌고, 대기열 초안에 첨부 이름이 들어가며, 실제 정책 파일 값이 승인한 한도와 같다.
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
  assert.match(server, /runCustomerRoomFallback\(\)\.catch[^\n]+15000\);/);
  assert.match(server, /attachment: path\.basename\(String\(deterministicReply\.attachment\?\.fileUrl/);
  assert.match(server, /validReply: validSoomgoAiReply/);
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8')).customerRoomFallback;
  assert.equal(real.dailyMaxCalls, 40); // 2026-09-24 decisions 7-5: 하루 40건(이전 30)
  assert.equal(real.monthlyBudgetKrw, 15000); // 월 10달러
  assert.equal(real.dailyBudgetKrw, 3000);
  assert.equal(real.waitSeconds, 60);
  // 9/23 준희 지시: Opus 5.5로 부르고, 모델 이름이 runClaude까지 넘어간다
  assert.equal(real.model, 'claude-opus-5-5');
  // 9/23 16:26 정책에서 합치기 자체를 끔(enabled:false, 고객응대 아스트라 전담). 여기서는 켰을 때 모델이 넘어가는지만 본다.
  const realOn = { ...real, enabled: true };
  assert.equal(fb.readConfig({ customerRoomFallback: realOn }).model, 'claude-opus-5-5');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server', 'customer-room-fallback.js'), 'utf8'), /\.\.\.\(cfg\.model \? \{ model: cfg\.model \} : \{\}\)/);
  assert.ok(fb.readConfig({ customerRoomFallback: realOn }));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('customer-room-fallback: PASS');
})().catch(error => { console.error(error); process.exit(1); });
