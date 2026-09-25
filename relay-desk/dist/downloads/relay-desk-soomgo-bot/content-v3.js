(function () {
  'use strict';

  const KEY = 'relaySoomgoQuoteBotV3';
  const ENDPOINT = 'http://127.0.0.1:8787/api/soomgo/quote';
  const QUOTE_RESULT_ENDPOINT = 'http://127.0.0.1:8787/api/soomgo/quote-result';
  const RETURN_AFTER_SEND_KEY = 'relaySoomgoQuoteReturnAfterSendV1';
  const STATUS_ENDPOINT = 'http://127.0.0.1:8787/api/soomgo/bot-status';
  // 0.4.13: 사람 확인·제공 불가로 판정된 요청은 다시 열지 않는다(서버 정의 파일 버전이 바뀌면 재판정).
  const BOT_VERSION_ENDPOINT = 'http://127.0.0.1:8787/api/soomgo/bot-version';
  const LIST_SEEN_ENDPOINT = 'http://127.0.0.1:8787/api/soomgo/list-seen';
  const SKIP_KEY = 'relaySoomgoSkipJudgedV1';
  const LAST_CARD_KEY = 'relaySoomgoLastCardV1';
  const VERSION_REFRESH_MS = 10 * 60 * 1000;
  const LIST_SEEN_MS = 5 * 60 * 1000;
  // 0.4.21(2026-09-23 감독 지시 P3): 견적 결과 보고를 sessionStorage에 예약해 두고, 페이지 이동으로 끊기면 다음 로드에서 한 번만 다시 보낸다.
  // 0.4.20(2026-09-23): 목록에서 PPT → 문서 → 자막 순으로 먼저 연다.
  // 0.4.19(2026-09-22): 카드 키가 모두 같아져 목록 요청을 안 여는 문제 수정.
  // 0.4.18(2026-09-22 준희 지시): 선착순에서 밀려 목록 새로고침 30초 → 20초.
  const REQUEST_REFRESH_MS = 20000;
  const HEARTBEAT_MS = 15000;
  const DAILY_STATS_KEY = 'relaySoomgoQuoteDailyV1';
  // 하루 신규 견적 상한(사용자 지시 2026-09-21: 5건 → 20건). 날짜는 한국 시간 기준.
  const DAILY_QUOTE_LIMIT = 30; // 9/25 준희 "30건으로 올려줘"(웨딩·쇼츠·돌잔치 샘플 링크 붙음)
  const DETAIL_WAIT_MS = 8000;
  // 요청 상세가 다 떴는지 보는 칸 이름(숨고 요청서 항목). 하나라도 있으면 읽는다.
  const REQUEST_FIELDS = /(이용 목적|작업 분량|작성 주제|제작 범위|희망 서비스|서비스 분야|파일 형식|결과물 형식|영상 길이|원본 길이|의뢰 내용|의뢰\/희망사항|완료 희망일|예산)/;
  const kstDay = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const PENDING_KEY = 'relaySoomgoQuotePendingV1';
  const state = { on: false, busy: false, lastUrl: location.href, currentId: '', processed: new Set(), failures: new Map(), pending: new Map(), status: '대기 중', lastRefreshAt: Date.now(), lastHeartbeatAt: 0, skipped: new Map(), definitionsVersion: '', versionCheckedAt: 0, listSeenAt: 0 };
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const hash = value => { let h = 2166136261; const text = String(value || ''); for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect?.();
    const s = getComputedStyle(el);
    return Boolean(r && r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden');
  };
  const bodyText = () => clean(document.body?.innerText || '').slice(0, 20000);
  const currentAccountName = () => {
    const namedButton = [...document.querySelectorAll('button')]
      .map(button => clean(button.innerText || button.getAttribute('aria-label') || ''))
      .find(name => /^swan$/i.test(name));
    if (namedButton) return namedButton;
    const images = [...document.querySelectorAll('button img[alt]')];
    for (const image of images) {
      const name = clean(image.getAttribute('alt') || '');
      if (name && name.length <= 80 && !/^(숨고|알림|프로필|메뉴|검색|앱스토어|구글플레이|app store|play store|coin)$/i.test(name)) return name;
    }
    return '';
  };
  // 로그인 만료·접근 차단은 사람이 처리해야 하므로 자동 정지한다.
  // 반면 숨고의 '일시적인 오류' 화면은 새로고침으로 복구되므로 OFF로 바꾸지
  // 않고 제한된 횟수만 새로고침한다(0.4.7). OFF 저장값은 건드리지 않는다.
  const blocked = () => /\/login|로그인해 주세요|접근할 수 없습니다|고객센터로 문의/i.test(`${location.href} ${bodyText()}`);
  const transientError = () => /일시적인 오류/.test(bodyText());
  // 0.4.12: 숨고 캐시가 부족하면 견적을 보낼 수 없으므로 자동 정지한다(충전은 사람이 한다).
  const cashShortage = () => /캐시(?:가|이)?\s*부족|잔여\s*캐시가?\s*부족|충전\s*(?:후|이\s*필요|해\s*주세요|하시겠)/.test(bodyText());
  // 0.4.12: swan이 아닌 계정으로 로그인돼 있으면 다른 계정 명의로 견적이 나가지 않게 정지한다.
  const wrongAccount = () => { const name = currentAccountName(); return Boolean(name) && !/^swan$/i.test(name) && /^[\w가-힣.\-]{2,30}$/.test(name) ? name : ''; };
  async function stopBot(reason) {
    state.on = false;
    try { await chrome.storage.local.set({ [KEY]: { on: false } }); } catch (_) {}
    draw(reason);
  }
  const TRANSIENT_RELOAD_KEY = 'relaySoomgoTransientReloadV1';
  const TRANSIENT_RELOAD_DELAY_MS = 20000;
  const TRANSIENT_RELOAD_WINDOW_MS = 10 * 60 * 1000;
  const TRANSIENT_RELOAD_MAX = 3;
  let transientReloadTimer = null;
  const scheduleTransientReload = () => {
    if (transientReloadTimer !== null) return true;
    let history = [];
    try { history = JSON.parse(sessionStorage.getItem(TRANSIENT_RELOAD_KEY) || '[]').filter(at => Date.now() - Number(at) < TRANSIENT_RELOAD_WINDOW_MS); } catch (_) {}
    if (history.length >= TRANSIENT_RELOAD_MAX) return false;
    history.push(Date.now());
    try { sessionStorage.setItem(TRANSIENT_RELOAD_KEY, JSON.stringify(history)); } catch (_) {}
    draw(`숨고 일시 오류 · ${Math.round(TRANSIENT_RELOAD_DELAY_MS / 1000)}초 후 새로고침 (${history.length}/${TRANSIENT_RELOAD_MAX})`);
    transientReloadTimer = setTimeout(() => { if (!state.busy) location.reload(); else transientReloadTimer = null; }, TRANSIENT_RELOAD_DELAY_MS);
    return true;
  };
  // 상세 화면의 아래쪽에 최근 견적이 길게 쌓이면 bodyText의 길이 제한 때문에
  // `요청 상세` 문구가 잘릴 수 있다. 숨고의 상세 URL에 포함된 요청 ID를
  // 단일 기준으로 사용해 상세 진입 뒤 자동화가 멈추지 않게 한다.
  const isDetail = () => Boolean(requestId());
  const isList = () => /받은\s*요청|요청 목록|요청서|요청･견적/i.test(bodyText()) && /requests\/received/i.test(location.pathname);
  const requestId = () => (location.pathname.match(/\/requests\/received\/([^/?]+)/i) || [])[1] || '';
  const requestKey = () => requestId() || `PAGE-${location.href}`;
  const listEntries = () => {
    const links = [...document.querySelectorAll('a[href*="/requests/received/"],a[href*="/pro/quotes/"]')]
      .filter(visible)
      .map(link => { const id = String(link.href || '').split('/').pop().split('?')[0] || ''; return { element: link, id, href: link.href || '', key: `REQ-${id}`, text: clean((link.closest('li,article') || link).textContent || '').slice(0, 300) }; });
    const cards = [...document.querySelectorAll('button')]
      .filter(visible)
      .filter(button => button.id !== 'relay-soomgo-v3' && !button.closest('#relay-soomgo-v3'))
      .filter(button => /자세히\s*보기/.test(clean(button.textContent || '')))
      .map(button => {
        // 0.4.19: 버튼에서 위로 올라가며 '자세히 보기'가 이 버튼 하나뿐인 가장 큰 칸을 카드로 본다.
        // 카드 칸을 못 찾으면 모든 카드 키가 '자세히 보기' 글로 같아져, 한 건 건너뛰면 전부 건너뛰는 문제가 있었다.
        let holder = null;
        for (let node = button.parentElement; node && node !== document.body; node = node.parentElement) {
          const count = [...node.querySelectorAll('button')].filter(item => /자세히\s*보기/.test(clean(item.textContent || ''))).length;
          if (count === 1) holder = node; else break;
        }
        const buttonText = clean(button.textContent || '');
        const cardText = clean((holder || button).textContent || '');
        const generic = !holder || cardText === buttonText;
        // '3시간 전', '견적 보낸 고수 6명'처럼 시간이 지나며 바뀌는 부분을 빼고 카드 키를 만든다.
        const stable = cardText.replace(/\d+\s*(?:분|시간|일|주)\s*전|방금\s*전|견적\s*보낸\s*고수\s*\d+\s*명|\d+\s*명/g, '').slice(0, 500);
        const dataId = button.getAttribute('data-request-id');
        return { element: button, id: dataId || `CARD-${hash(stable)}`, href: '', key: dataId ? `REQ-${dataId}` : `CARD-${hash(stable)}`, generic: !dataId && generic, text: cardText.slice(0, 300) };
      });
    return [...links, ...cards];
  };
  // 0.4.20(2026-09-23 준희 승인): 견적 뒤 고객 답장률 PPT 23.1% · 문서 7.3% · 자막 0%(7건)·그 외 0~4%.
  // 여러 요청이 한꺼번에 떠 있을 때 캐시를 답장 가능성이 높은 순서로 쓴다. 판매하지 않는 카테고리는 서버 규칙이 삭제한다.
  const REQUEST_PRIORITY = [
    [/PPT|파워\s*포인트|프레젠테이션|발표\s*자료/i, 0],
    [/문서\s*\/\s*글\s*작성|문서\s*작성|교정|교열|윤문|보고서/, 1],
    [/자막|속기|타이핑/, 2]
  ];
  const requestPriority = text => {
    const value = String(text || '');
    for (const [pattern, rank] of REQUEST_PRIORITY) if (pattern.test(value)) return rank;
    return 3;
  };
  const skipRecord = entry => {
    if (entry.generic) return null;
    const record = state.skipped.get(entry.key);
    if (!record) return null;
    // 서버 정의 파일 버전을 모르면 안전하게 건너뛰고, 버전이 바뀌었으면 다시 연다.
    return !state.definitionsVersion || record.version === state.definitionsVersion ? record : null;
  };
  async function saveSkipped() {
    const entries = [...state.skipped.entries()].sort((a, b) => Number(b[1].at || 0) - Number(a[1].at || 0)).slice(0, 300);
    state.skipped = new Map(entries);
    try { await chrome.storage.local.set({ [SKIP_KEY]: entries }); } catch (_) {}
  }
  async function adoptDefinitionsVersion(version) {
    const value = String(version || '');
    if (!value || value === state.definitionsVersion) return;
    state.definitionsVersion = value;
    let dropped = 0;
    for (const [key, record] of [...state.skipped.entries()]) if (record.version !== value) { state.skipped.delete(key); state.processed.delete(record.requestId); dropped += 1; }
    if (dropped) await saveSkipped();
  }
  async function rememberSkip(requestIdValue, version, reason) {
    const at = Date.now();
    const record = { requestId: String(requestIdValue || ''), version: String(version || state.definitionsVersion || ''), reason: String(reason || '').slice(0, 120), at };
    state.skipped.set(`REQ-${record.requestId}`, record);
    try {
      const last = JSON.parse(sessionStorage.getItem(LAST_CARD_KEY) || 'null');
      if (last?.key && !last.generic && at - Number(last.at || 0) < 120000) state.skipped.set(last.key, record);
    } catch (_) {}
    await saveSkipped();
  }
  async function refreshDefinitionsVersion(force = false) {
    if (!force && Date.now() - state.versionCheckedAt < VERSION_REFRESH_MS) return;
    state.versionCheckedAt = Date.now();
    try {
      const response = await fetch(BOT_VERSION_ENDPOINT, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      await adoptDefinitionsVersion(data.definitionsVersion);
    } catch (_) {}
  }
  // 다시 열지 않는 요청이 목록에 아직 있는지만 서버에 알린다(알림의 '3시간 안 보임' 규칙용).
  async function reportListSeen(entries) {
    if (Date.now() - state.listSeenAt < LIST_SEEN_MS) return;
    state.listSeenAt = Date.now();
    const requestIds = [...new Set(entries.map(skipRecord).filter(Boolean).map(record => record.requestId).filter(Boolean))];
    if (!requestIds.length) return;
    try { await fetch(LIST_SEEN_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestIds }), signal: AbortSignal.timeout(5000) }); } catch (_) {}
  }
  const draw = text => {
    try { requestGuard?.beat?.(); } catch (_) {}
    const previousStatus = state.status;
    state.status = text;
    let panel = document.getElementById('relay-soomgo-v3');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'relay-soomgo-v3';
      // 숨고 견적 작성 화면의 보라색 발송 버튼은 오른쪽 아래에 있으므로
      // 패널을 위쪽으로 고정해 버튼을 가리지 않게 한다.
      panel.style.cssText = 'position:fixed;z-index:2147483647;right:14px;top:82px;width:250px;padding:12px;border-radius:12px;background:#111827;color:#e5e7eb;font:13px sans-serif;box-shadow:0 8px 30px #0007';
      panel.innerHTML = '<b>Relay Desk · 요청봇 0.4.27</b><button data-toggle style="float:right">OFF</button><div data-status style="margin-top:10px;color:#a7f3d0"></div><small>하루 최대 30건 · 발송 확인 후 완료</small>';
      panel.addEventListener('click', async event => {
        if (!event.target.matches('[data-toggle]')) return;
        state.on = !state.on;
        await chrome.storage.local.set({ [KEY]: { on: state.on } });
        draw(state.on ? '감시 중' : '정지');
      });
      document.documentElement.append(panel);
    }
    panel.querySelector('[data-status]').textContent = text;
    const button = panel.querySelector('[data-toggle]');
    button.textContent = state.on ? 'ON' : 'OFF';
    button.style.background = state.on ? '#10b981' : '#64748b';
    const now = Date.now();
    // 프로필 등 다른 숨고 탭에 주입된 패널이 실제 요청봇 상태를 덮어쓰지
    // 않도록 요청 목록/상세 화면에서만 상태를 서버에 보고한다.
    const requestSurface = /\/requests\/received/i.test(location.pathname);
    if (requestSurface && (text !== previousStatus || now - state.lastHeartbeatAt >= HEARTBEAT_MS)) {
      state.lastHeartbeatAt = now;
      fetch(STATUS_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension-v3' },
        body: JSON.stringify({ role: 'request', at: now, status: state.on ? text : '정지', stats: { processed: state.processed.size, busy: state.busy, url: location.href, accountName: currentAccountName(), version: (() => { try { return chrome.runtime.getManifest().version; } catch (_) { return ''; } })() } })
      }).catch(() => {});
    }
  };
  const fieldText = el => clean(`${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('placeholder') || ''} ${el.name || ''} ${el.closest?.('label')?.textContent || ''}`);
  const findField = re => [...document.querySelectorAll('input,textarea,[contenteditable="true"]')].filter(visible).find(el => re.test(fieldText(el)));
  const setValue = (el, value) => {
    if (!el) return false;
    const raw = String(value ?? '');
    el.focus();
    if (el.isContentEditable) el.textContent = String(value ?? '');
    else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) return false;
      const previousValue = String(el.value || '');
      setter.call(el, raw);
      // React의 value tracker가 이전 값을 기억하도록 한 뒤 input 이벤트를
      // 보내야 화면 값과 내부 폼 상태가 함께 갱신된다.
      if (el._valueTracker?.setValue) el._valueTracker.setValue(previousValue);
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: raw }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  };
  const readValue = el => clean(el?.isContentEditable ? el.textContent : el?.value);
  const comparableText = value => String(value || '').replace(/\s+/g, ' ').trim();
  async function waitForFormValues(amount, description, expectedAmount, expectedDescription) {
    const amountText = String(expectedAmount).replace(/[^0-9]/g, '');
    const descriptionText = comparableText(expectedDescription);
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const actualAmount = readValue(amount).replace(/[^0-9]/g, '');
      const actualDescription = comparableText(readValue(description));
      const descriptionMatches = actualDescription === descriptionText;
      if (actualAmount === amountText && descriptionMatches) return true;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
  }
  // 0.4.27(9/25 시뮬 7): 원본 길이 칸이 없을 때 '희망 길이'(완성본 길이)를 원본 길이로 읽어 식전영상이 "원본 3분 69,000원"으로 나갔다.
  // 원본(작업할 자료) 길이가 분명한 칸만 읽는다. 희망·완성 길이는 비워 두고 서버가 자료 기준(89,000원부터)으로 정한다.
  const sourceVolume = text => (text.match(/(?<!희망\s*|완성\s*|원하는\s*)(?:작업 분량|원본 영상 길이|원본 길이|영상 길이|분량)\s*\n?([^\n]+)/i) || [])[1] || '';
  const extract = () => {
    const page = bodyText();
    const start = page.indexOf('요청 상세');
    const text = start >= 0 ? page.slice(start).split('견적 금액')[0] : '';
    const displayLabel = (text.match(/(?:희망 서비스|서비스 분야)\s*[:：]?\s*\n?\s*([^\n]+)/i) || [])[1] || '';
    return { requestId: requestKey(), text, displayLabel: clean(displayLabel), topic: (text.match(/(?:의뢰\/희망사항|의뢰 내용|작성 주제)\s*\n?([\s\S]{0,1200}?)(?=\n?\s*(?:고객 정보|완료 희망일)|$)/i) || [])[1] || '', volume: sourceVolume(text), format: (text.match(/(?:파일 형식|결과물 형식)\s*\n?([^\n]+)/i) || [])[1] || '', sourceUrl: location.href };
  };
  async function queueForRelayDesk(request, error, connectionLost = false) {
    const previous = state.pending.get(request.requestId) || {};
    const pending = { request, attempts: Number(previous.attempts || 0) + 1, lastError: String(error?.message || error || '').slice(0, 200), updatedAt: new Date().toISOString(), nextRetryAt: Date.now() + 30000 };
    state.pending.set(request.requestId, pending);
    await chrome.storage.local.set({ [PENDING_KEY]: [...state.pending.entries()].slice(-100) });
    draw('Relay Desk 연결 대기 · 발송하지 않음');
    // 0.4.10: 상세 화면에 머물지 않고 요청 목록으로 나가 대기한다. 서버 연결이
    // 끊긴 경우에는 목록에서 새 요청도 열지 않고, 서버가 돌아오면 이어서 처리한다.
    if (connectionLost) setRelayWait(Date.now() + 30000);
    await new Promise(resolve => setTimeout(resolve, 600));
    await returnToRequestList();
  }
  const RELAY_WAIT_KEY = 'relaySoomgoRelayWaitUntilV1';
  function setRelayWait(until) {
    state.relayWaitUntil = until;
    try { if (until) sessionStorage.setItem(RELAY_WAIT_KEY, String(until)); else sessionStorage.removeItem(RELAY_WAIT_KEY); } catch (_) {}
  }
  function relayWaitUntil() {
    if (state.relayWaitUntil) return state.relayWaitUntil;
    try { state.relayWaitUntil = Number(sessionStorage.getItem(RELAY_WAIT_KEY) || 0); } catch (_) { state.relayWaitUntil = 0; }
    return state.relayWaitUntil;
  }
  async function relayDeskReachable() {
    try {
      const response = await fetch('http://127.0.0.1:8787/api/health', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      return response.ok;
    } catch (_) {
      return false;
    }
  }
  const sendButton = () => {
    const candidates = [...document.querySelectorAll('button,[role="button"],.prisma-btn')]
      .filter(visible)
      .filter(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true')
      .filter(el => /견적\s*보내기|견적을\s*발송|견적을\s*보내|전송/i.test(clean(el.textContent || el.getAttribute('aria-label'))));
    return candidates.find(el => /견적\s*보내기|견적을\s*발송|견적을\s*보내/i.test(clean(el.textContent || el.getAttribute('aria-label')))) || candidates[0];
  };
  const clickSendButton = button => {
    if (!button) return false;
    button.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    button.focus?.();
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      try {
        const EventCtor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        button.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
      } catch (_) {}
    }
    try { HTMLElement.prototype.click.call(button); } catch (_) { try { button.click(); } catch (_) {} }
    return true;
  };
  const explicitFailure = () => /캐시(?:가|이)?\s*부족|견적을\s*발송할\s*수\s*없어요|견적 보내기 실패|금액을 입력해 주세요|필수 항목|전송에 실패|오류가 발생/i.test(bodyText());
  const explicitSuccess = () => /견적을 보냈|견적 발송 완료|견적이 전송|견적 보내기 완료/i.test(bodyText());
  async function confirmSend(beforeUrl) {
    const started = Date.now();
    while (Date.now() - started < 10000) {
      await new Promise(resolve => setTimeout(resolve, 350));
      if (explicitFailure()) return 'failed';
      if (explicitSuccess() || /\/pro\/chats\/[^/]+/.test(location.pathname)) return 'confirmed';
    }
    return 'unknown';
  }
  // 0.4.21: 결과 보고 예약함. 요청번호마다 가장 최근 결과 하나만 남긴다.
  // 보고가 서버에 닿으면 지우고, 닿기 전에 페이지가 바뀌면 다음 로드에서 한 번만 다시 보낸다.
  const QUOTE_RESULT_OUTBOX_KEY = 'relaySoomgoQuoteResultOutboxV1';
  const QUOTE_RESULT_OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;
  const readQuoteResultOutbox = () => {
    try { const list = JSON.parse(sessionStorage.getItem(QUOTE_RESULT_OUTBOX_KEY) || '[]'); return Array.isArray(list) ? list.filter(entry => entry && entry.requestId) : []; } catch (_) { return []; }
  };
  const writeQuoteResultOutbox = list => {
    try { if (list.length) sessionStorage.setItem(QUOTE_RESULT_OUTBOX_KEY, JSON.stringify(list.slice(-20))); else sessionStorage.removeItem(QUOTE_RESULT_OUTBOX_KEY); } catch (_) {}
  };
  function reserveQuoteResult(requestIdValue, status, note = '', at = new Date().toISOString(), url = location.href) {
    const requestIdText = String(requestIdValue || '').slice(0, 160);
    if (!requestIdText) return;
    const list = readQuoteResultOutbox().filter(entry => entry.requestId !== requestIdText);
    list.push({ requestId: requestIdText, status, note: String(note || '').slice(0, 300), at, url: String(url || '').slice(0, 500), retried: false });
    writeQuoteResultOutbox(list);
  }
  function clearQuoteResult(requestIdText, status) {
    writeQuoteResultOutbox(readQuoteResultOutbox().filter(entry => !(entry.requestId === requestIdText && entry.status === status)));
  }
  async function reportQuoteResult(requestIdValue, status, note = '', options = {}) {
    const requestIdText = String(requestIdValue || '').slice(0, 160);
    if (!requestIdText) return false;
    const at = options.at || new Date().toISOString();
    const url = options.url || location.href;
    const noteText = String(note || '').slice(0, 300);
    if (!options.replay) reserveQuoteResult(requestIdText, status, noteText, at, url);
    try {
      const response = await fetch(QUOTE_RESULT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension-v3' },
        keepalive: true,
        body: JSON.stringify({ requestId: requestIdText, status, at, url, note: noteText })
      });
      if (response.ok && !options.replay) clearQuoteResult(requestIdText, status);
      return response.ok;
    } catch (_) {
      return false;
    }
  }
  // 새 문서가 뜰 때 한 번 부른다. 아직 안 보낸 예약만 한 번 다시 보내고,
  // 성공·실패와 상관없이 예약함에서 뺀다(그래도 빠진 건은 서버 quote_result_missing 알림이 잡는다).
  async function flushQuoteResultOutbox() {
    const now = Date.now();
    const fresh = readQuoteResultOutbox().filter(entry => now - Date.parse(entry.at || 0) < QUOTE_RESULT_OUTBOX_TTL_MS);
    const due = fresh.filter(entry => !entry.retried);
    // 보내기 전에 표시해 두어, 이 로드가 도중에 끊겨도 같은 예약을 또 보내지 않는다.
    writeQuoteResultOutbox(due.map(entry => ({ ...entry, retried: true })));
    let delivered = 0;
    for (const entry of due) {
      if (await reportQuoteResult(entry.requestId, entry.status, `${entry.note} · 페이지 이동 뒤 재전송`, { at: entry.at, url: entry.url, replay: true })) delivered += 1;
    }
    const sentKeys = new Set(due.map(entry => `${entry.requestId}|${entry.status}|${entry.at}`));
    writeQuoteResultOutbox(readQuoteResultOutbox().filter(entry => !sentKeys.has(`${entry.requestId}|${entry.status}|${entry.at}`)));
    return { due: due.length, delivered };
  }
  async function returnToRequestList() {
    // 숨고 SPA의 뒤로가기 상태에 의존하지 않고 요청 목록으로 직접 이동한다.
    // 채팅방·상세 화면 어느 곳에서든 같은 목록으로 복귀한다.
    const target = 'https://soomgo.com/requests/received?from=gnb';
    const listLink = [...document.querySelectorAll('a[href*="/requests/received"]')].filter(visible).find(el => /요청\s*[·･.ㆍ]?\s*견적/.test(clean(el.textContent)));
    if (listLink) { listLink.click(); return; }
    location.assign(target);
  }
  // 견적 발송 뒤 숨고가 띄우는 'AI가 완성했습니다 · 스마트견적을 지금 등록해 보세요'
  // 안내 화면에서는 '나가기'만 누른다. '스마트견적에 임시 등록하기'는 누르지 않는다(0.4.8).
  const smartQuoteExitButton = () => {
    const text = bodyText();
    if (!/스마트견적을\s*지금\s*등록해\s*보세요|AI가\s*완성했습니다/.test(text)) return null;
    if (!/스마트견적에\s*임시\s*등록하기/.test(text)) return null;
    return [...document.querySelectorAll('button,[role="button"],a')]
      .filter(visible)
      .filter(el => !el.closest('#relay-soomgo-v3'))
      .find(el => /^나가기$/.test(clean(el.textContent || el.getAttribute('aria-label') || ''))) || null;
  };
  let lastSmartQuoteExitAt = 0;
  function dismissSmartQuotePromo() {
    if (Date.now() - lastSmartQuoteExitAt < 3000) return false;
    const exit = smartQuoteExitButton();
    if (!exit) return false;
    lastSmartQuoteExitAt = Date.now();
    try { exit.click(); } catch (_) { return false; }
    draw('스마트견적 안내 화면 · 나가기');
    return true;
  }
  async function waitAndDismissSmartQuotePromo(timeoutMs = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (dismissSmartQuotePromo()) { await new Promise(resolve => setTimeout(resolve, 600)); return true; }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    return false;
  }
  // 고수 10명이 이미 견적을 보낸 요청은 숨고가 '견적을 발송할 수 없어요' 팝업을 띄운다.
  // 확인을 누르고, 다시 열리지 않게 요청을 삭제한 뒤 목록으로 돌아간다(0.4.9).
  const quoteClosedConfirmButton = () => {
    const text = bodyText();
    if (!/견적을\s*발송할\s*수\s*없어요/.test(text)) return null;
    if (!/이미\s*10\s*개\s*이상\s*견적을\s*받은\s*요청/.test(text)) return null;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal, [class*="Modal"]')]
      .filter(visible).filter(el => !el.closest('#relay-soomgo-v3'))
      .filter(el => /견적을\s*발송할\s*수\s*없어요/.test(clean(el.innerText || el.textContent || '')));
    const scope = dialogs[dialogs.length - 1] || document;
    return [...scope.querySelectorAll('button,[role="button"]')]
      .filter(visible).filter(el => !el.closest('#relay-soomgo-v3'))
      .find(el => /^확인$/.test(clean(el.textContent || el.getAttribute('aria-label') || ''))) || null;
  };
  let lastQuoteClosedAt = 0;
  async function handleQuoteClosed(requestIdValue = requestId()) {
    if (Date.now() - lastQuoteClosedAt < 3000) return false;
    const confirm = quoteClosedConfirmButton();
    if (!confirm) return false;
    lastQuoteClosedAt = Date.now();
    try { confirm.click(); } catch (_) { return false; }
    await new Promise(resolve => setTimeout(resolve, 500));
    if (requestIdValue) state.processed.add(requestIdValue);
    if (requestIdValue) await rememberSkip(requestIdValue, state.definitionsVersion, '고수 10명 견적 마감');
    const deleted = await deleteCurrentRequest('quoteClosed10');
    await reportQuoteResult(requestIdValue, 'skipped', `고수 10명 견적 마감 요청 · 발송 불가 · ${deleted ? '숨고 요청 삭제 완료' : '삭제 버튼을 확실히 찾지 못해 삭제 안 함'}`);
    draw(deleted ? '견적 마감 요청(10명) · 삭제 후 목록 이동' : '견적 마감 요청(10명) · 삭제 안 함 · 목록 이동');
    await new Promise(resolve => setTimeout(resolve, 600));
    await returnToRequestList();
    return true;
  }
  // 삭제 규칙(2026-09-22 준희 지시):
  // - 0.4.15: 숨고 요청 삭제는 준희 승인 후에만. 제공 불가 판정(deleteRequest)은 삭제하지 않고 건너뛴다.
  // - 0.4.16: 예외로 '고수 10명 견적 마감' 요청만 자동 삭제한다(견적을 보낼 수 없는 요청이라 남길 이유가 없음).
  // 이전 버전은 화면의 첫 '삭제하기' 버튼을 눌러, 상세 화면 옆 목록의 다른 요청을 지울 위험이 있었다.
  // 그래서 지금 열린 요청의 버튼만 고르고, 애매하면(후보 0개·다른 요청 카드 안·확인 대화상자 없음) 누르지 않는다.
  const AUTO_DELETE_ALLOWED = Object.freeze({ quoteClosed10: true, unsupported: false });
  const REQUEST_LINK = 'a[href*="/requests/received/"]';
  function linkedRequestIds(el) {
    if (!el?.querySelectorAll) return [];
    return [...el.querySelectorAll(REQUEST_LINK)].map(a => (String(a.getAttribute?.('href') || a.href || '').match(/\/requests\/received\/([^/?#]+)/) || [])[1]).filter(Boolean);
  }
  // 버튼에서 위로 올라가며 요청 링크를 처음 만나는 조상을 본다.
  // 그 조상에 걸린 요청이 하나뿐이고 지금 요청이 아니면 다른 요청의 목록 카드 → 제외.
  // 여러 요청이 한꺼번에 걸려 있으면 카드가 아니라 화면 전체 영역이므로 카드 밖 버튼으로 본다.
  function belongsToOtherRequest(button, currentId) {
    let el = button.parentElement;
    for (let depth = 0; el && depth < 8; depth += 1, el = el.parentElement) {
      const ids = [...new Set(linkedRequestIds(el))];
      if (!ids.length) continue;
      return ids.length === 1 && ids[0] !== currentId;
    }
    return false;
  }
  function currentRequestDeleteButton(currentId = requestId(), root = document) {
    if (!currentId) return null;
    const candidates = [...root.querySelectorAll('button,[role="button"]')]
      .filter(visible).filter(el => !el.closest?.('#relay-soomgo-v3'))
      .filter(el => /^\s*삭제하기\s*$/.test(clean(el.textContent || el.getAttribute?.('aria-label') || '')));
    if (!candidates.length) return null;
    const safe = candidates.filter(el => !belongsToOtherRequest(el, currentId));
    return safe[0] || null;
  }
  async function deleteCurrentRequest(kind = 'unsupported') {
    if (AUTO_DELETE_ALLOWED[kind] !== true) return false;
    const currentId = requestId();
    const first = currentRequestDeleteButton(currentId);
    if (!first) return false;
    first.click();
    await new Promise(resolve => setTimeout(resolve, 350));
    // 확인은 반드시 새로 뜬 대화상자 안에서만 누른다(문서 전체에서 찾지 않는다).
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal, [class*="Modal"]')]
      .filter(visible).filter(el => !el.closest('#relay-soomgo-v3'));
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog || requestId() !== currentId) return false;
    const confirm = [...dialog.querySelectorAll('button,[role="button"]')]
      .filter(visible)
      .filter(button => /^\s*(?:삭제하기|삭제|확인)\s*$/.test(clean(button.textContent || button.getAttribute('aria-label') || '')))
      .pop();
    if (!confirm || confirm === first) return false;
    confirm.click();
    return true;
  }
  async function processDetail() {
    if (!state.on || state.busy || !isDetail() || blocked()) return;
    try {
      const day = kstDay();
      const daily = JSON.parse(localStorage.getItem(DAILY_STATS_KEY) || '{}');
      if (daily.day === day && Number(daily.sent || 0) >= DAILY_QUOTE_LIMIT) {
        draw(`오늘 신규 견적 한도 도달 · 최대 ${DAILY_QUOTE_LIMIT}건`);
        return;
      }
    } catch (_) {}
    const request = extract();
    // 0.4.17: 요청 상세 칸이 화면에 뜨기 전에 읽으면 빈 내용이 서버로 가서 '분류 불가'로 건너뛰었다(2026-09-22 PPT 요청 사례).
    // 요청 칸이 보일 때까지 최대 8초 기다린 뒤 읽는다. 그래도 안 뜨면 그대로 보내고 서버 판단(빈 요청은 422 → 30초 뒤 재시도)에 맡긴다.
    if (!REQUEST_FIELDS.test(request.text)) {
      if (!state.waitDetail || state.waitDetail.id !== request.requestId) state.waitDetail = { id: request.requestId, at: Date.now() };
      if (Date.now() - state.waitDetail.at < DETAIL_WAIT_MS) { draw('요청 상세 불러오는 중 · 기다림'); return; }
    }
    state.waitDetail = null;
    if (state.currentId !== request.requestId) { state.currentId = request.requestId; state.busy = false; }
    // 이미 처리한 요청 상세에 다시 들어왔으면 머물지 않고 목록으로 돌아간다(0.4.13).
    if (state.processed.has(request.requestId)) { draw('이미 처리한 요청 · 목록으로'); await returnToRequestList(); return; }
    const pending = state.pending.get(request.requestId);
    if (pending && Date.now() < Number(pending.nextRetryAt || 0)) { draw('Relay Desk 연결 대기 · 발송하지 않음'); return; }
    state.busy = true;
    draw('견적 계산 중 · Relay Desk 분류 대기');
    try {
      let response;
      let data;
      try {
        response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension-v3' }, body: JSON.stringify(request) });
        data = await response.json();
      } catch (error) {
        await queueForRelayDesk(request, error, true);
        return;
      }
      if (!response.ok || !data.quote) {
        await queueForRelayDesk(request, new Error(data?.error || '견적 응답 없음'));
        return;
      }
      state.pending.delete(request.requestId);
      await chrome.storage.local.set({ [PENDING_KEY]: [...state.pending.entries()].slice(-100) });
      const quote = data.quote;
      const resultRequestId = String(quote.sourceRequestId || request.requestId);
      if (!state.on || requestId() !== request.requestId) return;
      draw(`견적 계산 완료 · ${data.serviceLabel || quote.serviceLabel || '수동 확인'}`);
      if (data.duplicate && data.lead?.quoteEvidence?.status === 'sent') {
        state.processed.add(request.requestId);
        draw('이미 발송 확인된 요청 건너뜀');
        await new Promise(resolve => setTimeout(resolve, 350));
        await returnToRequestList();
        return;
      }
      if (data.duplicate && data.lead?.quoteEvidence?.status === 'uncertain') {
        state.processed.add(request.requestId);
        draw('이전 발송 결과 확인 필요 · 중복 방지로 건너뜀');
        await new Promise(resolve => setTimeout(resolve, 350));
        await returnToRequestList();
        return;
      }
      if (quote.deleteRequest === true) {
        // 삭제 대상 판정이어도 삭제하지 않는다. 건너뜀으로 기록하고 준희 승인을 기다린다(0.4.15).
        state.processed.add(request.requestId);
        await rememberSkip(request.requestId, data.definitionsVersion, quote.reason || '삭제 대상');
        await reportQuoteResult(resultRequestId, 'skipped', `삭제 승인 대기(봇은 삭제하지 않음) · ${quote.reason || '제공하지 않는 요청'}`);
        draw('삭제 대상 · 승인 대기 · 삭제 안 함');
        await new Promise(resolve => setTimeout(resolve, 600));
        await returnToRequestList();
        return;
      }
      if (quote.manualReview || quote.autoSend === false) {
        state.processed.add(request.requestId);
        await adoptDefinitionsVersion(data.definitionsVersion);
        if (data.skipRevisit !== false) await rememberSkip(request.requestId, data.definitionsVersion, quote.reason);
        await reportQuoteResult(resultRequestId, 'skipped', quote.reason || '지원 범위 외 또는 수동 확인 필요');
        draw(`지원 범위 외 요청 건너뜀 · ${quote.reason || '수동 확인 필요'}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        await returnToRequestList();
        return;
      }
      const amount = findField(/금액|비용|price|amount/i);
      const days = findField(/소요일|기간|day|period/i);
      const description = findField(/견적|서비스 설명|상세 내용|메시지|description|message/i) || [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible)[0];
      if (!amount || !description) throw new Error('견적 입력창을 찾지 못했습니다');
      setValue(amount, String(quote.amount).replace(/,/g, '')); setValue(days, quote.days); setValue(description, quote.message);
      draw('입력 확인 중');
      if (!await waitForFormValues(amount, description, quote.amount, quote.message)) throw new Error('숨고 폼 상태 불일치');
      const send = sendButton();
      if (!send) throw new Error('견적 보내기 버튼을 찾지 못했습니다');
      // 다른 탭이 요청봇 잠금을 넘겨받았으면 이 탭은 발송하지 않는다.
      if (requestGuard?.superseded?.()) { draw('잠금 넘겨줌 · 발송 안 함'); return; }
      const beforeUrl = location.href;
      // 숨고는 제출 즉시 채팅 SPA로 이동해 현재 문서의 JS를 종료한다.
      // 새 문서에서 복귀할 수 있도록 발송 전에 예약을 남긴다.
      try { sessionStorage.setItem(RETURN_AFTER_SEND_KEY, JSON.stringify({ at: Date.now(), requestId: resultRequestId, reported: false })); } catch (_) {}
      // 0.4.21: 결과를 확인하기 전에 페이지가 바뀌어도 '발송 확인 필요'로 남도록 먼저 예약한다.
      // 확인되면 아래 reportQuoteResult가 같은 요청번호의 예약을 실제 결과로 바꾼다.
      reserveQuoteResult(resultRequestId, 'uncertain', '견적 보내기를 누른 뒤 결과를 확인하기 전에 페이지가 바뀌었습니다.');
      await new Promise(resolve => setTimeout(resolve, 250));
      if (!state.on || requestId() !== request.requestId) return;
      draw('견적 보내기 클릭 · 발송 확인 중');
      if (!clickSendButton(send)) throw new Error('견적 보내기 버튼 클릭 실패');
      const result = await confirmSend(beforeUrl);
      if (result === 'confirmed') {
        const reported = await reportQuoteResult(resultRequestId, 'sent', '숨고 화면의 발송 성공 표시 또는 채팅방 이동을 확인했습니다.');
        if (reported) {
          try { sessionStorage.setItem(RETURN_AFTER_SEND_KEY, JSON.stringify({ at: Date.now(), requestId: resultRequestId, reported: true })); } catch (_) {}
        }
        state.processed.add(request.requestId);
        try {
          const day = kstDay();
          const daily = JSON.parse(localStorage.getItem(DAILY_STATS_KEY) || '{}');
          const next = daily.day === day ? daily : { day, sent: 0 };
          next.sent = Number(next.sent || 0) + 1;
          localStorage.setItem(DAILY_STATS_KEY, JSON.stringify(next));
        } catch (_) {}
        draw('견적 발송 확인 · 요청 목록으로 이동');
        await new Promise(resolve => setTimeout(resolve, 500));
        await returnToRequestList();
      }
      else if (result === 'failed' && cashShortage()) {
        await reportQuoteResult(resultRequestId, 'blocked', '숨고 캐시 부족으로 견적을 보내지 못했습니다.');
        await stopBot('숨고 캐시 부족 · 자동 정지 (충전 후 ON)');
      }
      else if (result === 'failed' && quoteClosedConfirmButton()) {
        lastQuoteClosedAt = 0;
        await handleQuoteClosed(resultRequestId);
        state.processed.add(request.requestId);
      }
      else {
        await reportQuoteResult(resultRequestId, result === 'failed' ? 'blocked' : 'uncertain', result === 'failed' ? '숨고 화면에서 견적 발송 실패 문구를 확인했습니다.' : '제한 시간 안에 발송 성공 여부를 확인하지 못했습니다.');
        state.processed.add(request.requestId);
        draw(result === 'failed' ? '견적 발송 실패 · 다음 요청으로 이동' : '견적 발송 결과 불확실 · 중복 방지 후 다음 요청으로 이동');
        await new Promise(resolve => setTimeout(resolve, 500));
        await returnToRequestList();
      }
    } catch (error) {
      const attempts = Number(state.failures.get(request.requestId) || 0) + 1;
      state.failures.set(request.requestId, attempts);
      draw(`오류 ${attempts}/2 · ${String(error.message || error).slice(0, 100)}`);
      if (attempts >= 2) {
        state.processed.add(request.requestId);
        await new Promise(resolve => setTimeout(resolve, 500));
        await returnToRequestList();
      }
    }
    finally { state.busy = false; }
  }
  // 0.4.12: 숨고 탭이 여러 개여도 요청봇은 한 탭에서만 돈다(같은 요청 중복 발송 방지).
  const requestGuard = globalThis.RelayAutomationGuard?.createGuard({
    role: 'request',
    isPaused: async () => !state.on,
    onStatus: code => { if (code === 'role-busy') draw('다른 숨고 탭에서 요청봇 실행 중 · 이 탭은 대기'); }
  });
  async function loop() {
    if (!state.on) { draw('정지'); return; }
    if (!requestGuard) return guardedLoop();
    try { await requestGuard.run(guardedLoop); } catch (error) { draw(`요청봇 실행 보류 · ${String(error?.message || error).slice(0, 80)}`); }
  }
  async function guardedLoop() {
    draw(state.on ? state.status : '정지');
    if (state.busy) return;
    const otherAccount = state.on ? wrongAccount() : '';
    if (otherAccount) { await stopBot(`숨고 계정이 swan이 아님(${otherAccount}) · 자동 정지`); return; }
    if (location.href !== state.lastUrl) { state.lastUrl = location.href; state.currentId = ''; }
    if (blocked()) { state.on = false; draw('로그인·차단 화면 감지 · 자동 정지'); return; }
    if (state.on && dismissSmartQuotePromo()) return;
    if (state.on && isDetail() && quoteClosedConfirmButton()) { state.busy = true; try { await handleQuoteClosed(); } finally { state.busy = false; } return; }
    if (state.on && transientError()) {
      if (scheduleTransientReload()) return;
      state.on = false; draw('숨고 일시 오류 반복 · 자동 정지 (새로고침 3회 초과)'); return;
    }
    if (isDetail()) return processDetail();
    if (!state.on || !isList()) return;
    if (relayWaitUntil()) {
      if (Date.now() < state.relayWaitUntil) { draw(`Relay Desk 연결 끊김 · 목록에서 대기 (${Math.ceil((state.relayWaitUntil - Date.now()) / 1000)}초 후 재확인)`); return; }
      state.busy = true;
      let reachable = false;
      try { reachable = await relayDeskReachable(); } finally { state.busy = false; }
      if (!reachable) { setRelayWait(Date.now() + 30000); draw('Relay Desk 연결 끊김 · 목록에서 대기'); return; }
      setRelayWait(0);
      draw('Relay Desk 연결 복구 · 감시 재개');
    }
    await refreshDefinitionsVersion();
    const entries = listEntries();
    await reportListSeen(entries);
    // 0.4.20: 답장률이 높은 PPT → 문서 → 자막 순으로 먼저 연다(같은 순위는 목록 순서 그대로).
    const next = entries.filter(entry => !state.processed.has(entry.id) && !skipRecord(entry)
      && !(state.pending.get(entry.id) && Date.now() < Number(state.pending.get(entry.id).nextRetryAt || 0)))
      .map((entry, index) => ({ entry, index, rank: requestPriority(entry.text) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)[0]?.entry;
    if (next) {
      draw('요청 1건 여는 중');
      try { sessionStorage.setItem(LAST_CARD_KEY, JSON.stringify({ key: next.key, generic: Boolean(next.generic), at: Date.now() })); } catch (_) {}
      next.element.click();
    }
    else if (Date.now() - state.lastRefreshAt >= REQUEST_REFRESH_MS) {
      state.lastRefreshAt = Date.now();
      const refresh = [...document.querySelectorAll('button,[role="button"]')]
        .filter(visible)
        .find(button => /^새로고침$/.test(clean(button.textContent || button.getAttribute('aria-label') || '')));
      if (refresh) { draw('새 요청 확인 중'); refresh.click(); }
      else draw('감시 중');
    }
  }
  chrome.storage.local.get([KEY, PENDING_KEY, SKIP_KEY]).then(async stored => {
    // 0.4.19: 예전 버전이 카드 키(CARD-)로 잘못 묶어 저장한 건너뜀 기록은 버린다. 요청번호(REQ-) 기록만 남긴다.
    state.skipped = new Map((Array.isArray(stored[SKIP_KEY]) ? stored[SKIP_KEY] : []).filter(entry => Array.isArray(entry) && /^REQ-/.test(String(entry[0] || ''))));
    const storedOn = stored[KEY] ? Boolean(stored[KEY].on) : true;
    if (storedOn && /\/pro\/chats\//i.test(location.pathname)) await waitAndDismissSmartQuotePromo();
    // 견적 발송 후 숨고가 채팅방으로 이동한 경우 새 content script가
    // 예약된 요청 목록 복귀를 수행한다.
    try {
      const pendingReturn = JSON.parse(sessionStorage.getItem(RETURN_AFTER_SEND_KEY) || 'null');
      if (pendingReturn?.at && Date.now() - Number(pendingReturn.at) < 30000 && /\/pro\/chats\//i.test(location.pathname)) {
        if (!pendingReturn.reported) await reportQuoteResult(pendingReturn.requestId, 'sent', '견적 제출 후 숨고 채팅방으로 이동한 사실을 확인했습니다.');
        sessionStorage.removeItem(RETURN_AFTER_SEND_KEY);
        await returnToRequestList();
        return;
      }
      if (pendingReturn?.at && Date.now() - Number(pendingReturn.at) >= 30000) sessionStorage.removeItem(RETURN_AFTER_SEND_KEY);
    } catch (_) {}
    // 0.4.21: 지난 문서에서 서버에 못 닿은 결과 보고를 한 번 다시 보낸다.
    try { await flushQuoteResultOutbox(); } catch (_) {}
    if (/\/pro\/chats/.test(location.pathname)) return;
    // 새 V3 설치본은 사용자가 요청한 무인 운영을 바로 재개한다.
    // 이후 패널에서 OFF를 누른 상태는 저장값을 그대로 존중한다.
    state.on = stored[KEY] ? Boolean(stored[KEY].on) : true;
    state.pending = new Map(Array.isArray(stored[PENDING_KEY]) ? stored[PENDING_KEY] : []);
    await chrome.storage.local.set({ [KEY]: { on: state.on } });
    draw(state.on ? '감시 중' : '정지');
    // 다른 탭의 패널에서 ON/OFF를 바꾸면 이 탭도 같은 값을 따라가게 해
    // 탭마다 다른 상태가 서버 심박을 덮어쓰는 일을 막는다(0.4.7).
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[KEY]) return;
      const next = Boolean(changes[KEY].newValue?.on);
      if (next === state.on) return;
      state.on = next;
      draw(state.on ? '감시 중' : '정지');
    });
    setInterval(loop, 1500);
    setInterval(() => draw(state.on ? state.status || '감시 중' : '정지'), HEARTBEAT_MS);
    loop();
  });
})();
