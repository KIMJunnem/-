'use strict';
// 9/25 준희 "봇이 판단 못 하는 채팅·상황은 Claude한테 물어보고 그렇게 실행": 보류된 고객 말을 Claude 답장 대기열로.
const assert = require('assert');
const R = require('../server/relay-server.js');

const quote = { amount: 69000, days: '1~2일', serviceId: 'video_edit' };
const base = { conversationId: '235950001', quote, quoteSent: true };
const on = { chatSupervisor: { enabled: true } };
function ask(message, extra = {}) {
  const body = { ...base, message, ...(extra.body || {}) };
  const det = extra.det || R.applyChatReplyPolicy(body, { autoSend: true, text: '기본 답' });
  const captured = [];
  const enqueue = (b, d) => { captured.push(d); return { autoSend: false, manualReview: false, pendingRoom: true, templateKey: 'astra_room_pending' }; };
  const out = R.supervisorReply(body, det, { policy: extra.policy || on, enqueue });
  return { det, out, sent: captured[0] || null };
}

// 1) 환불: Claude에게 묻고, 준희 알림도 유지. 규칙에 "약속하지 않는다"
let r = ask('환불해 주세요');
assert.strictEqual(r.det.manualReview, true);
assert.strictEqual(r.out.supervisor, 'payment');
assert.strictEqual(r.out.attention, true);
assert.strictEqual(r.out.pendingRoom, true);
assert.match(r.sent.factsText, /약속하지 않는다/);
assert.match(r.sent.factsText, /"보류"라고만/);
assert.strictEqual(r.sent.autoSend, false, '정해진 문구로 대신 보내지 않음(Claude 실패면 준희)');
// 2) 파일 요청: 알림 유지, 보냈다고 하지 않음
r = ask('완성본 보내주세요');
assert.strictEqual(r.out.supervisor, 'file_delivery'); assert.strictEqual(r.out.attention, true);
assert.match(r.sent.factsText, /파일을 보냈다고 하지 않는다/);
// 3) AI 질문: 알림 없이 Claude가 답
r = ask('혹시 AI로 만드시는 건가요?');
assert.strictEqual(r.out.supervisor, 'ai_question'); assert.strictEqual(r.out.attention, false);
// 4) 보류가 아닌 답·건너뜀·대화 종료·비상·고용 뒤 작업은 그대로
assert.strictEqual(ask('얼마예요?').out, null, '자동 답이면 물을 필요 없음');
assert.strictEqual(ask('x', { det: { autoSend: false, manualReview: true, skip: true } }).out, null);
assert.strictEqual(ask('x', { det: { autoSend: false, manualReview: true, closeConversation: true } }).out, null);
assert.strictEqual(ask('x', { det: { autoSend: false, manualReview: true, emergency: true } }).out, null);
assert.strictEqual(ask('환불해 주세요', { body: { hiredConversation: true } }).out, null);
// 5) 스위치 끄면 예전처럼 준희 알림만
assert.strictEqual(ask('환불해 주세요', { policy: { chatSupervisor: { enabled: false } } }).out, null);
// 6) Claude가 "보류"라고 쓰면 검사에 걸려 보내지 않음(→ 준희)
assert.strictEqual(R.validSoomgoAiReply('보류', '(자동 규칙이 보류함)', { requireNumbers: false }), false);
// 7) 견적 판단·첨부 판단은 켜짐(준희 9/25)
const policy = require('../server/config/astra-relay-operating-policy.json');
assert.strictEqual(policy.quoteJudge.enabled, true);
assert.strictEqual(policy.attachmentJudge.enabled, true);
console.log('봇이 못 정한 채팅은 Claude에게 묻기 통과');
