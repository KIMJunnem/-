'use strict';

const assert = require('node:assert/strict');
const {
  buildSoomgoQuote,
  soomgoReply,
  workflowPaymentAmount
} = require('../server/relay-server.js');

// Use a price that divides cleanly by four so this contract does not decide
// whether future non-round sample prices should be rounded to 100 or 1,000 won.
const quote = buildSoomgoQuote({
  purpose: 'PPT 제작',
  volume: '10장',
  topic: '회사 소개 자료'
}).quote;

assert.equal(quote.amount, 40000, 'the fixture must use the fixed PPT entry price');
assert.equal(quote.sampleAvailable, true, 'every quoted service must expose the sample option');
assert.equal(quote.sampleRate, 0.25, 'the sample rate must be 25% of the sale price');
assert.equal(quote.sampleAmount, 10000, '40,000 won must produce a 10,000 won sample');
assert.equal(quote.sampleCreditOnFullOrder, true, 'sample payment must be credited to the full order');
assert.equal(typeof quote.sampleScope, 'string');
assert.ok(quote.sampleScope.trim().length >= 5, 'the customer must receive a concrete sample scope');
assert.match(quote.message, /^샘플 구매 가능/m, 'the quote must prominently lead with sample availability');
assert.match(quote.message, /25%/);
assert.match(quote.message, /(?:본|전체)\s*작업.*(?:전액\s*)?차감|샘플\s*(?:결제|구매)액.*(?:전액\s*)?차감/);
assert.match(quote.followupMessage, /^샘플 구매 가능/m, 'the first chat message must lead with the sample offer');
assert.match(quote.followupMessage, /10,000원/);

const sampleQuestion = soomgoReply({
  conversationId: 'TEST-SAMPLE-OFFER',
  message: '샘플을 먼저 볼 수 있나요?',
  conversationText: '[고객] 샘플을 먼저 볼 수 있나요?',
  quote
});
assert.equal(sampleQuestion.autoSend, true);
assert.equal(sampleQuestion.manualReview, false);
assert.equal(sampleQuestion.templateKey, 'sample_offer');
assert.notEqual(sampleQuestion.hireRequest, true, 'asking about a sample is not an order confirmation');
assert.match(sampleQuestion.text, /10,000원/);
assert.match(sampleQuestion.text, /25%/);
assert.match(sampleQuestion.text, /(?:본|전체)\s*작업.*(?:전액\s*)?차감|샘플\s*(?:결제|구매)액.*(?:전액\s*)?차감/);
assert.match(sampleQuestion.text, new RegExp(escapeRegExp(quote.sampleScope.trim().slice(0, 12))));

const sampleYes = soomgoReply({
  conversationId: 'TEST-SAMPLE-YES',
  message: '네',
  conversationText: `[내 답변] ${sampleQuestion.text}\n[고객] 네`,
  quote
});
assert.equal(sampleYes.templateKey, 'sample_order_ready');
assert.equal(sampleYes.hireRequest, true);
assert.equal(sampleYes.sampleOrder, true);

const sampleOrder = soomgoReply({
  conversationId: 'TEST-SAMPLE-ORDER',
  message: '샘플로 먼저 진행할게요.',
  conversationText: [
    '[내 답변] 샘플 구매 가능 · 판매가의 25%인 10,000원이며 본 작업 진행 시 전액 차감합니다.',
    '[고객] 샘플로 먼저 진행할게요.'
  ].join('\n'),
  quote
});
assert.equal(sampleOrder.autoSend, true);
assert.equal(sampleOrder.manualReview, false);
assert.equal(sampleOrder.templateKey, 'sample_order_ready');
assert.equal(sampleOrder.hireRequest, true, 'an explicit sample order must enter the hire flow');
assert.equal(sampleOrder.sampleOrder, true, 'the hire flow must distinguish sample work from full work');
assert.ok(sampleOrder.sampleQuote && typeof sampleOrder.sampleQuote === 'object');
assert.notEqual(sampleOrder.sampleQuote, quote, 'the sample quote must not mutate the full quote object');
assert.equal(sampleOrder.sampleQuote.amount, quote.sampleAmount);
assert.equal(sampleOrder.sampleQuote.sampleAvailable, true);
assert.equal(sampleOrder.sampleQuote.sampleCreditOnFullOrder, true);
assert.equal(sampleOrder.sampleQuote.sampleScope, quote.sampleScope);
assert.match(sampleOrder.text, /10,000원/);
assert.match(sampleOrder.text, /(?:본|전체)\s*작업.*(?:전액\s*)?차감|샘플\s*(?:결제|구매)액.*(?:전액\s*)?차감/);

// Paying for the sample must charge the sample amount itself. The credit is
// consumed only by the later full order.
assert.equal(workflowPaymentAmount({
  quote: sampleOrder.sampleQuote,
  sampleOrder: true,
  sampleCreditAmount: quote.sampleAmount,
  additionalFees: []
}), 10000);

const fullWorkflow = {
  quote: { amount: quote.amount },
  sampleOrder: false,
  sampleCreditAmount: quote.sampleAmount,
  additionalFees: [
    { amount: 5000, accepted: true },
    { amount: 10000, accepted: false }
  ]
};
const creditedAmount = workflowPaymentAmount(fullWorkflow);
assert.equal(creditedAmount, 35000, 'full amount + accepted extras - one sample credit');

// Workflow recalculation happens at completion and again when the payment
// action is recorded. A previously stored paymentAmount must not cause the
// same sample credit to be subtracted for a second time.
fullWorkflow.paymentAmount = creditedAmount;
assert.equal(workflowPaymentAmount(fullWorkflow), creditedAmount, 'sample credit must be idempotent');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

console.log('Soomgo sample offer, sample hire, and one-time credit contracts passed.');
