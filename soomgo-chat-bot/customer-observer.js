/* Observe-only: independent of the sending bot's ON/OFF switch. No clicks,
 * navigation, model requests, input edits or customer sends are allowed here. */
(function () {
  'use strict';
  if (globalThis.__relayCustomerObserver) return;
  globalThis.__relayCustomerObserver = true;
  const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
  let timer, lastPayload = '', lastPost = 0, busy = false;
  function collect() {
    const rows = [];
    for (const link of document.querySelectorAll('a[href*="/pro/chats/"]')) {
      const id = link.getAttribute('href')?.match(/\/pro\/chats\/(\d+)/)?.[1];
      if (!id) continue;
      // The message preview is the p child; customer/service/price/clock are
      // siblings and must not change the dedup signature.
      const preview = link.querySelector('p');
      if (!preview) continue;
      const text = clean(preview.textContent);
      const badges = [...link.querySelectorAll('[role="status"],[aria-live],[class*="unread" i],[class*="badge" i],span')];
      const unreadCount = Math.max(0, ...badges.map(e => /^\d{1,3}$/.test(clean(e.textContent)) ? Number(clean(e.textContent)) : 0));
      const unread = unreadCount > 0
        || /안 읽|새 메시지|unread/i.test(link.getAttribute('aria-label') || '');
      rows.push({ conversationId: id, text, unread, unreadCount, displayTime: clean(preview.parentElement?.querySelector('span')?.textContent), role: 'unknown', view: 'list', closed: /다른 고수를 고용함|상대방이 채팅방을 나갔습니다/.test(clean(link.textContent)) });
    }
    const conversationId = location.pathname.match(/^\/pro\/chats\/(\d+)/)?.[1];
    if (conversationId) {
      const nodes = [...document.querySelectorAll('[id^="message-"]:not([id*="chat-date"]),[data-message-id],[data-messageid]')];
      // Keep all currently rendered messages so a trailing coupon doesn't hide
      // a customer's question. Only changes after initial observation wake us.
      for (const node of nodes) {
        if (node.querySelector('textarea,input,[contenteditable="true"]')) continue;
        const content = node.querySelector('[data-name="content"],[data-name="content-body"],[data-name="message-body"],.message-content,.message-text');
        if (!content) continue;
        const mine = node.closest('[data-mymessage="true"]') || /(?:^|\s)(?:outgoing|sent|my-message)(?:\s|$)/i.test(node.className || '');
        const incoming = node.closest('[data-mymessage="false"]');
        rows.push({ conversationId, messageId: node.getAttribute('data-message-id') || node.getAttribute('data-messageid') || node.id, text: clean(content.innerText || content.textContent) || (content.querySelector('img,a') ? '[첨부 파일]' : ''), role: mine ? 'outgoing' : incoming ? 'incoming' : 'unknown', view: 'detail' });
      }
    }
    const page = clean(document.body?.innerText);
    const health = rows.length ? 'observing' : /로그인.*비밀번호|로그인이 필요/.test(page) ? 'login_required' : /채팅|메시지가 없/.test(page) ? 'empty_or_loading' : 'dom_unrecognized';
    return { platform: 'soomgo', sourceId: conversationId ? `room-${conversationId}` : 'list', url: location.origin + location.pathname, health, rows: rows.slice(-200) };
  }
  function badge(message) {
    let el = document.getElementById('relay-customer-observer-status');
    if (!el) {
      el = document.createElement('div'); el.id = 'relay-customer-observer-status';
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483646;background:#111;color:white;padding:7px 11px;font:12px sans-serif;border-radius:6px;pointer-events:none';
      document.body.appendChild(el);
    }
    if (el.textContent !== message) el.textContent = message;
  }
  async function tick() {
    if (busy) return;
    const snapshot = collect();
    const signature = JSON.stringify(snapshot);
    if (signature === lastPayload && Date.now() - lastPost < 30000) return;
    busy = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'relay-customer-observation', snapshot });
      if (!result?.ok) throw new Error('relay_unavailable');
      lastPayload = signature; lastPost = Date.now();
      badge(result.forwarded ? '문의 감지 ON · AI 신호 연결 · 감지 전용' : '문의 감지 ON · 연결 대기 · 로컬 보관');
    } catch (_) { badge('문의 감지 연결 대기 · 발송하지 않음'); }
    finally { busy = false; }
  }
  function schedule() { if (!timer) timer = setTimeout(() => { timer = null; tick(); }, 500); }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(tick, 5000);
  schedule();
})();
