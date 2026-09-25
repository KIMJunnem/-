'use strict';
// 9/25 지시 32(decisions 7-18): 결제 진행·흥정은 챗봇이. 환불·취소·분쟁·계좌·세금 서류는 그대로 준희.
// 할인은 방마다 한 번, 보낸 견적의 85%까지(1,000원 단위). 가격표 밖 추가 작업은 150%까지. "결제했어요"는 답장 + 준희 확인 알림.
const assert = require('assert');
const R = require('../server/relay-server.js');

// 1) 금지 주제
assert.strictEqual(R.chatForbiddenTopic('숨고페이로 결제하면 되나요?'), '');
assert.strictEqual(R.chatForbiddenTopic('좀 더 깎아 주실 수 있나요?'), '');
assert.strictEqual(R.chatForbiddenTopic('결제했어요'), '');
for (const m of ['환불해 주세요', '취소할게요', '계좌로 보내도 될까요?', '세금계산서 되나요?']) assert.strictEqual(R.chatForbiddenTopic(m), 'payment', m);
assert.strictEqual(R.chatForbiddenTopic('혹시 AI로 만드시는 건가요?'), 'ai_question');

// 2) 새 금액 검사: 범위(69,000원 견적 → 최저 59,000원, 최대 103,000원) 안이면 통과
const range = { min: 59000, max: 103000 };
const facts = '견적 금액은 69,000원입니다.';
assert.strictEqual(R.validSoomgoAiReply('그럼 59,000원에 해 드릴 수 있습니다!', facts, { requireNumbers: false, amountRange: range }), true);
assert.strictEqual(R.validSoomgoAiReply('추가 작업까지 하면 99,000원에 해 드릴 수 있습니다!', facts, { requireNumbers: false, amountRange: range }), true);
assert.strictEqual(R.validSoomgoAiReply('그럼 55,000원에 해 드릴 수 있습니다!', facts, { requireNumbers: false, amountRange: range }), false, '85% 아래는 막음');
assert.strictEqual(R.validSoomgoAiReply('추가 작업 포함 120,000원입니다.', facts, { requireNumbers: false, amountRange: range }), false, '150% 위는 막음');
assert.strictEqual(R.validSoomgoAiReply('그럼 59,500원에 해 드릴 수 있습니다!', facts, { requireNumbers: false, amountRange: range }), false, '1,000원 단위만');
assert.strictEqual(R.validSoomgoAiReply('그럼 59,000원에 해 드릴 수 있습니다!', facts, { requireNumbers: false }), false, '범위가 없으면 예전처럼 막음');

// 3) [사실]: 처음이면 최저가 안내, 이미 낮췄으면 더 낮추지 않음
const quote = { amount: 69000, days: '1~2일', serviceId: 'video_edit' };
let text = R.soomgoChatFactsText({ quote });
assert.match(text, /최저 59,000원까지/);
assert.match(text, /최대 103,000원까지/);
assert.match(text, /숨고페이로 결제/);
text = R.soomgoChatFactsText({ quote, conversationText: '[고객] 좀 깎아 주세요\n[내 답변] 그럼 62,000원에 해 드릴 수 있습니다!\n[고객] 조금만 더요' });
assert.match(text, /이미 62,000원으로 한 번 낮췄다/);
assert.doesNotMatch(text, /최저 59,000원까지/);

// 4) 날짜가 앞에 붙은 진행 의사도 고용 요청
for (const m of ['25일까지 해주세요', '10월 3일까지 해 주세요', '다음 주 월요일로 할게요', '내일까지 부탁드려요']) assert.strictEqual(R.isSoomgoShortProceed(m), true, m);
for (const m of ['25일까지 가능한가요?', '25일까지 확인해 주세요']) assert.strictEqual(R.isSoomgoShortProceed(m), false, m);

// 5) Claude 대기열: 흥정은 범위와 함께 넘기고, "결제했어요"는 알림을 붙인다
const captured = [];
const enqueue = (body, det) => { captured.push(det); return { autoSend: false, manualReview: false, pendingRoom: true, templateKey: 'astra_room_pending' }; };
const opts = { enqueue, templatesForHumanMessages: false };
const base = { conversationId: '235909001', quote, quoteSent: true };
let out = R.humanChatViaClaude({ ...base, message: '조금만 깎아 주실 수 있나요?' }, { autoSend: true, text: '' }, opts);
assert.ok(out && out.humanViaClaude, '흥정도 Claude로');
assert.deepStrictEqual({ min: captured[0].amountRange.min, max: captured[0].amountRange.max }, range);
out = R.humanChatViaClaude({ ...base, message: '방금 숨고페이로 결제했어요' }, { autoSend: true, text: '' }, opts);
assert.strictEqual(out.attention, true);
assert.strictEqual(out.paymentCheck, true);
assert.match(out.reason, /결제 확인 필요/);
out = R.humanChatViaClaude({ ...base, message: '결제는 언제 하면 되나요?' }, { autoSend: true, text: '' }, opts);
assert.ok(!out.paymentCheck, '결제 질문은 알림 없이 답장');
console.log('지시 32 결제·흥정 통과');

// 6) 할인한 방에서 진행하면 고용 요청은 그대로, 준희에게 결제 금액 확인 알림
{
  const convo = '[고수] 견적 69,000원 · 1~2일 · 수정 2회 포함 · 추가 비용은 사전 동의\n[고객] 좀 깎아 주세요\n[내 답변] 그럼 62,000원에 해 드릴 수 있습니다!\n[고객] 25일까지 해주세요';
  const r = R.soomgoReply({ conversationId: '235909002', message: '25일까지 해주세요', conversationText: convo, quote: { ...quote, basicScope: '컷편집·자막' } });
  assert.strictEqual(r.templateKey, 'hire_ready');
  assert.strictEqual(r.hireRequest, true);
  assert.strictEqual(r.agreedAmount, 62000);
  assert.match(r.reason, /이 금액으로 작업·결제 요청/);
  assert.ok(!r.attention, '준희 확인 없이 봇이 정함');
  // 고용 연결 때 이 방의 합의 금액을 작업·결제 금액으로(범위 밖·다른 방은 무시)
  const state = { soomgoReplies: [{ conversationId: '235909002', reply: { agreedAmount: 62000 } }, { conversationId: '235909003', reply: { agreedAmount: 50000 } }] };
  assert.strictEqual(R.agreedDiscountFor(state, '235909002', quote), 62000);
  assert.strictEqual(R.agreedDiscountFor(state, '235909003', quote), null, '85% 아래는 인정 안 함');
  assert.strictEqual(R.agreedDiscountFor(state, '235909009', quote), null);
  console.log('할인 합의 금액 자동 반영 통과');
}
