const assert = require('node:assert/strict');
const { soomgoReply, workflowPaymentAmount } = require('../server/relay-server.js');
const history = '[내 답변] A4 2쪽, 29,000원, 당일~1일, 수정 1회, 추가금 사전 동의 기준입니다.';
let failures = 0;
for (const message of ['진행해주세요라고 하면 바로 결제되나요?', '진행해주세요. 그런데 가격은 아직 동의 안 했어요', '추가금 동의 안 합니다. 진행해주세요는 취소할게요']) {
  try {
    const reply = soomgoReply({ conversationId: 'CONSENT-LOCAL', message, conversationText: history, quote: { amount: 29000 } });
    assert.notEqual(reply.hireRequest, true);
    console.log('PASS consent:', message);
  } catch (error) { failures++; console.error('FAIL consent:', message); }
}
try {
  assert.equal(workflowPaymentAmount({ quote: { amount: 29000 }, additionalFees: [{ amount: 10000 }, { amount: 10000, accepted: false }, { amount: 5000, accepted: true }] }), 34000);
  console.log('PASS unapproved fees excluded');
} catch (error) { failures++; console.error('FAIL unapproved fees included'); }
process.exitCode = failures ? 1 : 0;
