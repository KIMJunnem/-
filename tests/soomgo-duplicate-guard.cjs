// 결제 요청·리뷰 요청·결과 전달은 고객 화면에서 되돌릴 수 없다.
// 클릭은 성공했는데 Relay Desk 기록만 실패하면 1초 주기 루프가 같은
// 버튼을 다시 누를 수 있어, 그 상황을 실제로 실행해 확인한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'soomgo-chat-bot', 'chat-content.js'), 'utf8');

function makeElement(text, options = {}) {
  const el = {
    tagName: options.tagName || 'BUTTON',
    textContent: text,
    className: options.className || '',
    type: options.type || '',
    name: options.name || '',
    value: '',
    disabled: false,
    files: null,
    clicks: 0,
    attrs: options.attrs || {},
    getAttribute(key) { return this.attrs[key] ?? null; },
    setAttribute(key, value) { this.attrs[key] = value; },
    matches() { return false; },
    closest() { return null; },
    click() { this.clicks += 1; if (typeof options.onClick === 'function') options.onClick(this); },
    dispatchEvent() { return true; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 100, height: 30 }; }
  };
  return el;
}

function buildEnvironment({ ackOk, paymentSuccessText, staleSuccessText = '', fileInputs = [] }) {
  const clicked = { payment: 0, review: 0 };
  const paymentOpen = makeElement('숨고페이 요청');
  const amountInput = makeElement('', { tagName: 'INPUT', type: 'number', attrs: { placeholder: '금액' } });
  const paymentSubmit = makeElement('요청하기', { onClick: () => { clicked.payment += 1; body.innerText += ` ${paymentSuccessText || ''}`; } });
  const reviewButton = makeElement('리뷰 요청', { onClick: () => { clicked.review += 1; } });

  const elements = [paymentOpen, amountInput, paymentSubmit, reviewButton];
  const body = { innerText: `고객 채팅 ${staleSuccessText}` };

  const panels = {};
  const document = {
    body,
    documentElement: { append() {} },
    getElementById(id) { return panels[id] || null; },
    querySelectorAll(selector) {
      if (/input/i.test(selector) && !/file/i.test(selector)) return [amountInput];
      if (/dialog|modal|overlay|form/i.test(selector)) return [];
      if (/file/i.test(selector)) return fileInputs;
      return elements.filter(el => el.tagName === 'BUTTON');
    },
    querySelector() { return null; },
    createElement() {
      const el = makeElement('');
      el.id = '';
      el.innerHTML = '';
      el.style = {};
      el.dataset = {};
      el.append = () => {};
      el.addEventListener = () => {};
      el.querySelector = () => null;
      Object.defineProperty(el, 'id', {
        get() { return this._id || ''; },
        set(value) { this._id = value; if (value) panels[value] = this; }
      });
      return el;
    },
    addEventListener() {}
  };

  const storage = {};
  const ackCalls = [];
  const sandbox = {
    console,
    AbortSignal,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    document,
    location: { pathname: '/chats/ROOM-1', href: 'https://soomgo.com/chats/ROOM-1', reload() {}, assign(url) { this.href = new URL(url, 'https://soomgo.com').href; this.pathname = new URL(url, 'https://soomgo.com').pathname; } },
    history: { back() {}, pushState() {} },
    navigator: { userAgent: 'test' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    Event: class { constructor(type) { this.type = type; } },
    InputEvent: class { constructor(type) { this.type = type; } },
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    HTMLTextAreaElement: class {},
    HTMLInputElement: class {},
    DataTransfer: class { constructor() { this.items = { add() {} }; this.files = []; } },
    File: class {},
    URLSearchParams,
    window: null,
    chrome: {
      storage: {
        local: {
          async get(keys) {
            const out = {};
            for (const key of [].concat(keys)) if (storage[key] !== undefined) out[key] = storage[key];
            return out;
          },
          async set(values) { Object.assign(storage, values); },
          async remove(key) { delete storage[key]; }
        }
      }
    },
    async fetch(url, init = {}) {
      const target = String(url); if(target.includes('/api/soomgo/control')) return {ok:true,json:async()=>({paused:false})};
      if (target.includes('/workflow/action')) {
        ackCalls.push(JSON.parse(init.body || '{}'));
        return { ok: ackOk, status: ackOk ? 200 : 409, async json() { return ackOk ? { ok: true, workflow: {} } : { error: 'payment_amount_mismatch' }; } };
      }
      if (target.includes('/api/soomgo/workflow')) {
        return { ok: true, status: 200, async json() { return { workflows: [currentWorkflow] }; } };
      }
      return { ok: true, status: 200, async json() { return {}; }, async text() { return ''; }, async blob() { return { size: 10, type: 'text/plain' }; } };
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });

  const currentWorkflow = {
    id: 'WF-TEST-1',
    conversationId: 'ROOM-1',
    stage: 'payment_ready',
    pendingAction: 'request_payment',
    pendingDelivery: null,
    quote: { amount: 29000 },
    additionalFees: [{ amount: 10000, accepted: true }],
    paymentAmount: 39000
  };

  let hook = null;
  sandbox.__relaySoomgoChatTestHook = api => { hook = api; };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert.ok(hook, '테스트 훅이 노출되지 않았습니다.');
  return { hook, clicked, ackCalls, currentWorkflow, paymentSubmit, amountInput, storage };
}

async function run() {
  {
    const env = buildEnvironment({ ackOk: true, paymentSuccessText: '', staleSuccessText: '결제 요청을 보냈습니다' });
    await env.hook.loadSettings();
    await env.hook.deliverWorkflow(env.currentWorkflow);
    assert.equal(env.ackCalls.length, 0, '과거 결제 요청 문구를 새 발송 성공으로 오인');
    console.log('[PASS] 과거 결제 요청 문구만 남아 있으면 새 요청 완료 기록 금지');
  }
  {
    const env = buildEnvironment({ ackOk: true, paymentSuccessText: '' });
    Object.defineProperty(env.amountInput, 'value', { get: () => '0', set() {} });
    await env.hook.loadSettings();
    await env.hook.deliverWorkflow(env.currentWorkflow);
    assert.equal(env.clicked.payment, 0, '입력값 반영 실패 시 결제 요청 금지');
    console.log('[PASS] 금액 입력값이 반영되지 않으면 전송 차단');
  }
  {
    const env = buildEnvironment({ ackOk: true, paymentSuccessText: '' });
    env.currentWorkflow.pendingDelivery = { id: 'DEL-UNCERTAIN', text: '결과', fileUrl: '/api/files/result.txt' };
    await env.hook.loadSettings();
    const key = env.hook.attemptKey(env.currentWorkflow, 'deliver', 'DEL-UNCERTAIN');
    await env.hook.markAttempt(key, { started: true });
    await env.hook.deliverWorkflow(env.currentWorkflow);
    assert.equal(env.ackCalls.length, 0);
    assert.equal(env.clicked.payment, 0);
    console.log('[PASS] 불확실한 파일 전송은 재전송·완료 처리 금지');
  }
  {
    const staged = makeElement('', { tagName: 'INPUT', type: 'file' });
    staged.files = [{ name: 'checked-final.txt', size: 123 }];
    const env = buildEnvironment({ ackOk: true, paymentSuccessText: '', fileInputs: [staged] });
    await env.hook.loadSettings();
    assert.equal(env.hook.workflowFileInComposer({ filename: 'checked-final.txt' }), true);
    assert.equal(env.hook.workflowFileInComposer({ filename: 'different-file.txt' }), false);
    console.log('[PASS] 실제 파일 입력에 남은 첨부만 재전송 안전 상태로 인정');
  }
  // 1) Relay Desk 기록이 실패해도 결제 요청 버튼은 한 번만 눌려야 한다.
  {
    const env = buildEnvironment({ ackOk: false, paymentSuccessText: '결제 요청을 보냈습니다' });
    await env.hook.loadSettings();
    for (let tick = 0; tick < 5; tick += 1) await env.hook.deliverWorkflow(env.currentWorkflow);
    assert.equal(env.clicked.payment, 1, `기록 실패 시 결제 요청이 ${env.clicked.payment}번 전송되었습니다.`);
    console.log('[PASS] 기록 실패가 반복돼도 숨고페이 요청은 1회만 전송');
  }

  // 2) 정상 흐름에서는 서버 합계 금액 그대로 1회 요청한다.
  {
    const env = buildEnvironment({ ackOk: true, paymentSuccessText: '결제 요청을 보냈습니다' });
    await env.hook.loadSettings();
    await env.hook.deliverWorkflow(env.currentWorkflow);
    assert.equal(env.clicked.payment, 1);
    assert.equal(env.ackCalls.length, 1);
    assert.equal(env.ackCalls[0].amount, 39000, '기본금+추가금 합계가 아닌 금액이 전송되었습니다.');
    assert.equal(env.amountInput.value, '39000');
    console.log('[PASS] 기본금 29,000 + 승인 추가금 10,000 = 39,000원으로 1회 요청');
  }

  // 3) 서버 합계와 기본금+추가금이 어긋나면 아예 요청하지 않는다.
  {
    const env = buildEnvironment({ ackOk: true, paymentSuccessText: '결제 요청을 보냈습니다' });
    env.currentWorkflow.paymentAmount = 29000; // 추가금이 빠진 낡은 값
    await env.hook.loadSettings();
    await env.hook.deliverWorkflow(env.currentWorkflow);
    assert.equal(env.clicked.payment, 0, '금액이 어긋난 상태에서 결제 요청이 전송되었습니다.');
    console.log('[PASS] 합계 불일치 시 고객에게 결제 요청을 보내지 않음');
  }

  // 4) 숨고 완료 표시를 확인하지 못하면 재클릭하지 않고 사람 확인으로 남긴다.
  {
    const env = buildEnvironment({ ackOk: true, paymentSuccessText: '' });
    await env.hook.loadSettings();
    for (let tick = 0; tick < 3; tick += 1) await env.hook.deliverWorkflow(env.currentWorkflow);
    assert.equal(env.clicked.payment, 1, `결과 미확인 상태에서 결제 요청이 ${env.clicked.payment}번 전송되었습니다.`);
    assert.equal(env.ackCalls.length, 0, '발송이 확인되지 않았는데 완료로 기록했습니다.');
    console.log('[PASS] 발송 결과 미확인 시 중복 전송 없이 수동 확인으로 보류');
  }

  // 5) 리뷰 요청도 기록 실패로 반복 클릭되지 않는다.
  {
    const env = buildEnvironment({ ackOk: false, paymentSuccessText: '' });
    env.currentWorkflow.stage = 'review_requested';
    env.currentWorkflow.pendingAction = 'request_review';
    await env.hook.loadSettings();
    for (let tick = 0; tick < 5; tick += 1) await env.hook.deliverWorkflow(env.currentWorkflow);
    assert.equal(env.clicked.review, 1, `리뷰 요청이 ${env.clicked.review}번 전송되었습니다.`);
    console.log('[PASS] 기록 실패가 반복돼도 리뷰 요청은 1회만 전송');
  }

  console.log('duplicate-action guard checks passed.');
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
