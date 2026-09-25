'use strict';
// P4(2026-09-23 준희 채택): 견적 보낸 대화의 후속 답장 A 금액 확인 · B 고객 준비 늦어짐 · C 견적 다시 묻기.
// 문구 원본 docs/soomgo/p4-reply-drafts.md. 준희 결정: B의 '견적 금액 유지' 문장은 뺌, 날짜 대신 '고용 확정 후 {소요일} 안에', 수정 횟수는 견적 값.
// 외부 호출 없음.
const assert = require('assert');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { soomgoReply, contextualizeSoomgoReplyBody, shouldUseSoomgoAiReply } = require('../server/relay-server.js');
const quote = { amount: 51000, days: '1~2일', label: '교정·교열·윤문', serviceId: 'document_writing', basicScope: '기본 포함 범위: A4 10쪽 교정·교열·윤문, 수정 3회입니다.', includedRevisions: 3 };
const ctx = '[고수] 요청 주셔서 감사합니다. 요청서 확인했습니다.\n견적 51,000원 · 1~2일 안에 납품 · 수정 3회 포함';
const ask = (message, extra = {}) => soomgoReply({ conversationId: '235999992', message, quote, quoteSent: true, priorTemplateKeys: [], conversationText: `${ctx}\n[고객] ${message}`, ...extra });

// A — 금액 확인
const a = ask('51,000원 맞나요?');
assert.equal(a.templateKey, 'followup_price_confirm');
assert.equal(a.messageId, 'soomgo.followup.price_confirm');
assert.equal(a.messageVersion, 'v1');
assert.equal(a.autoSend, true);
assert.equal(a.text, '네, 보내드린 견적 기준으로 교정·교열·윤문 전체 51,000원입니다.\n고용 확정 후 1~2일 안에 보내드리고, 수정 3회가 포함되어 있습니다.\n숨고페이 안전결제로 진행되어, 결과물을 확인하신 뒤 거래 확정하시면 됩니다.\n\n분량이 요청서보다 늘어나면 작업 전에 먼저 말씀드리고, 동의하신 뒤에만 진행합니다.\n이대로 진행을 원하시면 고용 요청을 눌러 주세요.');
assert.equal(shouldUseSoomgoAiReply(a), false, '정해진 문구 그대로 보낸다');

// B — 고객 준비 늦어짐 (견적 유지 문장 없음)
const b = ask('아직 초안이 안나와서');
assert.equal(b.templateKey, 'followup_customer_waiting');
assert.equal(b.messageId, 'soomgo.followup.customer_waiting');
assert.equal(b.text, '네, 알려주셔서 감사합니다. 급하지 않으니 초안 준비되시는 대로 편하게 보내주세요.\n받는 날을 기준으로 다시 날짜를 잡아 말씀드리겠습니다.');
assert.doesNotMatch(b.text, /유지|원은/);
assert.equal(ask('좀 기다려야 할거 같아요..').templateKey, 'followup_customer_waiting');
assert.match(ask('아직 영상 준비 중이에요', { quote: { ...quote, serviceId: 'subtitle' } }).text, /영상 준비되시는/);
assert.match(ask('아직 원고 정리 중이라', { quote: { ...quote, serviceId: 'presentation' } }).text, /원고 준비되시는/);

// C — 견적·납기 다시 묻기
const c = ask('위 내용을 요청드리려고 하는데 견적이 어떻게 되나요?');
assert.equal(c.templateKey, 'followup_quote_recap');
assert.equal(c.messageId, 'soomgo.followup.quote_recap');
assert.equal(c.text, '보내드린 견적 다시 정리해 드립니다.\n교정·교열·윤문 — 51,000원, 고용 확정 후 1~2일 안에 보내드립니다. 수정 3회 포함입니다.\n숨고페이 안전결제로 진행되어, 결과물을 확인하신 뒤 거래 확정하시면 됩니다.\n\n이대로 진행을 원하시면 고용 요청을 눌러 주세요.');
assert.equal(ask('언제까지 가능하신가요?').templateKey, 'followup_quote_recap');
assert.equal(ask('견적 알 수 있을까요?').templateKey, 'followup_quote_recap');

// 새 숫자 없음: 답장 속 숫자는 견적 값(금액·소요일·수정 횟수)뿐
for (const r of [a, c]) {
  const nums = (r.text.match(/\d[\d,]*/g) || []).map(n => n.replace(/,/g, ''));
  assert.deepEqual([...new Set(nums)].sort(), ['1', '2', '3', '51000'].filter(n => nums.includes(n)).sort(), r.templateKey);
}

// 제외 조건 — 각각 A·B·C로 나가지 않는다
const notFollowup = (r, why) => assert.ok(!/^followup_/.test(String(r.templateKey || '')), why);
assert.equal(ask('장당39000원인가요?').templateKey, 'manual_unit_price_question', '단위 금액 질문 → 사람 확인');
assert.equal(ask('장당39000원인가요?').autoSend, false);
assert.equal(ask('39,000원 맞나요?').templateKey, 'manual_price_mismatch', '다른 금액 → 사람 확인');
notFollowup(ask('51,000원 결제는 어떻게 하나요?'), '결제');
notFollowup(ask('견적 금액 환불 되나요?'), '환불');
notFollowup(ask('취소하면 견적 어떻게 되나요?'), '취소');
notFollowup(ask('여기에 밑줄 그은 부분만 검토해주시면 되긴하는데 견적 알수잇을가여'), '새 범위');
notFollowup(ask('10쪽 추가하면 견적이 얼마인가요?'), '분량 추가');
notFollowup(ask('51,000원 맞나요?', { quoteSent: false }), '견적 발송 미확인');
notFollowup(ask('아직 초안이 안나와서', { quoteSent: false }), '견적 발송 미확인(B)');
notFollowup(ask('견적이 어떻게 되나요?', { quote: null }), '견적 없음');
notFollowup(ask('견적이 어떻게 되나요?', { hiredConversation: true }), '고용 확정');
notFollowup(ask('아직 초안이 안나와서', { hiredConversation: true }), '고용 확정(B)');
notFollowup(ask('생각 좀 해보고 연락드릴게요'), '나중 연락은 기존 감사 답장');

// 같은 종류는 한 번만 — 두 번째는 사람 확인
for (const [msg, key] of [['51,000원 맞나요?', 'followup_price_confirm'], ['아직 초안이 안나와서', 'followup_customer_waiting'], ['견적이 어떻게 되나요?', 'followup_quote_recap']]) {
  const again = ask(msg, { priorTemplateKeys: [key] });
  assert.equal(again.templateKey, 'manual_followup_repeat', key);
  assert.equal(again.autoSend, false, key);
  assert.equal(again.manualReview, true, key);
}

// 대화 맥락: 발송 확인·이미 보낸 답장 종류를 state에서 싣는다
const state = {
  soomgoLeads: [{ requestId: 'R1', conversationId: '235999993', quote, quoteEvidence: { status: 'sent' } }, { requestId: 'R2', conversationId: '235999994', quote, quoteEvidence: { status: 'uncertain' } }],
  soomgoReplies: [
    { conversationId: '235999993', reply: { autoSend: true, templateKey: 'followup_quote_recap' } },
    { conversationId: '235999993', reply: { autoSend: false, templateKey: 'followup_price_confirm' } },
    { conversationId: '235999999', reply: { autoSend: true, templateKey: 'followup_customer_waiting' } }
  ]
};
const body1 = contextualizeSoomgoReplyBody(state, { conversationId: '235999993', message: '견적이 어떻게 되나요?' });
assert.equal(body1.quoteSent, true);
assert.deepEqual(body1.priorTemplateKeys, ['followup_quote_recap'], '보낸 것만, 이 대화 것만');
assert.equal(soomgoReply(body1).templateKey, 'manual_followup_repeat');
assert.equal(soomgoReply(contextualizeSoomgoReplyBody(state, { conversationId: '235999993', message: '51,000원 맞나요?' })).templateKey, 'followup_price_confirm');
assert.equal(contextualizeSoomgoReplyBody(state, { conversationId: '235999994', message: 'x' }).quoteSent, false);
console.log('p4-followup-replies: PASS');
process.exit(0);
