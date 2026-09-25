'use strict';
// 9/25 지시 31: 제브 문지기(가짜 응답). 규칙이 못 정한 고객 말만, 확률 0.9 이상일 때만 Claude 대신 처리.
const assert = require('assert');
const R = require('../server/relay-server.js');
const jevGate = require('../server/jev-gate');
const { redact } = require('../server/jev-gate-redact');

const on = { jevGate: { enabled: true, threshold: 0.9, dailyMaxCalls: 500, timeoutMs: 2000 } };
const quote = { amount: 69000, days: '1~2일', serviceId: 'video_edit' };
const base = { conversationId: '235931001', quote, quoteSent: true, customerName: '김가명' };
const det = { autoSend: true, text: '' };

function fakeDeps(choice, confidence, sent = []) {
  return {
    getKey: () => 'sk-test-jev-000000',
    callJev: async args => { sent.push(args); if (choice === 'throw') { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; } return { answers: { intent: { choice, confidence } } }; }
  };
}
async function gate(message, choice, confidence, extra = {}) {
  const logs = []; const sent = [];
  const reply = await R.jevGateReply({ ...base, message }, extra.det || det, extra.state || {}, { policy: extra.policy || on, deps: fakeDeps(choice, confidence, sent), templatesForHumanMessages: false, writeLog: e => logs.push(e) });
  return { reply, logs, sent };
}

(async () => {
  // 1) 보기별 처리(0.9 이상)
  let r = await gate('숨고 알리미 새 소식', 'system_notice', 0.95);
  assert.strictEqual(r.reply.skip, true); assert.strictEqual(r.reply.autoSend, false);
  r = await gate('네 알겠습니다 나중에 연락드릴게요', 'thanks', 0.97);
  assert.strictEqual(r.reply.templateKey, 'later_contact_thanks'); assert.strictEqual(r.reply.autoSend, true);
  r = await gate('파일 언제 보내주시나요', 'forbidden', 0.93);
  assert.strictEqual(r.reply.manualReview, true); assert.strictEqual(r.reply.autoSend, false); assert.strictEqual(r.reply.attention, true);
  for (const choice of ['proceed', 'question', 'other']) {
    r = await gate('이거 어떻게 진행돼요', choice, 0.99);
    assert.strictEqual(r.reply, null, `${choice}: Claude 그대로`);
  }
  // 2) 0.9 미만 → Claude
  r = await gate('숨고 알리미 새 소식', 'system_notice', 0.89);
  assert.strictEqual(r.reply, null);
  assert.strictEqual(r.logs[0].action, 'claude');
  // 3) 실패·시간 초과 → Claude
  r = await gate('안녕하세요', 'throw', 0);
  assert.strictEqual(r.reply, null);
  assert.match(r.logs[0].reason, /jev_error/);
  // 4) 규칙이 먼저: 금지 주제(환불)·짧은 승낙(고용 요청)은 제브를 부르지 않음
  const refundDet = R.applyChatReplyPolicy({ ...base, message: '환불해 주세요' }, { autoSend: true, text: 'x' });
  r = await gate('환불해 주세요', 'thanks', 0.99, { det: refundDet });
  assert.strictEqual(r.reply, null); assert.strictEqual(r.sent.length, 0, '규칙이 정한 것은 제브 안 부름');
  r = await gate('할게요', 'thanks', 0.99, { det: { autoSend: true, hireRequest: true, templateKey: 'hire_ready', text: '감사합니다.' } });
  assert.strictEqual(r.reply, null); assert.strictEqual(r.sent.length, 0);
  // 5) 스위치 꺼짐 → 부르지 않음
  r = await gate('숨고 알리미', 'system_notice', 0.99, { policy: { jevGate: { enabled: false } } });
  assert.strictEqual(r.reply, null); assert.strictEqual(r.sent.length, 0);
  // 6) 하루 상한
  const day = jevGate.kstDay();
  const full = { jevGateLog: Array.from({ length: 500 }, () => ({ day, called: true })) };
  r = await gate('숨고 알리미', 'system_notice', 0.99, { state: full });
  assert.strictEqual(r.reply, null); assert.strictEqual(r.sent.length, 0); assert.strictEqual(r.logs[0].reason, 'daily_cap');
  // 7) 보내는 글은 가림, 기록에는 본문 없음
  r = await gate('김가명입니다 010-1234-5678 hong@test.com https://a.b/c (주)가나다 문의', 'other', 0.5);
  const text = r.sent[0].state.message;
  assert.ok(!/김가명|010-1234-5678|hong@test\.com|https:|가나다/.test(text), text);
  assert.ok(!JSON.stringify(r.logs).includes('문의'), '기록에 본문 없음');
  assert.strictEqual(redact('안녕하세요'), '안녕하세요');
  console.log('지시 31 제브 문지기 통과');
})().catch(error => { console.error(error); process.exit(1); });
