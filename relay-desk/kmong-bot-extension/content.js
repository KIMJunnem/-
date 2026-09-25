(function () {
  'use strict';

  const API = 'http://127.0.0.1:8787/api/kmong';
  const STORAGE_KEY = 'relayKmongBotSettingsV1';
  const SEEN_KEY = 'relayKmongBotSeenV1';
  const PENDING_KEY = 'relayKmongBotPendingV1';
  const ORDER_SEEN_KEY = 'relayKmongOrderSeenV1';
  const HEARTBEAT_MS = 15000;
  const LOOP_MS = 2000;
  const DEFAULTS = {
    enabled: true,
    // 설치 직후 실제 고객에게 바로 발송하지 않는다. 모의 검증과 크몽
    // 화면별 선택자 확인을 마친 뒤 패널에서 켠다.
    autoSend: false,
    accountName: 'swan'
  };
  const state = {
    settings: { ...DEFAULTS },
    busy: false,
    seen: new Set(),
    pending: [],
    orders: new Set(),
    lastHeartbeatAt: 0,
    lastUrl: location.href,
    lastStatus: '시작 중',
    stats: { detected: 0, drafted: 0, sent: 0, skipped: 0, uncertain: 0, orders: 0 }
  };
  let loopTimer = null;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const hash = value => {
    let h = 2166136261;
    for (const ch of String(value || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  const visible = element => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const pageText = () => clean(document.body?.innerText || '').slice(0, 30000);
  const currentChatId = () => {
    const url = new URL(location.href);
    const fromQuery = url.searchParams.get('inbox_group_id') || url.searchParams.get('inboxGroupId') || url.searchParams.get('conversation_id');
    if (fromQuery) return clean(fromQuery).slice(0, 200);
    const match = url.pathname.match(/\/inboxes\/([A-Za-z0-9_-]{3,})/);
    return match?.[1] || '';
  };
  const currentAccountName = () => {
    const candidates = [
      ...document.querySelectorAll('header img[alt], nav img[alt], [data-testid*="profile"] img[alt], button img[alt]')
    ];
    for (const item of candidates) {
      const name = clean(item.getAttribute('alt'));
      if (name && name.length <= 80 && !/avatar|profile|프로필|크몽|logo/i.test(name)) return name;
    }
    const text = pageText();
    if (/\bswan\b/i.test(text)) return 'swan';
    return '';
  };
  const isSystemText = text => /^(?:크몽|알림|시스템)\s*(?:알림|메시지)?/i.test(clean(text))
    || /결제가\s*완료|주문이\s*접수|거래가\s*완료|서비스가\s*구매|안전\s*결제|거래\s*확정/.test(clean(text));
  const isClosedText = text => /다른\s*전문가(?:를|와)\s*(?:선택|고용)|거래\s*(?:종료|취소|환불\s*완료)|문의\s*종료|대화\s*종료/.test(clean(text));

  async function storageGet(key, fallback) {
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] ?? fallback;
    } catch (_) { return fallback; }
  }

  async function storageSet(key, value) {
    try { await chrome.storage.local.set({ [key]: value }); } catch (_) {}
  }

  async function load() {
    state.settings = { ...DEFAULTS, ...(await storageGet(STORAGE_KEY, {})) };
    state.seen = new Set(await storageGet(SEEN_KEY, []));
    state.pending = await storageGet(PENDING_KEY, []);
    if (!Array.isArray(state.pending)) state.pending = [];
    state.orders = new Set(await storageGet(ORDER_SEEN_KEY, []));
  }

  async function saveSeen() {
    await storageSet(SEEN_KEY, [...state.seen].slice(-3000));
  }

  async function savePending() {
    await storageSet(PENDING_KEY, state.pending.slice(-300));
  }

  async function saveOrders() {
    await storageSet(ORDER_SEEN_KEY, [...state.orders].slice(-1000));
  }

  async function api(path, options = {}) {
    const reply = await chrome.runtime.sendMessage({
      type: 'relay-kmong-api',
      path,
      method: options.method || 'GET',
      body: options.body || null,
      timeoutMs: options.timeoutMs || 8000
    });
    if (!reply?.ok) throw new Error(reply?.error || `http_${reply?.status || 0}`);
    return reply.body || {};
  }

  function setStatus(text) {
    state.lastStatus = clean(text).slice(0, 160) || '확인 중';
    const element = document.querySelector('#relay-kmong-status');
    if (element && element.textContent !== state.lastStatus) element.textContent = state.lastStatus;
  }

  function scheduleLoop(delay = 200) {
    if (loopTimer !== null) return;
    loopTimer = setTimeout(() => {
      loopTimer = null;
      loop();
    }, delay);
  }

  function renderPanel() {
    if (document.querySelector('#relay-kmong-bot')) return;
    const panel = document.createElement('section');
    panel.id = 'relay-kmong-bot';
    panel.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;width:260px;padding:14px;border:1px solid #d9d9d9;border-radius:14px;background:#111;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.22);font:13px/1.45 Arial,"Noto Sans KR",sans-serif';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <strong style="font-size:14px">SWAN · 크몽</strong>
        <button id="relay-kmong-toggle" style="border:1px solid #fff;border-radius:999px;background:#fff;color:#111;padding:5px 10px;cursor:pointer"></button>
      </div>
      <div id="relay-kmong-status" style="margin-top:8px;color:#ddd"></div>
      <label style="display:flex;align-items:center;gap:7px;margin-top:10px;cursor:pointer">
        <input id="relay-kmong-autosend" type="checkbox"> 검증된 답장 자동 전송
      </label>
      <button id="relay-kmong-audit" style="width:100%;margin-top:10px;border:1px solid #555;border-radius:9px;background:#222;color:#fff;padding:7px;cursor:pointer">현재 화면 점검</button>`;
    document.body.appendChild(panel);
    const toggle = panel.querySelector('#relay-kmong-toggle');
    const autosend = panel.querySelector('#relay-kmong-autosend');
    const sync = () => {
      toggle.textContent = state.settings.enabled ? 'ON' : 'OFF';
      toggle.style.background = state.settings.enabled ? '#fff' : '#444';
      toggle.style.color = state.settings.enabled ? '#111' : '#fff';
      autosend.checked = Boolean(state.settings.autoSend);
      setStatus(state.lastStatus);
    };
    toggle.addEventListener('click', async () => {
      state.settings.enabled = !state.settings.enabled;
      await storageSet(STORAGE_KEY, state.settings);
      await api('/control', { method: 'POST', body: JSON.stringify({ paused: !state.settings.enabled }) }).catch(() => {});
      sync();
    });
    autosend.addEventListener('change', async () => {
      state.settings.autoSend = autosend.checked;
      await storageSet(STORAGE_KEY, state.settings);
      sync();
    });
    panel.querySelector('#relay-kmong-audit').addEventListener('click', async () => {
      const chat = currentChatId();
      const latest = chat ? latestIncomingMessage() : null;
      setStatus(chat ? (latest ? `고객 메시지 확인 · ${latest.messageId}` : '현재 방에 새 고객 메시지 없음') : '메시지 목록 또는 주문 화면 확인');
      await heartbeat(true);
    });
    sync();
  }

  function messageNodes() {
    const selectors = [
      '[data-message-id]',
      '[data-testid*="message-item" i]',
      '[data-testid*="message-bubble" i]',
      '[id^="message-"]',
      '[class*="message-item" i]',
      '[class*="message-bubble" i]'
    ];
    const found = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (seen.has(node) || node.closest('#relay-kmong-bot') || !visible(node)) continue;
        const nested = found.some(parent => parent.contains(node));
        if (nested) continue;
        found.push(node); seen.add(node);
      }
    }
    return found;
  }

  function directionOf(node) {
    const attrs = [
      node.getAttribute('data-direction'), node.getAttribute('data-sender-type'),
      node.getAttribute('data-message-type'), node.getAttribute('aria-label'),
      node.className, node.parentElement?.className
    ].map(clean).join(' ').toLowerCase();
    if (/outgoing|sent|seller|expert|mine|my-message|right|내가\s*보낸/.test(attrs)) return 'mine';
    if (/incoming|received|buyer|customer|partner|other|left|고객/.test(attrs)) return 'customer';
    return 'unknown';
  }

  function idOf(node, text, index) {
    return clean(node.getAttribute('data-message-id') || node.id || node.getAttribute('data-testid'))
      || `dom-${hash(`${text}|${index}`)}`;
  }

  function latestIncomingMessage() {
    const chatId = currentChatId();
    if (!chatId) return null;
    const nodes = messageNodes();
    const messages = nodes.map((node, index) => {
      const text = clean(node.innerText || node.textContent || '');
      return { node, text, direction: directionOf(node), messageId: idOf(node, text, index), index };
    }).filter(item => item.text && item.text.length <= 4000 && !isSystemText(item.text));
    const conversationText = messages.map(item => `${item.direction === 'mine' ? '[내 답변]' : item.direction === 'customer' ? '[고객]' : '[미확인]'} ${item.text}`).join('\n').slice(-12000);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index];
      if (item.direction !== 'customer') continue;
      const key = `${chatId}:${item.messageId}`;
      if (state.seen.has(key)) continue;
      const laterMine = messages.slice(index + 1).some(candidate => candidate.direction === 'mine');
      if (laterMine) continue;
      return { ...item, chatId, conversationText, key };
    }
    return null;
  }

  function findComposer() {
    return [...document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')]
      .filter(visible)
      .find(element => /메시지|내용|문의|입력/.test(clean(element.getAttribute('placeholder') || element.getAttribute('aria-label') || '')))
      || [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible).at(-1)
      || null;
  }

  function setComposerValue(element, value) {
    element.focus();
    if (element.isContentEditable) {
      element.textContent = '';
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      element.textContent = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else {
      const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) return false;
      setter.call(element, '');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return clean(element.value ?? element.textContent) === clean(value);
  }

  function findSendButton(composer) {
    const scope = composer?.closest('form') || composer?.parentElement?.parentElement || document;
    const buttons = [...scope.querySelectorAll('button')].filter(visible);
    return buttons.find(button => /^(?:보내기|전송|send)$/i.test(clean(button.innerText || button.getAttribute('aria-label') || button.title)))
      || buttons.find(button => /보내|전송|send|submit/i.test(clean(button.getAttribute('aria-label') || button.title || button.getAttribute('data-testid'))))
      || null;
  }

  async function reportResult(item, status, evidence) {
    await api('/reply-result', {
      method: 'POST',
      body: JSON.stringify({ chatId: item.chatId, messageId: item.messageId, status, evidence, at: new Date().toISOString(), url: location.href })
    }).catch(() => {});
  }

  async function fillOrSend(item, reply) {
    if (currentChatId() !== item.chatId) return false;
    const latest = latestIncomingMessage();
    if (!latest || latest.messageId !== item.messageId || isClosedText(pageText())) {
      await reportResult(item, 'skipped', 'latest_message_or_conversation_state_changed');
      return false;
    }
    const composer = findComposer();
    if (!composer || !setComposerValue(composer, reply.text)) {
      await reportResult(item, 'uncertain', 'composer_not_confirmed');
      state.stats.uncertain += 1;
      return false;
    }
    state.stats.drafted += 1;
    if (!state.settings.autoSend) {
      setStatus('답장 초안 준비 · 자동 전송 꺼짐');
      return true;
    }
    const button = findSendButton(composer);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
      await reportResult(item, 'uncertain', 'send_button_not_ready');
      state.stats.uncertain += 1;
      return false;
    }
    button.click();
    await sleep(900);
    const cleared = !clean(composer.value ?? composer.textContent);
    const outgoing = messageNodes().some(node => directionOf(node) === 'mine' && clean(node.innerText || node.textContent).includes(clean(reply.text).slice(0, 80)));
    const status = cleared && outgoing ? 'sent' : 'uncertain';
    await reportResult(item, status, status === 'sent' ? 'composer_cleared_and_outgoing_message_visible' : 'send_result_not_confirmed');
    state.stats[status === 'sent' ? 'sent' : 'uncertain'] += 1;
    return status === 'sent';
  }

  async function requestReply(item) {
    const body = {
      chatId: item.chatId,
      messageId: item.messageId,
      message: item.text,
      conversationText: item.conversationText,
      url: location.href,
      statusText: pageText().slice(0, 6000),
      snapshotVersion: hash(`${item.chatId}|${item.messageId}|${item.conversationText}`)
    };
    return api('/reply', { method: 'POST', body: JSON.stringify(body), timeoutMs: 10000 });
  }

  async function processMessage() {
    const item = latestIncomingMessage();
    if (!item) return false;
    state.stats.detected += 1;
    setStatus(`문의 확인 · ${item.messageId}`);
    let response;
    try { response = await requestReply(item); }
    catch (error) { setStatus(`접수 보류 · ${clean(error.message)}`); return false; }
    const reply = response.reply || {};
    if (reply.pendingRoom) {
      if (!state.pending.some(entry => entry.key === item.key)) {
        state.pending.push({ key: item.key, chatId: item.chatId, messageId: item.messageId, text: item.text, conversationText: item.conversationText, url: location.href, createdAt: Date.now() });
        await savePending();
      }
      state.seen.add(item.key);
      await saveSeen();
      setStatus('Astra 대응실 답변 대기');
      return true;
    }
    if (reply.skip || !reply.text || reply.manualReview) {
      state.stats.skipped += 1;
      state.seen.add(item.key);
      await saveSeen();
      setStatus(reply.reason || '자동 발송 보류');
      return true;
    }
    await fillOrSend(item, reply);
    state.seen.add(item.key);
    await saveSeen();
    return true;
  }

  async function processPending() {
    if (!state.pending.length) return false;
    const next = state.pending[0];
    let response;
    try {
      response = await api('/reply', {
        method: 'POST',
        body: JSON.stringify({ chatId: next.chatId, messageId: next.messageId, message: next.text, conversationText: next.conversationText, url: next.url }),
        timeoutMs: 10000
      });
    } catch (_) { return false; }
    const reply = response.reply || {};
    if (reply.pendingRoom) return false;
    if (currentChatId() !== next.chatId) {
      const url = new URL('/inboxes', location.origin);
      url.searchParams.set('inbox_group_id', next.chatId);
      url.searchParams.set('partner_id', '');
      location.assign(url.href);
      return true;
    }
    state.pending.shift();
    await savePending();
    if (reply.skip || !reply.text || reply.manualReview) return true;
    await fillOrSend({ ...next, key: `${next.chatId}:${next.messageId}` }, reply);
    return true;
  }

  function unreadConversationLink() {
    const links = [...document.querySelectorAll('a[href*="/inboxes"]')].filter(visible);
    return links.find(link => {
      let id = '';
      try { id = new URL(link.href, location.href).searchParams.get('inbox_group_id') || ''; } catch (_) {}
      if (!id) return false;
      const marker = clean([
        link.getAttribute('aria-label'), link.className, link.innerText,
        link.querySelector('[class*="unread" i], [data-testid*="unread" i], [class*="badge" i]')?.textContent
      ].join(' '));
      return /안읽|안\s*읽|unread|새\s*메시지|\b[1-9]\d*\b/.test(marker);
    }) || null;
  }

  async function processInboxList() {
    if (currentChatId()) return false;
    const link = unreadConversationLink();
    if (!link) return false;
    setStatus('안 읽은 문의 열기');
    link.click();
    return true;
  }

  function orderCards() {
    const candidates = [...document.querySelectorAll('[data-order-id], a[href*="order"], article, li')].filter(visible);
    const cards = [];
    for (const node of candidates) {
      const text = clean(node.innerText || node.textContent);
      if (!/주문|거래|결제/.test(text) || text.length < 20 || text.length > 8000) continue;
      const href = node.matches('a') ? node.href : node.querySelector('a[href*="order"]')?.href || '';
      const id = clean(node.getAttribute('data-order-id')) || (href.match(/(?:orders?|order_id)[/=]([A-Za-z0-9_-]+)/i)?.[1]) || '';
      if (!id || cards.some(item => item.orderId === id)) continue;
      cards.push({ node, orderId: id, text, href });
    }
    return cards;
  }

  async function processOrders() {
    if (!/\/seller\/order-list/.test(location.pathname)) return false;
    for (const card of orderCards()) {
      if (state.orders.has(card.orderId)) continue;
      const paymentConfirmed = /결제\s*완료|거래\s*중|작업\s*(?:진행|시작)|서비스\s*진행/.test(card.text)
        && !/결제\s*(?:대기|취소)|거래\s*(?:취소|종료)/.test(card.text);
      const amountMatch = card.text.replace(/,/g, '').match(/(?:결제|주문|총)\s*(?:금액)?[^0-9]{0,12}(\d{4,})\s*원/);
      const serviceType = /자막|srt|subtitle/i.test(card.text) ? 'subtitle' : /문서\s*[·/]?\s*글|문서\s*작성|글\s*작성|보고서|원고|요약|교정|윤문/i.test(card.text) ? 'document' : 'unknown';
      const result = await api('/order', {
        method: 'POST',
        body: JSON.stringify({
          orderId: card.orderId,
          serviceType,
          serviceName: serviceType === 'subtitle' ? '자막 제작' : serviceType === 'document' ? '문서·글 작성' : '',
          amount: amountMatch ? Number(amountMatch[1]) : 0,
          paymentConfirmed,
          paymentEvidence: paymentConfirmed ? { source: 'Kmong seller order screen', statusText: card.text.slice(0, 500), observedAt: new Date().toISOString() } : null,
          statusText: card.text.slice(0, 1000),
          requirements: card.text.slice(0, 8000),
          url: card.href || location.href,
          observedAt: new Date().toISOString()
        })
      });
      if (result.ok) {
        state.orders.add(card.orderId);
        state.stats.orders += 1;
        await saveOrders();
      }
    }
    return false;
  }

  async function heartbeat(force = false) {
    const at = Date.now();
    if (!force && at - state.lastHeartbeatAt < HEARTBEAT_MS) return;
    state.lastHeartbeatAt = at;
    await api('/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ at, status: state.lastStatus, url: location.href, accountName: currentAccountName(), stats: state.stats })
    }).catch(() => {});
  }

  async function loop() {
    if (state.busy) return;
    state.busy = true;
    try {
      renderPanel();
      if (state.lastUrl !== location.href) {
        state.lastUrl = location.href;
        setStatus('화면 전환 확인');
      }
      await heartbeat();
      if (!state.settings.enabled) { setStatus('일시 정지'); return; }
      if (/\/seller\/order-list/.test(location.pathname)) { await processOrders(); setStatus('주문 확인 중'); return; }
      if (!/\/inboxes/.test(location.pathname)) return;
      if (await processPending()) return;
      if (await processInboxList()) return;
      if (await processMessage()) return;
      setStatus(currentChatId() ? '현재 대화 확인 중' : '새 문의 대기');
    } catch (error) {
      setStatus(`오류 · ${clean(error.message).slice(0, 90)}`);
    } finally {
      state.busy = false;
    }
  }

  load().then(() => {
    renderPanel();
    loop();
    setInterval(loop, LOOP_MS);
    const observer = new MutationObserver(records => {
      const hasRelevantChange = records.some(record => {
        const target = record.target?.nodeType === Node.ELEMENT_NODE ? record.target : record.target?.parentElement;
        if (target?.closest?.('#relay-kmong-bot')) return false;
        return [...record.addedNodes, ...record.removedNodes].some(node => {
          if (node?.nodeType !== Node.ELEMENT_NODE) return true;
          return !node.matches?.('#relay-kmong-bot') && !node.closest?.('#relay-kmong-bot');
        });
      });
      if (hasRelevantChange && !state.busy) scheduleLoop();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });

  if (typeof globalThis.__relayKmongTestHook === 'function') {
    globalThis.__relayKmongTestHook({ state, clean, hash, currentChatId, isSystemText, isClosedText, messageNodes, directionOf, latestIncomingMessage, findComposer, setComposerValue, findSendButton, orderCards });
  }
})();
