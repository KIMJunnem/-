(function () {
  'use strict';

  const KEY = 'relaySoomgoQuoteBotV3';
  const ENDPOINT = 'http://127.0.0.1:8787/api/soomgo/quote';
  const state = { on: false, busy: false, lastUrl: location.href, currentId: '', processed: new Set(), status: '대기 중' };
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect?.();
    const s = getComputedStyle(el);
    return Boolean(r && r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden');
  };
  const bodyText = () => clean(document.body?.innerText || '').slice(0, 20000);
  const blocked = () => /\/login|로그인해 주세요|접근할 수 없습니다|일시적인 오류|고객센터로 문의/i.test(`${location.href} ${bodyText()}`);
  const isDetail = () => /요청 상세|견적을 작성해 주세요|견적 금액|희망 서비스|고객 정보/i.test(bodyText());
  const isList = () => /받은\s*요청|요청 목록|요청서|요청･견적/i.test(bodyText()) && /requests\/received/i.test(location.pathname);
  const requestId = () => (location.pathname.match(/\/requests\/received\/([^/?]+)/i) || [])[1] || '';
  const requestKey = () => requestId() || `PAGE-${location.href}`;
  const draw = text => {
    state.status = text;
    let panel = document.getElementById('relay-soomgo-v3');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'relay-soomgo-v3';
      panel.style.cssText = 'position:fixed;z-index:2147483647;right:14px;bottom:14px;width:250px;padding:12px;border-radius:12px;background:#111827;color:#e5e7eb;font:13px sans-serif;box-shadow:0 8px 30px #0007';
      panel.innerHTML = '<b>Relay Desk · 숨고 요청봇 V3</b><button data-toggle style="float:right">OFF</button><div data-status style="margin-top:10px;color:#a7f3d0"></div><small>한 번에 한 요청 · 발송 확인 후 완료</small>';
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
  };
  const fieldText = el => clean(`${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('placeholder') || ''} ${el.name || ''} ${el.closest?.('label')?.textContent || ''}`);
  const findField = re => [...document.querySelectorAll('input,textarea,[contenteditable="true"]')].filter(visible).find(el => re.test(fieldText(el)));
  const setValue = (el, value) => {
    if (!el) return false;
    const raw = String(value ?? '').replace(/,/g, '');
    el.focus();
    if (el.isContentEditable) el.textContent = String(value ?? '');
    else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) return false;
      setter.call(el, '');
      if (el.setRangeText) el.setRangeText(raw, 0, 0, 'end'); else setter.call(el, raw);
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: raw }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  };
  const readValue = el => clean(el?.isContentEditable ? el.textContent : el?.value);
  const extract = () => {
    const text = bodyText();
    let purpose = (text.match(/희망 서비스\s*\n\s*([^\n]+)/i) || text.match(/서비스 분야\s+([^\n]+)/i) || [])[1] || '';
    if (!/영상|자막|숏폼|릴스|쇼츠/i.test(purpose) && /영상\s*편집|개인\s*영상|자막\s*추가|숏폼|릴스|쇼츠/i.test(text)) purpose = '영상 편집';
    return { requestId: requestKey(), purpose, topic: (text.match(/(?:의뢰\/희망사항|의뢰 내용|작성 주제)\s*\n?([\s\S]{0,1200}?)(?=\n?\s*(?:고객 정보|완료 희망일)|$)/i) || [])[1] || '', volume: (text.match(/(?:작업 분량|영상 길이|원본 길이|희망 길이|분량)\s*\n?([^\n]+)/i) || [])[1] || '', format: (text.match(/(?:파일 형식|결과물 형식)\s*\n?([^\n]+)/i) || [])[1] || '', sourceUrl: location.href };
  };
  const sendButton = () => [...document.querySelectorAll('button,[role="button"]')].filter(visible).find(el => /견적.*(?:보내|발송)|전송/i.test(clean(el.textContent || el.getAttribute('aria-label'))));
  const explicitFailure = () => /견적 보내기 실패|금액을 입력해 주세요|필수 항목|전송에 실패|오류가 발생/i.test(bodyText());
  const explicitSuccess = () => /견적을 보냈|견적 발송 완료|견적이 전송|견적 보내기 완료/i.test(bodyText());
  async function confirmSend(beforeUrl) {
    const started = Date.now();
    while (Date.now() - started < 10000) {
      await new Promise(resolve => setTimeout(resolve, 350));
      if (explicitFailure()) return 'failed';
      if (explicitSuccess() || location.href !== beforeUrl || !sendButton()) return 'confirmed';
    }
    return 'unknown';
  }
  async function processDetail() {
    if (!state.on || state.busy || !isDetail() || blocked()) return;
    const request = extract();
    if (state.currentId !== request.requestId) { state.currentId = request.requestId; state.busy = false; }
    if (state.processed.has(request.requestId)) return;
    state.busy = true;
    draw(`견적 계산 중 · ${request.purpose || '요청'}`);
    try {
      const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension-v3' }, body: JSON.stringify(request) });
      const data = await response.json();
      if (!response.ok || !data.quote) throw new Error(data.error || '견적 응답 없음');
      const quote = data.quote;
      if (quote.manualReview || quote.autoSend === false) { draw('수동 검토 필요 · 자동 발송 안 함'); return; }
      const amount = findField(/금액|비용|price|amount/i);
      const days = findField(/소요일|기간|day|period/i);
      const description = findField(/견적|서비스 설명|상세 내용|메시지|description|message/i) || [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible)[0];
      if (!amount || !description) throw new Error('견적 입력창을 찾지 못했습니다');
      setValue(amount, quote.amount); setValue(days, quote.days); setValue(description, quote.message);
      await new Promise(resolve => setTimeout(resolve, 400));
      if (readValue(amount).replace(/[^0-9]/g, '') !== String(quote.amount).replace(/[^0-9]/g, '') || readValue(description) !== clean(quote.message)) throw new Error('숨고 폼 상태 불일치');
      const send = sendButton();
      if (!send) throw new Error('견적 보내기 버튼을 찾지 못했습니다');
      const beforeUrl = location.href;
      send.click();
      const result = await confirmSend(beforeUrl);
      if (result === 'confirmed') { state.processed.add(request.requestId); draw('견적 발송 확인 완료'); }
      else if (result === 'failed') draw('견적 발송 실패 · 다음 요청으로 이동하지 않음');
      else draw('견적 발송 결과 확인 필요 · 자동 재전송 안 함');
    } catch (error) { draw(`오류 · ${String(error.message || error).slice(0, 100)}`); }
    finally { state.busy = false; }
  }
  async function loop() {
    draw(state.on ? state.status : '정지');
    if (location.href !== state.lastUrl) { state.lastUrl = location.href; state.currentId = ''; state.busy = false; }
    if (blocked()) { state.on = false; draw('로그인·차단 화면 감지 · 자동 정지'); return; }
    if (isDetail()) return processDetail();
    if (!state.on || !isList()) return;
    const links = [...document.querySelectorAll('a[href*="/requests/received/"],a[href*="/pro/quotes/"]')].filter(visible);
    const next = links.find(link => !state.processed.has(link.href?.split('/').pop()));
    if (next) { draw('요청 1건 여는 중'); next.click(); }
  }
  chrome.storage.local.get(KEY).then(stored => { state.on = Boolean(stored[KEY]?.on); draw(state.on ? '감시 중' : '정지'); setInterval(loop, 1500); loop(); });
})();
