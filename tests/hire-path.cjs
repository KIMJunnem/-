// 2026-09-23 개선 I1: 견적을 받은 고객의 짧은 승낙은 고용 요청으로, 거절에는 감사 인사만.
const assert = require('assert');
const { soomgoReply, isSoomgoShortProceed: yes, isSoomgoDecline: no, shouldUseSoomgoAiReply } = require('../server/relay-server.js');
const quoteText = '[고수] 요청 주셔서 감사합니다. 요청서 확인했습니다.\n견적 21,000원 · 당일~1일 안에 납품 · 수정 3회 포함\n결제는 숨고페이 안전결제라, 받아보시고 확인하신 뒤에 거래 확정하시면 됩니다.\nA4 2쪽 기준입니다.\n어떤 용도로 쓰실 문서인가요?';
const quote = { amount: 21000, days: '당일~1일', serviceId: 'document_writing' };
const ask = (message, q = quote, ctx = quoteText) => soomgoReply({ conversationId: '235000001', message, conversationText: `${ctx}\n[고객] ${message}`, quote: q });

// 실제 대화(…2101·…9573)에서 나온 승낙 → 고용 요청
for (const m of ['해주세요', '할게요', '네 그렇게 해주세요', '해주세여', '네 시작해주세요', '알아서 해주세요', '부탁드려요', '맡길게요', '진행해주세요']) {
  const r = ask(m);
  assert.equal(r.templateKey, 'hire_ready', m);
  assert.equal(r.hireRequest, true, m);
}
// 견적이 없으면 짧은 승낙만으로 고용 요청하지 않는다
assert.notEqual(ask('해주세요', { amount: 0 }, '[고객] 해주세요').templateKey, 'hire_ready');
// 승낙이 아닌 것
for (const m of ['파일 확인해주세요', '메일로 보내주세요', '바로 해주실수있나요', '해주실 수 있나요?', '네 좋아요', '괜찮습니다', '진행하면 바로 결제되나요?']) assert.equal(yes(m), false, m);
// 거절 → 감사 인사만, 정해진 문구 그대로
// '취소'는 결제가 걸려 있을 수 있어 기존대로 사람 확인(manual_cancel_review)
assert.equal(ask('취소할게요').templateKey, 'manual_cancel_review');
for (const m of ['안 할게요', '다른 분께 맡기기로 했어요', '필요 없어졌어요', '안 해도 될 것 같아요']) {
  assert.equal(no(m), true, m);
  const r = ask(m);
  assert.equal(r.templateKey, 'decline_thanks', m);
  assert.equal(r.hireRequest, undefined);
  assert.match(r.text, /감사합니다/);
  assert.doesNotMatch(r.text, /[?？]/, '거절한 고객에게 질문하지 않는다');
  assert.equal(shouldUseSoomgoAiReply(r), false);
}
for (const m of ['괜찮습니다', '안녕하세요', '안 되나요?', '할게요']) assert.equal(no(m), false, m);
console.log('hire-path: PASS');
