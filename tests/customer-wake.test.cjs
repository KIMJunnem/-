'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWakeStore } = require('../server/customer-wake');
function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rd-wake-test-')), 'state.json');
  let clock = 100000, calls = [];
  const dispatch = async batch => { calls.push(batch); return { accepted: true, receipt: 'test-receipt' }; };
  const store = createWakeStore({ file, now: () => clock, dispatch });
  const observe = (rows, sourceId = 'list') => store.observe({ platform: 'soomgo', sourceId, health: 'observing', rows });
  const row = (text, extra = {}) => ({ conversationId: '235000001', text, role: 'unknown', view: 'list', ...extra });
  return { file, store, observe, row, calls, advance: ms => clock += ms, clock: () => clock, dispatch };
}
test('idle hour and initial baseline call no model/queue', async () => {
  const s = setup();
  for (let i = 0; i < 720; i++) { s.observe([s.row('기존 대화')]); s.advance(5000); await s.store.flush(); }
  assert.equal(s.calls.length, 0);
});
test('100 duplicates, trailing system alert, one durable queued signal', async () => {
  const s = setup(); s.observe([s.row('기존 대화')]);
  for (let i = 0; i < 100; i++) s.observe([s.row('언제까지 가능할까요?')]);
  s.observe([s.row('고객이 숨고페이 5,000원 쿠폰을 받았어요')]);
  assert.equal(Object.keys(s.store.snapshot().events).length, 1);
  s.advance(5001); await s.store.flush(); await s.store.flush();
  assert.equal(s.calls.length, 1);
  const restarted = createWakeStore({ file: s.file, now: s.clock, dispatch: s.dispatch });
  restarted.observe({ platform: 'soomgo', rows: [s.row('언제까지 가능할까요?')] });
  s.advance(60000); await restarted.flush(); assert.equal(s.calls.length, 1);
});
test('read, refund notice, outgoing quote and closed rooms do not wake', async () => {
  const s = setup(); s.observe([s.row('이전')]);
  for (const row of [s.row('고객님이 견적을 읽었습니다'), s.row('고객이 48시간 동안 견적을 읽지 않아서 캐시를 보상해드렸습니다.'), s.row('견적 21,000원 · 작업 기간 당일~1일 · 수정 3회'), s.row('감사합니다', { role: 'outgoing' }), s.row('언제 되나요', { closed: true })]) s.observe([row]);
  s.advance(5001); await s.store.flush(); assert.equal(s.calls.length, 0);
});
test('two genuine changes coalesce into one invocation', async () => {
  const s = setup(); s.observe([s.row('이전')]);
  s.observe([s.row('안녕하세요')]); s.advance(3000); s.observe([s.row('자료는 어디로 보내나요?')]);
  s.advance(2001); await s.store.flush(); assert.equal(s.calls.length, 0);
  s.advance(3000); await s.store.flush(); assert.equal(s.calls.length, 1); assert.equal(s.calls[0].length, 2);
});
test('new room wakes, own reply preview does not wake', async () => {
  const s = setup(); s.observe([s.row('이전')]);
  s.observe([s.row('새 방 문의', { conversationId: '235000002' })]);
  s.observe([s.row('답변입니다', { view: 'detail', role: 'outgoing', messageId: 'message-1000' })], 'room-235000001');
  s.observe([s.row('답변입니다')]);
  assert.equal(Object.keys(s.store.snapshot().events).length, 1);
});
test('same words with new unread evidence are distinct, relative age is not', async () => {
  const s = setup(); s.observe([s.row('네', { unread: true, unreadCount: 1, displayTime: '오전 11:00' })]);
  s.observe([s.row('네', { unread: true, unreadCount: 2, displayTime: '오전 11:01' })]);
  s.observe([s.row('네', { unread: true, unreadCount: 2, displayTime: '어제' })]);
  assert.equal(Object.keys(s.store.snapshot().events).length, 2);
});
test('detail history never loops; new incoming survives trailing coupon', async () => {
  const s = setup(); const msg = (n, text, role = 'incoming') => s.row(text, { view: 'detail', messageId: `message-${n}`, role });
  const history = [msg(100, '예전 질문'), msg(101, '답변', 'outgoing')];
  s.observe(history, 'room-235000001');
  for (let i = 0; i < 10; i++) s.observe(history, 'room-235000001');
  assert.equal(Object.keys(s.store.snapshot().events).length, 0);
  const updated = [...history, msg(102, '새 질문'), msg(103, '고객이 숨고페이 5,000원 쿠폰을 받았어요', 'system')];
  s.observe(updated, 'room-235000001'); s.observe(updated, 'room-235000001');
  assert.equal(Object.keys(s.store.snapshot().events).length, 1);
  s.advance(5001); await s.store.flush(); assert.equal(s.calls.length, 1);
});
test('failure remains uncertain across restart and never auto retries', async () => {
  const s = setup(); const failing = createWakeStore({ file: s.file, now: s.clock, dispatch: async () => { throw new Error('timeout'); } });
  failing.observe({ platform: 'soomgo', rows: [s.row('미확인 질문', { unread: true })] });
  s.advance(6000); assert.equal((await failing.flush()).status, 'uncertain');
  const restarted = createWakeStore({ file: s.file, now: s.clock, dispatch: s.dispatch });
  s.advance(60000); await restarted.flush(); assert.equal(s.calls.length, 0);
  assert.equal(restarted.health().counts.uncertain, 1);
});
test('pending survives restart, stale is not empty, ack only after queue', async () => {
  const s = setup(); s.observe([s.row('새 질문', { unread: true })]);
  const restarted = createWakeStore({ file: s.file, now: s.clock, dispatch: s.dispatch });
  s.advance(121000); assert.equal(restarted.health().sources.list.stale, true);
  await restarted.flush(); const id = Object.keys(restarted.snapshot().events)[0];
  restarted.ack([id], 'waiting_customer'); assert.equal(restarted.health().counts.waiting_customer, 1);
});
