'use strict';
// 요청봇 0.4.7 / 채팅봇 0.3.15 복구 규칙 비발송 검사.
// 숨고·Relay Desk에 실제 요청을 보내지 않고, 견적·메시지 발송 경로가
// 호출되지 않는지도 함께 확인한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const requestSrc = fs.readFileSync(path.join(root, 'soomgo-bot-extension', 'content-v3.js'), 'utf8');
const chatWorkerSrc = fs.readFileSync(path.join(root, 'soomgo-chat-bot', 'auto-update.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function makeElement() {
  const el = { style: {}, children: [], textContent: '', innerHTML: '', listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelector() { return this._child || (this._child = makeElement()); },
    append(child) { this.children.push(child); } };
  return el;
}

async function runRequestBot({ text, href = 'https://soomgo.com/requests/received', stored = { on: true }, reloadHistory = [] }) {
  const fetchCalls = []; const timers = []; let reloaded = 0; const listeners = [];
  const session = new Map([['relaySoomgoTransientReloadV1', JSON.stringify(reloadHistory)]]);
  let panel = null;
  const storage = { relaySoomgoQuoteBotV3: stored };
  const url = new URL(href);
  const ctx = {
    console, URL, Date, JSON, Math, Promise, Set, Map, Number, String, Boolean, RegExp, Error, InputEvent: function () {}, Event: function () {},
    location: { href, pathname: url.pathname, reload() { reloaded += 1; } },
    sessionStorage: { getItem: k => session.has(k) ? session.get(k) : null, setItem: (k, v) => session.set(k, String(v)), removeItem: k => session.delete(k) },
    document: {
      body: { innerText: text },
      querySelectorAll: () => [],
      getElementById: () => panel,
      createElement: () => (panel = makeElement()),
      documentElement: { append() {} }
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setInterval: () => 0,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    fetch: (u, opts) => { fetchCalls.push({ u, body: opts && opts.body }); return Promise.resolve({ ok: true, json: async () => ({}) }); },
    chrome: { storage: { local: {
      get: async () => ({ ...storage }),
      set: async v => Object.assign(storage, v)
    }, onChanged: { addListener: fn => listeners.push(fn) } } }
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(requestSrc, ctx);
  await flush(); await flush();
  return { ctx, fetchCalls, timers, get reloaded() { return reloaded; }, listeners, panel: () => panel, storage, session };
}

(async () => {
  // 1. 숨고 '일시적인 오류' 화면: OFF로 바꾸지 않고 20초 뒤 새로고침 1회 예약.
  let r = await runRequestBot({ text: '받은 요청 일시적인 오류가 발생했습니다' });
  assert.equal(r.panel().querySelector().textContent, 'ON', '일시 오류에서 ON 유지');
  assert.equal(r.storage.relaySoomgoQuoteBotV3.on, true, '저장값 유지');
  const reloadTimer = r.timers.find(t => t.ms === 20000);
  assert.ok(reloadTimer, '20초 새로고침 예약');
  reloadTimer.fn();
  assert.equal(r.reloaded, 1, '새로고침 1회 실행');
  assert.ok(!r.fetchCalls.some(c => /quote/.test(c.u)), '견적 요청 없음');
  console.log('[PASS] 일시 오류 → ON 유지 + 새로고침 1회');

  // 2. 10분 안에 이미 3회 새로고침했다면 더 새로고침하지 않고 자동 정지.
  const now = Date.now();
  r = await runRequestBot({ text: '받은 요청 일시적인 오류', reloadHistory: [now - 1000, now - 2000, now - 3000] });
  assert.ok(!r.timers.some(t => t.ms === 20000), '추가 새로고침 없음');
  assert.equal(r.panel().querySelector().textContent, 'OFF', '반복 오류 시 정지');
  assert.equal(r.storage.relaySoomgoQuoteBotV3.on, true, '사용자 저장값은 바꾸지 않음');
  console.log('[PASS] 일시 오류 반복(3회 초과) → 새로고침 중단·자동 정지');

  // 3. 로그인 만료 화면은 기존처럼 즉시 정지하고 새로고침하지 않는다.
  r = await runRequestBot({ text: '로그인해 주세요', href: 'https://soomgo.com/login' });
  assert.equal(r.panel().querySelector().textContent, 'OFF');
  assert.ok(!r.timers.some(t => t.ms === 20000));
  console.log('[PASS] 로그인 만료 → 자동 정지, 새로고침·우회 없음');

  // 4. 다른 탭에서 ON/OFF를 바꾸면 이 탭도 따라간다.
  r = await runRequestBot({ text: '받은 요청 목록', stored: { on: false } });
  assert.equal(r.panel().querySelector().textContent, 'OFF');
  assert.equal(r.listeners.length, 1, 'storage 변경 감지 등록');
  r.listeners[0]({ relaySoomgoQuoteBotV3: { newValue: { on: true } } }, 'local');
  assert.equal(r.panel().querySelector().textContent, 'ON');
  r.listeners[0]({ relaySoomgoQuoteBotV3: { newValue: { on: false } } }, 'local');
  assert.equal(r.panel().querySelector().textContent, 'OFF');
  const hb = r.fetchCalls.filter(c => /bot-status/.test(c.u)).map(c => JSON.parse(c.body).status);
  assert.equal(hb[hb.length - 1], '정지', '마지막 심박이 동기화된 상태를 보고');
  console.log('[PASS] 탭 간 ON/OFF 동기화 + 심박 반영');

  // 5. 채팅봇 심박 감시: 5분 초과·서버 정상일 때만 채팅 탭 하나를 새로고침.
  async function runWatchdog({ ageMs, paused = false, busy = false, lastReloadAt = 0, tabs = [{ id: 1, lastAccessed: 10 }, { id: 2, lastAccessed: 20 }] }) {
    const reloaded = []; const updated = []; let alarmFn = null; const store = { relayChatWatchdogLastReloadAt: lastReloadAt, relayDeskPublishedRevision: 'x|0.3.15' };
    const ctx = {
      console, Date, Number, Promise, Array, JSON, Math, setTimeout: () => 0, Number,
      fetch: async u => ({ ok: true, json: async () => /health/.test(u) ? { queue: { busy }, botHealth: { chat: { ageMs } } } : /control/.test(u) ? { paused } : { revision: 'x', chatVersion: '0.3.15' } }),
      chrome: {
        alarms: { create() {}, onAlarm: { addListener: fn => { alarmFn = fn; } } },
        runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, reload() { throw new Error('reload not expected'); } },
        tabs: { query: async () => tabs, create: async () => { throw new Error('new tab not expected'); }, reload: async id => { reloaded.push(id); }, update: async (id, p) => { updated.push([id, p]); }, onRemoved: { addListener() {} } },
        storage: { local: { get: async k => (typeof k === 'string' ? { [k]: store[k] } : { ...store }), set: async v => Object.assign(store, v), remove: async () => {} } }
      }
    };
    vm.runInNewContext(chatWorkerSrc, ctx);
    await flush();
    alarmFn({ name: 'relay-desk-version-check' });
    for (let i = 0; i < 6; i += 1) await flush();
    return { reloaded, updated };
  }
  let w = await runWatchdog({ ageMs: 22 * 60 * 1000 });
  assert.deepEqual(w.reloaded, [2], '가장 최근 채팅 탭 1개만 새로고침');
  assert.ok(w.updated.every(([, p]) => p.autoDiscardable === false) && w.updated.length === 2, '채팅 탭 자동 비활성화 제외');
  assert.deepEqual((await runWatchdog({ ageMs: 60 * 1000 })).reloaded, [], '정상 심박이면 새로고침 없음');
  assert.deepEqual((await runWatchdog({ ageMs: 22 * 60 * 1000, paused: true })).reloaded, [], '서버 일시정지면 새로고침 없음');
  assert.deepEqual((await runWatchdog({ ageMs: 22 * 60 * 1000, busy: true })).reloaded, [], '서버 처리 중이면 새로고침 없음');
  assert.deepEqual((await runWatchdog({ ageMs: 22 * 60 * 1000, lastReloadAt: Date.now() - 60000 })).reloaded, [], '10분 안 재새로고침 없음');
  assert.deepEqual((await runWatchdog({ ageMs: 22 * 60 * 1000, tabs: [] })).reloaded, [], '채팅 탭이 없으면 새로 만들지 않음(기존 ensureChatTab 규칙 유지)');
  console.log('[PASS] 채팅봇 심박 감시: 5분 초과·정상 서버일 때만 1개 탭 새로고침, 10분 제한');

  console.log('soomgo bot recovery checks passed; no quotes or customer messages sent.');
})().catch(error => { console.error(error); process.exit(1); });
