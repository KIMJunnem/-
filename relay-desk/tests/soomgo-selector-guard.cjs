// 숨고 화면 구조가 바뀌어 입력창·전송 버튼 선택자가 어긋났을 때,
// 봇이 빈 메시지를 보내거나 "보냈다"고 잘못 기록하지 않는지 확인한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'soomgo-chat-bot', 'chat-content.js'), 'utf8');

function makeElement(tagName, options = {}) {
  const el = {
    tagName,
    textContent: options.textContent || '',
    className: options.className || '',
    type: options.type || '',
    name: options.name || '',
    value: '',
    disabled: false,
    isContentEditable: Boolean(options.contentEditable),
    clicks: 0,
    attrs: options.attrs || {},
    acceptsInput: options.acceptsInput !== false,
    clearOnSend: options.clearOnSend !== false,
    getAttribute(key) { return this.attrs[key] ?? null; },
    setAttribute(key, value) { this.attrs[key] = value; },
    hasAttribute(key) { return this.attrs[key] !== undefined; },
    matches() { return false; },
    closest() { return null; },
    click() { this.clicks += 1; if (typeof options.onClick === 'function') options.onClick(this); },
    dispatchEvent() { return true; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 200, height: 40 }; }
  };
  return el;
}

function buildEnvironment({ inputs, sendButton, pageText }) {
  const panels = {};
  const document = {
    body: { innerText: pageText || '고객 채팅' },
    documentElement: { append() {} },
    getElementById(id) { return panels[id] || null; },
    querySelectorAll(selector) {
      if (/textarea|contenteditable/i.test(selector)) return inputs;
      if (/input\[type="file"\]/i.test(selector)) return [];
      if (/button/i.test(selector)) return sendButton ? [sendButton] : [];
      return [];
    },
    querySelector() { return null; },
    createElement() {
      const el = makeElement('DIV');
      el.innerHTML = '';
      el.style = {};
      el.dataset = {};
      el.append = () => {};
      el.addEventListener = () => {};
      el.querySelector = () => { const child = makeElement('DIV'); child.style = {}; return child; };
      Object.defineProperty(el, 'id', {
        get() { return this._id || ''; },
        set(value) { this._id = value; if (value) panels[value] = this; }
      });
      return el;
    },
    addEventListener() {}
  };

  const storage = {};
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    document,
    location: { pathname: '/pro/chats/ROOM-1', href: 'https://soomgo.com/pro/chats/ROOM-1', reload() {} },
    history: { back() {} },
    navigator: { userAgent: 'test' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    MutationObserver: class { observe() {} },
    Event: class { constructor(t) { this.type = t; } },
    InputEvent: class { constructor(t) { this.type = t; } },
    KeyboardEvent: class { constructor(t) { this.type = t; } },
    HTMLTextAreaElement: class {},
    HTMLInputElement: class {},
    DataTransfer: class { constructor() { this.items = { add() {} }; this.files = []; } },
    File: class {},
    URLSearchParams,
    chrome: {
      storage: { local: {
        async get(keys) { const out = {}; for (const k of [].concat(keys)) if (storage[k] !== undefined) out[k] = storage[k]; return out; },
        async set(v) { Object.assign(storage, v); },
        async remove(k) { delete storage[k]; }
      } }
    },
    async fetch() { return { ok: true, status: 200, async json() { return { workflows: [] }; } }; },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  // setValue는 입력창 value를 직접 쓴다. 입력을 받지 않는 필드는
  // 값이 남지 않도록 흉내 낸다.
  for (const input of inputs) {
    let stored = '';
    Object.defineProperty(input, 'value', {
      get() { return input.acceptsInput ? stored : ''; },
      set(v) { stored = v; },
      configurable: true
    });
  }

  let hook = null;
  sandbox.__relaySoomgoChatTestHook = api => { hook = api; };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert.ok(hook, '테스트 훅이 노출되지 않았습니다.');
  return { hook, document, sandbox };
}

async function run() {
  let checks = 0;
  const ok = name => { checks += 1; console.log(`[PASS] ${name}`); };
  {
    const env = buildEnvironment({ inputs: [] });
    const times = ['오후 6:00', '오전 9:00', '오후 8:00'].map(textContent => makeElement('BUTTON', { textContent }));
    const root = { querySelectorAll: () => times };
    const evening = new Date(); evening.setHours(19, 10, 0, 0);
    assert.equal(env.hook.chooseTimeButton(root, '2000-01-01', evening), times[2]);
    evening.setHours(23, 50);
    assert.equal(env.hook.chooseTimeButton(root, '2000-01-01', evening), null);
    assert.equal(env.hook.chooseTimeButton(root, '2099-01-01', evening), times[1]);
    ok('오늘 지난 시간 선택 금지·미래 일정은 오전부터 선택');
  }
  {
    const env = buildEnvironment({ inputs: [], pageText: '결제 완료했습니다 고용 요청 진행하겠습니다' });
    assert.equal(env.hook.platformConfirmation('hire'), null);
    assert.equal(env.hook.platformConfirmation('payment', { paymentAmount: 29000 }), null);
    const node = makeElement('DIV', { textContent: '숨고페이 결제 완료 29,000원', attrs: { 'data-created-at': '2030-01-02T00:00:00Z' } });
    env.document.querySelectorAll = () => [node];
    const workflow = { paymentAmount: 29000, paymentRequestedAt: '2030-01-01T00:00:00Z' };
    assert.ok(env.hook.platformConfirmation('payment', workflow));
    assert.equal(env.hook.platformConfirmation('payment', { ...workflow, paymentAmount: 39000 }), null);
    assert.equal(env.hook.platformConfirmation('payment', { ...workflow, paymentRequestedAt: '2030-01-03T00:00:00Z' }), null);
    const refunded = makeElement('DIV', { textContent: '결제 취소 완료' });
    env.document.querySelectorAll = () => [node, refunded];
    assert.equal(env.hook.platformConfirmation('payment', workflow), null);
    env.document.querySelectorAll = () => [node];
    node.closest = () => ({});
    assert.equal(env.hook.platformConfirmation('payment', workflow), null);
    const hired = makeElement('DIV', { textContent: '고용이 확정되었습니다' });
    env.document.querySelectorAll = () => [hired];
    assert.ok(env.hook.platformConfirmation('hire'));
    ok('고객 발언·다른 금액·과거 결제는 확정 증거로 인정하지 않음');
  }
  {
    const env = buildEnvironment({ inputs: [] });
    const infer = env.hook.inferCustomerStartDate;
    assert.equal(infer('[고객] 내일까지 납품해주세요\n[내 답변] 오늘 시작하겠습니다', '진행해주세요'), '');
    assert.equal(infer('[고객] 2030년 9월 20일 시작해주세요\n[내 답변] 2030년 9월 25일 완료\n[고객] 2030년 9월 22일 시작으로 바꿔주세요', ''), '2030-09-22');
    ok('납품일을 시작일로 오인하지 않고 최신 고객 시작일 적용');
  }
  {
    const env = buildEnvironment({ inputs: [] });
    const platformNotice = '휴대폰 번호 또는 계좌번호를 받으셨나요? 직접 거래는 사기나 피싱 위험이 있을 수 있어요. 서비스를 진행한다면 일정을 등록하고, 숨고에서 거래를 이어가세요.';
    assert.equal(env.hook.isSystemChatMessage(platformNotice), true);
    assert.equal(env.hook.isChatUiPlaceholder(platformNotice), true);
    assert.equal(env.hook.isSystemChatMessage('자료조사 추가금은 얼마인가요?'), false);
    const cleaned = env.hook.stripChatUiChrome(platformNotice);
    assert.equal(cleaned, '');
    ok('숨고 직거래 안전 안내를 고객 발언으로 인식하지 않음');
  }

  // 1) 정상 화면: 입력 → 전송 → 입력창 비워짐
  {
    const input = makeElement('TEXTAREA', { attrs: { placeholder: '메시지를 입력하세요' } });
    const send = makeElement('BUTTON', { textContent: '전송', onClick: () => { input.value = ''; } });
    const env = buildEnvironment({ inputs: [input], sendButton: send });
    await env.hook.loadSettings();
    const sent = await env.hook.sendChatText('안녕하세요. 문의 확인했습니다.');
    assert.equal(sent, true, '정상 화면에서 전송에 실패했습니다.');
    assert.equal(send.clicks, 1);
    ok('정상 화면에서는 입력·전송이 그대로 동작');
  }

  // 2) 입력이 반영되지 않는 필드: 전송 버튼을 누르면 안 된다
  {
    const input = makeElement('TEXTAREA', { attrs: { placeholder: '메시지를 입력하세요' }, acceptsInput: false });
    const send = makeElement('BUTTON', { textContent: '전송' });
    const env = buildEnvironment({ inputs: [input], sendButton: send });
    await env.hook.loadSettings();
    const sent = await env.hook.sendChatText('안녕하세요. 문의 확인했습니다.');
    assert.equal(sent, false, '입력이 반영되지 않았는데 전송했다고 보고했습니다.');
    assert.equal(send.clicks, 0, '빈 입력창 상태에서 전송 버튼을 눌렀습니다.');
    ok('입력이 반영되지 않으면 전송 버튼을 누르지 않음');
  }

  // 3) 버튼은 눌렀지만 입력창이 비워지지 않는 경우: 보냈다고 기록하지 않는다
  {
    const input = makeElement('TEXTAREA', { attrs: { placeholder: '메시지를 입력하세요' } });
    const send = makeElement('BUTTON', { textContent: '전송' }); // 클릭해도 입력창 유지
    const env = buildEnvironment({ inputs: [input], sendButton: send });
    await env.hook.loadSettings();
    const sent = await env.hook.sendChatText('안녕하세요. 문의 확인했습니다.');
    assert.equal(sent, false, '전송이 확인되지 않았는데 성공으로 보고했습니다.');
    assert.equal(send.clicks, 1);
    ok('전송 후 입력창이 남아 있으면 성공으로 기록하지 않음');
  }

  // 4) 검색창 같은 다른 입력 필드가 뒤에 추가돼도 메시지 입력창을 고른다
  {
    const composer = makeElement('TEXTAREA', { attrs: { placeholder: '메시지를 입력하세요' } });
    const search = makeElement('TEXTAREA', { attrs: { placeholder: '대화 검색' } });
    const env = buildEnvironment({ inputs: [composer, search] });
    await env.hook.loadSettings();
    const picked = env.hook.findChatInput();
    assert.equal(picked, composer, '메시지 입력창 대신 다른 필드를 선택했습니다.');
    ok('메시지 입력창 표시가 있는 필드를 우선 선택');
  }

  // 답변 생성은 현재 문의에 대한 초안만 입력하고 전송하지 않는다.
  {
    const input = makeElement('TEXTAREA', { attrs: { placeholder: '메시지를 입력하세요' } });
    const send = makeElement('BUTTON', { textContent: '전송' });
    const env = buildEnvironment({ inputs: [input], sendButton: send });
    await env.hook.loadSettings();
    env.sandbox.fetch = async () => ({ ok: true, async json() { return { reply: { autoSend: true, text: '추가금은 요청하신 분량을 확인해 먼저 안내드리겠습니다.' } }; } });
    const generated = await env.hook.generateReplyDraft({
      conversationId: 'ROOM-1', messageId: 'MSG-CUSTOMER-1', text: '추가 비용은 어떻게 되나요?', conversationText: '[고객] 추가 비용은 어떻게 되나요?'
    });
    assert.equal(generated, true, '답변 초안 생성에 실패했습니다.');
    assert.equal(input.value, '추가금은 요청하신 분량을 확인해 먼저 안내드리겠습니다.');
    assert.equal(send.clicks, 0, '답변 생성 버튼이 메시지를 전송했습니다.');
    ok('답변 생성 버튼은 초안만 입력하고 고객에게 전송하지 않음');
  }

  // 5) 고객이 "결제 완료했어요"라고 쳐도 시스템 결제 표시로 오인하지 않는다
  {
    const input = makeElement('TEXTAREA', { attrs: { placeholder: '메시지를 입력하세요' } });
    const send = makeElement('BUTTON', { textContent: '전송', onClick: () => { input.value = ''; } });
    const env = buildEnvironment({
      inputs: [input],
      sendButton: send,
      pageText: '상대방 결제 완료했어요 메시지를 입력하세요'
    });
    await env.hook.loadSettings();
    const workflow = { id: 'WF-1', conversationId: 'ROOM-1', stage: 'payment_requested' };
    const advanced = await env.hook.detectPaymentCompletion(workflow, '상대방 결제 완료했어요 메시지를 입력하세요');
    assert.equal(advanced, false, '고객이 친 문장을 숨고 결제 표시로 읽었습니다.');
    ok('고객이 직접 친 결제 완료 문장은 시스템 표시로 인정하지 않음');
  }

  console.log(`${checks} selector guard checks passed.`);
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
