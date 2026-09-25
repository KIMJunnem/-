// 알림방 중복 방지: 같은 이상은 한 번만, 사라졌다 다시 생기면 다시 알린다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const d = require('../server/attention-dedupe');
const state = {};
const att = (extra = {}) => ({ items: [{ kind: 'quote_review', requestId: 'R1', at: '2026-09-22T10:00:00Z', urgent: false }], alerts: [{ level: 'error', code: 'provider_usage_high', provider: 'Claude' }], bots: { request: { stopped: false }, chat: { stopped: true, lastSeenMinutesAgo: 12 } }, ...extra });
let r = d.dedupe(state, att());
assert.equal(r.notify.length, 3);
r = d.dedupe(state, att());
assert.equal(r.notify.length, 0, '같은 이상은 다시 안 알림');
assert.equal(r.alreadyNotified, 3);
assert.equal(r.changed, false);
// 긴급으로 바뀌면 다시 알림
r = d.dedupe(state, att({ items: [{ kind: 'quote_review', requestId: 'R1', at: '2026-09-22T10:00:00Z', urgent: true }] }));
assert.equal(r.notify.length, 1);
assert.equal(r.notify[0].urgent, true);
// 채팅봇이 살아나면 기록이 지워지고, 다시 멈추면 다시 알림
const urgentItems = [{ kind: 'quote_review', requestId: 'R1', at: '2026-09-22T10:00:00Z', urgent: true }];
r = d.dedupe(state, att({ items: urgentItems, bots: { request: { stopped: false }, chat: { stopped: false } } }));
assert.equal(r.notify.length, 0);
r = d.dedupe(state, att({ items: urgentItems }));
assert.deepEqual(r.notify.map(e => e.type), ['bot']);
// 서버 연결
const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
assert.match(server, /searchParams\.get\('dedupe'\) === '1'/);
console.log('attention-dedupe: PASS');
