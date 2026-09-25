const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createKmongAutomation, classifyService, deterministicReply, isSystemMessage } = require('../server/kmong-automation');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-kmong-'));
const events = new Map();
const mockBridge = {
  config() { return { enabled: true, targetThreadId: 'test-thread', policyVersion: 'test-v1' }; },
  enqueue(input) {
    const id = `event-${input.idempotencyKey}`;
    if (!events.has(id)) events.set(id, { eventId: id, status: 'pending', input });
    return { duplicate: events.size > 1, event: JSON.parse(JSON.stringify(events.get(id))) };
  },
  get(id) { return events.has(id) ? JSON.parse(JSON.stringify(events.get(id))) : null; },
  markDelivery(id, status, evidence) { const event = events.get(id); Object.assign(event, { deliveryStatus: status, evidence }); return { event }; }
};

assert.equal(classifyService({ productTitle: '영상 흐름에 맞춰 정확한 자막을 제작해 드립니다' }), 'subtitle');
assert.equal(classifyService({ message: '제공 자료로 회사 소개 문서 작성 부탁드립니다' }), 'document_writing');
assert.equal(classifyService({ message: '로고를 만들고 싶어요' }), null);
assert.equal(isSystemMessage('크몽 알림 주문이 접수되었습니다.'), true);

const subtitle = deterministicReply({ serviceType: 'subtitle', message: '영상 자막 문의드립니다.' });
assert.equal(subtitle.templateKey, 'subtitle_duration');
assert.match(subtitle.text, /몇 분/);
assert.doesNotMatch(subtitle.text, /1\)|진행하겠습니다|숨고/);

const document = deterministicReply({ serviceType: 'document_writing', message: '문서 작성 문의드려요' });
assert.equal(document.templateKey, 'document_purpose');
assert.match(document.text, /어디에 사용할/);

const automation = createKmongAutomation({ dataFile: path.join(temp, 'state.json'), astraRoomBridge: mockBridge });
const first = automation.reply({ chatId: 'chat-1', messageId: 'message-1', message: '자막 작업 문의드려요', serviceType: 'subtitle' });
assert.equal(first.duplicate, false);
assert.equal(first.pendingRoom, true);
assert.equal(first.reply.autoSend, false);

const duplicate = automation.reply({ chatId: 'chat-1', messageId: 'message-1', message: '자막 작업 문의드려요', serviceType: 'subtitle' });
assert.equal(duplicate.duplicate, true);
assert.equal(duplicate.pendingRoom, true);

const eventId = first.reply.astraRoomEventId;
const event = events.get(eventId);
event.status = 'completed';
event.response = {
  mode: 'CUSTOMER_REPLY',
  decision: 'SEND',
  reply: '영상 전체 길이와 사용 언어를 알려주시면 작업 범위와 일정을 확인하겠습니다.',
  fields: {}
};
const completed = automation.reply({ chatId: 'chat-1', messageId: 'message-1', message: '자막 작업 문의드려요', serviceType: 'subtitle' });
assert.equal(completed.pendingRoom, false);
assert.equal(completed.reply.autoSend, true);
assert.match(completed.reply.text, /영상 전체 길이/);

const sent = automation.replyResult({ chatId: 'chat-1', messageId: 'message-1', status: 'sent', evidence: 'fixture' });
assert.equal(sent.record.replyEvidence.status, 'sent');
const sentAgain = automation.replyResult({ chatId: 'chat-1', messageId: 'message-1', status: 'uncertain' });
assert.equal(sentAgain.duplicate, true);
assert.equal(sentAgain.record.replyEvidence.status, 'sent');

const system = automation.reply({ chatId: 'chat-2', messageId: 'system-1', message: '크몽 알림 주문이 접수되었습니다.' });
assert.equal(system.reply.skip, true);
assert.equal(system.reply.autoSend, false);

const unverifiedOrder = automation.order({ orderId: 'order-1', serviceType: 'subtitle', amount: 32000, requirements: '5분 영상 SRT' });
assert.equal(unverifiedOrder.readyForFulfillment, false);
const verifiedOrder = automation.order({ orderId: 'order-1', serviceType: 'subtitle', amount: 32000, requirements: '5분 영상 SRT', paymentConfirmed: true, paymentEvidence: { source: 'fixture' } });
assert.equal(verifiedOrder.readyForFulfillment, true);
assert.equal(verifiedOrder.order.serviceType, 'subtitle');

fs.rmSync(temp, { recursive: true, force: true });
console.log('Kmong automation unit checks passed; no customer messages or orders were sent.');

