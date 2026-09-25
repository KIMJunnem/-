const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAstraRoomBridge, parseFields } = require('../server/astra-room-bridge');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-room-bridge-'));
const bridge = createAstraRoomBridge({
  dataFile: path.join(root, 'data.json'),
  configFile: path.join(root, 'config.json')
});

assert.strictEqual(bridge.summary().config.enabled, false);
const first = bridge.enqueue({
  eventType: 'customer_message',
  caseId: 'CHAT-1',
  idempotencyKey: 'soomgo:CHAT-1:MSG-1',
  payload: { text: '가격이 얼마인가요?' }
});
assert.strictEqual(first.duplicate, false);
assert.strictEqual(bridge.enqueue({
  eventType: 'customer_message',
  caseId: 'CHAT-1',
  idempotencyKey: 'soomgo:CHAT-1:MSG-1'
}).duplicate, true);

bridge.claim(first.event.eventId, 'test-worker');
const completed = bridge.complete(first.event.eventId, `[MODE:CUSTOMER_REPLY]\n[DECISION:SEND]\n[REPLY]\n요청하신 작업 범위를 먼저 확인해도 될까요?\n[FACTS_USED]\nMSG-1\n[MISSING]\n영상 길이`);
assert.strictEqual(completed.event.response.decision, 'SEND');
assert.strictEqual(completed.event.response.reply, '요청하신 작업 범위를 먼저 확인해도 될까요?');
assert.strictEqual(completed.event.deliveryStatus, 'ready');
assert.strictEqual(bridge.outbox({ conversationId: 'CHAT-1' }).length, 0, 'conversationId is read from the event payload');
assert.strictEqual(bridge.outbox().length, 1);
assert.strictEqual(bridge.markDelivery(first.event.eventId, 'sent', { receipt: 'test' }).event.deliveryStatus, 'sent');
assert.strictEqual(bridge.markDelivery(first.event.eventId, 'sent', { receipt: 'duplicate' }).duplicate, true);
assert.strictEqual(bridge.complete(first.event.eventId, completed.event.response.raw).duplicate, true);

assert.throws(() => parseFields('[MODE:CUSTOMER_REPLY]\n[DECISION:SEND]\n[REPLY]\n\n[FACTS_USED]\n없음\n[MISSING]\n없음'), /reply_missing/);
assert.throws(() => parseFields('설명부터 시작\n[MODE:NO_ACTION]\n[REASON]\n없음'), /mode_missing/);

const linked = bridge.link({ targetThreadId: 'thread-123', targetTitle: 'Swan Astra 운영·고객대응실' });
assert.strictEqual(linked.enabled, true);
assert.strictEqual(linked.targetThreadId, 'thread-123');

fs.rmSync(root, { recursive: true, force: true });
console.log('astra-room-bridge: ok');
