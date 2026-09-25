const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('server/relay-server.js', 'utf8');
const chat = fs.readFileSync('soomgo-chat-bot/chat-content.js', 'utf8');

const start = server.indexOf('async function conversationalSoomgoReply');
const end = server.indexOf('\nfunction duplicateMatches', start);
const routing = server.slice(start, end);

assert.ok(routing.includes('enqueueAstraRoomCustomerReply(body, deterministicReply)'), 'customer replies must try the subscription room first');
assert.ok(routing.indexOf('enqueueAstraRoomCustomerReply') < routing.indexOf('runOpenAI('), 'room routing must happen before paid API fallback');
assert.ok(chat.includes("astraRoomOutboxEndpoint: 'http://127.0.0.1:8787/api/astra-room/outbox'"), 'chat bot must poll the room outbox');
assert.ok(chat.includes("reason: 'newer_customer_message_exists'"), 'stale room replies must be blocked');
assert.ok(chat.includes("reason: 'send_result_uncertain'"), 'uncertain sends must not be retried as a fresh message');

console.log('astra-room-customer-routing: ok');
