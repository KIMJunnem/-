(function () {
  'use strict';

  const DEFAULTS = {
    endpoint: 'http://127.0.0.1:8787/api/soomgo/quote',
    enabled: true,
    autoSend: true,
    remoteOnly: true,
    maxQuoteSendCash: 3999,
    intervalMs: 1000,
    refreshMs: 30000
  };
  const STORAGE_KEY = 'relaySoomgoBotSettings';
  const SEEN_KEY = 'relaySoomgoBotSeen';
  const SEEN_MIGRATION_KEY = 'relaySoomgoBotSeenResetV3';
  const BOT_RESET_KEY = 'relaySoomgoBotResetV4';
  const OPEN_FAILURES_KEY = 'relaySoomgoBotOpenFailures';
  const OPEN_FAILURE_TTL_MS = 2 * 60 * 1000;
  const LAST_QUOTE_KEY = 'relaySoomgoBotLastQuote';
  // 요청 봇과 채팅 봇은 서로 다른 확장 프로그램이므로
  // 숨고 페이지의 같은 출처 localStorage를 통해 접수 이벤트를 전달한다.
  const ACCEPTED_JOB_EVENT_KEY = 'relaySoomgoAcceptedJob';
  const ACCEPTED_JOB_QUEUE_KEY = 'relaySoomgoAcceptedJobs';
  const GLOBAL_PAUSE_KEY = 'relaySoomgoGlobalPause';
  // V2 is a one-time resume migration for the user's explicit live test.
  // It clears the stale pause saved by the previous system-check session,
  // then preserves any later manual pause chosen in the extension panel.
  const GLOBAL_PAUSE_MIGRATION_KEY = 'relaySoomgoGlobalPauseFixV2';
  const RESUME_TEST_ONCE_KEY = 'relaySoomgoResumeTestOnceV2';
  const LIVE_RESUME_MIGRATION_KEY = 'relaySoomgoLiveResumeV1';
  const HEARTBEAT_KEY = 'relaySoomgoBotHeartbeat';
  const STATS_KEY = 'relaySoomgoBotStats';
  const state = { settings: { ...DEFAULTS }, busy: false, loopRunning: false, lastKey: '', activeCardKey: '', detailWaitStartedAt: 0, lastMessage: '', retryAt: 0, currentQuote: null, openFailures: {}, lastRefreshAt: Date.now() };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const pageText = () => clean(document.body?.innerText || '').slice(0, 16000);
  const hash = value => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  const excludeBot = el => !el.closest || !el.closest('#relay-soomgo-bot');
  const globalPaused = () => { try { return localStorage.getItem(GLOBAL_PAUSE_KEY) === '1'; } catch (_) { return false; } };
  const controlState = { checkedAt: 0, paused: true, pending: null };
  async function serverPaused(force = false) {
    if (!force && Date.now() - controlState.checkedAt < 5000) return controlState.paused;
    if (controlState.pending) return controlState.pending;
    controlState.pending = (async () => {
      try {
        const response = await fetch('http://127.0.0.1:8787/api/soomgo/control', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
        const data = response.ok ? await response.json() : {};
        controlState.paused = data.paused !== false;
      } catch (_) { controlState.paused = true; }
      controlState.checkedAt = Date.now();
      controlState.pending = null;
      return controlState.paused;
    })();
    return controlState.pending;
  }
  const setGlobalPause = async value => {
    try {
      // Stop locally immediately; resume only after the server acknowledges.
      if (value) localStorage.setItem(GLOBAL_PAUSE_KEY, '1');
      const response = await fetch('http://127.0.0.1:8787/api/soomgo/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused: Boolean(value) }), signal: AbortSignal.timeout(4000) });
      const data = response.ok ? await response.json() : {};
      if (data.paused !== Boolean(value)) throw new Error('pause_not_acknowledged');
      controlState.paused = data.paused; controlState.checkedAt = Date.now();
      localStorage.setItem(GLOBAL_PAUSE_KEY, value ? '1' : '0');
      window.dispatchEvent(new Event('relaySoomgoGlobalPauseChanged'));
    } catch (_) { controlState.paused = true; localStorage.setItem(GLOBAL_PAUSE_KEY, '1'); }
  };

  function writeHeartbeat(status = '') {
    try {
      const at = Date.now(); const raw = localStorage.getItem(HEARTBEAT_KEY); const data = raw ? JSON.parse(raw) : {};
      data.request = { at, status: String(status || '') }; localStorage.setItem(HEARTBEAT_KEY, JSON.stringify(data));
      if (at - Number(writeHeartbeat.lastSent || 0) > 5000) {
        writeHeartbeat.lastSent = at;
        let stats = {}; try { stats = JSON.parse(localStorage.getItem(STATS_KEY) || '{}'); } catch (_) {}
        fetch('http://127.0.0.1:8787/api/soomgo/bot-status', { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' }, body: JSON.stringify({ role: 'request', at, status, stats }) }).catch(() => {});
      }
    } catch (_) {}
  }
  function bumpStat(name) {
    try {
      const day = new Date().toISOString().slice(0, 10); const raw = localStorage.getItem(STATS_KEY); const data = raw ? JSON.parse(raw) : {};
      if (data.day !== day) Object.assign(data, { day, requestOpened: 0, quoteSent: 0, quoteBlocked: 0, quoteReview: 0, quoteSkipped: 0, sendUncertain: 0 });
      data[name] = Number(data[name] || 0) + 1; localStorage.setItem(STATS_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function extract(text) {
    const first = (patterns) => {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return clean(match[1]).slice(0, 800);
      }
      return '';
    };
    const purpose = first([
      /(?:^|\n)\s*(영상\s*편집|간단\s*영상\s*편집|숏폼\s*편집|컷\s*편집|자막\s*추가|상업\s*영상|개인\s*영상|PPT\s*제작|보고서|제안서|기술문서|계획서|통계\s*분석|데이터\s*분석|데이터\s*가공(?:\s*및\s*라벨링)?|자막\s*제작|번역|교정|이력서(?:\/|·)?자소서\s*컨설팅|레주메(?:\s*작성)?|resume(?:\s*writing)?|CV(?:\s*작성)?|문서\s*\/\s*글\s*작성)\s*(?=\n|$)/i,
      /이용\s*목적\s*\n?\s*([^\n]+)/i,
      /희망\s*서비스\s*\n?\s*([^\n]+)/i,
      /서비스\s*(?:종류|내용)?\s*\n?\s*([^\n]+)/i
    ]);
    const format = first([
      /파일\s*형식\s*\n?\s*([^\n]+)/i,
      /결과물\s*형식\s*\n?\s*([^\n]+)/i
    ]);
    const volume = first([
      /작업\s*분량\s*\n?\s*([^\n]+)/i,
      /영상\s*길이\s*\n?\s*([^\n]+)/i,
      /분량\s*\n?\s*([^\n]+)/i
    ]);
    const scope = first([
      /(?:제작|작업)\s*범위\s*\n?\s*([^\n]+)/i,
      /진행\s*방식\s*\n?\s*([^\n]+)/i,
      /희망\s*서비스\s*\n?\s*([^\n]+)/i
    ]);
    const notes = first([
      /(?:문의\/희망사항|의뢰\s*내용)\s*\n?\s*([\s\S]{0,1400}?)(?=\n\s*(?:완료\s*희망일|고객\s*정보|견적\s*금액)|$)/i
    ]);
    const deadline = first([/완료\s*희망일\s*\n?\s*([^\n]+)/i]);
    const company = first([
      /지원\s*(?:희망\s*)?기업(?:명)?\s*[:：]?\s*(?:\n\s*)?([^\n]+)/i,
      /지원\s*(?:희망\s*)?회사(?:명)?\s*[:：]?\s*(?:\n\s*)?([^\n]+)/i
    ]);
    const role = first([
      /(?:희망|지원)\s*직무\s*[:：]?\s*(?:\n\s*)?([^\n]+)/i,
      /직무\s*[:：]\s*([^\n]+)/i
    ]);
    const customerName = first([
      /고객[ \t]*정보[ \t]*(?:\n+[ \t]*신고하기[ \t]*)?\n+[ \t]*([^\n]{2,50})/i
    ]);
    const topic = first([
      /작성\s*주제\s*\n?\s*([\s\S]{0,1400}?)(?=\n\s*완료\s*희망일|\n\s*고객\s*정보|$)/i,
      /의뢰\s*내용\s*\n?\s*([\s\S]{0,1400}?)(?=\n\s*완료\s*희망일|\n\s*고객\s*정보|$)/i,
      /문의\/희망사항\s*\n?\s*([\s\S]{0,800}?)(?=\n\s*고객\s*정보|$)/i
    ]);
    const pageMatch = `${volume} ${text}`.match(/(?:A4\s*(?:기준)?\s*)?(\d+)\s*(?:페이지|장|쪽)|A4\s*(?:기준)?\s*(\d+)/i);
    const requestIdNode = document.querySelector('[data-request-id], [data-requestid], [data-id]');
    // 숨고 상세 URL은 /requests/received/{id} 형태다. 기존의 넓은
    // 정규식은 "received"를 ID로 잘못 잡아 모든 요청을 같은 항목으로
    // 인식했고, 그 결과 견적 입력 전에 이미 처리된 것으로 건너뛰었다.
    const urlId = location.pathname.match(/\/requests\/received\/([A-Za-z0-9_-]{4,})/i)?.[1]
      || location.pathname.match(/\/pro\/quotes\/([A-Za-z0-9_-]{4,})/i)?.[1]
      || location.pathname.match(/\/(?:request|quote|job)[^/=?]*[/?=]([A-Za-z0-9_-]{4,})/i)?.[1]
      || '';
    const stable = `${urlId}|${purpose}|${format}|${volume}|${topic}|${text.slice(-2500)}`;
    return {
      requestId: String(requestIdNode?.getAttribute('data-request-id') || requestIdNode?.getAttribute('data-requestid') || urlId || `PAGE-${hash(stable)}`).slice(0, 160),
      purpose, format, volume, topic, scope, notes, deadline, company, role, customerName,
      pages: Number(pageMatch?.[1] || pageMatch?.[2] || 1),
      text,
      sourceUrl: location.href
    };
  }

  function isRequestDetail(text) {
    const detailMarker = /요청\s*상세|견적을\s*작성해\s*주세요|견적\s*금액|견적\s*설명|견적을\s*발송/.test(text);
    const requestData = /이용\s*목적|희망\s*서비스|작성\s*주제|작업\s*분량|영상\s*길이|의뢰\s*내용|고객\s*정보/.test(text);
    return detailMarker && requestData;
  }

  // 화상회의와 대면·방문·현장 작업만 자동 견적에서 제외한다.
  function isDirectRequest(text) {
    const value = clean(text);
    if (!value) return false;
    return /(대면|대면\s*상담|직접\s*(?:방문|찾아|오셔|오다|만나|만남|미팅|상담)|방문\s*(?:해서|하여|해|할|희망|필요|가능|요청)|출장|현장\s*(방문|작업|진행|미팅)|오프라인|자택\s*(방문|에서)|사무실\s*(방문|에서)|찾아\s*오|찾아와)/i.test(value);
  }

  // 대본·시나리오 계열 의뢰는 자동 견적 대상에서 제외한다.
  function isScriptRequest(text) {
    return /(대본|시나리오|각본|스크립트|콘티)/i.test(clean(text));
  }

  // 논문 대필·작성은 제외하되, 기존 자료의 통계 검증·코드 재현·오류
  // 분석처럼 결과를 만들어내는 글쓰기 아닌 검증 업무는 자동 접수한다.
  function isAcademicRequest(text) {
    const value = clean(text);
    const verification = /(오류\s*(검증|정정|수정)|검증|재현|코드\s*(분석|검토|확인)|통계\s*(분석|검증)|분석\s*재현|결과\s*확인)/i.test(value);
    const writing = /(논문\s*(작성|대필|집필)|학위\s*논문\s*(작성|대필)|학술\s*(논문|원고)\s*(작성|대필)|연구\s*보고서\s*(작성|대필))/i.test(value);
    if (verification && !writing) return false;
    if (/(논문|학위\s*논문|학술|연구\s*논문|학회|저널|석사|박사|졸업\s*논문|연구\s*프로젝트)/i.test(value)) return true;
    return false;
  }

  function makePanel() {
    if (document.getElementById('relay-soomgo-bot')) return document.getElementById('relay-soomgo-bot');
    const panel = document.createElement('aside');
    panel.id = 'relay-soomgo-bot';
    panel.innerHTML = `
      <div class="rsb-head"><b>Relay Desk · 숨고 봇</b><button data-rsb="toggle" title="봇 켜기/끄기">ON</button></div>
      <div class="rsb-status" data-rsb="status">요청 목록 감시 중</div>
      <div class="rsb-detail" data-rsb="detail">받은 요청 목록을 30초마다 확인하고 새 요청을 상세 화면으로 엽니다. 화상·대면 요청은 자동 처리하지 않습니다. 온라인 문서 작업은 접수합니다.</div>
      <div class="rsb-actions"><button class="rsb-pause" data-rsb="pause">잠시 멈춤</button><button class="rsb-global" data-rsb="globalPause">전체 정지</button></div>`;
    const style = document.createElement('style');
    style.textContent = `
      #relay-soomgo-bot{position:fixed;z-index:2147483647;right:14px;bottom:14px;width:278px;padding:13px;border-radius:14px;background:#101827;color:#eaf2ff;box-shadow:0 10px 35px #0006;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #relay-soomgo-bot .rsb-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}
      #relay-soomgo-bot button{border:0;border-radius:8px;padding:6px 9px;background:#34445f;color:#fff;cursor:pointer}
      #relay-soomgo-bot [data-rsb=toggle]{background:#42d6b1;color:#08231d;font-weight:700}
      #relay-soomgo-bot .rsb-status{color:#8de6ce;font-weight:600;margin-bottom:5px}
      #relay-soomgo-bot .rsb-detail{color:#b8c4d6;max-height:88px;overflow:auto;white-space:pre-wrap;margin-bottom:8px}
      #relay-soomgo-bot .rsb-actions{display:flex;gap:7px}#relay-soomgo-bot .rsb-actions button{flex:1}`;
    panel.append(style);
    document.documentElement.append(panel);
    panel.addEventListener('click', async event => {
      const action = event.target?.dataset?.rsb;
      if (action === 'toggle') {
        state.settings.enabled = !state.settings.enabled;
        await chrome.storage.local.set({ [STORAGE_KEY]: state.settings });
        writeHeartbeat(state.settings.enabled ? '감시 중' : '일시 정지');
        renderStatus(state.settings.enabled ? '요청 목록 감시 중' : '일시 정지');
      }
      if (action === 'pause') {
        state.settings.enabled = false;
        await chrome.storage.local.set({ [STORAGE_KEY]: state.settings });
        writeHeartbeat('일시 정지');
        renderStatus('일시 정지 · 다시 시작하려면 ON을 누르세요');
      }
      if (action === 'globalPause') {
        const next = !globalPaused(); await setGlobalPause(next);
        writeHeartbeat(next ? '전체 일시정지' : (state.settings.enabled ? '감시 중' : '일시 정지'));
        renderStatus(next ? '전체 일시정지' : (state.settings.enabled ? '요청 목록 감시 중' : '일시 정지'), next ? '요청 봇과 고객 채팅 봇을 함께 멈췄습니다.' : '전체 감시를 다시 시작했습니다.');
      }
    });
    return panel;
  }

  function renderStatus(message, detail = '') {
    const panel = makePanel();
    const status = panel.querySelector('[data-rsb=status]');
    const toggle = panel.querySelector('[data-rsb=toggle]');
    const global = panel.querySelector('[data-rsb=globalPause]');
    const info = panel.querySelector('[data-rsb=detail]');
    if (status && status.textContent !== message) status.textContent = message;
    if (toggle) { if (toggle.textContent !== (state.settings.enabled ? 'ON' : 'OFF')) toggle.textContent = state.settings.enabled ? 'ON' : 'OFF'; toggle.style.background = state.settings.enabled ? '#42d6b1' : '#53627a'; }
    if (global) { if (global.textContent !== (globalPaused() ? '전체 재개' : '전체 정지')) global.textContent = globalPaused() ? '전체 재개' : '전체 정지'; global.style.background = globalPaused() ? '#d6a73c' : '#34445f'; }
    if (info && detail && info.textContent !== detail) info.textContent = detail;
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get([STORAGE_KEY, SEEN_KEY, SEEN_MIGRATION_KEY, BOT_RESET_KEY, LAST_QUOTE_KEY, OPEN_FAILURES_KEY]);
    const storedSettings = stored[STORAGE_KEY] || {};
    state.settings = { ...DEFAULTS, ...storedSettings };
    // v0.1.46 reset: clear stale request decisions and force the request bot on.
    // Chat-bot storage is intentionally untouched.
    if (!stored[BOT_RESET_KEY]) {
      state.settings.enabled = true;
      state.seen = new Set();
      state.openFailures = {};
      await chrome.storage.local.set({
        [STORAGE_KEY]: state.settings,
        [SEEN_KEY]: [],
        [OPEN_FAILURES_KEY]: {},
        [BOT_RESET_KEY]: Date.now()
      });
    }
    // Only an explicit operator action may resume a stopped bot.
    const recoveredGlobalPause = false;
    // 이전 기본값(60초·45초)이 저장된 설치본은 30초로 한 번만 마이그레이션한다.
    if (!Object.prototype.hasOwnProperty.call(storedSettings, 'refreshMs') || [60000, 45000].includes(Number(storedSettings.refreshMs))) {
      state.settings.refreshMs = DEFAULTS.refreshMs;
      await chrome.storage.local.set({ [STORAGE_KEY]: state.settings });
    }
    // 이전 버전은 상세 화면을 열기만 해도 카드를 완료 처리했다.
    // 한 번만 원장을 비워 현재 목록의 0명 요청을 다시 처리한다.
    if (!stored[BOT_RESET_KEY] || !stored[SEEN_MIGRATION_KEY]) {
      state.seen = new Set();
      await chrome.storage.local.set({ [SEEN_KEY]: [], [SEEN_MIGRATION_KEY]: true });
    } else {
      state.seen = new Set(Array.isArray(stored[SEEN_KEY]) ? stored[SEEN_KEY] : []);
    }
    state.openFailures = stored[BOT_RESET_KEY] ? pruneOpenFailures(stored[OPEN_FAILURES_KEY]) : {};
    await chrome.storage.local.set({ [OPEN_FAILURES_KEY]: state.openFailures });
    state.currentQuote = stored[LAST_QUOTE_KEY] || null;
    makePanel();
    renderStatus(state.settings.enabled ? '요청 목록 감시 중' : '일시 정지', recoveredGlobalPause ? '업데이트 전에 남아 있던 전체 정지를 해제하고 감시를 다시 시작했습니다.' : '');
  }

  async function remember(key) {
    state.seen.add(key);
    while (state.seen.size > 500) state.seen.delete(state.seen.values().next().value);
    await chrome.storage.local.set({ [SEEN_KEY]: [...state.seen] });
  }

  function pruneOpenFailures(failures = {}) {
    const now = Date.now();
    return Object.fromEntries(Object.entries(failures || {})
      .filter(([, at]) => Number.isFinite(Number(at)) && now - Number(at) < OPEN_FAILURE_TTL_MS)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 200));
  }

  async function rememberOpenFailure(key) {
    state.openFailures = pruneOpenFailures(state.openFailures);
    state.openFailures[key] = Date.now();
    state.openFailures = pruneOpenFailures(state.openFailures);
    await chrome.storage.local.set({ [OPEN_FAILURES_KEY]: state.openFailures });
  }

  function publishAcceptedJob(requestKey, quote, request = {}) {
    try {
      const at = Date.now();
      const event = {
        id: `${String(requestKey || 'request').slice(0, 160)}:${at}`,
        requestId: String(quote?.sourceRequestId || requestKey || '').slice(0, 160),
        at,
        request: {
          customerName: String(request.customerName || '').slice(0, 80),
          purpose: String(request.purpose || '').slice(0, 160),
          company: String(request.company || '').slice(0, 120),
          role: String(request.role || '').slice(0, 120)
        },
        quote: {
          amount: quote?.amount || 0,
          regularAmount: quote?.regularAmount || quote?.originalAmount || 0,
          sourceRequestId: String(quote?.sourceRequestId || requestKey || '').slice(0, 160),
          days: quote?.days || '',
          label: quote?.label || '',
          basicScope: quote?.basicScope || '',
          extraScope: quote?.extraScope || '',
          sampleAvailable: quote?.sampleAvailable === true,
          sampleRate: Number(quote?.sampleRate || 0),
          sampleAmount: Number(quote?.sampleAmount || 0),
          sampleScope: String(quote?.sampleScope || '').slice(0, 500),
          sampleCreditOnFullOrder: quote?.sampleCreditOnFullOrder === true,
          followupMessage: String(quote?.followupMessage || '').slice(0, 900)
        }
      };
      let queue = [];
      try { const parsed = JSON.parse(localStorage.getItem(ACCEPTED_JOB_QUEUE_KEY) || '[]'); if (Array.isArray(parsed)) queue = parsed; } catch (_) {}
      queue = queue.filter(item => item && item.id).slice(-49); queue.push(event);
      localStorage.setItem(ACCEPTED_JOB_QUEUE_KEY, JSON.stringify(queue));
      // 이전 채팅 봇과의 호환을 위해 최신 이벤트 키도 함께 유지한다.
      localStorage.setItem(ACCEPTED_JOB_EVENT_KEY, JSON.stringify(event));
    } catch (_) {
      // localStorage가 차단된 환경에서도 견적 발송 자체는 계속한다.
    }
  }

  function reportQuoteResult(requestId, status, note = '') {
    fetch('http://127.0.0.1:8787/api/soomgo/quote-result', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' },
      body: JSON.stringify({ requestId, status, at: new Date().toISOString(), url: location.href, note })
    }).catch(() => {});
  }

  function fieldByLabel(pattern) {
    const nodes = [...document.querySelectorAll('label,legend,p,span,div')].filter(excludeBot).filter(visible);
    for (const node of nodes) {
      const text = clean(node.textContent);
      if (!text || text.length > 60 || !pattern.test(text)) continue;
      const parent = node.closest('label,fieldset,form,section,li,div') || node.parentElement;
      const field = parent?.querySelector('input:not([type=hidden]), textarea, [contenteditable="true"]');
      if (visible(field)) return field;
    }
    return null;
  }

  function setValue(field, value) {
    if (!field) return false;
    const stringValue = String(value);
    if (field.isContentEditable) field.textContent = stringValue;
    else {
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(field, stringValue); else field.value = stringValue;
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof InputEvent === 'function') {
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
    }
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'End' }));
    return true;
  }

  function quoteStatusLabel(quote) {
    const amount = Number(quote?.amount || 0);
    const regular = Number(quote?.regularAmount || quote?.originalAmount || 0);
    const days = String(quote?.days || '');
    const discountLabel = String(quote?.discountLabel || '리뷰 확보 초기 30% 할인');
    if (regular > amount && amount > 0) {
      return `정상가 ${regular.toLocaleString('ko-KR')}원 → ${discountLabel} ${amount.toLocaleString('ko-KR')}원 · ${days}`;
    }
    return `${amount.toLocaleString('ko-KR')}원 · ${days}`;
  }

  function findSendButton() {
    return [...document.querySelectorAll('button,[role=button],a')].filter(excludeBot).filter(visible).find(el => {
      const text = clean(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`);
      return /견적\s*(보내기|발송|전송)|보내고\s*싶어요|제출하기/.test(text) && !/삭제|취소/.test(text);
    });
  }

  function parseCashAmount(value) {
    const text = clean(value);
    const matches = [
      ...text.matchAll(/(?:견적\s*(?:발송|보내기|전송)|차감|사용)[^\d]{0,40}(\d[\d,]*)\s*캐시/gi),
      ...text.matchAll(/(\d[\d,]*)\s*캐시[^\n]{0,50}(?:견적\s*(?:발송|보내기|전송)|차감|사용)/gi)
    ];
    const amounts = matches.map(match => Number(String(match[1] || '').replace(/,/g, ''))).filter(Number.isFinite);
    return amounts.length ? Math.max(...amounts) : null;
  }

  function quoteSendCashCost() {
    const candidates = [...document.querySelectorAll('[role=dialog],dialog,[aria-modal="true"],button,[role=button],section,article,div')]
      .filter(excludeBot).filter(visible)
      .map(el => clean(el.textContent || ''))
      .filter(text => /캐시/.test(text) && /견적|발송|보내|전송|차감|사용/.test(text));
    const amounts = candidates.map(parseCashAmount).filter(Number.isFinite);
    return amounts.length ? Math.max(...amounts) : null;
  }

  function quoteCashLimit() {
    const configured = Number(state.settings.maxQuoteSendCash);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULTS.maxQuoteSendCash;
  }

  async function blockExpensiveQuote(key, cost) {
    const limit = quoteCashLimit();
    bumpStat('quoteSkipped');
    reportQuoteResult(key, 'blocked', `견적 발송 비용 ${cost}캐시 · ${limit}캐시 이상 자동 제외`);
    await remember(`skipped-cost:${key}`);
    renderStatus('고비용 견적 자동 제외', `${cost.toLocaleString('ko-KR')}캐시가 필요해 ${limit.toLocaleString('ko-KR')}캐시 이상 차단 기준에 따라 보내지 않았습니다.`);
    const cancel = [...document.querySelectorAll('button,[role=button]')].filter(excludeBot).filter(visible)
      .find(el => /취소|닫기|아니요|돌아가기/.test(clean(el.textContent || '')));
    if (cancel) cancel.click();
    await returnToRequestList(true);
  }

  function findCashConfirmationButton(originalButton) {
    const dialogs = [...document.querySelectorAll('[role=dialog],dialog,[aria-modal="true"]')].filter(visible);
    const roots = dialogs.length ? dialogs : [document];
    for (const root of roots) {
      const candidate = [...root.querySelectorAll('button,[role=button]')].filter(excludeBot).filter(visible).find(el => {
        if (el === originalButton) return false;
        const text = clean(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`);
        return /견적\s*(보내기|발송|전송)|보내기|발송하기|지원하기|확인/.test(text) && !/취소|닫기|아니요/.test(text);
      });
      if (candidate) return candidate;
    }
    return null;
  }

  function firstVisibleField(selectors) {
    return selectors.flatMap(selector => [...document.querySelectorAll(selector)])
      .filter(excludeBot).find(visible) || null;
  }

  function isRequestDetailHref(href) {
    const value = String(href || '');
    return /\/requests\/received\/[A-Za-z0-9_-]{4,}/i.test(value)
      || /\/pro\/quotes\/[A-Za-z0-9_-]{4,}/i.test(value);
  }

  function fieldContent(field) {
    if (!field) return '';
    return clean(field.isContentEditable ? field.textContent : field.value);
  }

  function fillQuote(quote) {
    let amount = fieldByLabel(/견적\s*금액|총\s*비용|금액/);
    if (!amount) amount = firstVisibleField([
      'input[name*="price" i]', 'input[name*="amount" i]', 'input[placeholder*="금액"]',
      'input[aria-label*="금액"]', 'input[type=number]', 'input[inputmode="numeric"]'
    ]);
    const days = fieldByLabel(/예상\s*(소요일|기간)|작업\s*기간|소요일/);
    const daysField = days || firstVisibleField([
      'input[name*="day" i]', 'input[name*="period" i]', 'input[placeholder*="소요일"]',
      'input[placeholder*="기간"]', 'input[aria-label*="소요일"]'
    ]);
    let description = fieldByLabel(/견적\s*내용|서비스\s*설명|상세\s*내용|메시지/);
    if (!description) description = firstVisibleField([
      'textarea[name*="description" i]', 'textarea[name*="message" i]',
      'textarea[placeholder*="내용"]', 'textarea[placeholder*="메시지"]',
      'textarea', '[contenteditable="true"]'
    ]);
    setValue(amount, quote.amount);
    setValue(daysField, quote.days);
    setValue(description, quote.message);
    return { amount, days: daysField, description, send: findSendButton(), ready: Boolean(fieldContent(amount) && fieldContent(description)) };
  }

  async function returnToRequestList(refresh = false) {
    const onReceivedList = () => /^\/requests\/received\/?$/i.test(location.pathname) && !isRequestDetail(pageText());
    const waitForList = async (timeout = 1800) => {
      const end = Date.now() + timeout;
      while (!onReceivedList() && Date.now() < end) await sleep(100);
      return onReceivedList();
    };

    // '요청·견적' 상단 메뉴가 보낸 견적함이나 다른 화면으로 갈 수 있으므로
    // 정확히 받은 요청 목록으로 연결되는 링크만 사용한다. 브라우저 히스토리도
    // 이전 상세 글로 되돌릴 수 있어 성공 여부를 목록 URL로 검증한다.
    if (!onReceivedList()) {
      // 숨고 SPA의 목록 링크는 현재 상세 URL을 redirect 파라미터로
      // 다시 붙이는 경우가 있어 클릭할수록 URL이 재귀적으로 길어진다.
      // 링크 클릭을 거치지 않고 깨끗한 목록 주소로 한 번만 이동한다.
      const cleanListUrl = `${location.origin}/requests/received?from=gnb`;
      location.replace(cleanListUrl);
      await waitForList(2200);
    }
    if (refresh && onReceivedList()) {
      state.lastRefreshAt = Date.now();
      await sleep(180);
      location.reload();
    }
    return onReceivedList();
  }

  async function deleteErroredRequest() {
    const deleteButton = [...document.querySelectorAll('button,[role=button],a')]
      .filter(excludeBot).filter(visible)
      .find(el => /^삭제하기$/i.test(clean(el.textContent || el.getAttribute('aria-label') || '')));
    if (!deleteButton) return false;
    try { deleteButton.click(); } catch (_) { return false; }
    await sleep(350);
    // 숨고는 가운데 확인 팝업에 보라색 삭제 버튼을 다시 표시한다.
    // 원래 화면의 삭제 버튼을 재클릭하지 않도록 대화상자 내부를 우선한다.
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .modal, [class*="Modal"]')]
      .filter(excludeBot).filter(visible);
    const scope = dialogs[dialogs.length - 1] || document;
    const confirm = [...scope.querySelectorAll('button,[role=button],a')]
      .filter(excludeBot).filter(visible)
      .filter(el => /^(삭제|삭제하기|확인|네|예)$/i.test(clean(el.textContent || el.getAttribute('aria-label') || '')))
      .pop();
    if (confirm && confirm !== deleteButton) { try { confirm.click(); } catch (_) {} }
    await sleep(500);
    return true;
  }

  async function processDetail() {
    const text = pageText();
    if (!isRequestDetail(text) || state.busy || Date.now() < state.retryAt) return false;
    state.detailWaitStartedAt = 0;
    const request = extract(text);
    const detailPathAtStart = location.pathname + location.search;
    const key = request.requestId || `PAGE-${hash(text)}`;
    if (state.seen.has(`sent:${key}`)) { await returnToRequestList(true); return true; }
    if (state.seen.has(`skipped-script:${key}`)) { await returnToRequestList(); return true; }
    if (state.seen.has(`skipped-academic:${key}`)) { await returnToRequestList(); return true; }
    if (state.seen.has(`skipped-cost:${key}`)) { await returnToRequestList(); return true; }
    if (state.seen.has(`review:${key}`)) { await returnToRequestList(); return true; }
    // 요청 목록에서는 발송 결과가 불확실해도 다음 접수 처리를 막지 않는다.
    // 서버의 requestId 원장과 숨고 화면의 현재 발송 수가 최종 중복 방지 기준이다.
    // 요청 판정에는 상세 요청 필드만 사용한다. 페이지 전체에는 숨고의
    // '최근 작성한 견적' 예시가 함께 있어 대본·온라인 같은 단어가 섞인다.
    const requestSignals = [request.purpose, request.format, request.volume, request.topic, request.scope, request.notes, request.deadline].filter(Boolean).join(' ');
    if (isScriptRequest(requestSignals)) {
      bumpStat('quoteSkipped');
      await remember(`skipped-script:${key}`);
      renderStatus('대본·시나리오 요청 자동 제외', '현재는 일반 문서 요청만 자동 접수합니다.');
      await returnToRequestList();
      return true;
    }
    if (isAcademicRequest(requestSignals)) {
      bumpStat('quoteSkipped');
      await remember(`skipped-academic:${key}`);
      renderStatus('논문·학술 요청 자동 제외', '논문·학술·학위·연구 프로젝트는 자동 견적을 보내지 않습니다.');
      await returnToRequestList();
      return true;
    }
    const flexibleMethod = /어떤\s*(?:방식이든|거든)\s*상관없어요/i.test(requestSignals);
    if (isDirectRequest(requestSignals) && !flexibleMethod) {
      bumpStat('quoteSkipped');
      await remember(`skipped-direct:${key}`);
      renderStatus('대면 요청 자동 제외', '대면·방문·현장 요청은 견적을 보내지 않습니다. 온라인·화상 문서 작업은 접수합니다.');
      await returnToRequestList();
      return true;
    }
    state.busy = true;
    bumpStat('requestOpened');
    renderStatus('요청 분석 중', `${request.purpose || '문서 요청'} · ${request.volume || `${request.pages}쪽`}`);
    try {
      const response = await fetch(state.settings.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' },
        body: JSON.stringify(request)
      });
      const data = await response.json();
      // 숨고 SPA가 요청 상세를 바꾼 뒤 이전 요청의 느린 응답이 도착해도
      // 새 화면에 이전 견적을 덮어쓰지 않는다.
      if ((location.pathname + location.search) !== detailPathAtStart) {
        state.currentQuote = null;
        renderStatus('요청 목록 감시 중', '화면 전환으로 이전 요청 분석 결과를 폐기했습니다.');
        return true;
      }
      if (!response.ok || !data.quote) {
        if (data.error === 'service_quote_mismatch') {
          bumpStat('quoteReview');
          renderStatus('수동 검토 필요', '서비스와 견적 기준이 맞지 않아 이 요청을 보류하고 다음 요청으로 이동합니다.');
          await remember(`review:${key}`);
          await returnToRequestList();
          return true;
        }
        // 영상·파일 작업은 Astra intake 검증에서 409가 반환될 수 있다.
        // 이를 일반 예외로 재시도하면 같은 상세 방을 무한히 다시 열게
        // 되므로, 검토 보류로 종결하고 목록으로 복귀한다.
        if (data.error === 'astra_intake_review_required' || response.status === 409) {
          bumpStat('quoteReview');
          await remember(`review:${key}`);
          state.activeCardKey = '';
          renderStatus('Astra 검토 필요 · 다음 요청 확인', data.reason || '요청 범위 확인이 필요해 자동 견적을 보류합니다.');
          await returnToRequestList();
          return true;
        }
        throw new Error(data.error || '견적 엔진 응답 없음');
      }
      const quote = { ...data.quote, sourceRequestId: data.quote?.sourceRequestId || request.requestId };
      state.currentQuote = quote;
      await chrome.storage.local.set({ [LAST_QUOTE_KEY]: quote });
      if (quote.manualReview || !quote.autoSend) {
        bumpStat('quoteReview');
        renderStatus('수동 검토 필요', quote.reason || '자동 발송하지 않은 요청입니다.');
        await remember(`review:${key}`);
        await returnToRequestList();
        return true;
      }
      const filled = fillQuote(quote);
      if (!filled.amount || !filled.description || !filled.ready) {
        const opener = [...document.querySelectorAll('button,[role=button],a')].filter(excludeBot).filter(visible).find(el => /견적을\s*작성|견적\s*작성/.test(clean(el.textContent)));
        if (opener) { opener.click(); await sleep(700); }
        state.retryAt = Date.now() + 1200;
        renderStatus('견적 입력창을 여는 중', quoteStatusLabel(quote));
        return true;
      }
      renderStatus('견적 입력 완료 · 발송 준비', quoteStatusLabel(quote));
      await sleep(350);
      const send = findSendButton();
      if (!send) { state.retryAt = Date.now() + 1500; renderStatus('견적 입력 완료 · 보내기 버튼 대기', '입력된 내용을 확인한 뒤 버튼을 눌러 주세요.'); return true; }
      if (state.settings.autoSend) {
        const visibleCost = quoteSendCashCost();
        if (Number.isFinite(visibleCost) && visibleCost >= quoteCashLimit()) {
          await blockExpensiveQuote(key, visibleCost);
          return true;
        }
        if (!state.settings.enabled || globalPaused() || await serverPaused(true)) return true;
        send.click();
        await sleep(350);
        const confirmationCost = quoteSendCashCost();
        if (Number.isFinite(confirmationCost) && confirmationCost >= quoteCashLimit()) {
          await blockExpensiveQuote(key, confirmationCost);
          return true;
        }
        const confirmationButton = findCashConfirmationButton(send);
        if (confirmationButton && visible(confirmationButton)) {
          confirmationButton.click();
          await sleep(350);
        }
        let afterSendText = pageText();
        if (/견적을\s*발송할\s*수\s*없어요|견적\s*보내기에\s*실패했어요|계속해서\s*문제가\s*발생하면\s*고객센터|이미\s*\d+개\s*이상\s*견적/.test(afterSendText)) {
          bumpStat('quoteBlocked');
          reportQuoteResult(key, 'blocked', '숨고 발송 제한 문구 확인');
          await remember(`blocked:${key}`);
          if (state.activeCardKey) await remember(`card-blocked:${state.activeCardKey}`);
          await deleteErroredRequest();
          renderStatus('오류 요청 삭제 완료', '발송 오류가 확인된 요청을 삭제하고 다음 요청으로 이동합니다.');
          await returnToRequestList(true);
          return true;
        }
        let confirmed = /견적을\s*보냈어요|견적\s*발송\s*완료|견적이\s*전송(?:되었|됐)습니다|성공적으로\s*발송|견적\s*보내기\s*완료/.test(afterSendText);
        for (let attempt = 0; !confirmed && attempt < 5; attempt += 1) {
          await sleep(250); afterSendText = pageText();
          confirmed = /견적을\s*보냈어요|견적\s*발송\s*완료|견적이\s*전송(?:되었|됐)습니다|성공적으로\s*발송|견적\s*보내기\s*완료/.test(afterSendText) || !visible(send) || send.disabled;
        }
        if (!confirmed) {
          if (/견적\s*보내기에\s*실패했어요|계속해서\s*문제가\s*발생하면\s*고객센터|요청이\s*(?:삭제|종료)되었|접근할\s*수\s*없습니다/.test(afterSendText)) {
            bumpStat('quoteBlocked');
            reportQuoteResult(key, 'blocked', '숨고 발송 오류 문구 확인');
            await remember(`blocked:${key}`);
            if (state.activeCardKey) await remember(`card-blocked:${state.activeCardKey}`);
            await deleteErroredRequest();
            renderStatus('오류 요청 삭제 완료', '발송 오류가 확인된 요청을 삭제하고 다음 요청으로 이동합니다.');
            await returnToRequestList(true);
            return true;
          }
          // SPA가 응답을 늦게 그려도 요청 목록 전체를 멈추지 않는다.
          bumpStat('sendUncertain');
          reportQuoteResult(key, 'uncertain', '발송 성공 표시를 확인하지 못함');
          renderStatus('발송 결과 미확인 · 다음 요청 처리', '발송 결과가 늦어도 요청 목록으로 돌아가 다음 요청을 처리합니다.');
          await returnToRequestList();
          return true;
        }
        bumpStat('quoteSent');
        reportQuoteResult(key, 'sent', '숨고 발송 성공 표시 또는 버튼 상태 확인');
        await remember(`sent:${key}`);
        if (state.activeCardKey) await remember(`card-done:${state.activeCardKey}`);
        publishAcceptedJob(key, quote, request);
        renderStatus('견적 자동 발송 완료', quoteStatusLabel(quote));
        await returnToRequestList(true);
      }
      return true;
    } catch (error) {
      renderStatus('자동 견적 오류', String(error.message || error).slice(0, 160));
      state.retryAt = Date.now() + 5000;
      return false;
    } finally { state.busy = false; }
  }

  // 받은 요청 목록에 머물러 있어도 가장 최근 요청 상세로 자동 진입한다.
  // 이미 연 링크는 기록해 같은 요청을 계속 열지 않는다.
  function requestCardKey(candidate) {
    const card = candidate.closest('[data-request-id], [data-requestid], [data-id], .request-item-card-wrapper, [data-observe]')
      || candidate.closest('article,li')
      || candidate.parentElement?.closest('button,[role=button]')
      || candidate.parentElement;
    const cardId = card?.getAttribute?.('data-request-id') || card?.getAttribute?.('data-requestid') || card?.getAttribute?.('data-id') || '';
    // 숨고가 목록 카드에 반복해서 붙이는 first-request 같은 임시 ID는
    // 새 요청과 충돌하므로 카드의 실제 내용까지 키에 포함한다.
    const reusableCardId = /^(first-request|request|card|undefined|null)$/i.test(String(cardId));
    const keySource = cardId && !reusableCardId
      ? cardId
      : `${candidate.href || ''}|${clean(card?.textContent || candidate.textContent).slice(0, 500)}`;
    return { card, key: `opened:${keySource}` };
  }

  async function processList() {
    const text = pageText();
    // SPA는 목록 카드 클릭 직후 URL만 상세 주소로 바꾸고 본문을
    // 늦게 렌더링한다. 이 구간에 목록 로직이 다시 카드를 클릭하면
    // 같은 방을 무한히 재진입하므로 상세 URL에서는 목록 처리를 금지한다.
    if (isRequestDetailHref(location.href)) {
      if (isRequestDetail(text)) state.detailWaitStartedAt = 0;
      else {
        if (!state.detailWaitStartedAt) state.detailWaitStartedAt = Date.now();
        if (state.activeCardKey && Date.now() - state.detailWaitStartedAt >= 15000) {
          const failedKey = state.activeCardKey;
          await rememberOpenFailure(failedKey);
          await remember(`card-open-failed:${failedKey}`);
          state.activeCardKey = '';
          state.detailWaitStartedAt = 0;
          renderStatus('상세 화면 로딩 실패 · 카드 보류', '같은 요청으로 다시 들어가지 않고 목록에서 다음 요청만 확인합니다.');
          await returnToRequestList();
          return true;
        }
      }
      return false;
    }
    if (isRequestDetail(text) || !/받은\s*요청|요청\s*목록|요청서/.test(text)) return false;
    const candidates = [...document.querySelectorAll('a,button,[role=button]')].filter(excludeBot).filter(visible).filter(el => {
      const label = clean(el.textContent);
      const href = el.href || '';
      const detailLink = isRequestDetailHref(href);
      const likelyRequestButton = /자세히\s*보기|요청\s*확인|요청|견적|문서|글\s*작성|보고서|기술문서|제안서|계획서|데이터|통계|분석|번역|교정|디자인|개발|촬영|레슨/.test(label);
      const navigation = /받은\s*요청|보낸\s*견적|요청\s*[·･ㆍ.]?\s*견적|새로고침|프로멤버십|광고|입찰|지정\s*요청|전체|안\s*읽음|서비스|숨고플러스|필터/.test(label)
        || /\/requests\/received(?:\/?$|\?)/i.test(href);
      const cardButton = el.matches?.('.request-item-card-wrapper,[data-observe]');
      return !navigation && (detailLink || cardButton || ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && likelyRequestButton));
    });
    // 카드 안의 "자세히 보기"를 가장 먼저 선택한다. 바깥 카드 버튼을
    // 누르면 선택만 되고 상세 화면으로 이동하지 않는 숨고 화면이 있어,
    // 내부 상세 버튼을 우선해야 실제 견적 입력 단계로 넘어간다.
    const orderedCandidates = [
      ...candidates.filter(el => isRequestDetailHref(el.href || '')),
      // 카드 전체 버튼의 텍스트에도 '자세히 보기'가 포함되므로,
      // 내부 상세 버튼은 짧은 라벨이 정확히 일치할 때만 우선한다.
      ...candidates.filter(el => /^(자세히\s*보기|요청\s*확인)$/i.test(clean(el.textContent || el.getAttribute('aria-label') || ''))),
      ...candidates.filter(el => el.matches?.('.request-item-card-wrapper,[data-observe]')),
      ...candidates
    ];
    // 첫 카드가 이미 처리된 상태여도 거기서 멈추지 않고, 목록 아래의
    // 새 미처리 카드를 계속 찾아 연다.
    const candidate = orderedCandidates.find((el, index, all) => {
      if (all.indexOf(el) !== index) return false;
      const cardText = clean(requestCardKey(el).card?.textContent || el.textContent || '');
      // '견적 보낸 고수 N명'은 다른 고수의 발송 수일 뿐이다.
      // 요청 봇은 자체 sent/card-done 기록으로만 중복을 막고, 이 숫자나
      // 고객 이름이 바뀌었다는 이유로 새 요청을 건너뛰지 않는다.
      const key = requestCardKey(el).key;
      // 상세 화면을 열지 못한 카드는 같은 순환에서 재진입하지 않는다.
      // 숨고가 URL만 바꾸고 본문을 렌더링하지 않는 경우 무한 새로고침의
      // 원인이 되므로, 실패 카드는 명시적으로 종결 상태로 취급한다.
      if (state.seen.has(`card-blocked:${key}`) || state.seen.has(`card-done:${key}`) || state.seen.has(`card-open-failed:${key}`)) return false;
      const failedAt = Number(state.openFailures?.[key] || 0);
      return !state.seen.has(key) && (!failedAt || Date.now() - failedAt >= OPEN_FAILURE_TTL_MS);
    })
      || null;
    if (!candidate) return false;
    const { key } = requestCardKey(candidate);
    if (state.seen.has(key)) return false;
    state.activeCardKey = key;
    state.detailWaitStartedAt = Date.now();
    renderStatus('새 요청 상세로 이동 중', clean(candidate.textContent).slice(0, 80));
    // 숨고 카드가 React 이벤트 위임을 사용하는 경우 단순 click()이
    // 라우팅을 놓칠 수 있어 실제 버튼·키보드 이벤트를 함께 전달한다.
    try {
      candidate.focus?.();
      candidate.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      candidate.click?.();
      candidate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      candidate.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    } catch (_) { candidate.click?.(); }
    // 숨고 SPA가 카드 클릭 후 상세 데이터를 비동기로 붙이는 데
    // 2초 이상 걸릴 수 있어 짧은 제한으로 실패 처리하지 않는다.
    const detailEnd = Date.now() + 15000;
    // SPA는 URL을 먼저 바꾸고 상세 본문을 나중에 렌더링한다.
    // URL만으로 성공 판정하면 빈 상세 화면에 멈추므로 실제 요청 필드를 기다린다.
    while (!isRequestDetail(pageText()) && Date.now() < detailEnd) await sleep(100);
    if (isRequestDetail(pageText())) {
      state.detailWaitStartedAt = 0;
      delete state.openFailures[key];
      await chrome.storage.local.set({ [OPEN_FAILURES_KEY]: state.openFailures });
      // 상세 화면을 연 것만으로 처리 완료로 기록하지 않는다.
      // 견적 발송·오류 삭제·명시적 보류가 끝난 뒤에만 상태를 기록한다.
      return true;
    }
    await rememberOpenFailure(key);
    await remember(`card-open-failed:${key}`);
    state.activeCardKey = '';
    state.retryAt = Date.now() + 1200;
    renderStatus('요청 열기 실패 · 카드 보류', '상세 화면이 열리지 않아 이 요청은 보류하고 다음 요청만 확인합니다.');
    return true;
  }

  async function refreshReceivedRequests() {
    if (await serverPaused()) return;
    if (!state.settings.enabled || state.busy || globalPaused()) { if (globalPaused()) writeHeartbeat('전체 일시정지'); return; }
    if (!/\/requests\/received/.test(location.pathname) || isRequestDetail(pageText())) return;
    // 이미 누적된 redirect 체인은 목록에 머무는 동안 즉시 정규화한다.
    if (/[?&]redirect=/i.test(location.search)) {
      history.replaceState(null, '', `${location.origin}/requests/received?from=gnb`);
    }
    const interval = Math.max(30000, Number(state.settings.refreshMs) || 60000);
    if (Date.now() - state.lastRefreshAt < interval) return;
    state.lastRefreshAt = Date.now();
    renderStatus('받은 요청 목록 새로고침', `${Math.round(interval / 1000)}초 주기`);
    location.reload();
  }

  const automationGuard = globalThis.RelayAutomationGuard?.createGuard({
    role: 'request',
    isPaused: async () => !state.settings.enabled || globalPaused() || await serverPaused(),
    onStatus: code => {
      if (code === 'locks-unavailable') renderStatus('중복 실행 방지 기능 확인 필요', '브라우저 잠금 기능이 없어 자동 동작을 멈췄습니다.');
    }
  });
  async function loop() {
    if (!automationGuard) { renderStatus('봇 업데이트 필요', '중복 실행 방지 모듈을 불러오지 못해 자동 동작을 멈췄습니다.'); return; }
    try { return await automationGuard.run(guardedLoop); }
    catch (error) { renderStatus('봇 실행 보류', String(error?.message || error).slice(0, 120)); }
  }
  async function guardedLoop() {
    if (!state.settings.enabled || state.loopRunning) return;
    if (globalPaused()) { renderStatus('전체 일시정지', '요청 봇과 고객 채팅 봇을 함께 멈췄습니다.'); writeHeartbeat('전체 일시정지'); return; }
    state.loopRunning = true;
    try {
      if (await serverPaused()) { renderStatus('서버 점검 · 자동 동작 정지', 'Relay Desk의 점검 정지가 해제되면 감시를 이어갑니다.'); return; }
      writeHeartbeat('감시 중');
      if (await processList()) return;
      if (await processDetail()) return;
    } finally {
      state.loopRunning = false;
    }
  }

  loadSettings().then(() => {
    let mutationTimer = null;
    const observer = new MutationObserver(records => {
      const externalChange = records.some(record => {
        const element = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        return !element?.closest?.('#relay-soomgo-chat-bot, #relay-soomgo-bot');
      });
      if (!externalChange || state.busy || mutationTimer !== null) return;
      mutationTimer = setTimeout(() => { mutationTimer = null; loop(); }, 250);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(loop, Math.max(700, Number(state.settings.intervalMs) || 1000));
    setInterval(refreshReceivedRequests, 5000);
    loop();
  });
})();

