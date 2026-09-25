'use strict';

const assert = require('node:assert/strict');
const {
  soomgoSamplePrice,
  soomgoSampleCodeHash,
  soomgoSampleCodeFromText,
  findSoomgoSampleLink,
  soomgoReply
} = require('../server/relay-server.js');

assert.equal(soomgoSamplePrice(17000), 4250, 'the sample must be exactly 25%, not rounded back to a full 1,000 won');
assert.equal(soomgoSampleCodeFromText('확인코드 rd-s-a1b2c3d4 입니다'), 'RD-S-A1B2C3D4');

const code = 'RD-S-A1B2C3D4';
const state = {
  soomgoSampleLinks: [{
    sampleWorkflowId: 'WF-SAMPLE-1',
    codeHash: soomgoSampleCodeHash(code),
    code,
    creditAmount: 7000,
    creditAvailable: true,
    linkedConversationIds: [],
    usedAt: null
  }]
};

const byCode = findSoomgoSampleLink(state, { conversationId: 'NEW-CHAT', message: `코드 ${code}` });
assert.equal(byCode.link.sampleWorkflowId, 'WF-SAMPLE-1');
assert.equal(byCode.code, code);

state.soomgoSampleLinks[0].linkedConversationIds.push('NEW-CHAT');
const byConversation = findSoomgoSampleLink(state, { conversationId: 'NEW-CHAT', message: '진행하겠습니다' });
assert.equal(byConversation.link.sampleWorkflowId, 'WF-SAMPLE-1');

const quote = { amount: 28000, days: '당일~1일', basicScope: 'PPT 10장', extraScope: '추가 범위 사전 안내' };
const linkedReply = soomgoReply({
  conversationId: 'NEW-CHAT',
  message: code,
  conversationText: '',
  quote,
  sampleCredit: { code, sampleWorkflowId: 'WF-SAMPLE-1', amount: 7000, fullAmount: 28000 }
});
assert.equal(linkedReply.templateKey, 'sample_credit_linked');
assert.match(linkedReply.text, /28,000원/);
assert.match(linkedReply.text, /7,000원/);
assert.match(linkedReply.text, /21,000원/);

state.soomgoSampleLinks[0].usedAt = new Date().toISOString();
assert.equal(findSoomgoSampleLink(state, { conversationId: 'ANOTHER-CHAT', message: code }).link, null, 'a used code must not be reusable');

console.log('Soomgo sample continuation code and credit link contracts passed.');
