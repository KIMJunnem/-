(function () {
  'use strict';

  // 시스템 점검은 완료되었고, 사용자가 실제 테스트를 요청했으므로
  // 확장 프로그램 패널에서 봇을 켤 수 있도록 운영 모드로 둔다.
  const SYSTEM_TEST_MODE = false;

  const DEFAULTS = {
    endpoint: 'http://127.0.0.1:8787/api/soomgo/quote',
    replyEndpoint: 'http://127.0.0.1:8787/api/soomgo/reply',
    hireEndpoint: 'http://127.0.0.1:8787/api/soomgo/hire',
    workflowEndpoint: 'http://127.0.0.1:8787/api/soomgo/workflow',
    workflowDeliverEndpoint: 'http://127.0.0.1:8787/api/soomgo/workflow/deliver',
    workflowActionEndpoint: 'http://127.0.0.1:8787/api/soomgo/workflow/action',
    astraRoomOutboxEndpoint: 'http://127.0.0.1:8787/api/astra-room/outbox',
    astraRoomDeliveryEndpoint: 'http://127.0.0.1:8787/api/astra-room/delivery',
    enabled: true,
    autoSend: true,
    autoReply: true,
    remoteOnly: true,
    intervalMs: 1000,
    refreshMs: 30000,
    // 고객 메시지 감지 후 즉시 응답한다. 중복 방지는 별도의 messageId/hash
    // 상태로 처리하므로 답변 지연을 두지 않는다.
    humanReplyMinDelayMs: 0,
    humanReplyMaxDelayMs: 0
  };
  const STORAGE_KEY = 'relaySoomgoBotSettings';
  const SEEN_KEY = 'relaySoomgoBotSeen';
  const REPLY_TIMES_KEY = 'relaySoomgoBotReplyTimes';
  const LAST_QUOTE_KEY = 'relaySoomgoBotLastQuote';
  const PENDING_HIRE_KEY = 'relaySoomgoBotPendingHire';
  const HIRED_CHATS_KEY = 'relaySoomgoBotHiredChats';
  // 요청 봇이 견적을 접수한 뒤 한 번만 채팅 화면을 갱신하기 위한
  // 숨고 페이지 공용 이벤트 키다. 두 확장 프로그램의 storage는
  // 분리되어 있으므로 페이지 localStorage를 사용한다.
  const ACCEPTED_JOB_EVENT_KEY = 'relaySoomgoAcceptedJob';
  const ACCEPTED_JOB_QUEUE_KEY = 'relaySoomgoAcceptedJobs';
  const ACCEPTED_JOB_SEEN_KEY = 'relaySoomgoChatAcceptedJobsSeen';
  const PENDING_INTROS_KEY = 'relaySoomgoPendingQuoteFollowups';
  const INTRO_SENT_KEY = 'relaySoomgoQuoteFollowupsSent';
  const PENDING_FOLLOWUPS_KEY = 'relaySoomgoPendingNoReplyFollowups';
  const FOLLOWUP_SENT_KEY = 'relaySoomgoNoReplyFollowupsSent';
  const SENT_REPLY_HASHES_KEY = 'relaySoomgoSentReplyHashesV1';
  const CHAT_DELIVERY_ATTEMPTS_KEY = 'relaySoomgoChatDeliveryAttemptsV1';
  const GLOBAL_PAUSE_KEY = 'relaySoomgoGlobalPause';
  // V2 is a one-time resume migration for the user's explicit live test.
  // It clears the stale pause saved by the previous system-check session,
  // then preserves any later manual pause chosen in the extension panel.
  const GLOBAL_PAUSE_MIGRATION_KEY = 'relaySoomgoGlobalPauseFixV2';
  const RESUME_TEST_ONCE_KEY = 'relaySoomgoResumeTestOnceV2';
  // 사용자가 운영 재개를 명시한 현재 배포에서만 한 번 자동 재개한다.
  // 이후 패널에서 정지한 상태는 이 표식으로 덮어쓰지 않는다.
  const LIVE_RESUME_MIGRATION_KEY = 'relaySoomgoLiveResumeV1';
  const HEARTBEAT_KEY = 'relaySoomgoBotHeartbeat';
  const STATS_KEY = 'relaySoomgoBotStats';
  // 채팅방 체류 상태를 저장하는 키다. 콘텐츠 스크립트는 페이지가
  // 새로 로드될 때마다 초기화되므로 메모리에만 두면 방을 나갈
  // 근거를 잃고 그대로 갇힌다.
  const CHAT_ROOM_KEY = 'relaySoomgoBotChatRoom';
  const CHAT_HANDLED_KEY = 'relaySoomgoBotChatHandled';
  const CHAT_INSPECTED_KEY = 'relaySoomgoChatInspectedV1';
  const INTRO_REPLY_TRACK_KEY = 'relaySoomgoIntroReplyTrackV1';
  const QUOTE_READ_RETRY_MIGRATION_KEY = 'relaySoomgoQuoteReadRetryMigrationV2';
  const QUOTE_READ_FOLLOWUP_DELAY_MS = 10 * 60 * 1000;
  // 결제 요청·리뷰 요청·결과 전달은 고객 화면에서 되돌릴 수 없는
  // 동작이다. 클릭은 성공했는데 Relay Desk 기록만 실패하면 서버 단계가
  // 그대로 남아 1초 주기 루프가 같은 버튼을 다시 누른다. 시도 기록을
  // 저장해 두고, 한 번 누른 동작은 기록이 저장될 때까지 다시 누르지
  // 않는다.
  const IRREVERSIBLE_ATTEMPTS_KEY = 'relaySoomgoBotIrreversibleAttemptsV1';
  const WORKFLOW_DELIVERY_HOLDS_KEY = 'relaySoomgoWorkflowDeliveryHoldsV1';
  const WORKFLOW_VISITS_KEY = 'relaySoomgoWorkflowVisitsV1';
  const RESEARCH_POLICY_MIGRATION_KEY = 'relaySoomgoResearchPolicyV0216';
  const STARTUP_MISSED_CHAT_RECOVERY_KEY = 'relaySoomgoMissedChatRecoveryV0219';
  const RESET_V3_KEY = 'relaySoomgoChatResetV3';
  const chatInspections = {};
  // 처리할 일이 없어도 이 시간을 넘기면 무조건 목록으로 나간다.
  // 0.3.19(E): 채팅방에는 60초까지만 머문다. 발송 중(busy)일 때만 최대 180초까지 기다린다.
  const ROOM_MAX_MS = 60000;
  const ROOM_BUSY_MAX_MS = 180000;
  // 서버 답변 요청이 멈춰 탭 잠금을 계속 쥐지 않도록 시간제한을 둔다.
  const REPLY_FETCH_TIMEOUT_MS = 25000;
  const MESSAGE_TEXT_ENDPOINT = 'http://127.0.0.1:8787/api/soomgo/message-text';
  const ROOM_EXIT_LOG_KEY = 'relaySoomgoRoomExitLogV1';
  const QUOTE_READ_SEEN_KEY = 'relaySoomgoQuoteReadSeenV1';
  // 채팅 전용 확장 프로그램을 별도 창에서 실행할 때는 기본 봇이
  // 같은 대화에 중복 답변하지 않도록 ?relayChatOnly=1 경로를 비운다.
  const CHAT_ONLY_ROUTE = false;
  const state = { settings: { ...DEFAULTS }, busy: false, busySince: 0, loopRunning: false, lastKey: '', lastMessage: '', retryAt: 0, currentQuote: null, replyTimes: [], lastRefreshAt: Date.now(), lastChatOpened: null, lastChatReplyAt: {}, chatBurst: {}, chatHandledAt: {}, hiredConversations: {}, chatPending: null, pendingHire: null, workflow: null, workflowList: [], workflowFetchedAt: 0, workflowDeliveryHolds: {}, workflowVisitAt: {}, acceptedEventIds: [], pendingIntros: [], introSentIds: [], introReplyTrack: {}, pendingFollowups: [], followupSentIds: [], sentReplyHashes: {}, acceptRefreshAt: 0, paymentWatchAt: {}, manualBlocks: new Set(), startupMissedChatRecoveryDone: false, roomOutboxCheckedAt: 0, quoteReadSeen: {}, roomSince: 0, roomPath: '' };
  const setBusy = value => {
    state.busy = Boolean(value);
    state.busySince = state.busy ? Date.now() : 0;
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const pageText = () => clean(document.body?.innerText || '').slice(0, 16000);
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
  const hash = value => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  const excludeBot = el => !el.closest || !el.closest('#relay-soomgo-chat-bot');
  const globalPaused = () => {
    if (SYSTEM_TEST_MODE) return true;
    try { return localStorage.getItem(GLOBAL_PAUSE_KEY) === '1'; } catch (_) { return false; }
  };
  // 0.3.23(2026-09-23 준희 결정: 숨고 고객 답장은 아스트라만): 서버가 chatSendEnabled:false를 주면 발송·첨부·결제 버튼 누르기를 모두 멈춘다.
  // 대화 읽기·서버 기록·심박은 그대로 돈다(paused와 달리 감시 탭 재로드도 막지 않음).
  const controlState = { checkedAt: 0, paused: true, sendOff: false, pending: null };
  async function serverPaused(force = false) {
    if (!force && Date.now() - controlState.checkedAt < 5000) return controlState.paused;
    if (controlState.pending) return controlState.pending;
    controlState.pending = (async () => {
      try {
        const response = await fetch('http://127.0.0.1:8787/api/soomgo/control', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
        const data = response.ok ? await response.json() : {};
        controlState.sendOff = data.chatSendEnabled === false;
        controlState.paused = data.paused !== false || controlState.sendOff;
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

  function writeHeartbeat(status = '', force = false) {
    try { automationGuard?.beat?.(); } catch (_) {}
    try {
      const at = Date.now(); const raw = localStorage.getItem(HEARTBEAT_KEY); const data = raw ? JSON.parse(raw) : {};
      data.chat = { at, status: String(status || '') }; localStorage.setItem(HEARTBEAT_KEY, JSON.stringify(data));
      if (force || at - Number(writeHeartbeat.lastSent || 0) > 5000) {
        writeHeartbeat.lastSent = at;
        let stats = {}; try { stats = JSON.parse(localStorage.getItem(STATS_KEY) || '{}'); } catch (_) {}
        fetch('http://127.0.0.1:8787/api/soomgo/bot-status', { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' }, body: JSON.stringify({ role: 'chat', at, status, stats: { ...stats, accountName: currentAccountName(), url: location.href, version: (() => { try { return chrome.runtime.getManifest().version; } catch (_) { return ''; } })() } }) }).catch(() => {});
      }
    } catch (_) {}
  }
  function bumpStat(name) {
    try {
      const day = new Date().toISOString().slice(0, 10); const raw = localStorage.getItem(STATS_KEY); const data = raw ? JSON.parse(raw) : {};
      if (data.day !== day) Object.assign(data, { day, requestOpened: 0, quoteSent: 0, quoteBlocked: 0, quoteReview: 0, quoteSkipped: 0, sendUncertain: 0, repliesSent: 0, repliesSkipped: 0, repliesManual: 0, manualEscalations: 0, replyAttempts: 0, customerReplies: 0, firstReplyCandidates: 0, firstReplyReceived: 0, firstReplyNoResponse: 0, introVariantA: 0, introVariantB: 0, followupsSent: 0, followupsSkipped: 0, chatRefreshes: 0, hireQueued: 0 });
      data[name] = Number(data[name] || 0) + 1; localStorage.setItem(STATS_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function readAcceptedJobEvents() {
    try {
      const rawQueue = localStorage.getItem(ACCEPTED_JOB_QUEUE_KEY);
      const queue = rawQueue ? JSON.parse(rawQueue) : [];
      if (Array.isArray(queue) && queue.length) return queue.filter(event => event && event.id);
      const raw = localStorage.getItem(ACCEPTED_JOB_EVENT_KEY);
      const event = raw ? JSON.parse(raw) : null;
      return event && event.id ? [event] : [];
    } catch (_) {
      return [];
    }
  }

  function currentConversationId() {
    return location.pathname.match(/^\/pro\/chats\/([^/?]+)/i)?.[1] || '';
  }

  async function fetchWorkflows(conversationId = '', pendingOnly = false) {
    try {
      const params = new URLSearchParams();
      if (conversationId) params.set('conversationId', conversationId);
      if (pendingOnly) params.set('pending', '1');
      const query = params.toString();
      // 조회가 끝나지 않으면 감시 루프와 탭 간 실행 잠금이 함께 묶여 채팅방에서
      // 목록으로 나가지 못한다. 읽기 전용 조회는 8초 안에 끊는다.
      const response = await fetch(`${state.settings.workflowEndpoint}${query ? `?${query}` : ''}`, { cache: 'no-store', headers: { 'x-relay-bot': 'soomgo-chat-extension' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        writeHeartbeat(`업무 API 응답 오류 · ${response.status}`, true);
        return [];
      }
      const data = await response.json();
      return Array.isArray(data.workflows) ? data.workflows : [];
    } catch (error) {
      writeHeartbeat(`업무 API 연결 오류 · ${String(error?.message || error).slice(0, 100)}`, true);
      return [];
    }
  }

  async function getCurrentWorkflow(conversationId = currentConversationId()) {
    if (!conversationId) return null;
    const now = Date.now();
    if (state.workflow && String(state.workflow.conversationId) === String(conversationId) && now - Number(state.workflowFetchedAt || 0) < 1800) return state.workflow;
    const workflows = await fetchWorkflows(conversationId);
    state.workflow = workflows[0] || null;
    state.workflowFetchedAt = now;
    return state.workflow;
  }

  // 되돌릴 수 없는 동작의 시도 기록 (workflowId|동작 → 시도 내용)
  function attemptKey(workflow, action, extra = '') {
    return `${String(workflow?.id || workflow?.conversationId || '')}|${action}${extra ? `|${extra}` : ''}`;
  }

  function getAttempt(key) {
    return state.irreversibleAttempts?.[key] || null;
  }

  async function markAttempt(key, data) {
    if (!state.irreversibleAttempts) state.irreversibleAttempts = {};
    state.irreversibleAttempts[key] = { at: Date.now(), ...data };
    const entries = Object.entries(state.irreversibleAttempts).sort((a, b) => Number(a[1]?.at || 0) - Number(b[1]?.at || 0));
    while (entries.length > 200) { delete state.irreversibleAttempts[entries.shift()[0]]; }
    try { await chrome.storage.local.set({ [IRREVERSIBLE_ATTEMPTS_KEY]: state.irreversibleAttempts }); } catch (_) {}
  }

  async function clearAttempt(key) {
    if (!state.irreversibleAttempts || !state.irreversibleAttempts[key]) return;
    delete state.irreversibleAttempts[key];
    try { await chrome.storage.local.set({ [IRREVERSIBLE_ATTEMPTS_KEY]: state.irreversibleAttempts }); } catch (_) {}
  }

  // 서버가 기억하는 최신 작업 흐름을 강제로 다시 읽는다. 1.8초 캐시를
  // 그대로 쓰면 추가금이 방금 승인된 경우 옛 금액으로 결제를 요청할 수
  // 있어, 금액이 걸린 동작 직전에는 항상 최신 값을 확인한다.
  async function refreshWorkflow(workflow) {
    const conversationId = String(workflow?.conversationId || currentConversationId() || '');
    if (!conversationId) return null;
    const workflows = await fetchWorkflows(conversationId);
    const fresh = workflows.find(item => String(item.id) === String(workflow?.id)) || workflows[0] || null;
    if (fresh) { state.workflow = fresh; state.workflowFetchedAt = Date.now(); }
    return fresh;
  }

  async function acknowledgeWorkflowDelivery(workflow, delivery) {
    if (!workflow || !delivery) return false;
    try {
      const response = await fetch(state.settings.workflowDeliverEndpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-chat-extension' },
        body: JSON.stringify({ workflowId: workflow.id, conversationId: workflow.conversationId, deliveryId: delivery.id })
      });
      if (!response.ok) return false;
      state.workflow = (await response.json()).workflow || workflow;
      state.workflowFetchedAt = Date.now();
      return true;
    } catch (_) { return false; }
  }

  async function acknowledgeWorkflowAction(workflow, action, details = {}) {
    if (!workflow || !action) return false;
    try {
      const response = await fetch(state.settings.workflowActionEndpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-chat-extension' },
        body: JSON.stringify({ workflowId: workflow.id, conversationId: workflow.conversationId, action, ...details })
      });
      if (!response.ok) return false;
      state.workflow = (await response.json()).workflow || workflow;
      state.workflowFetchedAt = Date.now();
      return true;
    } catch (_) { return false; }
  }

  async function toggleManualBlock() {
    const conversationId = currentConversationId();
    if (!conversationId) { renderStatus('채팅방에서 사용', '고객 대화를 연 뒤 수동 관리 버튼을 눌러 주세요.'); return; }
    const blocked = state.manualBlocks.has(conversationId);
    try {
      const response = await fetch('http://127.0.0.1:8787/api/soomgo/block', {
        method: blocked ? 'DELETE' : 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' },
        body: JSON.stringify({ conversationId, reason: '패널에서 사용자 선택' })
      });
      if (!response.ok) throw new Error('서버에 저장하지 못했습니다.');
      if (blocked) state.manualBlocks.delete(conversationId); else state.manualBlocks.add(conversationId);
      renderStatus(blocked ? '자동 답변 재개' : '이 대화 수동 관리', blocked ? '이 채팅방을 다시 자동 답변 대상에 포함했습니다.' : '이 채팅방에는 자동 답변을 보내지 않습니다.');
    } catch (error) { renderStatus('수동 관리 저장 실패', String(error.message || error)); }
  }

  async function reportReplyResult(conversationId, messageId, status) {
    // Retry only the receipt, never the customer message. Capture the original
    // room URL before navigation so a retry cannot attribute it to another room.
    const body = JSON.stringify({ conversationId, messageId, status, at: new Date().toISOString(), url: location.href });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:8787/api/soomgo/reply-result', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' },
          body, signal: AbortSignal.timeout(4000), keepalive: true
        });
        if (response.ok) return true;
        if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
      } catch (_) {}
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    writeHeartbeat('답변 전송 기록 저장 실패 · 고객 메시지 재전송 금지', true);
    return false;
  }

  function reportFollowupResult(event, conversationId, status) {
    fetch('http://127.0.0.1:8787/api/soomgo/followup-result', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-chat-extension' },
      body: JSON.stringify({
        eventId: String(event?.id || ''),
        requestId: String(event?.requestId || ''),
        conversationId: String(conversationId || ''),
        customerName: String(event?.request?.customerName || ''),
        message: safeIntroText(event),
        status,
        at: new Date().toISOString(),
        url: location.href
      })
    }).catch(() => {});
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
      /(?:^|\n)\s*(PPT\s*제작|보고서|제안서|기술문서|계획서|통계\s*분석|데이터\s*분석|데이터\s*가공(?:\s*및\s*라벨링)?|자막\s*제작|번역|교정|이력서(?:\/|·)?자소서\s*컨설팅|레주메(?:\s*작성)?|resume(?:\s*writing)?|CV(?:\s*작성)?|문서\s*\/\s*글\s*작성)\s*(?=\n|$)/i,
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
    const deadline = first([/완료\s*희망일\s*\n?\s*([^\n]+)/i]);
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
      purpose, format, volume, topic, deadline,
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

  // 대면·방문·현장뿐 아니라 온라인·비대면·원격 진행 요청도
  // 자동 견적 대상에서 제외한다.
  function isDirectRequest(text) {
    const value = clean(text);
    if (!value) return false;
    if (/(온라인|비대면|원격|화상\s*(?:회의|상담|미팅|진행)?|줌|zoom|구글\s*미트)/i.test(value)) return true;
    return /(대면|대면\s*상담|직접\s*(만나|만남|미팅|상담)|방문\s*(희망|필요|가능|요청)|출장|현장\s*(방문|작업|진행|미팅)|오프라인|자택\s*(방문|에서)|사무실\s*(방문|에서)|찾아\s*오|찾아와)/i.test(value);
  }

  // 대본·시나리오 계열 의뢰는 자동 견적 대상에서 제외한다.
  function isScriptRequest(text) {
    return /(대본|시나리오|각본|스크립트|콘티)/i.test(clean(text));
  }

  // 논문·학술·학위·연구 프로젝트처럼 전문성 검토가 필요한 의뢰는
  // 자동 접수하지 않는다.
  function isAcademicRequest(text) {
    const value = clean(text);
    if (/(논문|학위\s*논문|학술|연구\s*논문|학회|저널|석사|박사|졸업\s*논문|연구\s*프로젝트)/i.test(value)) return true;
    return false;
  }

  function makePanel() {
    if (document.getElementById('relay-soomgo-chat-bot')) return document.getElementById('relay-soomgo-chat-bot');
    const panel = document.createElement('aside');
    panel.id = 'relay-soomgo-chat-bot';
    panel.innerHTML = `
      <div class="rsb-head"><b>Relay Desk · 고객 채팅 봇</b><button data-rsb="toggle" title="봇 켜기/끄기">ON</button></div>
      <div class="rsb-status" data-rsb="status">고객 채팅 감시 중</div>
      <div class="rsb-detail" data-rsb="detail">고객 채팅 목록을 확인하고 새 메시지가 있으면 대화방을 열어 답변합니다. 고용이 확정되면 Relay Desk 작업을 시작하고 숨고페이 결제 확인 후 결과 파일·무료 1회 첨삭·최종본·리뷰 요청을 순서대로 처리합니다.</div>
      <button class="rsb-generate" data-rsb="generateReply">답변 생성</button>
      <div class="rsb-actions"><button class="rsb-pause" data-rsb="pause">잠시 멈춤</button><button class="rsb-global" data-rsb="globalPause">전체 정지</button></div><button class="rsb-manual" data-rsb="manualBlock">현재 대화 수동 관리</button><button class="rsb-manual" data-rsb="inspect">메시지 감지 점검</button>`;
    const style = document.createElement('style');
    style.textContent = `
      #relay-soomgo-chat-bot{position:fixed;z-index:2147483647;right:14px;bottom:14px;width:278px;padding:13px;border-radius:14px;background:#101827;color:#eaf2ff;box-shadow:0 10px 35px #0006;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #relay-soomgo-chat-bot .rsb-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}
      #relay-soomgo-chat-bot button{border:0;border-radius:8px;padding:6px 9px;background:#34445f;color:#fff;cursor:pointer}
      #relay-soomgo-chat-bot [data-rsb=toggle]{background:#42d6b1;color:#08231d;font-weight:700}
      #relay-soomgo-chat-bot .rsb-generate{width:100%;margin:0 0 8px;background:#6850e8;font-weight:700;padding:9px}
      #relay-soomgo-chat-bot .rsb-status{color:#8de6ce;font-weight:600;margin-bottom:5px}
      #relay-soomgo-chat-bot .rsb-detail{color:#b8c4d6;max-height:88px;overflow:auto;white-space:pre-wrap;margin-bottom:8px}
      #relay-soomgo-chat-bot .rsb-actions{display:flex;gap:7px}#relay-soomgo-chat-bot .rsb-actions button{flex:1}#relay-soomgo-chat-bot .rsb-manual{width:100%;margin-top:7px}`;
    panel.append(style);
    document.documentElement.append(panel);
    panel.addEventListener('click', async event => {
      const action = event.target?.dataset?.rsb;
      if (action === 'toggle') {
        state.settings.enabled = !state.settings.enabled;
        await chrome.storage.local.set({ [STORAGE_KEY]: state.settings });
        writeHeartbeat(state.settings.enabled ? '감시 중' : '일시 정지');
        renderStatus(state.settings.enabled ? '고객 채팅 감시 중' : '일시 정지');
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
        renderStatus(next ? '전체 일시정지' : (state.settings.enabled ? '고객 채팅 감시 중' : '일시 정지'), next ? '요청 봇과 고객 채팅 봇을 함께 멈췄습니다.' : '전체 감시를 다시 시작했습니다.');
      }
      if (action === 'manualBlock') await toggleManualBlock();
      if (action === 'generateReply') await generateReplyDraft();
      if (action === 'inspect') {
        try {
          const incoming = latestIncomingMessage(pageText(), { preferUnhandled: true });
          renderStatus(incoming ? '미답변 고객 문의 감지 · 전송 안 함' : '미답변 고객 문의 없음',
            incoming ? `${incoming.messageId} · ${incoming.text}` : '현재 대화의 마지막 답변 이후 고객 메시지를 확인했습니다.');
        } catch (error) {
          renderStatus('메시지 감지 오류', String(error.message || error));
        }
      }
    });
    return panel;
  }

  function renderStatus(message, detail = '') {
    const panel = makePanel();
    const status = panel.querySelector('[data-rsb=status]');
    const toggle = panel.querySelector('[data-rsb=toggle]');
    const global = panel.querySelector('[data-rsb=globalPause]');
    const manual = panel.querySelector('[data-rsb=manualBlock]');
    const info = panel.querySelector('[data-rsb=detail]');
    if (status && status.textContent !== message) status.textContent = message;
    if (toggle) { if (toggle.textContent !== (state.settings.enabled ? 'ON' : 'OFF')) toggle.textContent = state.settings.enabled ? 'ON' : 'OFF'; toggle.style.background = state.settings.enabled ? '#42d6b1' : '#53627a'; }
    if (global) { if (global.textContent !== (globalPaused() ? '전체 재개' : '전체 정지')) global.textContent = globalPaused() ? '전체 재개' : '전체 정지'; global.style.background = globalPaused() ? '#d6a73c' : '#34445f'; }
    if (manual) { const id = currentConversationId(); const label = id && state.manualBlocks.has(id) ? '이 대화 자동 답변 재개' : '현재 대화 수동 관리'; if (manual.textContent !== label) manual.textContent = label; }
    if (info && detail && info.textContent !== detail) info.textContent = detail;
  }

  async function loadSettings() {
    try { const extra = await chrome.storage.local.get([QUOTE_READ_SEEN_KEY]); state.quoteReadSeen = extra[QUOTE_READ_SEEN_KEY] && typeof extra[QUOTE_READ_SEEN_KEY] === 'object' ? extra[QUOTE_READ_SEEN_KEY] : {}; } catch (_) {}
    const stored = await chrome.storage.local.get([STORAGE_KEY, SEEN_KEY, REPLY_TIMES_KEY, LAST_QUOTE_KEY, PENDING_HIRE_KEY, HIRED_CHATS_KEY, ACCEPTED_JOB_SEEN_KEY, PENDING_INTROS_KEY, INTRO_SENT_KEY, PENDING_FOLLOWUPS_KEY, FOLLOWUP_SENT_KEY, SENT_REPLY_HASHES_KEY, CHAT_ROOM_KEY, CHAT_HANDLED_KEY, CHAT_INSPECTED_KEY, RESEARCH_POLICY_MIGRATION_KEY, QUOTE_READ_RETRY_MIGRATION_KEY, STARTUP_MISSED_CHAT_RECOVERY_KEY, IRREVERSIBLE_ATTEMPTS_KEY, WORKFLOW_DELIVERY_HOLDS_KEY, WORKFLOW_VISITS_KEY]);
    const resetMarker = (await chrome.storage.local.get(RESET_V3_KEY))[RESET_V3_KEY];
    if (!resetMarker) {
      await chrome.storage.local.remove([
        SEEN_KEY, REPLY_TIMES_KEY, LAST_QUOTE_KEY, PENDING_HIRE_KEY, HIRED_CHATS_KEY,
        ACCEPTED_JOB_SEEN_KEY, PENDING_INTROS_KEY, INTRO_SENT_KEY, PENDING_FOLLOWUPS_KEY,
        FOLLOWUP_SENT_KEY, SENT_REPLY_HASHES_KEY, CHAT_ROOM_KEY, CHAT_HANDLED_KEY,
        CHAT_INSPECTED_KEY, IRREVERSIBLE_ATTEMPTS_KEY, WORKFLOW_DELIVERY_HOLDS_KEY,
        WORKFLOW_VISITS_KEY, CHAT_DELIVERY_ATTEMPTS_KEY
      ]);
      try { localStorage.removeItem(GLOBAL_PAUSE_KEY); } catch (_) {}
      await chrome.storage.local.set({ [RESET_V3_KEY]: { at: Date.now(), version: '0.3.0' }, [STORAGE_KEY]: { ...DEFAULTS, enabled: true, autoSend: true, autoReply: true } });
    }
    Object.assign(chatInspections, stored[CHAT_INSPECTED_KEY] || {});
    const storedSettings = stored[STORAGE_KEY] || {};
    state.settings = { ...DEFAULTS, ...storedSettings };
    if (SYSTEM_TEST_MODE) {
      state.settings.enabled = false;
      state.settings.autoSend = false;
      state.settings.autoReply = false;
      setGlobalPause(true);
      await chrome.storage.local.set({ [STORAGE_KEY]: state.settings });
    }
    // Only an explicit operator action may resume a stopped bot.
    const recoveredGlobalPause = false;
    // 이전 기본값(60초·45초)이 저장된 설치본은 30초로 한 번만 마이그레이션한다.
    if (!Object.prototype.hasOwnProperty.call(storedSettings, 'refreshMs') || [60000, 45000].includes(Number(storedSettings.refreshMs))) {
      state.settings.refreshMs = DEFAULTS.refreshMs;
      await chrome.storage.local.set({ [STORAGE_KEY]: state.settings });
    }
    // 기존 설치본에 저장된 사람형 지연값도 즉시 응답 정책으로 통일한다.
    if (Number(state.settings.humanReplyMinDelayMs) !== 0 || Number(state.settings.humanReplyMaxDelayMs) !== 0) {
      state.settings.humanReplyMinDelayMs = 0;
      state.settings.humanReplyMaxDelayMs = 0;
      await chrome.storage.local.set({ [STORAGE_KEY]: state.settings });
    }
    state.seen = new Set(Array.isArray(stored[SEEN_KEY]) ? stored[SEEN_KEY] : []);
    state.replyTimes = Array.isArray(stored[REPLY_TIMES_KEY]) ? stored[REPLY_TIMES_KEY].filter(time => Date.now() - Number(time) < 24 * 60 * 60 * 1000) : [];
    state.currentQuote = stored[LAST_QUOTE_KEY] || null;
    state.pendingHire = stored[PENDING_HIRE_KEY] || null;
    state.hiredConversations = stored[HIRED_CHATS_KEY] && typeof stored[HIRED_CHATS_KEY] === 'object' ? stored[HIRED_CHATS_KEY] : {};
    state.acceptedEventIds = Array.isArray(stored[ACCEPTED_JOB_SEEN_KEY]) ? stored[ACCEPTED_JOB_SEEN_KEY].map(String) : [];
    state.pendingIntros = Array.isArray(stored[PENDING_INTROS_KEY]) ? stored[PENDING_INTROS_KEY].filter(item => item?.id && item?.quote?.followupMessage).slice(-20) : [];
    state.introSentIds = Array.isArray(stored[INTRO_SENT_KEY]) ? stored[INTRO_SENT_KEY].map(String).slice(-200) : [];
    state.introReplyTrack = stored[INTRO_REPLY_TRACK_KEY] && typeof stored[INTRO_REPLY_TRACK_KEY] === 'object' ? stored[INTRO_REPLY_TRACK_KEY] : {};
    for (const [key, value] of Object.entries(state.introReplyTrack)) if (Date.now() - Number(value || 0) > 36 * 60 * 60 * 1000) delete state.introReplyTrack[key];
    await chrome.storage.local.set({ [INTRO_REPLY_TRACK_KEY]: state.introReplyTrack });
    state.pendingFollowups = Array.isArray(stored[PENDING_FOLLOWUPS_KEY]) ? stored[PENDING_FOLLOWUPS_KEY].filter(item => item?.id && item?.conversationId && item?.message).slice(-50) : [];
    state.followupSentIds = Array.isArray(stored[FOLLOWUP_SENT_KEY]) ? stored[FOLLOWUP_SENT_KEY].map(String).slice(-200) : [];
    state.sentReplyHashes = stored[SENT_REPLY_HASHES_KEY] && typeof stored[SENT_REPLY_HASHES_KEY] === 'object' ? stored[SENT_REPLY_HASHES_KEY] : {};
    for (const [key, value] of Object.entries(state.sentReplyHashes)) {
      if (!value || Date.now() - Number(value.at || 0) > 24 * 60 * 60 * 1000) delete state.sentReplyHashes[key];
    }
    await chrome.storage.local.set({ [SENT_REPLY_HASHES_KEY]: state.sentReplyHashes });
    state.startupMissedChatRecoveryDone = Boolean(stored[STARTUP_MISSED_CHAT_RECOVERY_KEY]);
    state.irreversibleAttempts = stored[IRREVERSIBLE_ATTEMPTS_KEY] && typeof stored[IRREVERSIBLE_ATTEMPTS_KEY] === 'object' ? stored[IRREVERSIBLE_ATTEMPTS_KEY] : {};
    state.workflowDeliveryHolds = stored[WORKFLOW_DELIVERY_HOLDS_KEY] && typeof stored[WORKFLOW_DELIVERY_HOLDS_KEY] === 'object' ? stored[WORKFLOW_DELIVERY_HOLDS_KEY] : {};
    state.workflowVisitAt = stored[WORKFLOW_VISITS_KEY] && typeof stored[WORKFLOW_VISITS_KEY] === 'object' ? stored[WORKFLOW_VISITS_KEY] : {};
    for (const [key, value] of Object.entries(state.workflowVisitAt)) {
      if (!Number.isFinite(Number(value)) || Date.now() - Number(value) > 15 * 60 * 1000) delete state.workflowVisitAt[key];
    }
    await chrome.storage.local.set({ [WORKFLOW_VISITS_KEY]: state.workflowVisitAt });
    // 이전 버전에서 남은 전달 보류가 영구적으로 실제 결과물 큐를
    // 가로막지 않도록 10분이 지난 보류는 로드 시 정리한다.
    const holdCutoff = Date.now() - 10 * 60 * 1000;
    let staleHoldRemoved = false;
    for (const [workflowId, hold] of Object.entries(state.workflowDeliveryHolds)) {
      if (!hold || !Number.isFinite(Number(hold.heldAt)) || Number(hold.heldAt) < holdCutoff || isRetryableDeliveryReason(hold.reason)) {
        delete state.workflowDeliveryHolds[workflowId];
        staleHoldRemoved = true;
      }
    }
    // 서버에 아직 미전달 결과가 남아 있으면, 이전 화면에서 첨부 확인이
    // 늦어져 저장된 보류 때문에 새로고침 뒤에도 영구히 대기하지 않게
    // 한다. 실제로 메시지를 보낸 흔적은 irreversibleAttempts가 별도로
    // 막으므로 같은 파일을 무조건 다시 보내지는 않는다.
    try {
      const pendingResponse = await fetch(`${state.settings.workflowEndpoint}?pending=1`, { cache: 'no-store', headers: { 'x-relay-bot': 'soomgo-chat-extension' }, signal: AbortSignal.timeout(8000) });
      const pendingData = pendingResponse.ok ? await pendingResponse.json() : null;
      const livePendingIds = new Set((Array.isArray(pendingData?.workflows) ? pendingData.workflows : [])
        .filter(item => item?.pendingDelivery && !item.pendingDelivery.deliveredAt && !item.deliveryBlocked && !item.formatIssue?.blocked)
        .map(item => String(item.id || '')));
      for (const workflowId of Object.keys(state.workflowDeliveryHolds)) {
        if (livePendingIds.has(String(workflowId))) {
          delete state.workflowDeliveryHolds[workflowId];
          staleHoldRemoved = true;
        }
      }
    } catch (_) {}
    if (staleHoldRemoved) await chrome.storage.local.set({ [WORKFLOW_DELIVERY_HOLDS_KEY]: state.workflowDeliveryHolds });
    // 새로고침으로 잃어버렸던 체류 기록을 되살린다. 현재 URL과
    // 다른 방의 기록이면 버린다.
    state.chatHandledAt = stored[CHAT_HANDLED_KEY] && typeof stored[CHAT_HANDLED_KEY] === 'object' ? stored[CHAT_HANDLED_KEY] : {};
    const savedRoom = stored[CHAT_ROOM_KEY];
    const openRoom = currentConversationId();
    if (openRoom) {
      state.chatPending = savedRoom && String(savedRoom.conversationId) === String(openRoom)
        ? savedRoom
        : { conversationId: openRoom, at: Date.now() };
      try { await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending }); } catch (_) {}
    } else if (savedRoom) {
      try { await chrome.storage.local.remove(CHAT_ROOM_KEY); } catch (_) {}
    }
    try {
      const blockResponse = await fetch('http://127.0.0.1:8787/api/state', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (blockResponse.ok) {
        const remote = await blockResponse.json();
        state.manualBlocks = new Set((Array.isArray(remote.soomgoBlocks) ? remote.soomgoBlocks : []).filter(item => item && item.active !== false).map(item => String(item.conversationId)));
        if (!stored[RESEARCH_POLICY_MIGRATION_KEY]) {
          const retry = (Array.isArray(remote.soomgoReplies) ? remote.soomgoReplies : []).filter(item =>
            item?.conversationId && item?.messageId && item?.reply?.templateKey === 'manual_scope'
            && /자료\s*조사|리서치|공개\s*자료/i.test(String(item.incoming || ''))
          );
          retry.forEach(item => {
            state.seen.delete(`reply:${item.conversationId}:${item.messageId}`);
            chatInspections[String(item.conversationId)] = { signature: `research-policy-retry:${item.messageId}`, at: 0 };
          });
          await chrome.storage.local.set({
            [SEEN_KEY]: [...state.seen],
            [CHAT_INSPECTED_KEY]: chatInspections,
            [RESEARCH_POLICY_MIGRATION_KEY]: true
          });
        }
        // Previous versions permanently marked unmatched quote-read events as
        // handled. Clear that per-room dedupe and reopen the card once so the
        // server can repair its conversation link from the sent quote URL.
        const remoteReplies = Array.isArray(remote.soomgoReplies) ? remote.soomgoReplies : [];
        const failedQuoteReads = remoteReplies.filter(item => item?.conversationId && String(item.messageId || '').startsWith('QUOTE-READ-')
          && ['quote_read_unmatched', 'emergency_astra_review'].includes(item.reply?.templateKey)
          && Date.now() - (Date.parse(item.createdAt || '') || 0) < 7 * 24 * 60 * 60 * 1000
          && !remoteReplies.some(other => other?.conversationId === item.conversationId
            && ['quote_read_followup', 'quote_read_context_fallback'].includes(other.reply?.templateKey)
            && (Date.parse(other.createdAt || '') || 0) >= (Date.parse(item.createdAt || '') || 0)));
        let quoteReadRetryChanged = false;
        for (const item of failedQuoteReads) {
          const prefix = `quote-read:${item.conversationId}:`;
          for (const key of [...state.seen]) if (key.startsWith(prefix)) { state.seen.delete(key); quoteReadRetryChanged = true; }
          const previous = chatInspections[String(item.conversationId)] || {};
          const retrySignature = `quote-read-retry:${item.messageId}`;
          if (previous.signature !== retrySignature) {
            chatInspections[String(item.conversationId)] = { ...previous, signature: retrySignature, at: 0, unread: false };
            quoteReadRetryChanged = true;
          }
        }
        if (quoteReadRetryChanged) {
          await chrome.storage.local.set({ [SEEN_KEY]: [...state.seen], [CHAT_INSPECTED_KEY]: chatInspections, [QUOTE_READ_RETRY_MIGRATION_KEY]: Date.now() });
        }
      }
    } catch (_) {}
    const currentEvents = readAcceptedJobEvents();
    const currentEvent = currentEvents[currentEvents.length - 1];
    if (!state.currentQuote && currentEvent?.quote && typeof currentEvent.quote === 'object') {
      state.currentQuote = currentEvent.quote;
      await chrome.storage.local.set({ [LAST_QUOTE_KEY]: state.currentQuote });
    }
    // 처음 설치하거나 storage를 지운 경우 기존 이벤트를 기준점으로만
    // 기록해 오래된 접수 때문에 페이지가 즉시 새로고침되지 않게 한다.
    if (!state.acceptedEventIds.length && currentEvents.length) {
      state.acceptedEventIds = currentEvents.map(event => String(event.id)).slice(-100);
      await chrome.storage.local.set({ [ACCEPTED_JOB_SEEN_KEY]: state.acceptedEventIds });
    }
    makePanel();
    renderStatus(state.settings.enabled ? '고객 채팅 감시 중' : '일시 정지', recoveredGlobalPause ? '업데이트 전에 남아 있던 전체 정지를 해제하고 감시를 다시 시작했습니다.' : '');
  }

  async function refreshAfterAcceptedJob() {
    if (!state.settings.enabled || globalPaused() || !/^\/pro\/chats(?:\/|$)/i.test(location.pathname)) return false;
    const event = readAcceptedJobEvents().find(item => !state.acceptedEventIds.includes(String(item.id)));
    if (!event?.id) return false;
    if (event.quote && typeof event.quote === 'object') {
      state.currentQuote = event.quote;
      await chrome.storage.local.set({ [LAST_QUOTE_KEY]: state.currentQuote });
    }
    const age = Date.now() - Number(event.at || 0);
    // 채팅 봇이 꺼져 있던 동안 쌓인 오래된 이벤트는 기준점만 갱신한다.
    if (Number.isFinite(age) && age > 30 * 60 * 1000) {
      state.acceptedEventIds = [...state.acceptedEventIds, String(event.id)].slice(-100);
      await chrome.storage.local.set({ [ACCEPTED_JOB_SEEN_KEY]: state.acceptedEventIds });
      return false;
    }
    const introId = String(event.id);
    if (event.quote?.followupMessage && !state.introSentIds.includes(introId) && !state.pendingIntros.some(item => String(item.id) === introId)) {
      state.pendingIntros = [...state.pendingIntros, { ...event, queuedAt: Date.now() }].slice(-20);
      await chrome.storage.local.set({ [PENDING_INTROS_KEY]: state.pendingIntros });
    }
    state.acceptedEventIds = [...state.acceptedEventIds, String(event.id)].slice(-100);
    await chrome.storage.local.set({ [ACCEPTED_JOB_SEEN_KEY]: state.acceptedEventIds });
    if (Date.now() - state.acceptRefreshAt < 15000) return false;
    state.acceptRefreshAt = Date.now();
    bumpStat('chatRefreshes');
    renderStatus('새 업무 접수됨 · 채팅 새로고침', '요청 봇이 견적을 보낸 뒤 한 번만 갱신합니다.');
    await sleep(180);
    location.reload();
    return true;
  }

  // 현재 열려 있는 채팅방을 기록한다. 새로고침 뒤에도 남아야
  // 나갈 판단을 이어서 할 수 있다.
  async function setChatRoom(conversationId) {
    state.chatPending = conversationId
      ? { ...(state.chatPending || {}), conversationId: String(conversationId), at: Date.now() }
      : null;
    try {
      if (conversationId) await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending });
      else await chrome.storage.local.remove(CHAT_ROOM_KEY);
    } catch (_) {}
  }

  async function markChatHandled(conversationId) {
    const id = String(conversationId || '');
    if (!id) return;
    state.chatHandledAt[id] = Date.now();
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    Object.keys(state.chatHandledAt).forEach(k => { if (Number(state.chatHandledAt[k]) < cutoff) delete state.chatHandledAt[k]; });
    try { await chrome.storage.local.set({ [CHAT_HANDLED_KEY]: state.chatHandledAt }); } catch (_) {}
  }

  // chatPending 유무와 상관없이 동작하는 마지막 안전장치다.
  // 방에 들어온 기록이 없으면 현재 방을 채택하고, 한도를 넘기면
  // 무조건 목록으로 돌려보낸다.
  async function enforceRoomTimeout() {
    if (!state.settings.enabled || state.busy || state.pendingHire) return false;
    const id = currentConversationId();
    if (!id) {
      if (state.chatPending) await setChatRoom('');
      return false;
    }
    if (!state.chatPending || String(state.chatPending.conversationId) !== String(id)) {
      await setChatRoom(id);
      return false;
    }
    if (Date.now() - Number(state.chatPending.at || 0) < ROOM_MAX_MS) return false;
    await markChatHandled(id);
    await logRoomExit(id, '체류 60초 초과(잠금 보유 탭)');
    renderStatus('채팅방 체류 시간 초과 · 목록 복귀', `${Math.round(ROOM_MAX_MS / 1000)}초 동안 처리할 일이 없어 나갑니다.`);
    await returnToChatList();
    return true;
  }

  async function logRoomExit(conversationId, reason) {
    try {
      const stored = await chrome.storage.local.get([ROOM_EXIT_LOG_KEY]);
      const log = Array.isArray(stored[ROOM_EXIT_LOG_KEY]) ? stored[ROOM_EXIT_LOG_KEY] : [];
      log.unshift({ at: new Date().toISOString(), conversationId: String(conversationId || ''), reason: String(reason || '').slice(0, 120) });
      await chrome.storage.local.set({ [ROOM_EXIT_LOG_KEY]: log.slice(0, 50) });
    } catch (_) {}
    writeHeartbeat(`방 체류 제한 복귀 · ${reason}`, true);
  }

  // E: 잠금 여부와 관계없이 어떤 이유로든 방에 60초 넘게 머물면 목록으로 나간다.
  // 발송 중(busy)이면 최대 180초까지 기다린다. 잠금이 없는 대기 탭도 이 감시는 돈다.
  function roomWatchdog() {
    try {
      // 수동 응대 중에는 대화방에서 강제로 나가거나 입력을 지우지 않는다.
      if (!state.settings.enabled || globalPaused()) { state.roomSince = 0; state.roomPath = ''; return; }
      const inRoom = /^\/pro\/chats\/[^/]+/i.test(location.pathname);
      if (!inRoom) { state.roomSince = 0; state.roomPath = ''; return; }
      if (state.roomPath !== location.pathname) { state.roomPath = location.pathname; state.roomSince = Date.now(); return; }
      const stay = Date.now() - Number(state.roomSince || Date.now());
      const limit = state.busy ? ROOM_BUSY_MAX_MS : ROOM_MAX_MS;
      if (stay < limit) return;
      const id = currentConversationId();
      state.roomSince = Date.now();
      logRoomExit(id, state.busy ? '발송 중 180초 초과' : (automationGuard?.owns?.() ? '체류 60초 초과' : '체류 60초 초과(잠금 없는 대기 탭)'));
      renderStatus('채팅방 체류 시간 초과 · 목록 복귀', `${Math.round(limit / 1000)}초가 지나 목록으로 돌아갑니다.`);
      location.assign(`${location.origin}/pro/chats?filter=all&from=chatroom`);
    } catch (_) {}
  }

  async function remember(key) {
    state.seen.add(key);
    while (state.seen.size > 500) state.seen.delete(state.seen.values().next().value);
    await chrome.storage.local.set({ [SEEN_KEY]: [...state.seen] });
  }

  function sentReplyKey(conversationId, text) {
    return `${String(conversationId || '')}:${hash(clean(text).toLowerCase().replace(/\s+/g, ' '))}`;
  }

  function isRetryableDeliveryReason(reason) {
    return /^(?:result_file_missing|file_input_not_found|file_download_\d+|result_file_empty|file_upload_rejected|file_upload_unconfirmed)$/.test(String(reason || ''));
  }

  function recentlySentReply(conversationId, text) {
    const record = state.sentReplyHashes?.[sentReplyKey(conversationId, text)];
    return Boolean(record && Date.now() - Number(record.at || 0) < 24 * 60 * 60 * 1000);
  }

  async function rememberSentReply(conversationId, text) {
    if (!conversationId || !clean(text)) return;
    if (!state.sentReplyHashes || typeof state.sentReplyHashes !== 'object') state.sentReplyHashes = {};
    state.sentReplyHashes[sentReplyKey(conversationId, text)] = { at: Date.now() };
    const entries = Object.entries(state.sentReplyHashes).sort((a, b) => Number(a[1]?.at || 0) - Number(b[1]?.at || 0));
    while (entries.length > 300) delete state.sentReplyHashes[entries.shift()[0]];
    await chrome.storage.local.set({ [SENT_REPLY_HASHES_KEY]: state.sentReplyHashes });
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

  async function returnToRequestList() {
    // 숨고 상세 화면의 상단 뒤로가기 버튼을 우선 사용하고, 버튼을
    // 찾지 못하면 브라우저 히스토리로 목록으로 돌아간다.
    const back = [...document.querySelectorAll('button,a,[role=button]')]
      .filter(excludeBot).filter(visible)
      .find(el => /뒤로|이전|요청\s*목록|back/i.test(clean(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`)));
    if (back) back.click();
    else window.history.back();
    await sleep(700);
  }

  async function processDetail() {
    const text = pageText();
    if (!isRequestDetail(text) || state.busy || Date.now() < state.retryAt) return false;
    const request = extract(text);
    const key = request.requestId || `PAGE-${hash(text)}`;
    if (state.seen.has(`sent:${key}`)) return true;
    if (state.seen.has(`skipped-direct:${key}`)) { await returnToRequestList(); return true; }
    if (state.seen.has(`skipped-script:${key}`)) { await returnToRequestList(); return true; }
    if (state.seen.has(`skipped-academic:${key}`)) { await returnToRequestList(); return true; }
    if (state.seen.has(`review:${key}`)) { await returnToRequestList(); return true; }
    if (isScriptRequest(`${request.text} ${request.topic} ${request.purpose}`)) {
      await remember(`skipped-script:${key}`);
      renderStatus('대본·시나리오 요청 자동 제외', '현재는 일반 문서 요청만 자동 접수합니다.');
      await returnToRequestList();
      return true;
    }
    if (isAcademicRequest(`${request.text} ${request.topic} ${request.purpose}`)) {
      await remember(`skipped-academic:${key}`);
      renderStatus('논문·학술 요청 자동 제외', '논문·학술·학위·연구 프로젝트는 자동 견적을 보내지 않습니다.');
      await returnToRequestList();
      return true;
    }
    if (isDirectRequest(`${request.text} ${request.topic} ${request.purpose}`)) {
      await remember(`skipped-direct:${key}`);
      renderStatus('대면·온라인 요청 자동 제외', '대면·온라인·비대면·원격·화상 요청은 견적과 자동 답변을 보내지 않습니다.');
      await returnToRequestList();
      return true;
    }
    setBusy(true);
    renderStatus('요청 분석 중', `${request.purpose || '문서 요청'} · ${request.volume || `${request.pages}쪽`}`);
    try {
      const response = await fetch(state.settings.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' },
        body: JSON.stringify(request)
      });
      const data = await response.json();
      if (!response.ok || !data.quote) throw new Error(data.error || '견적 엔진 응답 없음');
      const quote = { ...data.quote, sourceRequestId: data.quote?.sourceRequestId || request.requestId };
      state.currentQuote = quote;
      await chrome.storage.local.set({ [LAST_QUOTE_KEY]: quote });
      if (quote.manualReview || !quote.autoSend) {
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
      if (!send) { renderStatus('견적 입력 완료 · 보내기 버튼 대기', '입력된 내용을 확인한 뒤 버튼을 눌러 주세요.'); return true; }
      if (state.settings.autoSend) {
        send.click();
        await sleep(500);
        const afterSendText = pageText();
        if (/견적을\s*발송할\s*수\s*없어요|이미\s*\d+개\s*이상\s*견적/.test(afterSendText)) {
          await remember(`blocked:${key}`);
          renderStatus('숨고 발송 제한', '이미 10개 이상 견적을 받은 요청이라 발송되지 않았습니다.');
          return true;
        }
        await remember(`sent:${key}`);
        renderStatus('견적 자동 발송 완료', quoteStatusLabel(quote));
      }
      return true;
    } catch (error) {
      renderStatus('자동 견적 오류', String(error.message || error).slice(0, 160));
      state.retryAt = Date.now() + 5000;
      return false;
    } finally { setBusy(false); }
  }

  // 받은 요청 목록에 머물러 있어도 가장 최근 요청 상세로 자동 진입한다.
  // 이미 연 링크는 기록해 같은 요청을 계속 열지 않는다.
  async function processList() {
    const text = pageText();
    if (isRequestDetail(text) || !/받은\s*요청|요청\s*목록|요청서/.test(text)) return false;
    const candidates = [...document.querySelectorAll('a,button,[role=button]')].filter(excludeBot).filter(visible).filter(el => {
      const label = clean(el.textContent);
      const href = el.href || '';
      const detailLink = isRequestDetailHref(href);
      const likelyRequestButton = /자세히\s*보기|요청\s*확인|요청|견적|문서|글\s*작성|보고서|기술문서|제안서|계획서|데이터|통계|분석|번역|교정|디자인|개발|촬영|레슨/.test(label);
      const navigation = /받은\s*요청|보낸\s*견적|새로고침|프로멤버십|광고|입찰/.test(label);
      return !navigation && (detailLink || (el.tagName === 'BUTTON' && likelyRequestButton));
    });
    // 카드 안의 "자세히 보기"를 가장 먼저 선택한다. 바깥 카드 버튼을
    // 누르면 선택만 되고 상세 화면으로 이동하지 않는 숨고 화면이 있어,
    // 내부 상세 버튼을 우선해야 실제 견적 입력 단계로 넘어간다.
    const candidate = candidates.find(el => /자세히\s*보기|요청\s*확인/.test(clean(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`)))
      || candidates.find(el => isRequestDetailHref(el.href || ''))
      || candidates[0];
    if (!candidate) return false;
    const card = candidate.closest('[data-request-id], [data-requestid], [data-id]')
      || candidate.parentElement?.closest('button,[role=button]')
      || candidate.parentElement;
    const cardId = card?.getAttribute?.('data-request-id') || card?.getAttribute?.('data-requestid') || card?.getAttribute?.('data-id') || '';
    // 숨고가 목록 카드에 반복해서 붙이는 first-request 같은 임시 ID는
    // 새 요청과 충돌하므로 카드의 실제 내용까지 키에 포함한다.
    const reusableCardId = /^(first-request|request|card|undefined|null)$/i.test(String(cardId));
    const keySource = cardId && !reusableCardId ? cardId : `${candidate.href || ''}|${clean(card?.textContent || candidate.textContent).slice(0, 500)}`;
    const key = `opened:${keySource}`;
    if (state.seen.has(key)) return false;
    renderStatus('새 요청 상세로 이동 중', clean(candidate.textContent).slice(0, 80));
    candidate.click();
    await sleep(700);
    if (isRequestDetail(pageText()) || /\/requests\/received\/[A-Za-z0-9_-]{4,}/i.test(location.pathname)) {
      await remember(key);
      return true;
    }
    state.retryAt = Date.now() + 1200;
    renderStatus('새 요청 열기 재시도 대기', '상세 보기 버튼을 찾지 못해 다시 확인합니다.');
    return true;
  }

  function isChatPage(text) {
    // 요청 상세가 오른쪽에 함께 표시되는 채팅 화면도 정상 대화방이다.
    // 숨고는 방 진입 직후 입력창을 늦게 렌더링한다. 입력창 유무를 방
    // 판정에 묶으면 로딩 중인 방을 '처리할 메시지 없음'으로 오인해
    // 목록으로 되돌아가고, 결과 파일 첨부·1차 결과 전송이 시작되기도
    // 전에 같은 방을 열고 닫는 루프가 생긴다. 방 URL 자체를 우선 신뢰하고
    // 입력창 대기는 각 전송 함수에서 별도로 처리한다.
    return /^\/pro\/chats\/[^/]+/i.test(location.pathname);
  }

  function isChatListPage() {
    return /^\/pro\/chats\/?$/.test(location.pathname) && !findChatInput();
  }

  // 읽지 않은 배지가 없어도 Relay Desk에 고객 전달 대기 결과나
  // 숨고페이 요청 대기 상태가 있으면 해당 대화방을 먼저 연다.
  async function processWorkflowList() {
    if (!state.settings.enabled || state.busy || !isChatListPage()) return false;
    if (Date.now() - Number(state.workflowFetchedAt || 0) < 2500 && Array.isArray(state.workflowList)) {
      // 최근 목록을 이미 읽었다면 같은 방을 다시 열지 않는다.
    } else {
      state.workflowList = await fetchWorkflows('', true);
      state.workflowFetchedAt = Date.now();
      writeHeartbeat(`업무 결과 대기 확인 · ${state.workflowList.length}건`);
    }
    const visitKeyFor = item => [item.id || item.conversationId, item.pendingDelivery?.id || "", item.pendingAction || "", item.stage || ""].join(":");
    const pending = [...(state.workflowList || [])].filter(Boolean).sort((a, b) => Number(state.workflowVisitAt[visitKeyFor(a)] || 0) - Number(state.workflowVisitAt[visitKeyFor(b)] || 0)).find(item => {
      if (!item || !/^\d{6,20}$/.test(String(item.conversationId || ''))) return false;
      const deliveryId = String(item.pendingDelivery?.id || '');
      const hold = state.workflowDeliveryHolds[String(item.id || '')];
      const holdWindow = isRetryableDeliveryReason(hold?.reason) ? 15 * 1000 : 10 * 60 * 1000;
      const holdFresh = hold && Number.isFinite(Number(hold.heldAt))
        && Date.now() - Number(hold.heldAt) < holdWindow;
      if (holdFresh && deliveryId && String(hold.deliveryId || '') === deliveryId && Date.now() < Number(hold.retryAt || 0)) return false;
      if (hold && !holdFresh) {
        delete state.workflowDeliveryHolds[String(item.id || '')];
        chrome.storage.local.set({ [WORKFLOW_DELIVERY_HOLDS_KEY]: state.workflowDeliveryHolds }).catch(() => {});
      }
      if (hold && deliveryId && String(hold.deliveryId || '') !== deliveryId) {
        delete state.workflowDeliveryHolds[String(item.id || '')];
        chrome.storage.local.set({ [WORKFLOW_DELIVERY_HOLDS_KEY]: state.workflowDeliveryHolds }).catch(() => {});
      }
      // 한 번 처리한 업무방을 다음 감시 틱에서 즉시 다시 열면
      // '내 고객 목록 ↔ 같은 고객방'만 반복하는 현상이 생긴다.
      // 업무 상태·전달 ID가 바뀌기 전에는 짧은 쿨다운을 두고 다른
      // 고객을 먼저 확인한다. 결제 요청은 플랫폼 반영 지연을 고려해
      // 조금 더 길게 기다린다.
      const visitKey = `${String(item.id || item.conversationId)}:${deliveryId}:${String(item.pendingAction || '')}:${String(item.stage || '')}`;
      const lastVisit = Number(state.workflowVisitAt[visitKey] || 0);
      const visitWindow = item.pendingAction === 'request_payment' ? 90 * 1000 : 45 * 1000;
      if (lastVisit && Date.now() - lastVisit < visitWindow) return false;
      if (item.pendingDelivery && !item.pendingDelivery.deliveredAt || item.pendingAction) return true;
      if (item.stage === 'payment_requested') {
        const lastWatch = Number(state.paymentWatchAt[item.conversationId] || 0);
        return Date.now() - lastWatch >= 30000;
      }
      return false;
    });
    if (!pending) {
      writeHeartbeat('업무 결과 대기 없음');
      return false;
    }
    const conversationId = String(pending.conversationId);
    writeHeartbeat(`결과 전달 대기 · ${conversationId}`);
    let links = [...document.querySelectorAll('a[href*="/pro/chats/"]')].filter(excludeBot).filter(visible);
    let candidate = links.find(link => (link.href || '').match(new RegExp(`/pro/chats/${conversationId}(?:[/?#]|$)`)));
    // 숨고는 파일 input의 change 이벤트를 받으면 별도 전송 버튼 없이
    // 파일을 즉시 보낸 뒤 대화 목록으로 이동하는 경우가 있다. 이때 봇은
    // 메시지 전송 단계에 도달하지 못해 Relay Desk 확인 기록만 남지 않고
    // 같은 방을 다시 여는 루프에 빠진다. 동일 delivery의 최근 첨부 시도가
    // 있고 해당 고객 카드가 실제 "파일을 보냈습니다"로 바뀐 경우에만
    // 플랫폼 전송 증거로 인정해 중복 첨부 없이 전달 완료를 기록한다.
    if (candidate && pending.pendingDelivery && !pending.pendingDelivery.deliveredAt) {
      const deliveryAttemptKey = attemptKey(pending, 'deliver', String(pending.pendingDelivery.id || ''));
      const previousAttempt = getAttempt(deliveryAttemptKey);
      const attemptAge = Date.now() - Number(previousAttempt?.at || 0);
      const candidateText = clean(candidate.textContent || '');
      const platformFileSent = previousAttempt?.started && !previousAttempt?.sent
        && attemptAge >= 0 && attemptAge < 5 * 60 * 1000
        && /파일을\s*보냈습니다/.test(candidateText) && Boolean(pending.pendingDelivery.filename) && candidateText.includes(pending.pendingDelivery.filename);
      if (platformFileSent) {
        const filenames = Array.isArray(pending.pendingDelivery.files) && pending.pendingDelivery.files.length
          ? pending.pendingDelivery.files.map(file => file.name || file.filename).filter(Boolean)
          : [pending.pendingDelivery.filename || ''].filter(Boolean);
        writeHeartbeat(`플랫폼 파일 전송 확인 · ${conversationId}`, true);
        return finishWorkflowDelivery(pending, pending.pendingDelivery, deliveryAttemptKey, filenames);
      }
    }
    if (!candidate && !/[?&]filter=is_hired(?:&|$)/.test(location.search)) {
      // 고용이 확정된 방은 숨고가 기본 '전체' 목록에서 오래된 항목을
      // 숨기고 '내 고용' 필터에만 남기는 경우가 있다. 숫자 ID로 직접
      // 이동하면 숨고가 목록으로 되돌리므로, 반드시 화면의 필터 버튼을
      // 눌러 SPA가 만든 실제 링크를 다시 렌더링한 뒤 그 링크를 사용한다.
      const hiredFilter = [...document.querySelectorAll('button,a')]
        .filter(excludeBot).filter(visible)
        .find(node => /^내\s*고용$/.test(clean(node.textContent || '')));
      if (hiredFilter) {
        // 목록 필터를 토글하면 감시 루프가 같은 카드와 목록 사이를
        // 왕복한다. 우선 실제 방 주소를 직접 열고, 플랫폼이 거부할
        // 때만 기존 고용 필터를 한 번 사용한다.
        const visitKey = `${String(pending.id || conversationId)}:${String(pending.pendingDelivery?.id || '')}:${String(pending.pendingAction || '')}:${String(pending.stage || '')}`;
        state.workflowVisitAt[visitKey] = Date.now();
        await chrome.storage.local.set({ [WORKFLOW_VISITS_KEY]: state.workflowVisitAt });
        renderStatus('업무 대화방 이동 중', `${conversationId}의 결과 전달 대화방을 직접 확인합니다.`);
        const roomQuery = '?from=chatroom&returnUrl=%2Fpro%2Fchats%3Ffilter%3Dall&list_filter=%EB%82%B4_%EA%B3%A0%EC%9A%A9&location_entry_method=%EB%82%B4_%EA%B3%A0%EC%9A%A9_%ED%95%84%ED%84%B0';
        location.href = `https://soomgo.com/pro/chats/${encodeURIComponent(conversationId)}${roomQuery}`;
        state.workflowFetchedAt = 0;
        return true;
      }
    }
    if (!candidate) {
      // 목록 카드가 아직 렌더링되지 않은 경우에도 숫자형 숨고 대화방이면
      // 직접 이동해 1차 결과 전달을 시도한다. 시험용 ID는 위에서 걸러져
      // 실제 고객 대화만 이 경로를 탄다.
      if (/^\d{6,20}$/.test(conversationId)) {
        const visitKey = `${String(pending.id || conversationId)}:${String(pending.pendingDelivery?.id || '')}:${String(pending.pendingAction || '')}:${String(pending.stage || '')}`;
        state.workflowVisitAt[visitKey] = Date.now();
        await chrome.storage.local.set({ [WORKFLOW_VISITS_KEY]: state.workflowVisitAt });
        state.lastChatOpened = { key: conversationId, at: Date.now() };
        state.chatPending = { conversationId, workflowId: pending.id, workflowMode: true, at: Date.now() };
        await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending });
        renderStatus('업무 결과 전달 대화방 이동 중', `${conversationId}의 결과 전달 대기 파일을 확인합니다.`);
        // 숨고는 대화 목록에서 붙는 진입 쿼리가 없으면 숫자형 방 주소를
        // 목록으로 되돌리는 경우가 있다. 결과 대기 방을 직접 열 때도
        // 실제 카드 링크와 같은 쿼리를 붙여야 첨부·전송 단계까지 도달한다.
        const roomQuery = '?from=chatroom&returnUrl=%2Fpro%2Fchats&list_filter=%EC%A0%84%EC%B2%B4&location_entry_method=%EC%A0%84%EC%B2%B4_%ED%95%84%ED%84%B0';
        location.href = `https://soomgo.com/pro/chats/${encodeURIComponent(conversationId)}${roomQuery}`;
        return true;
      }
      renderStatus('업무 대화방 찾는 중', `${conversationId}의 결과 전달 대기 상태를 확인했습니다.`);
      return true;
    }
    if (state.lastChatOpened?.key === conversationId && Date.now() - state.lastChatOpened.at < 5000) return true;
    const visitKey = `${String(pending.id || conversationId)}:${String(pending.pendingDelivery?.id || '')}:${String(pending.pendingAction || '')}:${String(pending.stage || '')}`;
    state.workflowVisitAt[visitKey] = Date.now();
    await chrome.storage.local.set({ [WORKFLOW_VISITS_KEY]: state.workflowVisitAt });
    state.lastChatOpened = { key: conversationId, at: Date.now() };
    state.chatPending = { conversationId, workflowId: pending.id, workflowMode: true, at: Date.now() };
    await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending });
    if (pending.stage === 'payment_requested') state.paymentWatchAt[conversationId] = Date.now();
    renderStatus('업무 결과 전달 대화방 여는 중', pending.pendingAction === 'request_payment' ? '숨고페이 요청을 진행합니다.' : pending.pendingDelivery?.kind === 'final' ? '최종 결과를 전달합니다.' : '1차 결과를 전달합니다.');
    candidate.click();
    await sleep(550);
    return true;
  }

  async function persistIntroQueue() {
    state.pendingIntros = state.pendingIntros.filter(item => item?.id && !state.introSentIds.includes(String(item.id))).slice(-20);
    state.introSentIds = state.introSentIds.slice(-200);
    await chrome.storage.local.set({ [PENDING_INTROS_KEY]: state.pendingIntros, [INTRO_SENT_KEY]: state.introSentIds });
  }

  async function removePendingIntro(event, sent = false) {
    const id = String(event?.id || '');
    if (sent && id && !state.introSentIds.includes(id)) state.introSentIds.push(id);
    state.pendingIntros = state.pendingIntros.filter(item => String(item?.id || '') !== id);
    await persistIntroQueue();
  }

  // 2-4-3: 고객에게 나가는 고정 문구는 서버 messages.json에서만 받는다. 서버가 답하지 않으면 보내지 않는다.
  async function serverMessage(id, values = {}) {
    try {
      const response = await fetch(MESSAGE_TEXT_ENDPOINT, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' },
        body: JSON.stringify({ id, values }), signal: AbortSignal.timeout(8000)
      });
      const data = await response.json();
      if (!response.ok || !data?.text) return null;
      return { text: String(data.text), messageId: String(data.messageId || id), version: String(data.version || 'v1') };
    } catch (_) { return null; }
  }

  function safeIntroText(event) {
    const raw = clean(event?.quote?.followupMessage || '');
    // 구버전 큐에 남은 "진행하실까요?"·"고용 요청" 문구가 새 고객에게
    // 성급한 동의 압박으로 발송되지 않도록 중립적인 안내로 교체한다.
    // 서버가 준 첫 안내만 쓴다. 없거나 구버전 문구면 보내지 않는다(로컬 대체 문구 없음).
    if (!raw || /고용\s*요청|일정\s*등록|진행하실까요|진행하겠습니다|네\s*가지\s*조건|고용하기/i.test(raw)) return '';
    return raw;
  }

  async function persistFollowupQueue() {
    state.pendingFollowups = state.pendingFollowups.filter(item => item?.id && item?.conversationId && item?.message && !state.followupSentIds.includes(String(item.id))).slice(-50);
    state.followupSentIds = state.followupSentIds.slice(-200);
    await chrome.storage.local.set({ [PENDING_FOLLOWUPS_KEY]: state.pendingFollowups, [FOLLOWUP_SENT_KEY]: state.followupSentIds });
  }

  async function queueNoReplyFollowup(event, conversationId) {
    const id = `${String(event?.id || '')}-no-reply`;
    if (!event?.id || !conversationId || state.followupSentIds.includes(id) || state.pendingFollowups.some(item => String(item.id) === id)) return;
    const serverText = safeIntroText(event);
    if (!serverText) return;
    state.pendingFollowups = [...state.pendingFollowups, { id, introEventId: String(event.id), requestId: String(event.requestId || ''), conversationId: String(conversationId), customerName: String(event.request?.customerName || ''), message: serverText, queuedAt: Date.now(), dueAt: Date.now() + QUOTE_READ_FOLLOWUP_DELAY_MS }].slice(-50);
    await persistFollowupQueue();
  }

  async function removePendingFollowup(item, sent = false) {
    const id = String(item?.id || '');
    if (sent && id && !state.followupSentIds.includes(id)) state.followupSentIds.push(id);
    state.pendingFollowups = state.pendingFollowups.filter(entry => String(entry?.id || '') !== id);
    await persistFollowupQueue();
  }

  function linkHasUnread(link) {
    const badges = [...(link?.querySelectorAll?.('[role="status"], [aria-live], [class*="unread" i], [class*="badge" i]') || [])];
    const labels = clean(`${link?.getAttribute?.('aria-label') || ''} ${link?.textContent || ''} ${badges.map(badge => `${badge.textContent || ''} ${badge.getAttribute?.('aria-label') || ''} ${badge.className || ''} ${badge.getAttribute?.('data-unread') || ''}`).join(' ')}`);
    return Boolean(badges.some(badge => {
      const value = clean(badge.textContent || '');
      return /^\d+$/.test(value) && Number(value) > 0;
    }) || /안\s*읽|새\s*메시지|unread|읽지\s*않음|has[-_]?unread/i.test(labels));
  }

  function globalUnreadChatCount() {
    const nav = [...document.querySelectorAll('a[href="/pro/chats"], a[href^="/pro/chats?"], a[href="https://soomgo.com/pro/chats"]')]
      .find(link => /채팅/.test(clean(`${link.textContent || ''} ${link.getAttribute?.('aria-label') || ''}`)));
    const title = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
      .find(node => clean(node.textContent) === '채팅');
    const roots = [nav, title, title?.parentElement, title?.parentElement?.parentElement].filter(Boolean);
    const badges = roots.flatMap(root => root.querySelectorAll?.('[role="status"], [aria-live], [class*="unread" i], [class*="badge" i], [class*="count" i], [aria-valuenow], [data-count]') || []);
    for (const badge of badges) {
      const text = clean(badge.textContent || '');
      const match = [text, badge.getAttribute?.('aria-label') || '', badge.getAttribute?.('aria-valuenow') || '', badge.getAttribute?.('data-count') || '']
        .map(value => clean(value).match(/^\d{1,3}$/)?.[0])
        .find(Boolean);
      if (match && Number(match) > 0) return Number(match);
    }
    for (const root of roots) {
      const match = clean(root.innerText || root.textContent || '').match(/채팅\s*(\d{1,3})\b/);
      if (match && Number(match[1]) > 0) return Number(match[1]);
    }
    return roots.some(root => linkHasUnread(root)) ? 1 : 0;
  }

  function chatListSignature(link) {
    // 접속 상태·표시 시각은 내용이 그대로여도 계속 바뀔 수 있다.
    // 고객명·서비스·마지막 메시지는 남기고 시간 표현만 제거한다.
    return hash(clean(link?.textContent || '')
      .replace(/(?:오전|오후)\s*\d{1,2}:\d{2}/g, ' ')
      .replace(/(?:방금|\d+\s*(?:초|분|시간|일)\s*전)(?:\s*접속)?/g, ' '));
  }

  function chatListClockAt(link, now = Date.now()) {
    const text = clean(link?.textContent || '');
    const match = text.match(/(?:오전|오후)\s*(\d{1,2}):(\d{2})/);
    if (!match) return Number(now);
    const period = match[0].includes('오후') ? 'pm' : 'am';
    let hour = Math.max(0, Math.min(12, Number(match[1]) || 0));
    const minute = Math.max(0, Math.min(59, Number(match[2]) || 0));
    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    const observed = new Date(Number(now));
    observed.setHours(hour, minute, 0, 0);
    // 자정 직후 목록에 전날 늦은 시각이 남아 있는 경우 오늘의 미래 시각으로
    // 오인하지 않는다. 숨고 목록 시각은 별도 날짜가 없으므로 5분보다 미래면
    // 전날 읽음으로 취급한다.
    if (observed.getTime() > Number(now) + 5 * 60 * 1000) observed.setDate(observed.getDate() - 1);
    return observed.getTime();
  }

  function quoteReadNoticeIn(value) {
    return /(?:고객님이\s*견적(?:서)?(?:을|를)?\s*읽었(?:습니다|어요)?|견적서?를?\s*읽었(?:습니다|어요)?)/i.test(clean(value));
  }

  function quoteReadNoticeNode() {
    const selectors = ['[id^="message-"]:not([id*="chat-date"])', '[data-message-id]', '[data-messageid]', '.message-box', '[class*="chat-message" i]'];
    const nodes = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]).map(node => node.closest('[id^="message-"], [data-message-id], [data-messageid]') || node))]
      .filter(excludeBot).filter(visible).filter(node => !node.querySelector?.('textarea, input, [contenteditable="true"]'))
      .map(node => ({ node, text: clean(node.querySelector?.('[data-name="content"], [data-name="content-body"], .message-content, .message-text')?.innerText || node.innerText || node.textContent) }))
      .filter(item => quoteReadNoticeIn(item.text));
    return nodes.at(-1) || null;
  }

  async function expandCollapsedQuote() {
    // 숨고가 긴 견적을 "전체보기"로 접어 두면 본문·견적 연결 정보가
    // DOM에 늦게 노출됩니다. 후속 안내를 판단하기 전에 한 번만 펼칩니다.
    const buttons = [...document.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .filter(node => /^\s*전체보기\s*$/.test(clean(node.innerText || node.textContent)));
    if (!buttons.length) return false;
    buttons.at(-1).click();
    await sleep(250);
    return true;
  }

  async function processQuoteReadFollowup() {
    if (!state.settings.enabled || state.busy || globalPaused() || !/^\/pro\/chats\/[^/]+/i.test(location.pathname)) return false;
    if (!state.chatPending?.quoteReadNotice || String(state.chatPending.conversationId || '') !== currentConversationId()) return false;
    const conversationId = currentConversationId();
    await expandCollapsedQuote();
    const notice = quoteReadNoticeNode();
    if (!notice) return false;
    const noticeAt = Number(state.chatPending.quoteReadAt || state.chatPending.at || Date.now());
    let delayUntil = Number(state.chatPending.quoteReadDelayUntil || 0);
    if (!delayUntil) {
      delayUntil = noticeAt + QUOTE_READ_FOLLOWUP_DELAY_MS;
      state.chatPending = { ...state.chatPending, quoteReadAt: noticeAt, quoteReadDelayUntil: delayUntil };
      await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending });
    }
    if (Date.now() < delayUntil) {
      // E: 방 안에서 10분을 기다리지 않는다. 아직 이르면 목록으로 돌아가 목록에서 기다린다.
      renderStatus('견적 읽음 후속 · 목록에서 대기', '읽음 후 10분이 지나면 다시 들어와 한 번만 안내합니다.');
      await returnToChatList();
      return true;
    }
    const latest = latestIncomingMessage(pageText(), { preferUnhandled: true });
    if (latest) return false; // 고객의 질문·답변이 있으면 견적 읽음 안내보다 먼저 처리한다.
    if (state.manualBlocks.has(conversationId) || isHiredConversation(pageText()) || platformConfirmation('hire')) {
      await remember(`quote-read:${conversationId}:${state.chatPending.quoteReadId || 'notice'}`);
      await returnToChatList();
      return true;
    }
    const eventId = String(state.chatPending.quoteReadId || notice.node.getAttribute('data-message-id') || notice.node.id || hash(`${conversationId}|${notice.text}`));
    const dedupeKey = `quote-read:${conversationId}:${eventId}`;
    if (state.seen.has(dedupeKey)) { await returnToChatList(); return true; }
    setBusy(true);
    try {
      const context = latestIncomingMessage(pageText(), { includeReplied: true });
      const body = {
        conversationId,
        messageId: `QUOTE-READ-${hash(`${conversationId}|${eventId}`)}`,
        message: notice.text,
        conversationText: context?.conversationText || '',
        quote: state.workflow?.quote || currentConversationQuote(conversationId),
        quoteReadFollowup: true,
        quoteReadExperiment: true,
        quoteReadEvidence: Boolean(state.chatPending?.quoteReadNotice),
        preferredFollowupTemplate: '요청하신 [작업]은 말씀해주신 [고객 조건]을 중심으로 확인했어요.\n[아직 확인되지 않은 핵심 항목]만 알려주시면 작업 범위와 가능한 일정을 더 정확히 안내드릴 수 있어요. 편하게 답해 주세요.',
        hiredConversation: false,
        workflowStage: ''
      };
      renderStatus('견적 확인 후 주제 맞춤 안내 생성 중', '앞선 요청과 대화 내용을 읽고 한 번만 후속 안내합니다.');
      const response = await fetch(state.settings.replyEndpoint, { signal: AbortSignal.timeout(REPLY_FETCH_TIMEOUT_MS), method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok || !data.reply) throw new Error(data.error || '견적 읽음 후속 응답을 만들지 못했습니다.');
      const reply = data.reply;
      if (reply.skip || reply.manualReview || !reply.autoSend || !reply.text) {
        if (reply.templateKey === 'quote_read_unmatched') {
          const retries = Number(state.chatPending.quoteReadRetries || 0) + 1;
          state.chatPending = { ...state.chatPending, quoteReadRetries: retries };
          await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending });
          if (retries < 3) {
            renderStatus('견적 읽음 고객 연결 재확인 중', '견적 발송 기록의 채팅 주소와 다시 대조합니다.');
            state.retryAt = Date.now() + 1800;
            return true;
          }
        }
        await remember(dedupeKey);
        renderStatus('견적 확인 후 안내 보류', reply.reason || '요청 기록을 연결하지 못해 중복·오발송 방지를 위해 보류했습니다.');
        await returnToChatList();
        return true;
      }
      const input = findChatInput();
      if (!input) { renderStatus('견적 확인 후 안내 입력창 대기', reply.text); state.retryAt = Date.now() + 1500; return true; }
      setValue(input, reply.text);
      await sleep(200);
      if (!state.settings.autoReply) {
        await remember(dedupeKey);
        renderStatus('견적 읽음 후속 초안 입력 · 전송 대기', '고객의 주제에 맞춘 메시지를 입력했습니다.');
        return true;
      }
      if (recentlySentReply(conversationId, reply.text)) {
        await remember(dedupeKey);
        renderStatus('견적 확인 후 중복 안내 생략', '같은 안내를 이미 보냈습니다. 고객의 새 질문을 기다립니다.');
        await markChatHandled(conversationId);
        await returnToChatList();
        return true;
      }
      const sent = await sendChatText(reply.text);
      await remember(dedupeKey);
      if (!sent) {
        // 전송 확인 실패: 같은 방에 다시 보내지 않도록 기록은 남기고(remember) 목록으로 돌아간다.
        renderStatus('견적 읽음 후속 전송 확인 필요', '전송 상태를 확인하지 못했습니다. 중복 방지를 위해 다시 보내지 않고 목록으로 돌아갑니다.');
        writeHeartbeat('견적 읽음 후속 확인 필요', true);
        reportReplyResult(conversationId, body.messageId, 'uncertain');
        await returnToChatList();
        return true;
      } else {
        await rememberSentReply(conversationId, reply.text);
        reportReplyResult(conversationId, body.messageId, 'sent');
        bumpStat('followupsSent');
        await recordReplyTime();
        renderStatus('견적 확인 후 주제 맞춤 안내 완료', reply.text);
      }
      await markChatHandled(conversationId);
      await returnToChatList();
      return true;
    } catch (error) {
      renderStatus('견적 읽음 후속 오류', String(error.message || error).slice(0, 160));
      state.retryAt = Date.now() + 5000;
      return true;
    } finally { setBusy(false); }
  }

  function shouldOpenUnreadRoom(item, now = Date.now()) {
    if (!item?.key || !item.unread || state.manualBlocks.has(item.key)) return false;
    const previous = item.previous || {};
    const signatureChanged = Boolean(item.signature && item.signature !== previous.signature);
    // 같은 unread 배지가 남아 있어도 같은 메시지에는 재진입하지 않는다.
    // 새 메시지로 미리보기가 바뀌거나 읽음→unread로 전환되면 다시 확인한다.
    if (previous.unread === true && !signatureChanged) return false;
    if (!signatureChanged && previous.unread !== false && now - Number(previous.at || 0) < 3000) return false;
    return true;
  }

  // 첫 안내 후 답장이 없는 고객에게만 10분 뒤 한 번 후속 메시지를
  // 보낸다. 읽지 않은 배지가 있으면 고객이 답한 것이므로 후속을 취소한다.
  async function processPendingFollowup() {
    if (!state.settings.enabled || state.busy || globalPaused()) return false;
    try {
      const day = new Date().toISOString().slice(0, 10);
      const daily = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
      if (daily.day === day && Number(daily.followupsSent || 0) >= 3) {
        renderStatus('오늘 후속 안내 한도 도달', '후속 안내는 하루 최대 3건만 보냅니다.');
        return false;
      }
    } catch (_) {}
    const item = state.pendingFollowups.find(entry => entry?.id && !state.followupSentIds.includes(String(entry.id)) && Date.now() >= Number(entry.dueAt || 0));
    if (!item) return false;
    if (Date.now() - Number(item.queuedAt || 0) > 36 * 60 * 60 * 1000) {
      bumpStat('followupsSkipped'); await removePendingFollowup(item, true); return false;
    }
    if (isChatListPage()) {
      const links = [...document.querySelectorAll('a[href*="/pro/chats/"]')].filter(excludeBot).filter(visible);
      const candidate = links.find(link => (link.href || '').match(new RegExp(`/pro/chats/${String(item.conversationId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/?#]|$)`)));
      if (!candidate) { renderStatus('무응답 후속 대화방 확인 대기', `${item.customerName || '고객'}의 채팅방을 찾고 있습니다.`); return false; }
      if (linkHasUnread(candidate)) { bumpStat('followupsSkipped'); await removePendingFollowup(item, true); return false; }
      state.chatPending = { conversationId: String(item.conversationId), followupId: String(item.id), at: Date.now() };
      await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending });
      renderStatus('무응답 후속 안내 준비', `${item.customerName || '고객'}에게 한 번만 안내합니다.`);
      candidate.click(); await sleep(550); return true;
    }
    if (String(state.chatPending?.followupId || '') !== String(item.id) || currentConversationId() !== String(item.conversationId)) return false;
    if (state.manualBlocks.has(item.conversationId) || isHiredConversation(pageText())) { bumpStat('followupsSkipped'); await removePendingFollowup(item, true); await returnToChatList(); return true; }
    // 예약된 후속 안내보다 고객의 새 메시지를 먼저 처리한다. 이 경우
    // 후속 큐를 소비하지 않고 processChat으로 넘겨 실제 문의에 답한다.
    const latest = latestIncomingMessage(pageText(), { preferUnhandled: true });
    if (latest) return false;
    if (state.replyTimes.length >= 20) { renderStatus('무응답 후속 한도 대기', '24시간 자동 답변 한도에 도달했습니다.'); return true; }
    setBusy(true);
    try {
      const sent = await sendChatText(item.message);
      if (!sent) { renderStatus('무응답 후속 입력창 대기', item.message); state.retryAt = Date.now() + 1500; return true; }
      reportFollowupResult(item, item.conversationId, 'sent'); bumpStat('followupsSent'); bumpStat('firstReplyNoResponse'); bumpStat('repliesSent'); await recordReplyTime(); await removePendingFollowup(item, true); await markChatHandled(item.conversationId); renderStatus('무응답 후속 안내 완료', '추가 후속 메시지는 보내지 않습니다.'); await returnToChatList(); return true;
    } finally { setBusy(false); }
  }

  // 견적 발송 직후 고객이 답하기 쉬운 질문을 한 번만 보낸다. 고객명이나
  // 요청 ID로 대화방을 확인할 수 있을 때만 열어 다른 고객에게 잘못 보내는
  // 일을 막는다. 식별할 수 없으면 자동 발송하지 않고 대기 상태로 남긴다.
  async function processPendingIntro() {
    if (!state.settings.enabled || state.busy || globalPaused()) return false;
    const event = state.pendingIntros.find(item => item?.id && item?.quote?.followupMessage && !state.introSentIds.includes(String(item.id)));
    if (!event) return false;
    const age = Date.now() - Number(event.queuedAt || event.at || 0);
    if (Number.isFinite(age) && age > 30 * 60 * 1000) {
      reportFollowupResult(event, '', 'expired');
      await removePendingIntro(event, false);
      return false;
    }
    if (isChatListPage()) {
      const links = [...document.querySelectorAll('a[href*="/pro/chats/"]')].filter(excludeBot).filter(visible);
      const requestId = clean(event.requestId || '');
      const customerName = clean(event.request?.customerName || '');
      const ranked = links.map((link, index) => {
        const haystack = clean(`${link.href || ''} ${link.textContent || ''} ${link.getAttribute('aria-label') || ''} ${link.getAttribute('data-request-id') || ''}`);
        let score = 0;
        if (requestId && haystack.includes(requestId)) score += 100;
        if (customerName && haystack.includes(customerName)) score += 60;
        return { link, index, score };
      }).filter(item => item.score > 0).sort((left, right) => right.score - left.score || left.index - right.index);
      let candidate = ranked[0]?.link || null;
      // 계정에 채팅방이 하나뿐인 경우에만 고객명 없이도 안전하게 연다.
      if (!candidate && links.length === 1 && age >= 0 && age < 2 * 60 * 1000) candidate = links[0];
      if (!candidate) {
        renderStatus('견적 후 안내 대화방 확인 대기', customerName ? `${customerName} 고객의 채팅방을 찾고 있습니다.` : '고객을 정확히 식별할 수 있어야 첫 안내를 보냅니다.');
        return false;
      }
      const href = candidate.href || '';
      const conversationId = href.match(/\/pro\/chats\/([A-Za-z0-9_-]{3,})/i)?.[1] || href;
      if (state.lastChatOpened?.key === `intro:${event.id}` && Date.now() - state.lastChatOpened.at < 5000) return true;
      state.lastChatOpened = { key: `intro:${event.id}`, at: Date.now() };
      state.currentQuote = { ...(event.quote || {}), sourceRequestId: String(event.requestId || event.quote?.sourceRequestId || ''), conversationId: String(conversationId) };
      state.chatPending = { conversationId: String(conversationId), introEventId: String(event.id), at: Date.now() };
      await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending, [LAST_QUOTE_KEY]: state.currentQuote });
      renderStatus('견적 후 첫 안내 준비', `${customerName || '신규 고객'}에게 질문 한 문장을 보냅니다.`);
      candidate.click();
      await sleep(550);
      return true;
    }
    const conversationId = currentConversationId();
    if (!conversationId || String(state.chatPending?.introEventId || '') !== String(event.id)) return false;
    // 견적 후 첫 안내가 대기 중이어도 고객이 먼저 보낸 질문을
    // 우선 답한다. 안내 문장이 문의를 덮어쓰지 않게 한다.
    if (latestIncomingMessage(pageText(), { preferUnhandled: true })) return false;
    if (state.manualBlocks.has(conversationId) || isHiredConversation(pageText())) {
      reportFollowupResult(event, conversationId, 'skipped');
      await removePendingIntro(event, false);
      await returnToChatList();
      return true;
    }
    if (state.replyTimes.length >= 20) {
      renderStatus('첫 안내 발송 한도 대기', '24시간 자동 답변 한도에 도달했습니다.');
      return true;
    }
    setBusy(true);
    try {
      const introMessage = safeIntroText(event);
      if (!introMessage) {
        await removePendingIntro(event, false);
        renderStatus('견적 후 첫 안내 생략', '서버 문구가 없어 보내지 않았습니다.');
        await returnToChatList();
        return true;
      }
      if (recentlySentReply(conversationId, introMessage)) {
        await removePendingIntro(event, true);
        renderStatus('견적 후 중복 안내 생략', '같은 첫 안내를 이미 보냈습니다. 고객 답변을 기다립니다.');
        await markChatHandled(conversationId);
        await returnToChatList();
        return true;
      }
      const sent = await sendChatText(introMessage);
      if (!sent) {
        renderStatus('견적 후 첫 안내 입력창 대기', introMessage);
        state.retryAt = Date.now() + 1500;
        return true;
      }
      reportFollowupResult(event, conversationId, 'sent');
      await rememberSentReply(conversationId, introMessage);
      state.introReplyTrack[conversationId] = Date.now();
      await chrome.storage.local.set({ [INTRO_REPLY_TRACK_KEY]: state.introReplyTrack });
      bumpStat('firstReplyCandidates');
      bumpStat(/①/.test(introMessage) ? 'introVariantB' : 'introVariantA');
      bumpStat('repliesSent');
      await recordReplyTime();
      await queueNoReplyFollowup(event, conversationId);
      await markChatHandled(conversationId);
      await removePendingIntro(event, true);
      renderStatus('견적 후 첫 안내 완료', '고객 답변을 기다립니다.');
      await returnToChatList();
      return true;
    } finally {
      setBusy(false);
    }
  }

  // 채팅 목록에 숫자 배지가 붙은 대화가 있으면 그 방을 먼저 연다.
  // 목록의 카드 자체를 누르는 것보다 실제 대화 링크를 사용해야 새 메시지를 읽을 수 있다.
  async function processChatList() {
    if (!state.settings.enabled || state.busy || !isChatListPage()) return false;
    const links = [...document.querySelectorAll('a[href*="/pro/chats/"]')]
      .filter(excludeBot).filter(visible);
    const now = Date.now();
    const eligible = links.map(link => {
      const key = String((link.href || '').match(/\/pro\/chats\/([A-Za-z0-9_-]{3,})/i)?.[1] || '');
      const hiredByMe = /내\s*고용/.test(clean(link.textContent));
      return { link, key, unread: linkHasUnread(link), hiredByMe, signature: chatListSignature(link), previous: chatInspections[key] };
    }).filter(item => {
      if (!item.key || state.manualBlocks.has(item.key)) return false;
      if (/다른\s*고수.*고용/.test(clean(item.link.textContent))) return false;
      const workflowKnown = (state.workflowList || []).some(w => String(w?.conversationId || '') === item.key && !['completed', 'review_requested'].includes(String(w.stage || '')));
      if (state.hiredConversations[item.key] && !workflowKnown && !item.unread) return false;
      // 고객 답변이 실제로 도착해 숨고가 안 읽음으로 표시한 방만 연다.
      // 접속 상태, 상대 활동, 카드 문구 변경은 고객 답장이 아니므로
      // 미리보기 signature 변화만으로는 절대 방을 열지 않는다.
      return shouldOpenUnreadRoom(item, now);
    });
    // DOM 첫 카드에 고정되지 않도록 마지막 확인 시각이 오래된 방부터
    // 순환한다. 여러 고객이 동시에 답하면 한 방을 반복해서 여는 대신
    // 각 방을 한 번씩 확인한 뒤 다음 라운드로 넘어간다.
    eligible.sort((left, right) => Number(left.previous?.at || 0) - Number(right.previous?.at || 0));
    // 고용 완료 표시는 읽음 배지가 없어도 실제 거래가 성립했다는 숨고의
    // 공식 상태다. 최근 발송 견적과 정확히 연결되고 아직 작업이 없는 방만
    // 한 번 열어 시스템 상태를 확인한다. 오래된 과거 고용 건은 건드리지 않는다.
    if (!eligible.length) {
      const newestOwnHire = links.map(link => {
        const key = String((link.href || '').match(/\/pro\/chats\/([A-Za-z0-9_-]{3,})/i)?.[1] || '');
        return { link, key, hiredByMe: /내\s*고용/.test(clean(link.textContent)), signature: chatListSignature(link), previous: chatInspections[key] };
      }).find(item => item.key && item.hiredByMe && !state.manualBlocks.has(item.key)
        && now - Number(item.previous?.hireCheckAt || 0) >= 30000);
      if (newestOwnHire) {
        chatInspections[newestOwnHire.key] = { ...(newestOwnHire.previous || {}), signature: newestOwnHire.signature, at: now, hireCheckAt: now };
        await chrome.storage.local.set({ [CHAT_INSPECTED_KEY]: chatInspections });
        try {
          const response = await fetch(`http://127.0.0.1:8787/api/soomgo/summary?conversationId=${encodeURIComponent(newestOwnHire.key)}`, { cache: 'no-store', headers: { 'x-relay-bot': 'soomgo-chat-extension' }, signal: AbortSignal.timeout(8000) });
          const summary = response.ok ? await response.json() : null;
          const leads = Array.isArray(summary?.leads) ? summary.leads : [];
          const exactLead = leads.length === 1 ? leads[0] : null;
          const quoteAt = Date.parse(exactLead?.quoteEvidence?.at || exactLead?.createdAt || '');
          const recent = Number.isFinite(quoteAt) && now - quoteAt >= 0 && now - quoteAt <= 48 * 60 * 60 * 1000;
          const workflowExists = (summary?.workflows || []).some(workflow => String(workflow?.conversationId || '') === newestOwnHire.key
            && !['completed', 'cancelled', 'review_requested'].includes(String(workflow.stage || '')));
          if (exactLead?.quoteEvidence?.status === 'sent' && !exactLead.taskId && recent && !workflowExists) {
            eligible.push({ ...newestOwnHire, unread: false, platformHireConfirmed: true, recentHireRecovery: true });
          }
        } catch (_) {}
      }
    }
    // Soomgo sometimes exposes only the global "채팅 N" unread count and
    // omits the per-room badge. This also occurs before hire, so restricting
    // the fallback to own-hire rooms drops real customer questions. When
    // exactly one message is unread, select the most recent card whose preview
    // signature changed. The global count proves that one unread message exists
    // and the changed preview identifies the room without scanning every room.
    const globalUnreadCount = globalUnreadChatCount();
    if (globalUnreadCount === 0) {
      let changed = false;
      for (const [key, previous] of Object.entries(chatInspections)) {
        if (previous?.globalUnreadActive) {
          chatInspections[key] = { ...previous, globalUnreadActive: false };
          changed = true;
        }
      }
      if (changed) await chrome.storage.local.set({ [CHAT_INSPECTED_KEY]: chatInspections });
    }
    if (!eligible.length && globalUnreadCount === 1) {
      const changedRooms = links.map(link => {
        const key = String((link.href || '').match(/\/pro\/chats\/([A-Za-z0-9_-]{3,})/i)?.[1] || '');
        const hiredByMe = /내\s*고용/.test(clean(link.textContent));
        return { link, key, hiredByMe, signature: chatListSignature(link), previous: chatInspections[key], clockAt: chatListClockAt(link, now) };
      }).filter(item => item.key && !state.manualBlocks.has(item.key)
        && !/다른\s*고수.*고용/.test(clean(item.link.textContent))
        && item.signature !== item.previous?.signature
        && (!item.previous?.globalUnreadActive || item.signature !== item.previous?.signature))
        .sort((left, right) => right.clockAt - left.clockAt);
      const newestChanged = changedRooms[0] || null;
      if (newestChanged) eligible.push({ ...newestChanged, unread: true, globalUnreadFallback: true, platformHireConfirmed: newestChanged.hiredByMe });
    }
    // 설치·갱신 직후에는 기존 목록을 기준점으로만 저장한다. 그렇지 않으면
    // 과거의 모든 방을 새 문의로 오인해 하나씩 들어갔다 나오는 현상이 난다.
    let baselineChanged = false;
    links.forEach(link => {
      const key = String((link.href || '').match(/\/pro\/chats\/([A-Za-z0-9_-]{3,})/i)?.[1] || '');
      if (key && !chatInspections[key] && !linkHasUnread(link)) {
        chatInspections[key] = { signature: chatListSignature(link), at: now, unread: false };
        baselineChanged = true;
      } else if (key && chatInspections[key]?.unread === true && !linkHasUnread(link)) {
        chatInspections[key] = { ...chatInspections[key], unread: false };
        baselineChanged = true;
      }
    });
    if (baselineChanged) await chrome.storage.local.set({ [CHAT_INSPECTED_KEY]: chatInspections });
    // E: '견적서를 읽었습니다'가 목록 미리보기에 있고 그 뒤 고객 답장이 없는 방은
    // 목록에서 기다렸다가, 읽음 시각부터 10분이 지나면 그때 들어가 한 번만 보낸다.
    const quoteReadWaiting = !eligible.length ? links.map(link => {
      const key = String((link.href || '').match(/\/pro\/chats\/([A-Za-z0-9_-]{3,})/i)?.[1] || '');
      return { link, key, hiredByMe: /내\s*고용/.test(clean(link.textContent)), signature: chatListSignature(link), previous: chatInspections[key] };
    }).filter(item => item.key && !item.hiredByMe && !state.manualBlocks.has(item.key)
      && quoteReadNoticeIn(item.link.textContent)
      && ![...(state.seen || [])].some(key => String(key).startsWith(`quote-read:${item.key}:`))
      && !linkHasUnread(item.link)) : [];
    let quoteReadSeenChanged = false;
    for (const item of quoteReadWaiting) {
      const seenAt = Number(state.quoteReadSeen[item.key]?.at || 0);
      if (!seenAt || state.quoteReadSeen[item.key]?.signature !== item.signature) { state.quoteReadSeen[item.key] = { at: now, signature: item.signature }; quoteReadSeenChanged = true; }
      // 목록 시각(오전/오후 hh:mm)이 읽히면 그 시각을, 아니면 목록에서 처음 본 시각을 읽음 시각으로 쓴다.
      const clockAt = chatListClockAt(item.link, now);
      item.readAt = Math.min(Number(state.quoteReadSeen[item.key].at), clockAt < now - 60000 ? clockAt : Number(state.quoteReadSeen[item.key].at));
    }
    if (quoteReadSeenChanged) {
      const entries = Object.entries(state.quoteReadSeen).sort((a, b) => Number(b[1].at || 0) - Number(a[1].at || 0)).slice(0, 200);
      state.quoteReadSeen = Object.fromEntries(entries);
      await chrome.storage.local.set({ [QUOTE_READ_SEEN_KEY]: state.quoteReadSeen });
    }
    const quoteReadCandidate = quoteReadWaiting.find(item => now - item.readAt >= QUOTE_READ_FOLLOWUP_DELAY_MS) || null;
    if (!eligible.length && !quoteReadCandidate && quoteReadWaiting.length) {
      const soonest = Math.min(...quoteReadWaiting.map(item => item.readAt + QUOTE_READ_FOLLOWUP_DELAY_MS));
      renderStatus('견적 읽음 후속 · 목록에서 대기', `${Math.max(1, Math.ceil((soonest - now) / 60000))}분 뒤 한 번만 안내합니다.`);
    }
    let selected = eligible[0] || (quoteReadCandidate ? { ...quoteReadCandidate, unread: false, quoteReadNotice: true } : null);
    // 구버전이 방을 열어 읽음 상태로 만든 뒤 로컬 답변 한도에서
    // 중단된 메시지를 새 버전 최초 실행 때 한 번만 복구한다. 전체 방을
    // 순회하지 않고 목록 맨 위의 최신 상담방 하나만 확인한다.
    if (!selected && !state.startupMissedChatRecoveryDone) {
      state.startupMissedChatRecoveryDone = true;
      await chrome.storage.local.set({ [STARTUP_MISSED_CHAT_RECOVERY_KEY]: true });
      const latest = links.map(link => {
        const key = String((link.href || '').match(/\/pro\/chats\/([A-Za-z0-9_-]{3,})/i)?.[1] || '');
        return { link, key, unread: false, signature: chatListSignature(link), previous: chatInspections[key] };
      }).find(item => item.key && !state.manualBlocks.has(item.key) && !/내\s*고용|다른\s*고수.*고용/.test(clean(item.link.textContent)));
      if (latest) selected = latest;
    }
    if (!selected) return false;
    const { link: candidate, key } = selected;
    if (state.lastChatOpened?.key === key && Date.now() - state.lastChatOpened.at < 5000) return true;
    state.lastChatOpened = { key, at: Date.now() };
    chatInspections[key] = { signature: selected.signature, at: now, unread: Boolean(selected.unread), ...(selected.globalUnreadFallback ? { globalUnreadAt: now, globalUnreadActive: true } : {}) };
    await chrome.storage.local.set({ [CHAT_INSPECTED_KEY]: chatInspections });
    const shouldFollowQuoteRead = Boolean(selected.quoteReadNotice || quoteReadNoticeIn(candidate.textContent));
    const selectedAt = Date.now();
    const quoteReadAt = shouldFollowQuoteRead ? Number(selected.readAt || chatListClockAt(candidate, selectedAt)) : 0;
    state.chatPending = { ...(state.chatPending || {}), conversationId: key, manualOnly: false, platformHireConfirmed: Boolean(selected.hiredByMe), quoteReadNotice: shouldFollowQuoteRead, quoteReadId: shouldFollowQuoteRead ? `QREAD-${hash(`${key}|${selected.signature}`)}` : '', ...(shouldFollowQuoteRead ? { quoteReadAt, quoteReadDelayUntil: quoteReadAt + QUOTE_READ_FOLLOWUP_DELAY_MS } : {}), at: selectedAt };
    await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending });
    renderStatus(selected.hiredByMe ? '고용 고객 메시지 확인 중' : '새 고객 메시지 확인 중', clean(candidate.textContent).slice(0, 100));
    candidate.click();
    await sleep(500);
    return true;
  }

  async function returnToChatList() {
    const isListRoute = () => /^\/pro\/chats\/?$/i.test(location.pathname) && !findChatInput();
    const waitForList = async (timeoutMs = 1200) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (isListRoute()) return true;
        await sleep(100);
      }
      return isListRoute();
    };

    if (isListRoute()) {
      await setChatRoom('');
      return true;
    }

    // 먼저 숨고의 채팅 목록 링크 또는 명확한 뒤로가기 컨트롤을 누른다.
    // 브라우저 history.back()은 이전 탭/요청 상세로 빠질 수 있어 사용하지 않는다.
    const listLink = [...document.querySelectorAll('a[href]')]
      .filter(excludeBot).filter(visible)
      .find(el => {
        try { return new URL(el.href, location.href).pathname.replace(/\/$/, '') === '/pro/chats'; }
        catch (_) { return false; }
      });
    const back = [...document.querySelectorAll('button,[role=button],a')]
      .filter(excludeBot).filter(visible)
      .find(el => /^(뒤로|뒤로가기|이전|채팅\s*목록|back)$/i.test(clean(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`)));
    const navigationControl = listLink || back;
    if (navigationControl) navigationControl.click();
    if (await waitForList()) {
      await setChatRoom('');
      return true;
    }

    // 버튼이 아이콘뿐이거나 SPA가 클릭을 무시해도 요청 상세나 다른 화면에
    // 남지 않도록 채팅 목록 주소를 직접 연다. 방 상태는 목록 도착 뒤 지운다.
    renderStatus('채팅 목록으로 복귀 중', '답변 처리를 마치고 채팅 목록으로 이동합니다.');
    location.assign(`${location.origin}/pro/chats?filter=all&from=chatroom`);
    if (await waitForList(2200)) {
      await setChatRoom('');
      return true;
    }
    state.retryAt = Date.now() + 1500;
    renderStatus('채팅 목록 이동 재시도', '목록 도착을 확인하지 못해 다시 이동합니다.');
    return false;
  }

  // 봇이 연 채팅방이 로딩 실패나 시스템 알림 때문에 처리되지 않은 채
  // 남아 있지 않도록 회복한다. 진행 중인 고용·결과 전달·결제 액션이
  // 있으면 먼저 해당 작업을 끝낼 때까지 채팅방을 유지한다.
  async function recoverStalledChat() {
    if (!state.settings.enabled || state.busy || !/^\/pro\/chats\/[^/]+/i.test(location.pathname) || !state.chatPending) return false;
    const age = Date.now() - Number(state.chatPending.at || 0);
    if (age < 5000 || state.pendingHire) return false;
    const workflow = await getCurrentWorkflow(currentConversationId());
    if (workflow?.pendingDelivery || workflow?.pendingAction) return false;
    if (isChatPage(pageText())) return false;
    renderStatus('처리할 메시지 없음 · 채팅 목록으로 복귀', '대화방 로딩이 끝나지 않아 다음 요청을 확인합니다.');
    await returnToChatList();
    return true;
  }

  // 네트워크·SPA 전환이 끊겨 비동기 작업이 busy 상태로 남으면 이후
  // 감시 루프가 모든 방을 건너뛰는 문제가 생긴다.  진행 중인 Relay
  // 작업이 있으면 방을 유지하고, 일반 상담 방이면 목록으로 복귀한다.
  async function recoverBusyWatchdog() {
    if (!state.busy || !state.busySince || Date.now() - state.busySince < 60000) return false;
    const conversationId = currentConversationId();
    setBusy(false);
    state.retryAt = Date.now() + 1000;
    writeHeartbeat('채팅 비정상 처리 복구', true);
    renderStatus('채팅 처리 시간 초과 · 자동 복구', '멈춘 작업을 해제하고 다음 대화를 확인합니다.');
    if (conversationId && /^\/pro\/chats\/[^/]+/i.test(location.pathname)) {
      const workflow = await getCurrentWorkflow(conversationId);
      if (!workflow?.pendingDelivery && !workflow?.pendingAction) {
        await markChatHandled(conversationId);
        await returnToChatList();
      }
    }
    return true;
  }

  function isHiredConversation(text) {
    return Boolean(platformConfirmation('hire'));
  }

  async function markHiredConversation(conversationId) {
    const key = String(conversationId || location.pathname);
    state.hiredConversations[key] = Date.now();
    await chrome.storage.local.set({ [HIRED_CHATS_KEY]: state.hiredConversations });
    await returnToChatList();
  }

  function isSystemChatMessage(value) {
    const message = clean(value);
    // "고용 요청해도 될까요?" 같은 고객 질문을 시스템 알림으로
    // 오인해 버리지 않도록 자동 알림의 완료·도착 표현만 제외한다.
    const officialHireAlert = /숨고\s*알리미/i.test(message)
      && /고용(?:(?:이\s*)?(?:확정|완료)(?:되었|됐|됐어요|되었습니다|됐습니다)?|을\s*(?:확정|완료)했(?:어요|습니다))/i.test(message);
    const automaticNotice = /(?:고객님이\s*견적(?:서)?(?:을|를)?\s*읽었(?:습니다|어요)?|견적서?\s*(?:발송|보내)(?:이|가)?\s*(?:완료|되었|됐)|견적서?를?\s*확인(?:했|하셨)|요청서가?\s*(?:도착|등록)(?:했|되었)|알림톡|시스템\s*메시지|거래\s*상세\s*정보\s*(?:업데이트|확인)|고용\s*요청(?:이|를)?\s*(?:등록|전송|완료)(?:되었|됐)|일정\s*등록(?:이|를)?\s*(?:완료|전송)(?:되었|됐)|거래가\s*성사됐다면,?\s*고용을\s*요청해\s*주세요|고용\s*횟수와\s*고객\s*리뷰를\s*모두\s*챙길\s*수\s*있어요|날짜를\s*클릭하면\s*요청서\s*정보를[\s\S]*캘린더에\s*자동으로\s*입력|앱에서만\s*지원되는\s*기능|메시지를?\s*입력하세요|답변을?\s*빨리\s*받고\s*싶다면\s*채팅을?\s*보내보세요|숨고\s*페이\s*안전\s*결제|휴대폰\s*번호\s*또는\s*계좌번호를?\s*받으셨나요|직접\s*거래는\s*사기나\s*피싱\s*위험이\s*있을\s*수\s*있어요|서비스를\s*진행한다면\s*(?:일정을\s*등록|고용을\s*확정)하고,?\s*숨고에서\s*거래를\s*이어가세요)/i.test(message);
    const compensationNotice = /^고객이\s*48시간\s*동안\s*견적을\s*읽지\s*않아서[\s\S]*캐시를\s*보너스\s*캐시로\s*보상해드렸습니다[.!]?$/i.test(message);
    return !message || officialHireAlert || automaticNotice || compensationNotice;
  }

  function isChatUiPlaceholder(value) {
    const message = clean(value);
    if (!message) return true;
    return /(?:메시지를?\s*입력하세요|답변을?\s*빨리\s*받고\s*싶다면\s*채팅을?\s*보내보세요|숨고\s*페이\s*안전\s*결제|휴대폰\s*번호\s*또는\s*계좌번호를?\s*받으셨나요|직접\s*거래는\s*사기나\s*피싱\s*위험이\s*있을\s*수\s*있어요|서비스를\s*진행한다면\s*(?:일정을\s*등록|고용을\s*확정)하고,?\s*숨고에서\s*거래를\s*이어가세요|파일\s*첨부|채팅\s*퀵\s*메세지)/i.test(message);
  }

  function stripChatUiChrome(value) {
    return clean(String(value || '')
      .replace(/숨고\s*페이\s*안전\s*결제\s*잊지\s*않으셨죠\s*[😉🙂😊]?/gi, ' ')
      .replace(/휴대폰\s*번호\s*또는\s*계좌번호를?\s*받으셨나요\??/gi, ' ')
      .replace(/직접\s*거래는\s*사기나\s*피싱\s*위험이\s*있을\s*수\s*있어요\.?/gi, ' ')
      .replace(/서비스를\s*진행한다면\s*(?:일정을\s*등록|고용을\s*확정)하고,?\s*숨고에서\s*거래를\s*이어가세요\.?/gi, ' ')
      .replace(/답변을?\s*빨리\s*받고\s*싶다면\s*채팅을?\s*보내보세요/gi, ' ')
      .replace(/메시지를?\s*입력하세요/gi, ' ')
      .replace(/파일\s*첨부|채팅\s*퀵\s*메세지/gi, ' '));
  }

  function isSoomgoAdditionalFeeQuestion(value) {
    const text = clean(value);
    return /추가\s*(?:금|비용)|추가로/i.test(text)
      && /얼마|몇|어느\s*정도|금액|비용|요금|가격|발생|나오|안내|있나요/i.test(text)
      && !/(?:조건|범위|수정·?추가비용).{0,20}(?:모두\s*)?(?:확인|동의)/i.test(text);
  }

  // 0.3.17: 고객 메시지 안의 사진·파일을 찾는다. 프로필 사진·이모티콘처럼 작은
  // 이미지는 제외한다. 실제 파일은 답변 요청 직전에 loadAttachments가 가져온다.
  function messageAttachments(node) {
    const found = [];
    const seen = new Set();
    for (const img of node.querySelectorAll?.('img') || []) {
      const src = img.currentSrc || img.src || '';
      if (!/^(?:https?:|blob:)/i.test(src) || seen.has(src)) continue;
      if (img.closest?.('[class*="profile" i], [class*="avatar" i], [class*="emoticon" i], [class*="sticker" i], button')) continue;
      const rect = img.getBoundingClientRect?.() || { width: 0, height: 0 };
      const width = Math.max(rect.width || 0, img.naturalWidth || 0);
      const height = Math.max(rect.height || 0, img.naturalHeight || 0);
      if (width < 80 || height < 80) continue;
      seen.add(src);
      found.push({ kind: 'image', url: src, name: clean(img.getAttribute('alt') || '').slice(0, 80) || '사진' });
    }
    for (const link of node.querySelectorAll?.('a[href]') || []) {
      const href = link.href || '';
      const label = clean(`${link.getAttribute('download') || ''} ${link.textContent || ''}`);
      if (seen.has(href) || !/^(?:https?:|blob:)/i.test(href)) continue;
      if (!link.hasAttribute('download') && !/\.(?:pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip|txt|jpe?g|png|mp3|m4a|wav|mp4)(?:$|[?#\s])/i.test(`${href} ${label}`)) continue;
      seen.add(href);
      found.push({ kind: /\.(?:jpe?g|png|gif|webp)(?:$|[?#\s])/i.test(`${href} ${label}`) ? 'image' : 'file', url: href, name: label.slice(0, 120) || '파일' });
    }
    return found.slice(0, 3);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(reader.error || new Error('read_failed'));
      reader.readAsDataURL(blob);
    });
  }

  // 큰 사진은 가로·세로 1600px 이하 JPEG로 줄여 보낸다(Claude 이미지 한도 대비).
  async function shrinkImage(blob) {
    if (blob.size <= 1.5 * 1024 * 1024 && /image\/(?:jpeg|png|webp|gif)/.test(blob.type)) return blob;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85)) || blob;
  }

  async function loadAttachments(list = []) {
    const loaded = [];
    for (const item of (Array.isArray(list) ? list : []).slice(0, 3)) {
      const urlName = (() => { try { return decodeURIComponent(new URL(item.url).pathname.split('/').pop() || ''); } catch (_) { return ''; } })();
      const name = /\.[a-z0-9]{2,5}$/i.test(item.name || '') ? item.name : (/\.[a-z0-9]{2,5}$/i.test(urlName) ? urlName : item.name);
      const entry = { kind: item.kind, name, mediaType: '', data: '', error: '' };
      try {
        const response = await fetch(item.url, { credentials: 'include', signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`http_${response.status}`);
        let blob = await response.blob();
        if (/^image\//.test(blob.type)) blob = await shrinkImage(blob);
        if (blob.size > 20 * 1024 * 1024) throw new Error('too_large');
        entry.mediaType = blob.type || '';
        // 사진·PDF·워드·한글·파워포인트·엑셀·텍스트는 서버로 넘긴다(서버가 글자를 뽑거나 Claude가 본다).
        const readableFile = /^image\//.test(entry.mediaType) || /pdf|officedocument|hwp|hancom|text\/(?:plain|csv)/i.test(entry.mediaType)
          || /\.(?:pdf|docx|pptx|xlsx|hwpx?|txt|csv|srt|jpe?g|png|webp|gif)(?:$|[?#\s])/i.test(`${item.name} ${item.url}`);
        if (readableFile) entry.data = await blobToBase64(blob);
        else entry.error = 'unsupported_type';
      } catch (error) {
        entry.error = String(error?.name === 'TimeoutError' ? 'timeout' : error?.message || 'fetch_failed').slice(0, 80);
      }
      loaded.push(entry);
    }
    return loaded;
  }

  function latestIncomingMessage(text, options = {}) {
    const selectors = [
      '[id^="message-"]:not([id*="chat-date"])', '[data-message-id]', '[data-messageid]',
      '.message-box:not(.my-message):not(.outgoing):not(.sent)',
      '[class~="message"]:not(.my-message):not(.outgoing):not(.sent)',
      '[class*="message-box" i]:not([class*="sent" i]):not([class*="outgoing" i])',
      '[class*="chat-message" i]:not([class*="sent" i]):not([class*="outgoing" i])'
    ];
    const canonical = '[id^="message-"]:not([id*="chat-date"]), [data-message-id], [data-messageid]';
    const candidates = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)])
      .map(node => node.closest(canonical) || node))]
      .filter(excludeBot).filter(visible).filter(node => {
        // 숨고의 입력창·결제 안내 컨테이너가 message-* ID를 공유하는
        // 경우가 있어, 입력 컨트롤을 품은 영역은 고객 메시지 후보에서
        // 제외한다.
        return !node.querySelector?.('textarea, input, [contenteditable="true"]')
          && !node.closest?.('textarea, input, [contenteditable="true"], form');
      }).map(node => {
        const marker = `${node.className || ''} ${node.getAttribute('data-direction') || ''}`.toLowerCase();
        const id = String(node.id || '').toLowerCase();
        const mine = node.getAttribute('data-mymessage') === 'true' || node.closest?.('[data-mymessage="true"]');
        const content = node.querySelector?.('[data-name="content"]') || node.querySelector?.('[data-name="content-body"], [data-name="message-body"], .message-content, .message-text');
        const attachments = messageAttachments(content || node);
        const rawValue = stripChatUiChrome(content?.innerText || content?.textContent || node.innerText || node.textContent).slice(0, 1800);
        const value = attachments.length && rawValue.length < 2
          ? attachments.map(file => (file.kind === 'image' ? '[사진]' : `[파일] ${file.name}`)).join(' ')
          : rawValue;
        const explicitMessage = Boolean(content || /^message-/.test(id) || node.hasAttribute('data-message-id') || node.hasAttribute('data-messageid') || /message-box|chat-message/.test(marker));
        const outgoing = /sent|outgoing|mine|self|내가|보낸|my-message/.test(marker) || /^(?:outgoing|sent|self)$/i.test(String(node.getAttribute('data-direction') || ''));
        return { node, id: node.getAttribute('data-message-id') || node.getAttribute('data-messageid') || node.id || '', text: value, attachments, marker, mine: Boolean(mine || outgoing), explicitMessage };
      }).filter(item => {
        const shortAcknowledgement = /^(?:네|예|응|어|넵|넹|ㅇㅇ|ㅇㅋ|ok|okay|yes|yep|sure)[.!?~\s]*$/i.test(item.text);
        return item.explicitMessage && !/chat-date/.test(item.id)
          && (item.text.length >= 2 || shortAcknowledgement) && item.text.length <= 1800
          && !isChatUiPlaceholder(item.text);
      });
    const unique = new Map();
    candidates.forEach(item => {
      const key = item.id ? `id:${item.id}` : `text:${item.text}`;
      if (!unique.has(key) || item.text.length < unique.get(key).text.length) unique.set(key, item);
    });
    const nodes = [...unique.values()].sort((left, right) => {
      if (left.node === right.node) return 0;
      return left.node.compareDocumentPosition(right.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    const conversationId = location.href.match(/(?:chat|conversation|room)[^/=?]*[/?=]([A-Za-z0-9_-]{3,})/i)?.[1] || location.pathname || 'soomgo-chat';
    // 마지막 메시지만 고르면 봇이 잠시 꺼져 있던 동안 쌓인 질문 중
    // 앞선 추가금 문의를 건너뛸 수 있다. 미처리 메시지를 순서대로
    // 확인하되, 추가금 질문은 어떤 뒤이은 짧은 메시지보다 우선한다.
    const lastOutgoing = nodes.reduce((last, message, index) => message.mine ? index : last, -1);
    const allIncoming = nodes.filter(message => !message.mine && !isSystemChatMessage(message.text));
    const incoming = options.includeReplied ? allIncoming : allIncoming.filter(message => nodes.indexOf(message) > lastOutgoing);
    const item = options.includeReplied
      ? incoming[incoming.length - 1]
      : options.preferUnhandled
      ? (() => {
        const unhandled = incoming.filter(message => {
          const id = message.id || `MSG-${hash(`${conversationId}|${message.text}${message.attachments?.length ? `|${message.attachments[0].url}` : ''}`)}`;
          return !state.seen.has(`reply:${conversationId}:${id}`);
        });
        return unhandled.find(message => isSoomgoAdditionalFeeQuestion(message.text)) || unhandled[unhandled.length - 1];
      })()
      : incoming[incoming.length - 1];
    if (!item || item.mine || isSystemChatMessage(item.text)) return null;
    const history = nodes.filter(message => !isSystemChatMessage(message.text))
      .map(message => `${message.mine ? '[내 답변]' : '[고객]'} ${message.text.replace(/\s+/g, ' ')}`).join('\n').slice(-12000);
    return { ...item, conversationId: String(conversationId).slice(0, 160), messageId: item.id || `MSG-${hash(`${conversationId}|${item.text}${item.attachments?.length ? `|${item.attachments[0].url}` : ''}`)}`, conversationText: history };
  }

  function findChatInput() {
    const candidates = [
      ...document.querySelectorAll('textarea, [contenteditable="true"], input[placeholder*="메시지"], input[placeholder*="내용"]')
    ].filter(excludeBot).filter(visible);
    if (!candidates.length) return null;
    // 무조건 마지막 입력창을 고르면 검색창·이모지 입력 같은 다른 필드가
    // 추가됐을 때 고객 답변이 엉뚱한 곳으로 들어간다. 메시지 입력창임을
    // 알 수 있는 표시가 있으면 그것을 먼저 고른다.
    const composerHint = /메시지|내용|답장|입력/;
    const labelled = candidates.filter(el => composerHint.test(clean([
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('name')
    ].filter(Boolean).join(' '))));
    if (labelled.length) return labelled[labelled.length - 1];
    const editable = candidates.filter(el => el.tagName === 'TEXTAREA' || el.isContentEditable);
    if (editable.length) return editable[editable.length - 1];
    return candidates[candidates.length - 1];
  }

  async function generateReplyDraft(incoming = latestIncomingMessage(pageText(), { includeReplied: true })) {
    if (!isChatPage() || !incoming) {
      renderStatus('답변 생성 대기', '고객 대화방에서 고객 메시지를 확인한 뒤 다시 눌러 주세요.');
      return false;
    }
    if (state.busy) {
      renderStatus('답변 생성 대기', '현재 채팅 처리가 끝난 뒤 다시 눌러 주세요.');
      return false;
    }
    const input = findChatInput();
    if (!input) {
      renderStatus('답변 입력창을 찾지 못했습니다', '대화방이 완전히 열린 뒤 다시 눌러 주세요.');
      return false;
    }
    if (chatInputValue(input)) {
      renderStatus('작성 중인 답변이 있어요', '입력창 내용을 지우거나 전송한 뒤 답변 생성을 눌러 주세요. 기존 내용을 덮어쓰지 않았습니다.');
      return false;
    }
    setBusy(true);
    renderStatus('답변 초안 생성 중', incoming.text.slice(0, 100));
    try {
      const conversationQuote = state.workflow?.conversationId === incoming.conversationId
        ? state.workflow.quote : currentConversationQuote(incoming.conversationId);
      const response = await fetch(state.settings.replyEndpoint, { signal: AbortSignal.timeout(REPLY_FETCH_TIMEOUT_MS),
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' },
        body: JSON.stringify({
          conversationId: incoming.conversationId,
          messageId: `DRAFT-${incoming.messageId}-${Date.now()}`,
          message: incoming.text,
          conversationText: incoming.conversationText,
          url: location.href,
          quote: conversationQuote,
          hiredConversation: Boolean(state.workflow?.conversationId === incoming.conversationId || state.chatPending?.platformHireConfirmed || state.hiredConversations[incoming.conversationId] || platformConfirmation('hire')),
          workflowStage: String(state.workflow?.stage || '')
        })
      });
      const data = await response.json();
      if (!response.ok || !data.reply) throw new Error(data.error || '답변 엔진 응답 없음');
      if (data.reply.skip || data.reply.manualReview || !data.reply.autoSend || !data.reply.text) {
        renderStatus('자동 답변 대상이 아닙니다', data.reply.reason || '수동으로 확인해 주세요.');
        return false;
      }
      setValue(input, data.reply.text);
      await sleep(200);
      if (chatInputValue(input) !== clean(data.reply.text)) {
        renderStatus('초안 입력을 확인하지 못했습니다', '전송하지 않았습니다.');
        return false;
      }
      renderStatus('답변 초안을 입력했습니다 · 전송은 직접 확인', data.reply.text);
      return true;
    } catch (error) {
      renderStatus('답변 생성 실패', String(error.message || error).slice(0, 180));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function acknowledgeAstraRoomDelivery(eventId, status, evidence = {}) {
    try {
      const response = await fetch(state.settings.astraRoomDeliveryEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-chat-extension' },
        body: JSON.stringify({ eventId, status, evidence })
      });
      return response.ok;
    } catch (_) {
      return false;
    }
  }

  async function processAstraRoomOutbox() {
    if (!state.settings.enabled || state.busy || globalPaused()) return false;
    if (Date.now() - Number(state.roomOutboxCheckedAt || 0) < 3000) return false;
    state.roomOutboxCheckedAt = Date.now();
    let items = [];
    try {
      const response = await fetch(`${state.settings.astraRoomOutboxEndpoint}?limit=10`, {
        cache: 'no-store',
        headers: { 'x-relay-bot': 'soomgo-chat-extension' },
        signal: AbortSignal.timeout(4000)
      });
      const data = response.ok ? await response.json() : {};
      items = Array.isArray(data.items) ? data.items : [];
    } catch (_) {
      return false;
    }
    const event = items[0];
    if (!event) return false;
    const conversationId = String(event.payload?.conversationId || '');
    const eventId = String(event.eventId || '');
    const replyText = clean(event.response?.reply || '');
    if (!eventId || !/^\d{6,20}$/.test(conversationId) || !replyText) {
      if (eventId) await acknowledgeAstraRoomDelivery(eventId, 'skipped', { reason: 'invalid_outbox_event', at: new Date().toISOString() });
      return false;
    }

    if (currentConversationId() !== conversationId) {
      state.chatPending = { conversationId, astraRoomEventId: eventId, at: Date.now() };
      await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending });
      renderStatus('Astra 답변 전달 대화방 이동 중', `${conversationId} 고객의 최신 상태를 다시 확인합니다.`);
      location.href = `https://soomgo.com/pro/chats/${encodeURIComponent(conversationId)}?relayAstraRoom=${encodeURIComponent(eventId)}`;
      return true;
    }

    const text = pageText();
    if (state.manualBlocks.has(conversationId) || /다른\s*고수를\s*(?:고용|선택)|거래가\s*(?:종료|취소)|채팅방을\s*나갔/i.test(text)) {
      await acknowledgeAstraRoomDelivery(eventId, 'skipped', { reason: 'conversation_closed_or_blocked', at: new Date().toISOString(), url: location.href });
      renderStatus('Astra 답변 발송 생략', '거래 종료·다른 고수 고용·수동 차단 상태를 확인했습니다.');
      await returnToChatList();
      return true;
    }
    const latest = latestIncomingMessage(text, { includeReplied: true });
    const sourceMessageId = String(event.payload?.messageId || '');
    if (sourceMessageId && latest?.messageId && String(latest.messageId) !== sourceMessageId) {
      await acknowledgeAstraRoomDelivery(eventId, 'skipped', { reason: 'newer_customer_message_exists', latestMessageId: latest.messageId, at: new Date().toISOString(), url: location.href });
      renderStatus('Astra 답변 만료', '답변 생성 뒤 새 고객 메시지가 도착해 이전 문구를 보내지 않았습니다.');
      await returnToChatList();
      return true;
    }
    if (recentlySentReply(conversationId, replyText)) {
      await acknowledgeAstraRoomDelivery(eventId, 'skipped', { reason: 'reply_hash_already_sent', at: new Date().toISOString(), url: location.href });
      renderStatus('Astra 중복 답변 생략', '같은 답변을 이미 보냈습니다.');
      await returnToChatList();
      return true;
    }

    // 0.3.21: 같은 답변이 이미 방에 있으면(준희가 직접 보낸 경우 등) 다시 보내지 않는다.
    const replyHead = replyText.slice(0, 40);
    if (replyHead.length >= 12 && text.includes(replyHead)) {
      await acknowledgeAstraRoomDelivery(eventId, 'skipped', { reason: 'reply_text_already_in_room', at: new Date().toISOString(), url: location.href });
      renderStatus('이미 보낸 답변', '같은 내용이 채팅방에 이미 있어 다시 보내지 않았습니다.');
      await returnToChatList();
      return true;
    }
    setBusy(true);
    try {
      // 0.3.21: 대기열 답변에 파일(PPT 디자인 샘플 PDF)이 붙어 있으면 먼저 첨부한다. 실패하면 문구도 보내지 않는다.
      const attachmentName = clean(event.response?.fields?.ATTACHMENT || '');
      if (attachmentName) {
        const attached = await attachWorkflowFile({ fileUrl: `/api/soomgo/design-sample/${encodeURIComponent(attachmentName)}`, filename: attachmentName });
        if (!attached.attached) {
          await acknowledgeAstraRoomDelivery(eventId, 'skipped', { reason: `attachment_failed:${attached.reason || 'unknown'}`, at: new Date().toISOString(), url: location.href });
          renderStatus('샘플 파일 첨부 실패 · 수동 확인', `${attachmentName} 첨부를 확인하지 못해 문구도 보내지 않았습니다 (${attached.reason || 'unknown'}).`);
          await returnToChatList();
          return true;
        }
      }
      const sent = await sendChatText(replyText);
      if (!sent) {
        await acknowledgeAstraRoomDelivery(eventId, 'uncertain', { reason: 'send_result_uncertain', at: new Date().toISOString(), url: location.href });
        renderStatus('Astra 답변 전송 확인 필요', '중복 발송을 막기 위해 자동 재전송하지 않습니다.');
        return true;
      }
      await rememberSentReply(conversationId, replyText);
      await remember(`reply:${conversationId}:${sourceMessageId}`);
      reportReplyResult(conversationId, sourceMessageId, 'sent');
      await acknowledgeAstraRoomDelivery(eventId, 'sent', { at: new Date().toISOString(), url: location.href, replyHash: hash(replyText) });
      bumpStat('repliesSent');
      await recordReplyTime();
      renderStatus('Astra 고객 답변 완료', replyText);
      await markChatHandled(conversationId);
      await returnToChatList();
      return true;
    } finally {
      setBusy(false);
    }
  }

  function currentConversationQuote(conversationId) {
    if (String(state.currentQuote?.conversationId || '') === String(conversationId)) return state.currentQuote;
    // 다른 고객에게 마지막으로 보낸 견적을 이 방에 재사용하지 않는다.
    const card = document.querySelector('[data-message-type="ST_QUOTE"]');
    const amount = clean(card?.textContent || '').match(/(?:총|예상금액)\s*([\d,]+)\s*원/);
    return amount ? { conversationId, amount: Number(amount[1].replace(/,/g, '')) } : null;
  }

  function findChatSendButton() {
    return [...document.querySelectorAll('button,[role=button],a,img.btn-submit,img[alt*="전송" i],[class*="btn-submit" i],[class*="send" i]')].filter(excludeBot).filter(visible).reverse().find(el => {
      const label = clean(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
      const className = String(el.className || '');
      return /메시지\s*(보내기|전송)|전송|보내기/.test(label) || /btn-submit|send/.test(className);
    }) || null;
  }

  function findChatActionButton(pattern) {
    return [...document.querySelectorAll('button,[role=button],a')]
      .filter(excludeBot).filter(visible).find(el => {
        const label = clean(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`);
        return pattern.test(label) && !/취소|삭제|닫기/.test(label);
      }) || null;
  }

  const findHireButton = () => findChatActionButton(/고용\s*요청/);
  const findScheduleButton = () => findChatActionButton(/일정\s*등록/);

  function scheduleModalRoot() {
    const visibleDialogs = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="Modal"],[class*="overlay" i]')]
      .filter(excludeBot).filter(visible);
    const direct = visibleDialogs.find(el => /서비스\s*일정을\s*등록해\s*주세요|시작\s*(?:날짜|시간)|일정\s*등록/.test(clean(el.textContent || '')));
    if (direct) return direct;
    const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"],div,span,p')]
      .filter(excludeBot).filter(visible)
      .filter(el => {
        const value = clean(el.textContent || '');
        return value.length <= 120 && /서비스\s*일정을\s*등록해\s*주세요|시작\s*날짜\s*선택/.test(value);
      });
    const heading = headings.find(el => /시작\s*날짜\s*선택/.test(clean(el.textContent || ''))) || headings[0];
    if (!heading) return null;
    const dialog = heading.closest?.('[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="Modal"],[class*="overlay" i]');
    if (dialog && visible(dialog)) return dialog;
    let root = heading;
    for (let i = 0; i < 10 && root.parentElement; i += 1) {
      root = root.parentElement;
      const value = clean(root.textContent || '');
      if (value.length > 5000) continue;
      if (root.querySelectorAll('button,[role="button"]').length >= 2 && /시작\s*(?:날짜|시간)|일정\s*등록/.test(value)) return root;
    }
    return heading.parentElement;
  }

  function todayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function inferStartDate(text) {
    const value = clean(text);
    const now = new Date();
    const toIso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (/오늘/.test(value)) return toIso(now);
    if (/내일/.test(value)) { const date = new Date(now); date.setDate(date.getDate() + 1); return toIso(date); }
    if (/모레/.test(value)) { const date = new Date(now); date.setDate(date.getDate() + 2); return toIso(date); }
    const explicit = value.match(/(?:20)?(\d{2})\s*[년./-]\s*(\d{1,2})\s*[월./-]\s*(\d{1,2})\s*일?|(?:올해\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (!explicit) return '';
    const year = explicit[1] ? 2000 + Number(explicit[1]) : now.getFullYear();
    const month = Number(explicit[2] || explicit[4]);
    const day = Number(explicit[3] || explicit[5]);
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
    if (!explicit[1] && date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) date.setFullYear(date.getFullYear() + 1);
    return toIso(date);
  }

  function inferCustomerStartDate(conversationText, currentMessage = '') {
    const raw = String(conversationText || '');
    const marked = /\[고객\]/.test(raw);
    if (marked) {
      const customerParts = [...raw.matchAll(/\[고객\]\s*([\s\S]*?)(?=\n\s*\[(?:고객|내 답변)\]\s*|$)/g)]
        .map(match => clean(match[1] || '')).filter(Boolean);
      for (const part of [currentMessage, ...customerParts.reverse()]) {
        // 납품 마감일은 착수일이 아니다. 명시된 착수 일정만 선택한다.
        if (!/시작|착수/.test(part)) continue;
        const fromHistory = inferStartDate(part);
        if (fromHistory) return fromHistory;
      }
    }
    return /시작|착수/.test(currentMessage) ? inferStartDate(currentMessage) : '';
  }

  function dateFromElement(el) {
    const raw = clean([el?.getAttribute?.('data-date'), el?.getAttribute?.('data-day'), el?.getAttribute?.('data-value'), el?.getAttribute?.('aria-label'), el?.getAttribute?.('title'), el?.getAttribute?.('datetime'), el?.getAttribute?.('id'), el?.textContent].filter(Boolean).join(' '));
    const iso = raw.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
    if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
    const ko = raw.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    return ko ? `${ko[1]}-${String(ko[2]).padStart(2, '0')}-${String(ko[3]).padStart(2, '0')}` : '';
  }

  function calendarDateButton(root, targetIso) {
    const candidates = [...root.querySelectorAll('[data-date],[data-day],[data-value],[aria-label],button,[role="button"],li,td,div')]
      .filter(excludeBot).filter(visible)
      .filter(el => !/disabled|지난달|다음달/.test(`${String(el.className || '')} ${el.getAttribute?.('aria-disabled') || ''} ${el.textContent || ''}`.toLowerCase()) && !el.hasAttribute('disabled') && el.getAttribute?.('aria-disabled') !== 'true');
    const exact = candidates.filter(el => dateFromElement(el) === targetIso).sort((a, b) => clean(a.textContent || '').length - clean(b.textContent || '').length);
    if (exact[0]) return exact[0];
    // 날짜 속성이 없는 달력 셀은 현재 달 헤더와 숫자만 노출한다.
    const [year, month, day] = String(targetIso).split('-').map(Number);
    const header = clean(root.textContent || '').match(/(20\d{2})년\s*(\d{1,2})월/);
    if (!header || Number(header[1]) !== year || Number(header[2]) !== month) return null;
    return candidates.find(el => {
      const value = clean(el.textContent || '');
      return value.length <= 24 && new RegExp(`(?:^|\\s)${day}(?:\\s|$)`).test(value);
    }) || null;
  }

  function chooseTimeButton(root, startDate = todayIso(), now = new Date()) {
    const scope = root || document;
    const candidates = [...scope.querySelectorAll('button,[role="button"],li,[role="option"],[data-value],div')].filter(excludeBot).filter(visible);
    const timeLike = candidates.filter(el => {
      const value = clean(el.textContent || '');
      return value.length <= 40 && /(?:오전|오후)\s*\d{1,2}(?::\d{2})?|\b\d{1,2}:\d{2}\b/.test(value) && !/확인|닫기|취소|일정\s*등록/.test(value);
    }).sort((a, b) => clean(a.textContent || '').length - clean(b.textContent || '').length);
    if (!timeLike.length) return null;
    const toMinutes = value => {
      const match = value.match(/(오전|오후)?\s*(\d{1,2})(?::(\d{2}))?|\b(\d{1,2}):(\d{2})\b/);
      if (!match) return Number.POSITIVE_INFINITY;
      let hour = Number(match[2] || match[4]);
      const minute = Number(match[3] || match[5] || 0);
      if (match[1] === '오후' && hour < 12) hour += 12;
      if (match[1] === '오전' && hour === 12) hour = 0;
      return hour * 60 + minute;
    };
    const earliestAllowed = startDate > todayIso() ? 9 * 60 : Math.max(9 * 60, now.getHours() * 60 + now.getMinutes() + 30);
    return timeLike.filter(el => !el.disabled && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true')
      .sort((a, b) => toMinutes(clean(a.textContent || '')) - toMinutes(clean(b.textContent || '')))
      .find(el => toMinutes(clean(el.textContent || '')) >= earliestAllowed) || null;
  }

  async function completeScheduleForm(pending) {
    let root = scheduleModalRoot();
    if (!root) return false;
    let text = clean(root.textContent || '');
    const requestedDate = pending.startDate || todayIso();
    const startDate = requestedDate < todayIso() ? todayIso() : requestedDate;
    pending.startDate = startDate;
    if (/시작\s*날짜\s*선택/.test(text)) {
      const day = calendarDateButton(root, startDate);
      if (!day) {
        renderStatus('일정 날짜 대기', `${startDate} 날짜를 달력에서 찾는 중입니다.`);
        return false;
      }
      day.click();
      await sleep(350);
      const confirm = [...document.querySelectorAll('button,[role="button"]')].filter(excludeBot).filter(visible).find(el => /^확인$/.test(clean(el.textContent || '')) && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true');
      if (confirm) { confirm.click(); await sleep(450); }
      pending.scheduleDateSelected = true;
      await chrome.storage.local.set({ [PENDING_HIRE_KEY]: pending });
      return false;
    }
    if (/시작\s*날짜[\s\S]{0,40}선택해\s*주세요/.test(text)) {
      const trigger = [...root.querySelectorAll('button,[role="button"],div')]
        .filter(excludeBot).filter(visible)
        .filter(el => clean(el.textContent || '').length <= 120)
        .find(el => /시작\s*날짜[\s\S]{0,40}선택해\s*주세요/.test(clean(el.textContent || '')));
      if (!trigger) { renderStatus('일정 날짜 입력 대기', '시작 날짜 선택 영역을 찾는 중입니다.'); return false; }
      trigger.click();
      await sleep(350);
      return false;
    }
    // 숨고가 선택된 날짜를 "2026. 09. 16." 또는 "9월 16일"로
    // 표시하면 확장 프로그램 저장값이 유실되어도 화면을 진실값으로
    // 삼아 다음 단계로 진행한다.
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const dateReadyOnScreen = new RegExp(`${startYear}[^0-9]{0,5}0?${startMonth}[^0-9]{0,5}0?${startDay}`).test(text)
      || new RegExp(`${startMonth}\\s*월\\s*${startDay}\\s*일`).test(text);
    if (dateReadyOnScreen && !pending.scheduleDateSelected) {
      pending.scheduleDateSelected = true;
      await chrome.storage.local.set({ [PENDING_HIRE_KEY]: pending });
    }
    if (/시작\s*시간/.test(text) && /선택해\s*주세요/.test(text)) {
      const trigger = [...root.querySelectorAll('button,[role="button"],div')].filter(excludeBot).filter(visible).filter(el => clean(el.textContent || '').length <= 120).find(el => /시작\s*시간[\s\S]{0,30}선택해\s*주세요/.test(clean(el.textContent || '')));
      if (trigger) { trigger.click(); await sleep(350); }
      const timeRoot = scheduleModalRoot() || root;
      const time = chooseTimeButton(timeRoot, startDate);
      if (!time) { renderStatus('일정 시간 대기', '선택 가능한 시작 시간을 찾는 중입니다.'); return false; }
      time.click(); await sleep(350);
      const confirm = [...document.querySelectorAll('button,[role="button"]')].filter(excludeBot).filter(visible).find(el => /^확인$/.test(clean(el.textContent || '')) && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true');
      if (confirm) { confirm.click(); await sleep(450); }
      pending.scheduleTimeSelected = true;
      await chrome.storage.local.set({ [PENDING_HIRE_KEY]: pending });
      return false;
    }
    root = scheduleModalRoot() || root;
    text = clean(root.textContent || '');
    const register = [...root.querySelectorAll('button,[role="button"]')].filter(excludeBot).filter(visible).find(el => /일정\s*등록/.test(clean(el.textContent || '')) && !/고용/.test(clean(el.textContent || '')) && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true');
    const dateReady = !/시작\s*날짜[\s\S]{0,30}선택해\s*주세요/.test(text);
    const timeReady = !/시작\s*시간[\s\S]{0,30}선택해\s*주세요/.test(text);
    if (dateReady) pending.scheduleDateSelected = true;
    if (timeReady) pending.scheduleTimeSelected = true;
    await chrome.storage.local.set({ [PENDING_HIRE_KEY]: pending });
    if (register && dateReady && timeReady) { register.click(); await sleep(600); return true; }
    return false;
  }

  function chatInputValue(input) {
    if (!input) return '';
    return clean(input.isContentEditable ? input.textContent : input.value);
  }

  async function sendChatText(message) {
    if (!state.settings.enabled || globalPaused() || await serverPaused(true)) {
      if (controlState.sendOff) renderStatus('발송 끔 · 기록만', '숨고 고객 답장은 아스트라가 맡습니다. 채팅봇은 읽고 기록만 합니다.');
      return false;
    }
    // 다른 탭이 잠금을 넘겨받았으면 이 탭은 보내지 않는다(중복 발송 방지).
    try { if (automationGuard?.superseded?.()) { renderStatus('잠금 넘겨줌 · 발송 안 함', '다른 숨고 탭이 채팅봇을 이어받았습니다.'); return false; } } catch (_) {}
    const targetRoom = currentConversationId();
    const value = clean(message);
    if (!value) return false;
    // 같은 대화에서 연속 자동 발송은 두 번까지 허용한다. 세 번째는
    // 고객 답변이나 5분 경과 후 다시 시작하도록 잠시 보류한다.
    const burst = state.chatBurst[targetRoom] || { count: 0, at: 0 };
    if (Date.now() - Number(burst.at || 0) > 5 * 60 * 1000) burst.count = 0;
    if (burst.count >= 2) {
      renderStatus('연속 답변 상한 대기', '같은 채팅의 연속 자동 답변은 2회까지 보내고 세 번째부터 잠시 보류합니다.');
      return false;
    }
    const attemptKey = `chat:${targetRoom}:${hash(value)}`;
    let attempts = {};
    try { attempts = JSON.parse((await chrome.storage.local.get(CHAT_DELIVERY_ATTEMPTS_KEY))[CHAT_DELIVERY_ATTEMPTS_KEY] || '{}'); } catch (_) {}
    const previousAttempt = attempts[attemptKey];
    const previousStatus = String(previousAttempt?.status || '');
    const previousAge = Date.now() - Number(previousAttempt?.at || 0);
    // UNKNOWN은 영구 잠금이 아니다. 전송 결과를 확인하지 못한 뒤에도
    // 운영자가 화면을 확인하고 10분 후 재시도할 수 있어야 한다.
    const staleUnknown = previousStatus === 'UNKNOWN' && previousAge >= 10 * 60 * 1000;
    if (['DISPATCHING', 'SENT_CONFIRMED'].includes(previousStatus) || (previousStatus === 'UNKNOWN' && !staleUnknown)) {
      renderStatus('채팅 전송 보류', '같은 대화와 같은 내용의 이전 전송 상태가 확인되지 않아 자동 재전송하지 않습니다.');
      return false;
    }
    state.lastChatSendOutcome = 'not_sent';
    const input = findChatInput();
    if (!input) return false;
    // 즉시 전송 모드: 입력값 반영 확인에 필요한 최소 대기만 둔다.
    setValue(input, value);
    await sleep(250);
    // 숨고가 입력창 구조를 바꾸면 엉뚱한 곳에 입력한 채로 전송 버튼을
    // 눌러 빈 메시지나 잘못된 내용이 나갈 수 있다. 실제로 반영됐는지
    // 확인하고, 아니면 보내지 않는다.
    const entered = chatInputValue(input);
    if (!entered || entered !== value) {
      renderStatus('채팅 입력 확인 실패', '답변이 입력창에 반영되지 않아 전송하지 않았습니다. 입력창 선택자를 확인해 주세요.');
      writeHeartbeat('입력창 확인 필요');
      return false;
    }
    const send = findChatSendButton();
    if (!send) return false;
    if (currentConversationId() !== targetRoom || !state.settings.enabled || globalPaused() || await serverPaused(true)) return false;
    state.lastChatSendOutcome = 'uncertain';
    attempts[attemptKey] = { status: 'DISPATCHING', at: Date.now(), conversationId: targetRoom };
    await chrome.storage.local.set({ [CHAT_DELIVERY_ATTEMPTS_KEY]: attempts });
    send.click();
    await sleep(350);
    // 전송되면 입력창이 비워진다. 그대로 남아 있으면 전송되지 않은
    // 것으로 보고, 보냈다고 기록하지 않는다.
    let remaining = chatInputValue(input);
    if (remaining && remaining.slice(0, 20) === value.slice(0, 20)) {
      await sleep(500);
      remaining = chatInputValue(input);
      if (remaining && remaining.slice(0, 20) === value.slice(0, 20)) {
        renderStatus('채팅 전송 확인 실패', '전송 버튼을 눌렀지만 입력창이 비워지지 않았습니다. 전송 버튼 선택자를 확인해 주세요.');
        writeHeartbeat('전송 버튼 확인 필요');
        attempts[attemptKey] = { ...attempts[attemptKey], status: 'UNKNOWN', at: Date.now() };
        await chrome.storage.local.set({ [CHAT_DELIVERY_ATTEMPTS_KEY]: attempts });
        return false;
      }
    }
    state.lastChatSendOutcome = 'confirmed';
    state.chatBurst[targetRoom] = { count: burst.count + 1, at: Date.now() };
    attempts[attemptKey] = { ...attempts[attemptKey], status: 'SENT_CONFIRMED', at: Date.now() };
    await chrome.storage.local.set({ [CHAT_DELIVERY_ATTEMPTS_KEY]: attempts });
    return true;
  }

  async function attachWorkflowFile(delivery) {
    const targetRoom = currentConversationId();
    if (!state.settings.enabled || globalPaused() || await serverPaused(true)) return { attached: false, reason: "automation_paused" };
    const sources = Array.isArray(delivery?.files) && delivery.files.length
      ? delivery.files.map(file => ({ filename: file.name || file.filename, fileUrl: file.fileUrl || file.serverPath }))
      : delivery?.fileUrl ? [{ filename: delivery.filename, fileUrl: delivery.fileUrl }] : [];
    if (!sources.length || sources.some(file => !file.fileUrl)) return { attached: false, reason: 'result_file_missing' };
    const fileInputs = () => [...document.querySelectorAll('input[type="file"]')].filter(excludeBot).filter(el => !el.disabled);
    let inputsBefore = fileInputs();
    let input = inputsBefore[0] || null;
    if (!input) {
      const composer = findChatInput();
      const isAttachControl = el => {
        const svgText = [...(el.querySelectorAll?.('svg') || [])].map(svg => `${svg.getAttribute('aria-label') || ''} ${svg.getAttribute('data-testid') || ''} ${svg.getAttribute('class') || ''}`).join(' ');
        const meta = clean(`${el.textContent || ''} ${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('title') || ''} ${el.getAttribute?.('data-testid') || ''} ${el.getAttribute?.('class') || ''} ${svgText}`);
        return /파일\s*첨부|첨부|파일\s*보내기|attach|upload|paperclip|file.?add|add.?file|file.?upload/i.test(meta)
          && !/메시지\s*보내기|send|전송|submit/i.test(meta);
      };
      let attachButton = null;
      let root = composer;
      for (let depth = 0; root && depth < 7 && !attachButton; depth += 1, root = root.parentElement) {
        attachButton = [...root.querySelectorAll('button,[role="button"],label,a')].filter(excludeBot).filter(visible).find(isAttachControl) || null;
      }
      if (!attachButton && composer) {
        const composerRect = composer.getBoundingClientRect();
        for (let depth = 0, scope = composer.parentElement; scope && depth < 5 && !attachButton; depth += 1, scope = scope.parentElement) {
          const candidates = [...scope.querySelectorAll('button,[role="button"],label,a')].filter(excludeBot).filter(visible).filter(el => {
            if (!el.querySelector('svg,img,[class*="icon" i]')) return false;
            const rect = el.getBoundingClientRect();
            const meta = clean(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('data-testid') || ''}`);
            const nearLowerLeft = rect.right >= composerRect.left - 36 && rect.left <= composerRect.left + 128
              && rect.top >= composerRect.top - 28 && rect.top <= composerRect.bottom + 104;
            const compact = rect.width <= 76 && rect.height <= 76;
            return nearLowerLeft && compact && !/보내기|전송|send|메시지|고용|숨고페이|일정|닫기|취소/i.test(meta);
          });
          candidates.sort((a, b) => {
            const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
            const as = Math.abs(ar.left - composerRect.left) + Math.abs(ar.top - composerRect.bottom);
            const bs = Math.abs(br.left - composerRect.left) + Math.abs(br.top - composerRect.bottom);
            return as - bs;
          });
          attachButton = candidates[0] || null;
        }
      }
      if (!attachButton) attachButton = [...document.querySelectorAll('button,[role="button"],label,a')].filter(excludeBot).filter(visible).find(isAttachControl) || null;
      if (attachButton) {
        attachButton.click();
        const deadline = Date.now() + 2600;
        while (Date.now() < deadline) {
          await sleep(150);
          const candidates = fileInputs();
          input = candidates.find(el => !inputsBefore.includes(el)) || candidates[0] || null;
          if (input) break;
        }
      }
    }
    if (!input) return { attached: false, reason: 'file_input_not_found' };
    try {
      if (sources.length > 1 && !input.multiple) return { attached: false, reason: 'multiple_attachments_not_supported', filenames: sources.map(file => file.filename) };
      const transfer = new DataTransfer();
      const uploaded = [];
      for (const source of sources) {
        const url = /^https?:/i.test(source.fileUrl) ? source.fileUrl : `http://127.0.0.1:8787${source.fileUrl}`;
        const response = await fetch(url, { cache: 'no-store', headers: { 'x-relay-bot': 'soomgo-chat-extension' }, signal: AbortSignal.timeout(30000) });
        if (!response.ok) return { attached: false, reason: `file_download_${response.status}`, filename: source.filename };
        const blob = await response.blob();
        if (!blob.size) return { attached: false, reason: 'result_file_empty', filename: source.filename };
        const fallbackName = decodeURIComponent(String(source.fileUrl).split('/').pop() || 'relay-desk-result.bin');
        const filename = clean(source.filename || fallbackName) || fallbackName;
        transfer.items.add(new File([blob], filename, { type: blob.type || 'application/octet-stream', lastModified: Date.now() }));
        uploaded.push({ filename, size: blob.size });
      }
      if (transfer.files.length !== sources.length) return { attached: false, reason: 'multiple_attachments_not_supported', filenames: uploaded.map(file => file.filename) };
      if (currentConversationId() !== targetRoom || !state.settings.enabled || globalPaused() || await serverPaused(true)) return { attached: false, reason: "automation_paused_or_room_changed" };
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      const failurePattern = /용량.{0,30}(?:초과|제한)|업로드.{0,20}(?:실패|오류)|지원하지\s*않는\s*파일/;
      const startedAt = Date.now();
      let readySince = 0;
      let uploadText = '';
      let namesVisible = false;
      let selectedFiles = false;
      let uploadBusy = false;
      do {
        await sleep(250);
        uploadText = pageText();
        selectedFiles = uploaded.every(expected => [...(input.files || [])].some(item => item.name === expected.filename && Number(item.size) === Number(expected.size)));
        uploadBusy = [...document.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-state="uploading"],[class*="uploading" i]')]
          .filter(excludeBot).filter(visible).length > 0;
        if (failurePattern.test(uploadText)) return { attached: false, reason: 'file_upload_rejected', filenames: uploaded.map(file => file.filename) };
        namesVisible = uploaded.every(file => uploadText.includes(file.filename));
        if (!uploadBusy && (namesVisible || selectedFiles)) readySince ||= Date.now();
        else readySince = 0;
      } while (Date.now() - startedAt < 5000 && (!readySince || Date.now() - readySince < 900));
      // 숨고 화면은 첨부 미리보기에 파일명을 표시하지 않는 경우가 있다.
      // 파일 입력에 정확한 파일이 남아 있고 업로드 중/실패 표시가 없으면
      // 선택 이벤트가 접수된 것으로 보고, 메시지 전송 단계로 진행한다.
      if (uploadBusy || (!namesVisible && !selectedFiles)) {
        return { attached: false, reason: 'file_upload_unconfirmed', filenames: uploaded.map(file => file.filename) };
      }
      return { attached: true, filename: uploaded[0]?.filename || '', filenames: uploaded.map(file => file.filename), size: uploaded.reduce((sum, file) => sum + file.size, 0) };
    } catch (error) {
      return { attached: false, reason: String(error?.message || error || 'file_attach_failed').slice(0, 120) };
    }
  }

  function workflowFileInComposer(delivery, filename = delivery?.filename) {
    const expected = Array.isArray(filename) ? filename.map(clean).filter(Boolean) : Array.isArray(delivery?.files) && delivery.files.length ? delivery.files.map(file => clean(file.name || file.filename || '')).filter(Boolean) : [clean(filename || '')].filter(Boolean);
    if (!expected.length) return false;
    const selectedNames = new Set([...document.querySelectorAll('input[type="file"]')].filter(excludeBot).flatMap(input => [...(input.files || [])].map(file => file.name)));
    if (expected.every(name => selectedNames.has(name))) return true;
    const composer = findChatInput();
    let root = composer;
    for (let depth = 0; root && depth < 5; depth += 1, root = root.parentElement) {
      const content = clean(root.innerText || root.textContent);
      if (expected.every(name => content.includes(name))) return true;
    }
    return false;
  }

  async function finishWorkflowDelivery(current, delivery, attemptKeyValue, filename) {
    const filenames = Array.isArray(filename) ? filename : [filename || ''];
    await markAttempt(attemptKeyValue, { started: true, phase: 'sent', sent: true, kind: delivery.kind, filename: filenames[0] || '', filenames });
    const acknowledged = await acknowledgeWorkflowDelivery(current, delivery);
    if (!acknowledged) {
      renderStatus('결과 전달 기록 대기', '채팅 전송은 확인했습니다. Relay Desk 기록만 다시 저장합니다.');
      return true;
    }
    await clearAttempt(attemptKeyValue);
    bumpStat('repliesSent');
    await recordReplyTime();
    renderStatus(`${delivery.kind === 'first' ? '1차' : '최종'} 결과 전달 완료`, '결제 완료 시각을 기준으로 3시간 뒤 거래 확정 요청을 진행합니다.');
    await returnToChatList();
    return true;
  }

  function holdWorkflowDelivery(workflow, reason = 'attachment_unconfirmed') {
    if (!workflow?.id || !workflow?.pendingDelivery?.id) return;
    if (!state.workflowDeliveryHolds || typeof state.workflowDeliveryHolds !== 'object') state.workflowDeliveryHolds = {};
    const retryMs = isRetryableDeliveryReason(reason) ? 15000 : 120000;
    state.workflowDeliveryHolds[String(workflow.id)] = {
      deliveryId: String(workflow.pendingDelivery.id),
      reason: String(reason || 'attachment_unconfirmed').slice(0, 160),
      heldAt: Date.now(),
      retryAt: Date.now() + retryMs
    };
    chrome.storage.local.set({ [WORKFLOW_DELIVERY_HOLDS_KEY]: state.workflowDeliveryHolds }).catch(() => {});
  }

  async function requestSoomgoPayment(workflow) {
    const amount = Math.round(Number(workflow?.paymentAmount || workflow?.quote?.amount || 0));
    if (!amount) return { sent: false, reason: 'payment_amount_missing' };
    const openButton = findChatActionButton(/숨고\s*페이\s*요청|결제\s*요청/);
    if (!openButton) return { sent: false, reason: 'payment_button_not_found' };
    openButton.click();
    await sleep(600);
    const roots = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="Modal"],form')].filter(excludeBot).filter(visible);
    const root = roots.find(el => /숨고\s*페이|결제\s*요청|금액/.test(clean(el.textContent || ''))) || document;
    const amountInput = [...root.querySelectorAll('input')].filter(excludeBot).filter(visible).find(el => {
      const label = clean(`${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''} ${el.name || ''}`);
      return /금액|가격|결제|원/.test(label) || /number|tel/.test(String(el.type || ''));
    });
    if (!amountInput) return { sent: false, reason: 'payment_amount_input_not_found' };
    setValue(amountInput, String(amount));
    await sleep(250);
    if (Number(String(amountInput.value || '').replace(/[^0-9]/g, '')) !== amount) return { sent: false, reason: 'payment_amount_input_mismatch' };
    // 모달을 여는 "숨고페이 요청" 버튼이 화면에 그대로 남아 있으면 같은
    // 문구 규칙에 먼저 걸려, 전송 버튼 대신 열기 버튼을 다시 누르게 된다.
    // 열기 버튼을 제외하고, 모달이 나중에 그려지는 점을 고려해 마지막
    // 후보를 전송 버튼으로 본다.
    const submitCandidates = [...root.querySelectorAll('button,[role="button"]')]
      .filter(excludeBot).filter(visible)
      .filter(el => el !== openButton)
      .filter(el => {
        const label = clean(el.textContent || el.getAttribute('aria-label') || '');
        return /(?:숨고\s*페이|결제).*(?:요청|보내기)|요청하기|보내기|다음|확인/.test(label) && !/취소|닫기/.test(label) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
      });
    const submit = submitCandidates[submitCandidates.length - 1] || null;
    if (!submit) return { sent: false, reason: 'payment_submit_not_found' };
    if (!state.settings.enabled || globalPaused() || await serverPaused(true)) return { sent: false, reason: "automation_paused" };
    const beforeSubmitText = pageText();
    submit.click();
    await sleep(500);
    // 견적 발송과 같은 기준으로 실제 요청 결과를 확인한다. 클릭만으로
    // 성공 처리하면 실패했을 때 Relay Desk 기록이 어긋나고, 다음 주기에
    // 결제 요청이 한 번 더 나갈 수 있다.
    const successPattern = /결제\s*요청(?:을)?\s*(?:보냈|완료|전송(?:되었|됐))|숨고\s*페이\s*요청(?:을)?\s*(?:보냈|완료)|요청(?:이|을)?\s*전송(?:되었|됐)습니다/;
    const previousCount = (beforeSubmitText.match(new RegExp(successPattern.source, 'g')) || []).length;
    const hasNewConfirmation = () => (pageText().match(new RegExp(successPattern.source, 'g')) || []).length > previousCount;
    let confirmed = hasNewConfirmation();
    for (let attempt = 0; !confirmed && attempt < 5; attempt += 1) {
      await sleep(300);
      confirmed = hasNewConfirmation();
    }
    if (!confirmed) return { sent: false, uncertain: true, amount, reason: 'payment_result_unconfirmed' };
    return { sent: true, amount };
  }

  async function deliverWorkflow(workflow = null) {
    const current = workflow || await getCurrentWorkflow();
    if (!current) return false;
    state.workflow = current;
    const delivery = current.pendingDelivery;
    const unresolved = delivery && getAttempt(attemptKey(current, 'deliver', String(delivery.id)));
    if (unresolved?.started && !unresolved.sent && (current.stage === 'payment_ready' || current.stage === 'payment_requested' || current.paymentRequiredForDelivery)) {
      renderStatus('결과 전송·결제 상태 확인 필요', '이전 파일 전송이 불확실하여 추가 결제 요청과 중복 전송을 보류했습니다.');
      await returnToChatList();
      return true;
    }
    const paymentGatePending = Boolean(delivery && !delivery.deliveredAt && (
      current.paymentRequiredForDelivery === true
      || delivery.paymentRequired === true
      || current.stage === 'payment_ready'
      || current.stage === 'payment_requested'
    ));
    if (delivery && !delivery.deliveredAt && !paymentGatePending) {
      writeHeartbeat(`결과 전달 준비 · ${String(current.conversationId || current.id)} · ${String(delivery.filename || '파일명 미기록')}`, true);
    }
    // 결제 대기 상태에서는 이미 남아 있는 pendingDelivery의 전송 기록을
    // 재시도하지 않는다. 먼저 숨고페이 요청을 완료해야 하므로, 이 순서를
    // 뒤집지 않으면 봇이 "결과 전달 기록 재시도" 화면에 갇힌다.
    if (delivery && !delivery.deliveredAt && !paymentGatePending) {
      const readyAt = Date.parse(delivery.readyAt || '');
      if (Number.isFinite(readyAt) && readyAt > Date.now()) {
        const waitMinutes = Math.max(1, Math.ceil((readyAt - Date.now()) / 60000));
        renderStatus('결과 전달 예약 대기', `최종 검수 후 ${waitMinutes}분 뒤 고객에게 전송합니다. 파일을 먼저 보내지 않습니다.`);
        state.retryAt = readyAt;
        await returnToChatList();
        return true;
      }
      if (current.deliveryBlocked || current.formatIssue?.blocked || delivery.formatIssue?.blocked) {
        const issue = current.formatIssue || delivery.formatIssue;
        renderStatus('요청 파일 형식 불일치 · 전송 보류', `${issue?.message || '고객 요청 형식과 파일이 일치하지 않습니다.'} Relay Desk 의뢰 상세에서 형식을 수정하면 대기 목록에서 다시 시도합니다.`);
        await returnToChatList();
        return true;
      }
      if (!delivery.text) return false;
      // 파일을 이미 보냈는데 전달 기록만 실패한 경우에는 다시 첨부·발송하지
      // 않고 기록만 재시도한다. 이 검사가 없으면 1초 주기 루프가 같은
      // 결과 파일과 메시지를 고객에게 반복해서 보낸다.
      const deliveryAttemptKey = attemptKey(current, 'deliver', String(delivery.id));
      let previousDelivery = getAttempt(deliveryAttemptKey);
      // 이전 버전에서 CORS·SPA 전환 때문에 남은 첨부 준비 기록은
      // 실제 전송이 확인되지 않은 상태다. 오래된 미전송 기록을 그대로
      // 재사용하면 새 파일을 다시 붙이지 않고 목록으로만 돌아가므로,
      // 메시지 전송 불확실성만 보존하고 첨부 단계 기록은 안전하게
      // 재시도한다.
      // Unknown attachment delivery is never cleared merely because time elapsed.
      if (previousDelivery?.started && !previousDelivery.sent) {
        const filenames = Array.isArray(previousDelivery.filenames) && previousDelivery.filenames.length
          ? previousDelivery.filenames : [String(previousDelivery.filename || delivery.filename || '')];
        const fileStillAttached = previousDelivery.phase === 'file_attached' || !previousDelivery.phase
          ? workflowFileInComposer(delivery, filenames)
          : false;
        if (fileStillAttached) {
          renderStatus('첨부된 결과 메시지 재시도', '파일을 다시 첨부하지 않고 결과 안내 메시지만 확인해 보냅니다.');
          const retried = await sendChatText(delivery.text);
          if (!retried) {
            if (state.lastChatSendOutcome === 'uncertain') {
              await markAttempt(deliveryAttemptKey, { started: true, phase: 'message_send_uncertain', reason: '전송 버튼을 눌렀지만 메시지 발송을 확인하지 못했습니다.', filename: filenames[0] || '', filenames });
              renderStatus('결과 파일 전송 수동 확인', '메시지 발송 상태가 불확실합니다. 중복 발송을 막았습니다. 채팅 기록과 Relay Desk 파일을 확인해 주세요.');
            } else {
              renderStatus('파일 첨부 완료 · 메시지 전송 대기', '채팅 전송을 시작하지 못해 메시지만 다시 시도합니다. 같은 파일은 다시 첨부하지 않습니다.');
            }
            return true;
          }
          return finishWorkflowDelivery(current, delivery, deliveryAttemptKey, filenames);
        }
        const reason = String(previousDelivery.reason || '이전 시도의 첨부·전송 완료를 확인하지 못했습니다.');
        const requestedFormat = clean(current.request?.format || '요청 형식 미기록');
        const artifactName = clean(delivery.filename || '파일명 미기록');
        renderStatus('결과 파일 전달 미확인', `${reason} 의뢰 형식은 ${requestedFormat}, Relay Desk 산출물은 ${artifactName}입니다. 숨고 채팅에서 첨부 도착 여부를 확인해 주세요. 확인 전에는 중복 전송하지 않습니다. 파일: ${delivery.fileUrl || ''}`);
        holdWorkflowDelivery(current, reason);
        await returnToChatList();
        return true;
      }
      if (previousDelivery?.sent) {
        const reacknowledged = await acknowledgeWorkflowDelivery(current, delivery);
        if (reacknowledged) {
          await clearAttempt(deliveryAttemptKey);
          renderStatus('결과 전달 기록 완료', '이미 보낸 결과의 전달 기록만 저장했습니다.');
          await returnToChatList();
        } else {
          renderStatus('결과 전달 기록 재시도', '결과는 이미 보냈습니다. 중복 발송 없이 기록만 다시 저장합니다.');
        }
        return true;
      }
      renderStatus(`${delivery.kind === 'first' ? '1차' : '최종'} 결과 전달 중`, 'Relay Desk에서 작업 결과를 가져와 고객 채팅으로 보냅니다.');
      await markAttempt(deliveryAttemptKey, { started: true, phase: 'preparing_attachment', filename: delivery.filename || '' });
      const attachment = await attachWorkflowFile(delivery);
      if (!attachment.attached) {
        const retrySafe = isRetryableDeliveryReason(attachment.reason);
        if (retrySafe) await clearAttempt(deliveryAttemptKey);
        else await markAttempt(deliveryAttemptKey, { started: true, phase: 'attachment_uncertain', reason: `숨고 파일 첨부 확인 실패 (${attachment.reason || 'unknown'})`, filename: delivery.filename || '' });
        const requestedFormat = clean(current.request?.format || '요청 형식 미기록');
        const filename = clean(delivery.filename || '파일명 미기록');
        renderStatus(retrySafe ? '결과 파일 첨부 재시도 대기' : '결과 파일 전달 미확인', retrySafe
          ? `첨부가 시작되지 않아 안전하게 다시 시도합니다: ${attachment.reason}. 요청 형식 ${requestedFormat}, 결과 파일 ${filename}.`
          : `첨부 여부를 확인하지 못해 고객 메시지 전송을 진행하지 않았습니다 (${attachment.reason}). 요청 형식은 ${requestedFormat}, Relay Desk 결과 파일은 ${filename}입니다. 파일: ${delivery.fileUrl || ''}`);
        writeHeartbeat(`결과 파일 첨부 실패 · ${attachment.reason || 'unknown'}`, true);
        holdWorkflowDelivery(current, attachment.reason || 'attachment_unconfirmed');
        // 단순히 파일 입력창이 늦게 그려진 경우에는 방을 닫으면 다시
        // 열고 닫는 동작만 반복된다. 재시도 가능한 실패는 같은 방에서
        // 잠시 기다린 뒤 첨부를 다시 시도한다.
        if (retrySafe) {
          state.retryAt = Date.now() + 2500;
          return true;
        }
        await returnToChatList();
        return true;
      }
      await markAttempt(deliveryAttemptKey, { started: true, phase: 'file_attached', filename: attachment.filename || delivery.filename || '', filenames: attachment.filenames || [attachment.filename || delivery.filename || ''] });
      const sent = await sendChatText(delivery.text);
      if (!sent) {
        if (state.lastChatSendOutcome === 'uncertain') {
          await markAttempt(deliveryAttemptKey, { started: true, phase: 'message_send_uncertain', reason: '전송 버튼을 눌렀지만 메시지 발송을 확인하지 못했습니다.', filename: attachment.filename || '', filenames: attachment.filenames || [] });
          renderStatus('결과 파일 전달 미확인', `파일 ${Array.isArray(attachment.filenames) ? attachment.filenames.join(', ') : attachment.filename || delivery.filename || ''}은 첨부됐지만 메시지 도착 여부를 확인하지 못했습니다. 숨고 채팅 기록을 확인해 주세요. 중복 전송은 보류했습니다.`);
          writeHeartbeat('결과 메시지 전송 확인 필요', true);
        } else renderStatus('파일 첨부 완료 · 메시지 전송 대기', '채팅 전송을 시작하지 못해 메시지만 다시 시도합니다. 같은 파일은 다시 첨부하지 않습니다.');
        if (state.lastChatSendOutcome === 'uncertain') {
          holdWorkflowDelivery(current, 'message_send_uncertain');
          await returnToChatList();
        } else {
          state.retryAt = Date.now() + 2500;
        }
        return true;
      }
      return finishWorkflowDelivery(current, delivery, deliveryAttemptKey, attachment.filenames || attachment.filename || '');
    }
    if (current.pendingAction === 'request_payment' && current.stage === 'payment_ready') {
      const paymentAttemptKey = attemptKey(current, 'payment');
      const previousPayment = getAttempt(paymentAttemptKey);
      // 이미 결제 요청을 눌렀다면 금액을 다시 입력해 보내지 않는다.
      // 서버 기록만 재시도하고, 계속 실패하면 사람이 확인하도록 남긴다.
      if (previousPayment?.clicked && !previousPayment.confirmed) {
        // 버튼은 눌렀지만 숨고의 발송 결과를 확인하지 못한 상태다.
        // 다시 누르지도, 완료로 기록하지도 않고 사람 확인으로 남긴다.
        renderStatus('숨고페이 결과 수동 확인', `${Number(previousPayment.amount || 0).toLocaleString('ko-KR')}원 결제 요청 버튼을 눌렀지만 완료 표시를 확인하지 못했습니다. 숨고 화면에서 결과를 확인한 뒤 진행해 주세요.`);
        await returnToChatList();
        return true;
      }
      if (previousPayment?.clicked) {
        const reconfirmed = await acknowledgeWorkflowAction(current, 'payment_requested', { amount: previousPayment.amount });
        if (reconfirmed) {
          await clearAttempt(paymentAttemptKey);
          renderStatus('숨고페이 요청 기록 완료', '이미 보낸 결제 요청의 기록을 저장했습니다.');
          await returnToChatList();
        } else {
          renderStatus('숨고페이 요청 수동 확인', `${Number(previousPayment.amount || 0).toLocaleString('ko-KR')}원 결제 요청은 이미 눌렀습니다. 중복 요청을 막기 위해 다시 보내지 않습니다. 숨고 화면에서 결과를 확인해 주세요.`);
          await returnToChatList();
        }
        return true;
      }
      // 금액이 걸린 동작이므로 서버의 최신 합계를 먼저 확인한다. 캐시된
      // 옛 금액으로 요청하면 고객이 잘못된 금액을 결제하게 된다.
      const fresh = await refreshWorkflow(current);
      if (!fresh || fresh.stage !== 'payment_ready' || fresh.pendingAction !== 'request_payment') {
        renderStatus('숨고페이 단계 재확인', '결제 단계 정보가 바뀌어 이번 주기에는 요청하지 않았습니다.');
        return true;
      }
      const paymentPlan = fresh.paymentPlan || null;
      const amount = Math.round(Number(paymentPlan?.requestAmount || fresh.paymentAmount || 0));
      const quoteAmount = Math.round(Number(fresh.quote?.amount || fresh.quote?.discounted || 0));
      const extras = (Array.isArray(fresh.additionalFees) ? fresh.additionalFees : [])
        .filter(item => item && item.accepted === true)
        .reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0)), 0);
      const sampleCredit = fresh.sampleOrder === true || String(fresh.orderType || fresh.order?.kind || '') === 'sample'
        ? 0 : Math.max(0, Number(fresh.sampleCreditAmount || fresh.sampleCredit?.amount || 0));
      const totalAmount = Math.max(0, quoteAmount + extras - Math.min(quoteAmount, sampleCredit));
      const expectedAmount = Math.max(0, Number(paymentPlan?.requestAmount || totalAmount));
      if (!amount || amount !== expectedAmount) {
        renderStatus('숨고페이 금액 확인 필요', `서버 요청액(${amount.toLocaleString('ko-KR')}원)과 현재 결제 단계 금액(${expectedAmount.toLocaleString('ko-KR')}원)이 달라 요청을 보내지 않았습니다.`);
        return true;
      }
      const paymentLabel = paymentPlan?.split ? (Number(paymentPlan.round || 1) >= 2 ? '잔금' : '착수금') : '전액';
      renderStatus('숨고페이 요청 중', `${paymentLabel} ${amount.toLocaleString('ko-KR')}원을 입력해 고객에게 요청합니다.`);
      await markAttempt(paymentAttemptKey, { clicked: true, amount });
      const payment = await requestSoomgoPayment(fresh);
      if (!payment.sent && !payment.uncertain) {
        // 전송 버튼까지 가지 못했으면 실제로 요청되지 않았으므로
        // 시도 기록을 지워 다음 주기에 정상적으로 다시 시도한다.
        await clearAttempt(paymentAttemptKey);
        renderStatus('숨고페이 입력 대기', `금액 입력·전송 화면을 확인 중입니다: ${payment.reason}`);
        return true;
      }
      if (payment.uncertain) {
        renderStatus('숨고페이 결과 확인 필요', '결제 요청 버튼은 눌렀지만 숨고의 완료 표시를 확인하지 못했습니다. 중복 요청 없이 사람이 확인할 수 있도록 남겨 둡니다.');
        await returnToChatList();
        return true;
      }
      await markAttempt(paymentAttemptKey, { clicked: true, confirmed: true, amount: payment.amount });
      const confirmed = await acknowledgeWorkflowAction(fresh, 'payment_requested', { amount: payment.amount });
      if (!confirmed) { renderStatus('숨고페이 요청 확인 대기', '결제 요청은 보냈습니다. 상태 기록만 다시 저장합니다.'); return true; }
      await clearAttempt(paymentAttemptKey);
      renderStatus('숨고페이 요청 완료', '고객 결제 완료 메시지를 기다립니다.');
      await returnToChatList();
      return true;
    }
    if (current.pendingAction === 'cancel_transaction' && current.stage === 'transaction_replacement_pending') {
      const cancelAttemptKey = attemptKey(current, 'transaction_cancel');
      const previousCancel = getAttempt(cancelAttemptKey);
      if (previousCancel?.clicked && !previousCancel.confirmed) {
        renderStatus('기존 거래 취소 확인 대기', '기존 숨고페이 거래 취소 버튼을 눌렀습니다. 중복 취소를 막기 위해 화면 확인을 기다립니다.');
        return true;
      }
      const cancelButton = [...document.querySelectorAll('button,[role="button"],a')]
        .filter(excludeBot).filter(visible).find(el => /거래\s*취소/.test(clean(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`)));
      if (!cancelButton) {
        renderStatus('기존 거래 취소 버튼 대기', '추가 작업을 시작하기 전에 기존 숨고페이 거래를 취소해야 합니다.');
        return true;
      }
      await markAttempt(cancelAttemptKey, { clicked: true });
      if (!state.settings.enabled || globalPaused() || await serverPaused(true)) return true;
      cancelButton.click();
      await sleep(500);
      const dialog = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="Modal"]')]
        .filter(excludeBot).filter(visible).at(-1) || document;
      const confirmCancel = [...dialog.querySelectorAll('button,[role="button"],a')]
        .filter(excludeBot).filter(visible).find(el => /거래\s*취소(?:하기|확정)?/.test(clean(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`)) && !/닫기/.test(clean(el.textContent || '')));
      if (!confirmCancel) {
        renderStatus('거래 취소 최종 확인 대기', '취소 확인 버튼을 찾지 못해 중복 실행을 막았습니다. 화면에서 취소 상태를 확인해 주세요.');
        return true;
      }
      if (!state.settings.enabled || globalPaused() || await serverPaused(true)) return true;
      confirmCancel.click();
      await sleep(700);
      const confirmed = await acknowledgeWorkflowAction(current, 'transaction_cancelled');
      if (!confirmed) {
        renderStatus('거래 취소 기록 대기', '숨고 거래 취소는 눌렀지만 Relay Desk 기록을 확인하지 못했습니다.');
        return true;
      }
      await markAttempt(cancelAttemptKey, { clicked: true, confirmed: true });
      renderStatus('기존 거래 취소 완료 · 새 숨고페이 준비', '최종금액으로 새 숨고페이 요청을 준비합니다.');
      await returnToChatList();
      return true;
    }
    if (current.pendingAction === 'request_transaction_confirmation' && current.stage === 'transaction_confirmation_wait') {
      const readyAt = Date.parse(String(current.transactionConfirmReadyAt || '')) || 0;
      if (readyAt > Date.now()) {
        const waitMinutes = Math.max(1, Math.ceil((readyAt - Date.now()) / 60000));
        renderStatus('거래 확정 요청 대기', `결제 완료 후 3시간이 지나야 요청할 수 있습니다. 약 ${waitMinutes}분 뒤 다시 확인합니다.`);
        state.retryAt = readyAt;
        await returnToChatList();
        return true;
      }
      const transactionAttemptKey = attemptKey(current, 'transaction_confirmation');
      const previousTransaction = getAttempt(transactionAttemptKey);
      if (previousTransaction?.clicked && !previousTransaction.confirmed) {
        renderStatus('거래 확정 요청 확인 대기', '거래 확정 요청 버튼을 눌렀지만 완료 표시를 확인하지 못했습니다. 중복 요청을 막았습니다.');
        return true;
      }
      const transactionButton = findChatActionButton(/거래\s*확정\s*요청/);
      if (!transactionButton) {
        renderStatus('거래 확정 요청 버튼 대기', '결제 완료 3시간이 지난 뒤 숨고의 거래 확정 요청 버튼을 확인합니다.');
        return true;
      }
      await markAttempt(transactionAttemptKey, { clicked: true });
      if (!state.settings.enabled || globalPaused() || await serverPaused(true)) return true;
      transactionButton.click();
      await sleep(700);
      const confirmed = await acknowledgeWorkflowAction(current, 'transaction_confirmation_requested');
      if (!confirmed) {
        renderStatus('거래 확정 요청 기록 대기', '숨고 버튼은 눌렀지만 Relay Desk 기록을 확인하지 못했습니다.');
        return true;
      }
      await markAttempt(transactionAttemptKey, { clicked: true, confirmed: true });
      const thanksMessage = await serverMessage('common.transaction_review_thanks.v1');
      const thanks = thanksMessage?.text || '';
      if (thanks && !recentlySentReply(current.conversationId, thanks)) {
        const sent = await sendChatText(thanks);
        if (sent) { await rememberSentReply(current.conversationId, thanks); bumpStat('repliesSent'); await recordReplyTime(); }
      }
      renderStatus('거래 확정 요청 완료', '감사 인사와 리뷰 요청을 안내했습니다.');
      await returnToChatList();
      return true;
    }
    if (current.pendingAction === 'request_review' && current.stage === 'review_requested') {
      const reviewAttemptKey = attemptKey(current, 'review');
      const previousReview = getAttempt(reviewAttemptKey);
      // 리뷰 요청도 고객에게 나가는 알림이므로 기록 실패로 반복 클릭되지
      // 않게 막는다.
      if (previousReview?.clicked) {
        const reconfirmed = await acknowledgeWorkflowAction(current, 'review_requested');
        if (reconfirmed) {
          await clearAttempt(reviewAttemptKey);
          renderStatus('리뷰 요청 기록 완료', '이미 보낸 리뷰 요청의 기록을 저장했습니다.');
          await returnToChatList();
        } else {
          renderStatus('리뷰 요청 수동 확인', '리뷰 요청은 이미 눌렀습니다. 중복 요청 없이 기록만 다시 저장합니다.');
        }
        return true;
      }
      const reviewButton = findChatActionButton(/리뷰\s*(?:요청|작성)|후기\s*(?:요청|작성)/);
      if (!reviewButton) {
        renderStatus('리뷰 요청 버튼 대기', '결제 완료 후 숨고의 리뷰 요청 버튼을 확인하고 있습니다.');
        return true;
      }
      await markAttempt(reviewAttemptKey, { clicked: true });
      if (!state.settings.enabled || globalPaused() || await serverPaused(true)) return true;
      reviewButton.click();
      await sleep(600);
      const confirmed = await acknowledgeWorkflowAction(current, 'review_requested');
      if (confirmed) { await clearAttempt(reviewAttemptKey); renderStatus('리뷰 요청 완료', '고객에게 리뷰를 요청하고 업무를 마쳤습니다.'); }
      else renderStatus('리뷰 요청 확인 대기', '리뷰 요청은 보냈습니다. 상태 기록만 다시 저장합니다.');
      if (confirmed) await returnToChatList();
      return true;
    }
    return false;
  }

  function platformConfirmation(kind, workflow = {}) {
    // 일반 대화·봇 답변은 플랫폼의 거래 증거가 아니다.
    const selector = '[data-message-type="system"],[data-type="system"],[data-name="system-message"],.system-message,[data-name="payment-status"],[data-name="hire-status"],[class*="SystemMessage"],[data-testid*="system-message"]';
    const nodes = [...new Set([
      ...document.querySelectorAll(selector),
      // 숨고 알리미는 일부 화면에서 전용 system 속성 없이 일반 대화 컨테이너로 렌더링된다.
      // 공식 알림 발신명과 확정 문구가 함께 있는 짧은 노드만 보조 후보로 쓴다.
      ...(kind === 'hire' ? [...document.querySelectorAll('div,li,p,span,section')].filter(node => {
        const value = clean(node.innerText || node.textContent);
        return value.length <= 320 && /숨고\s*알리미/.test(value) && /고용(?:이\s*확정(?:되었|됐|됐어요|되었습니다|됐습니다)|을\s*확정했(?:어요|습니다))/i.test(value);
      }) : [])
    ])].filter(excludeBot).filter(visible);
    for (const node of nodes.reverse()) {
      const value = clean(node.innerText || node.textContent);
      const officialHireAlert = kind === 'hire'
        && /숨고\s*알리미/.test(value)
        && /고용(?:이\s*확정(?:되었|됐|됐어요|되었습니다|됐습니다)|을\s*확정했(?:어요|습니다))/i.test(value);
      if (!officialHireAlert && node.closest('[data-mymessage],[data-direction="incoming"],[data-direction="outgoing"],.my-message')) continue;
      if (!(kind === 'payment' ? /결제|숨고\s*페이|환불/ : /고용/).test(value)) continue;
      if (kind === 'payment') {
        if (/예정|대기|아직|취소|실패|환불|[?？]|(?:완료|확정)(?:하면|시)/.test(value)) return null;
      } else if (!/고용(?:(?:이\s*)?(?:완료|확정)(?:되었|됐|됐어요|되었습니다|됐습니다)?|을\s*(?:완료|확정)했(?:어요|습니다))/i.test(value)
        || /고용.{0,30}(?:취소되|실패|거절|요청\s*대기)|고용\s*요청.{0,20}(?:예정|대기)|[?？]|(?:완료|확정)(?:하면|시)/.test(value)) {
        // 숨고의 "고용이 확정됐어요. ... 취소를 요청할 수 있어요" 알림은
        // 확정 상태다. 취소 가능 기간 안내의 '취소' 단어만으로 거부하지 않는다.
        return null;
      }
      const pattern = kind === 'payment' ? /(?:숨고\s*페이\s*)?결제(?:가)?\s*완료(?:되었|됐|되었습니다|됐습니다)?/ : /고용(?:(?:이\s*)?(?:완료|확정)(?:되었|됐|됐어요|되었습니다|됐습니다)?|을\s*(?:완료|확정)했(?:어요|습니다))/i;
      if (!pattern.test(value)) continue;
      if (kind === 'payment') {
        const expected = Number(workflow.paymentPlan?.requestAmount || workflow.paymentAmount || workflow.quote?.amount);
        const amounts = [...value.matchAll(/([\d,]+)\s*원/g)].map(m => Number(m[1].replace(/,/g, '')));
        const occurredAt = Date.parse(node.getAttribute('data-created-at') || node.getAttribute('datetime') || '');
        const requestedAt = Date.parse(workflow.paymentRequestedAt || '');
        if (!expected || !amounts.includes(expected) || !Number.isFinite(occurredAt) || !Number.isFinite(requestedAt) || occurredAt < requestedAt) continue;
      }
      return { text: value, source: 'soomgo_system' };
    }
    return null;
  }

  function hireWelcomeWasSent(conversationId) {
    const id = String(conversationId || '');
    const stableKey = `hire-welcome:${id}`;
    return state.introSentIds.includes(stableKey)
      || state.introSentIds.some(key => String(key).startsWith('hire-welcome:') && String(key).endsWith(`:${id}`));
  }

  async function rememberHireWelcome(conversationId) {
    const key = `hire-welcome:${String(conversationId || '')}`;
    state.introSentIds = [...new Set([...state.introSentIds, key])].slice(-200);
    await chrome.storage.local.set({ [INTRO_SENT_KEY]: state.introSentIds });
  }

  async function sendHireWelcome(workflow, page = '') {
    if (!workflow?.id || state.busy) return false;
    const conversationId = String(workflow.conversationId || currentConversationId());
    if (!conversationId || conversationId !== currentConversationId() || state.manualBlocks.has(conversationId)) return false;
    const listHireEvidence = state.chatPending?.platformHireConfirmed
      && String(state.chatPending.conversationId || '') === conversationId;
    const evidence = platformConfirmation('hire', workflow) || listHireEvidence;
    if (!evidence) return false;
    if (hireWelcomeWasSent(conversationId)) return false;
    if (/고용해 주셔서 감사합니다[.。]?/.test(String(page || '')) && /예상 소요일은/.test(String(page || ''))) {
      await rememberHireWelcome(conversationId);
      return false;
    }
    const days = clean(workflow.quote?.days || '당일~1일');
    const sampleOrder = String(workflow.orderType || workflow.order?.kind || '') === 'sample';
    const server = await serverMessage(sampleOrder ? 'common.sample_hire_greeting.v1' : 'common.hire_greeting.v1', { days, sampleScope: clean(workflow.quote?.sampleScope || '핵심 일부') });
    if (!server) { renderStatus('고용 인사 대기', '서버 문구를 받지 못해 보내지 않았습니다. 다음 확인 때 다시 시도합니다.'); return false; }
    const message = server.text;
    setBusy(true);
    try {
      const sent = await sendChatText(message);
      if (!sent) {
        renderStatus('고용 확정 인사말 입력 대기', message);
        state.retryAt = Date.now() + 2000;
        return false;
      }
      await rememberHireWelcome(conversationId);
      await recordReplyTime();
      bumpStat('repliesSent');
      renderStatus('고용 확정 인사말 전송 완료', `${days} · 동일 고용 건에는 다시 보내지 않습니다.`);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function sendHireWelcomeForConversation(conversationId) {
    const id = String(conversationId || '');
    const listHireEvidence = state.chatPending?.platformHireConfirmed && String(state.chatPending.conversationId || '') === id;
    if (!id || id !== currentConversationId() || (!platformConfirmation('hire') && !listHireEvidence)) return false;
    const workflows = await fetchWorkflows(id);
    const workflow = workflows[0] || null;
    if (!workflow) {
      renderStatus('고용 확정 인사말 대기', 'Relay Desk 업무가 등록되면 감사 인사와 예상 납기를 안내합니다.');
      return false;
    }
    state.workflow = workflow;
    state.workflowFetchedAt = Date.now();
    if (hireWelcomeWasSent(id)) return true;
    return (await sendHireWelcome(workflow, pageText())) || hireWelcomeWasSent(id);
  }

  async function detectPaymentCompletion(workflow, text) {
    if (!workflow || workflow.stage !== 'payment_requested') return false;
    // 시스템 요소·금액·요청 이후 시각을 함께 확인한다.
    // 이 증거를 노출하지 않는 화면에서는 자동 확정을 보류한다.
    const evidence = platformConfirmation('payment', workflow);
    if (!evidence) return false;
    const conversationId = String(workflow.conversationId || currentConversationId());
    const messageId = `SYSTEM-PAYMENT-${hash(`${conversationId}|${clean(text).slice(-600)}`)}`;
    try {
      const response = await fetch(state.settings.replyEndpoint, { signal: AbortSignal.timeout(REPLY_FETCH_TIMEOUT_MS),
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-chat-extension' },
        body: JSON.stringify({ conversationId, messageId, message: '숨고페이 결제 완료 확인', paymentEvidence: 'soomgo_system', conversationText: clean(text).slice(-3000) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) return false;
      if (data.reply?.autoSend && data.reply.text) {
        const sent = await sendChatText(data.reply.text);
        if (sent) {
          reportReplyResult(conversationId, messageId, 'sent');
          bumpStat('repliesSent');
          await recordReplyTime();
        }
      }
      state.paymentWatchAt[conversationId] = Date.now();
      renderStatus('결제 완료 확인 · 거래 확정 대기', '결제 완료 시각을 기록했습니다. 결과 전달 후 3시간이 지나면 거래 확정 요청을 진행합니다.');
      return true;
    } catch (_) {
      return false;
    }
  }

  function customerApprovedHire(text, incomingText = '') {
    const value = clean(`${text}\n${incomingText}`);
    if (!/(고용\s*요청|고용\s*신청|고용\s*하기)/i.test(value)) return false;
    return /(고용\s*(?:할게요?|하겠습니다|완료|확정|했습니다)|고용하기를?\s*눌렀|진행\s*(?:할게요?|하겠습니다)|확인했습니다|동의합니다|네[,\s!]*진행)/i.test(value);
  }

  async function finalizeRelayHire(pending) {
    if (!pending || pending.relayQueued) return true;
    const evidence = platformConfirmation('hire');
    if (!evidence) return false;
    const requestId = pending.requestId || state.currentQuote?.sourceRequestId || '';
    if (!requestId) {
      renderStatus('Relay Desk 연결 대기', '원래 요청 ID를 확인할 수 없어 고용 상태를 보존했습니다.');
      return false;
    }
    try {
      const response = await fetch(state.settings.hireEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' },
        body: JSON.stringify({
          requestId,
          conversationId: pending.conversationId,
          quote: pending.sampleOrder && pending.sampleQuote ? pending.sampleQuote : state.currentQuote,
          orderType: pending.sampleOrder ? 'sample' : 'full',
          sampleOrder: pending.sampleOrder === true,
          sampleCreditCode: String(pending.sampleCreditCode || ''),
          hireConfirmed: true,
          hireEvidence: { confirmed: true, source: evidence.source, at: new Date().toISOString(), note: evidence.text }
        })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Relay Desk 작업 생성 실패');
      pending.relayQueued = true;
      pending.customerApprovedAt = Date.now();
      await chrome.storage.local.set({ [PENDING_HIRE_KEY]: pending });
      renderStatus('고용 확정 · Relay Desk 작업 시작', data.task?.id ? `${data.task.id}를 AI 실행 큐에 등록했습니다.` : '고용 확정 내용을 Relay Desk 실행 큐에 등록했습니다.');
      bumpStat('hireQueued');
      return true;
    } catch (error) {
      renderStatus('Relay Desk 작업 연결 재시도 대기', String(error.message || error).slice(0, 160));
      state.retryAt = Date.now() + 3000;
      return false;
    }
  }

  async function queueConfirmedListHire(conversationId) {
    const pending = state.chatPending;
    if (!pending?.platformHireConfirmed || String(pending.conversationId) !== String(conversationId)) return false;
    if (pending.relayQueued) {
      // 재시도 중인 확정 업무는 인사말 전송 전에 대화방을 닫지 않는다.
      if (!await sendHireWelcomeForConversation(conversationId)) return true;
      await markHiredConversation(conversationId);
      return true;
    }
    if (Date.now() - Number(pending.hireQueueAttemptAt || 0) < 10000) return true;
    pending.hireQueueAttemptAt = Date.now();
    await chrome.storage.local.set({ [CHAT_ROOM_KEY]: pending });
    try {
      // 숨고의 공식 채팅 목록에 표시된 '내 고용'은 실제 거래 확정 상태다.
      // 채팅 주소와 일치하는 발송 완료 견적만 연결해 다른 요청의 견적을 재사용하지 않는다.
      const response = await fetch(`http://127.0.0.1:8787/api/soomgo/summary?conversationId=${encodeURIComponent(conversationId)}`, { cache: 'no-store', headers: { 'x-relay-bot': 'soomgo-chat-extension' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Relay Desk 요청 기록을 읽지 못했습니다.');
      const data = await response.json();
      const expectedPath = `/pro/chats/${encodeURIComponent(String(conversationId))}`;
      const matches = (Array.isArray(data.leads) ? data.leads : []).filter(lead => {
        if (lead?.quoteEvidence?.status !== 'sent') return false;
        try { return new URL(lead.quoteEvidence.url).pathname === expectedPath; } catch (_) { return false; }
      });
      if (matches.length !== 1) throw new Error(matches.length ? '이 채팅에 연결된 견적이 여러 개라 수동 확인이 필요합니다.' : '이 채팅에 연결된 발송 완료 견적을 찾지 못했습니다.');
      const lead = matches[0];
      if (lead.taskId) {
        pending.relayQueued = true;
        await chrome.storage.local.set({ [CHAT_ROOM_KEY]: pending });
        if (!await sendHireWelcomeForConversation(conversationId)) return true;
        await markHiredConversation(conversationId);
        renderStatus('고용 확정 작업 확인 완료', `${lead.taskId} 작업이 이미 Relay Desk에 연결되어 있습니다.`);
        return true;
      }
      const hireResponse = await fetch(state.settings.hireEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' },
        body: JSON.stringify({
          requestId: lead.requestId,
          conversationId,
          quote: lead.quote,
          hireConfirmed: true,
          hireEvidence: { confirmed: true, source: 'Soomgo 내 고용 표시', at: new Date().toISOString(), note: '숨고 채팅 목록에서 해당 대화의 공식 내 고용 상태를 확인하고, 연결된 발송 완료 견적과 대조했습니다.' }
        })
      });
      const result = await hireResponse.json();
      if (!hireResponse.ok || !result.ok) throw new Error(result.error || 'Relay Desk 작업 연결 실패');
      pending.relayQueued = true;
      await chrome.storage.local.set({ [CHAT_ROOM_KEY]: pending });
      state.workflow = null;
      state.workflowFetchedAt = 0;
      if (!await sendHireWelcomeForConversation(conversationId)) return true;
      await markHiredConversation(conversationId);
      bumpStat('hireQueued');
      renderStatus('숨고 고용 확정 · Relay Desk 작업 시작', result.task?.id ? `${result.task.id} 작업을 AI 실행 큐에 등록했습니다.` : '고용 확정 작업을 실행 큐에 등록했습니다.');
      return true;
    } catch (error) {
      renderStatus('고용 확정 확인 · 작업 연결 재시도', String(error.message || error).slice(0, 160));
      return false;
    }
  }

  async function processPendingHire() {
    const pending = state.pendingHire;
    if (!state.settings.enabled || !pending || !isChatPage(pageText()) || state.busy) return false;
    if (String(pending.conversationId) !== currentConversationId()) return false;
    // 이전 버전이 고객의 일반 질문을 고용 동의로 잘못 읽어 남긴 대기
    // 상태가 있으면 먼저 취소하고, 현재 고객 질문을 정상 답변 흐름으로
    // 넘긴다. 이 검사를 하지 않으면 추가비용·가능 여부 질문에서도
    // 일정 등록 창에 계속 머물 수 있다.
    const latestCustomer = latestIncomingMessage(pageText());
    const explicitConsent = latestCustomer && /(?:진행\s*(?:하겠습니다|할게요?|부탁드릴게요|해주세요|하죠)|고용\s*(?:하겠습니다|할게요?|하죠)|맡길게요?|이대로\s*진행|샘플.{0,20}(?:구매|신청|주문|진행|해주세요|할게요?))/i.test(latestCustomer.text || '');
    const pendingAge = Date.now() - Number(pending.at || 0);
    const scheduleOpen = Boolean(scheduleModalRoot());
    const staleWithoutCustomer = !latestCustomer && pendingAge > 30000 && !scheduleOpen;
    if (!platformConfirmation('hire') && ((latestCustomer && !explicitConsent && !customerApprovedHire(latestCustomer.text || '', latestCustomer.text || '')) || staleWithoutCustomer)) {
      state.pendingHire = null;
      await chrome.storage.local.remove(PENDING_HIRE_KEY);
      const modal = scheduleOpen ? scheduleModalRoot() : null;
      const close = modal && [...modal.querySelectorAll('button,[role="button"],a')]
        .filter(excludeBot).filter(visible)
        .find(el => /^(?:닫기|취소|×|✕)$/i.test(clean(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '')));
      if (close) close.click();
      renderStatus('고용 요청 보류', '고객의 추가 질문을 먼저 답변하고 조건이 확인될 때 다시 진행합니다.');
      return false;
    }
    if (!pending.hireClicked) {
      const hire = findHireButton();
      if (!hire) {
        renderStatus('고용 요청 버튼 대기', '고객이 네 가지 조건을 확정하면 채팅방의 고용 요청 버튼을 찾습니다.');
        return false;
      }
      hire.click();
      pending.hireClicked = true;
      await chrome.storage.local.set({ [PENDING_HIRE_KEY]: pending });
      renderStatus('고용 요청 확인 중', '고용 요청 창을 확인하고 일정 등록으로 이어갑니다.');
      await sleep(700);
    }
    if (!pending.scheduleClicked) {
      if (!pending.scheduleOpened) {
        const schedule = findScheduleButton();
        if (!schedule) {
          renderStatus('일정 등록 버튼 대기', '고용 요청이 열린 뒤 일정 등록 버튼을 찾습니다.');
          return false;
        }
        schedule.click();
        pending.scheduleOpened = true;
        await chrome.storage.local.set({ [PENDING_HIRE_KEY]: pending });
        renderStatus('일정 입력 중', '견적 기준 시작 날짜와 가능한 시간을 선택합니다.');
        await sleep(700);
      }
      // 저장된 상태는 열림인데 모달이 닫혔거나 SPA 전환으로 사라진
      // 경우 다시 일정 버튼을 열어 영구 대기 상태를 복구한다.
      if (pending.scheduleOpened && !scheduleModalRoot()) {
        const schedule = findScheduleButton();
        if (schedule) {
          schedule.click();
          pending.scheduleDateSelected = false;
          pending.scheduleTimeSelected = false;
          await chrome.storage.local.set({ [PENDING_HIRE_KEY]: pending });
          renderStatus('일정 입력 다시 시작', '닫힌 일정 창을 다시 열어 날짜와 시간을 선택합니다.');
          await sleep(700);
        }
      }
      const scheduleReady = await completeScheduleForm(pending);
      if (!scheduleReady) return true;
      pending.scheduleClicked = true;
      await chrome.storage.local.set({ [PENDING_HIRE_KEY]: pending });
      renderStatus('고용 요청·일정 등록 전송 완료', '고객님이 숨고 화면에서 고용하기를 눌러 최종 승인하면 됩니다.');
      await sleep(500);
    }
    if (pending.hireClicked && pending.scheduleClicked && !pending.relayQueued) {
      // 고용하겠다는 고객 발언과 플랫폼의 실제 확정 상태를 구분한다.
      const approved = Boolean(platformConfirmation('hire'));
      if (!approved) {
        renderStatus('고객 고용 승인 대기', '고객님이 숨고 화면에서 고용하기를 눌러 최종 승인하면 Relay Desk 작업을 시작합니다.');
        return true;
      }
      const queued = await finalizeRelayHire(pending);
      if (!queued) return true;
    }
    if (pending.hireClicked && pending.scheduleClicked && pending.relayQueued) {
      // 확정 직후 목록으로 복귀하면 고정 인사말을 보낼 기회를 잃는다.
      // Relay Desk 업무와 공식 확정 알림을 다시 대조해 전송 또는 재시도를 마친 뒤 복귀한다.
      if (!await sendHireWelcomeForConversation(pending.conversationId)) return true;
      state.pendingHire = null;
      await chrome.storage.local.remove(PENDING_HIRE_KEY);
      await markHiredConversation(pending.conversationId);
    }
    return true;
  }

  async function recordReplyTime() {
    state.replyTimes = [...state.replyTimes.filter(time => Date.now() - Number(time) < 24 * 60 * 60 * 1000), Date.now()];
    await chrome.storage.local.set({ [REPLY_TIMES_KEY]: state.replyTimes });
  }

  async function processChat() {
    const text = pageText();
    if (!isChatPage(text) || state.busy || Date.now() < state.retryAt) return false;
    const activeConversationId = currentConversationId();
    if (activeConversationId) writeHeartbeat(`채팅방 확인 · ${activeConversationId}`, true);
    // 수동 관리 표시는 일반 상담 답변만 멈추는 설정이다. 고객에게
    // 이미 약속한 고용 안내·1차/최종 결과 파일·결제 단계까지 막으면
    // Relay Desk 작업이 영구 대기하므로, 업무 단계는 먼저 확인한다.
    const activeWorkflow = await getCurrentWorkflow(activeConversationId);
    const workflowActionPending = Boolean(activeWorkflow && (activeWorkflow.pendingDelivery || activeWorkflow.pendingAction));
    if (activeWorkflow && workflowActionPending) {
      writeHeartbeat(`고용 업무 방 확인 · ${activeConversationId}`, true);
    }
    if (activeConversationId && state.manualBlocks.has(activeConversationId) && !workflowActionPending) {
      renderStatus('이 대화 수동 관리', '일반 자동 답변은 보내지 않지만, 결과 파일과 고용 단계가 있으면 그 단계만 처리합니다.');
      await returnToChatList();
      return true;
    }
    if (activeConversationId && platformConfirmation('hire') && !state.chatPending?.platformHireConfirmed) {
      state.chatPending = {
        ...(state.chatPending || {}),
        conversationId: activeConversationId,
        manualOnly: false,
        platformHireConfirmed: true,
        at: Date.now()
      };
      await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending });
    }
    if (state.chatPending?.manualOnly && String(state.chatPending.conversationId || '') === String(activeConversationId)) {
      // 구버전이 저장한 고용 고객 수동 전용 상태를 해제한다. 별도로
      // 지정한 manualBlocks는 위의 수동 차단 분기에서 그대로 유지한다.
      state.chatPending = { ...state.chatPending, manualOnly: false };
      await chrome.storage.local.set({ [CHAT_ROOM_KEY]: state.chatPending });
    }
    if (activeWorkflow && (activeWorkflow.pendingDelivery || activeWorkflow.pendingAction)) {
      // 고용 확정 직후의 감사 인사와 1차 결과 전달을 같은 체류에서
      // 이어서 처리한다. 인사말 하나가 성공했다고 여기서 반환하면
      // 결과 파일이 다음 감시 주기까지 밀리거나 전달되지 않을 수 있다.
      try {
        const welcomeHandled = await sendHireWelcome(activeWorkflow, text);
        writeHeartbeat(`고용 인사 확인 · ${activeConversationId} · ${welcomeHandled ? '처리됨' : '생략'}`, true);
        if (welcomeHandled) {
          state.workflow = null;
          state.workflowFetchedAt = 0;
        }
        // 같은 방에서 방금 읽은 최신 업무 객체를 그대로 사용한다. 두 번째
        // API 조회가 숨고 SPA 전환과 겹치면 결과 전달 단계가 조용히 끊길
        // 수 있어, 이미 확인된 pendingDelivery를 다시 조회하지 않는다.
        const deliveryWorkflow = activeWorkflow?.pendingDelivery || activeWorkflow?.pendingAction
          ? activeWorkflow
          : await getCurrentWorkflow(activeConversationId);
        if (deliveryWorkflow && (deliveryWorkflow.pendingDelivery || deliveryWorkflow.pendingAction)) {
          writeHeartbeat(`결과 전달 함수 실행 · ${activeConversationId}`, true);
          const handled = await deliverWorkflow(deliveryWorkflow);
          if (handled) return true;
        } else {
          writeHeartbeat(`결과 전달 단계 없음 · ${activeConversationId}`, true);
        }
      } catch (error) {
        writeHeartbeat(`결과 전달 처리 오류 · ${String(error?.message || error).slice(0, 140)}`, true);
        throw error;
      }
    } else if (activeWorkflow && await sendHireWelcome(activeWorkflow, text)) {
      return true;
    }
    if (activeWorkflow && await detectPaymentCompletion(activeWorkflow, text)) return true;
    if (state.chatPending?.platformHireConfirmed && !activeWorkflow && await queueConfirmedListHire(activeConversationId)) return true;
    if (await processQuoteReadFollowup()) return true;
    // 새 메시지가 여러 개 쌓여 있으면 미처리 문의부터 순서대로 답한다.
    // 추가금 문의는 뒤에 짧은 재촉 메시지가 와도 먼저 처리한다.
    const incoming = latestIncomingMessage(text, { preferUnhandled: true });
    if (!incoming) {
      if (state.chatPending && Date.now() - state.chatPending.at > 1200) {
        await markChatHandled(currentConversationId());
        await returnToChatList();
        return true;
      }
      return Boolean(state.chatPending);
    }
    // 고객이 새 메시지를 보내면 이전 자동 답변 연속 횟수를 초기화한다.
    // 따라서 고객 응답 뒤에는 다시 최대 두 번까지 즉시 답할 수 있다.
    if (incoming.conversationId) state.chatBurst[incoming.conversationId] = { count: 0, at: Date.now() };
    const key = `${incoming.conversationId}:${incoming.messageId}`;
    if (state.introReplyTrack[incoming.conversationId]) {
      bumpStat('firstReplyReceived');
      delete state.introReplyTrack[incoming.conversationId];
      await chrome.storage.local.set({ [INTRO_REPLY_TRACK_KEY]: state.introReplyTrack });
    }
    if (!state.chatPending || state.chatPending.conversationId !== incoming.conversationId || Date.now() - state.chatPending.at > 120000) {
      // 새로고침이나 2분 초과로 체류 기록이 끊겨도 현재 방을 다시
      // 채택해 이어서 처리한다. 이전에는 여기서 return false 로 빠져
      // 어떤 탈출 경로도 타지 못하고 방에 갇혔다.
      if (activeWorkflow) state.chatPending = { conversationId: incoming.conversationId, workflowId: activeWorkflow.id, workflowMode: true, at: Date.now() };
      else await setChatRoom(incoming.conversationId);
    }
    if (state.seen.has(`reply:${key}`)) {
      await markChatHandled(incoming.conversationId);
      await returnToChatList();
      return true;
    }
    const lastReplyAt = Number(state.lastChatReplyAt?.[incoming.conversationId] || 0);
    // 새 고객 메시지는 감지 즉시 처리한다. 같은 messageId·답변 해시는
    // seen/reply hash로 차단하므로 시간 기반 지연은 두지 않는다.
    // 메시지 수 자체로 답변을 차단하지 않는다. OpenAI 사용량과 비용은
    // Relay Desk 서버의 일일 토큰·비용 한도에서 통합 관리한다.
    setBusy(true);
    bumpStat('replyAttempts');
    bumpStat('customerReplies');
    renderStatus('고객 문의 분석 중', incoming.text.slice(0, 100));
    try {
      const conversationQuote = activeWorkflow?.quote || currentConversationQuote(incoming.conversationId);
      // 고객이 사진·파일을 보냈으면 내려받아 서버에 넘긴다. 서버가 Claude에게 판독을 맡긴다.
      let attachments = [];
      if (!activeWorkflow && incoming.attachments?.length) {
        renderStatus('고객 첨부 확인 중', `${incoming.attachments.length}개 파일을 Claude 판독용으로 가져옵니다.`);
        attachments = await loadAttachments(incoming.attachments);
      }
      const response = await fetch(state.settings.replyEndpoint, { signal: AbortSignal.timeout(REPLY_FETCH_TIMEOUT_MS),
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' },
        body: JSON.stringify({
          conversationId: incoming.conversationId,
          messageId: incoming.messageId,
          message: incoming.text,
          conversationText: incoming.conversationText,
          url: location.href,
          quote: conversationQuote,
          hiredConversation: Boolean(activeWorkflow || state.chatPending?.platformHireConfirmed || state.hiredConversations[incoming.conversationId] || platformConfirmation('hire')),
          workflowStage: String(activeWorkflow?.stage || ''),
          attachments
        })
      });
      const data = await response.json();
      if (!response.ok || !data.reply) throw new Error(data.error || '답변 엔진 응답 없음');
      if (data.duplicate) {
        // 서버가 이미 같은 메시지를 기록했으면 여러 탭·재시작이 겹쳐도 재전송하지 않는다.
        await remember(`reply:${key}`);
        await markChatHandled(incoming.conversationId);
        renderStatus('중복 문의 차단', '이미 처리한 메시지에는 다시 답장하지 않습니다.');
        await returnToChatList();
        return true;
      }
      const reply = data.reply;
      if (reply.skip) {
        bumpStat('repliesSkipped');
        await remember(`reply:${key}`);
        await markChatHandled(incoming.conversationId);
        renderStatus('불필요한 답변 생략', reply.reason || '확인성 메시지에는 자동 답변하지 않습니다.');
        await returnToChatList();
        return true;
      }
      if (reply.manualReview || !reply.autoSend) {
        bumpStat('repliesManual');
        bumpStat('manualEscalations');
        renderStatus(reply.pendingRoom ? 'Astra 고객대응실 답변 대기' : '고객 답변 수동 확인 대기', reply.reason || '범위·결제 관련 문의입니다.');
        await remember(`reply:${key}`);
        await markChatHandled(incoming.conversationId);
        await returnToChatList();
        return true;
      }
      const input = findChatInput();
      if (!input) { renderStatus('답변 입력창 대기', reply.text); state.retryAt = Date.now() + 1500; return true; }
      setValue(input, reply.text);
      await sleep(250);
      const send = findChatSendButton();
      if (!send) { renderStatus('답변 입력 완료 · 전송 버튼 대기', reply.text); state.retryAt = Date.now() + 1500; return true; }
      if (state.settings.autoReply) {
        if (recentlySentReply(incoming.conversationId, reply.text)) {
          await remember(`reply:${key}`);
          await markChatHandled(incoming.conversationId);
          renderStatus('중복 답변 생략', '같은 내용의 답변을 이미 보냈습니다. 고객의 새 질문을 기다립니다.');
          await returnToChatList();
          return true;
        }
        // 0.3.20: 답변에 파일이 붙어 있으면(PPT 디자인 샘플 PDF) 먼저 첨부한다. 첨부를 확인하지 못하면
        // '샘플 보내드립니다' 문구만 나가지 않도록 보내지 않고 사람 확인으로 남긴다.
        if (reply.attachment?.fileUrl) {
          renderStatus('샘플 파일 첨부 중', reply.attachment.filename || '');
          const attached = await attachWorkflowFile({ fileUrl: reply.attachment.fileUrl, filename: reply.attachment.filename });
          if (!attached.attached) {
            bumpStat('repliesManual');
            renderStatus('샘플 파일 첨부 실패 · 수동 확인', `${reply.attachment.filename || '샘플'} 첨부를 확인하지 못해 문구도 보내지 않았습니다 (${attached.reason || 'unknown'}). 숨고 채팅에서 직접 보내 주세요.`);
            writeHeartbeat(`샘플 첨부 실패 · ${attached.reason || 'unknown'}`, true);
            await remember(`reply:${key}`);
            await markChatHandled(incoming.conversationId);
            await returnToChatList();
            return true;
          }
        }
        const sent = await sendChatText(reply.text);
        if (!sent) {
        renderStatus('답변 전송 확인 필요', '입력·전송 성공을 확인하지 못했습니다. 중복 답변을 막기 위해 자동 재전송을 보류합니다.');
        writeHeartbeat('답변 전송 확인 필요');
        state.retryAt = Date.now() + 10 * 60 * 1000;
        await returnToChatList();
          return true;
        }
        reportReplyResult(incoming.conversationId, incoming.messageId, 'sent');
        await rememberSentReply(incoming.conversationId, reply.text);
        bumpStat('repliesSent');
        await remember(`reply:${key}`);
        await recordReplyTime();
        state.lastChatReplyAt[incoming.conversationId] = Date.now();
        await markChatHandled(incoming.conversationId);
        renderStatus('고객 자동 답변 완료', reply.text);
        if (reply.hireRequest) {
          state.pendingHire = {
            key,
            conversationId: incoming.conversationId,
            requestId: conversationQuote?.sourceRequestId || '',
            startDate: inferCustomerStartDate(incoming.conversationText, incoming.text) || todayIso(),
            expectedDays: conversationQuote?.days || '',
            sampleOrder: reply.sampleOrder === true || reply.orderType === 'sample',
            sampleQuote: reply.sampleQuote || null,
            sampleCreditCode: String(reply.sampleCreditCode || ''),
            sampleCreditAmount: Number(reply.sampleCreditAmount || 0),
            hireClicked: false,
            scheduleOpened: false,
            scheduleDateSelected: false,
            scheduleTimeSelected: false,
            scheduleClicked: false,
            relayQueued: false,
            at: Date.now()
          };
          await chrome.storage.local.set({ [PENDING_HIRE_KEY]: state.pendingHire });
          await processPendingHire();
        } else {
          // 일반 문의는 답변을 보낸 뒤 즉시 목록으로 돌아가야
          // 다음 고객을 확인하고 같은 방에 재답변하지 않는다.
          await returnToChatList();
        }
      }
      return true;
    } catch (error) {
      renderStatus('고객 답변 오류', String(error.message || error).slice(0, 160));
      state.retryAt = Date.now() + 5000;
      return false;
    } finally { setBusy(false); }
  }

  async function refreshReceivedRequests() {
    if (await serverPaused()) return;
    if (!state.settings.enabled || state.busy || globalPaused()) { if (globalPaused()) writeHeartbeat('전체 일시정지'); return; }
    if (!/\/requests\/received/.test(location.pathname) || isRequestDetail(pageText())) return;
    const interval = Math.max(30000, Number(state.settings.refreshMs) || 60000);
    if (Date.now() - state.lastRefreshAt < interval) return;
    state.lastRefreshAt = Date.now();
    renderStatus('받은 요청 목록 새로고침', `${Math.round(interval / 1000)}초 주기`);
    location.reload();
  }

  const automationGuard = globalThis.RelayAutomationGuard?.createGuard({
    role: 'chat',
    isPaused: async () => !state.settings.enabled || globalPaused() || await serverPaused(),
    onStatus: code => {
      if (code === 'locks-unavailable') renderStatus('중복 실행 방지 기능 확인 필요', '브라우저 잠금 기능이 없어 자동 동작을 멈췄습니다.');
      // 다른 숨고 탭이 채팅봇 실행 잠금을 쥐고 있으면 이 탭은 아무 동작도 하지
      // 않는다. 조용히 멈춘 것처럼 보이지 않게 상태를 표시한다.
      if (code === 'role-busy') renderStatus('다른 숨고 탭에서 채팅봇 실행 중', '이 탭은 대기합니다. 숨고 탭을 하나만 열어 두면 이 화면에서 바로 동작합니다.');
    }
  });
  async function loop() {
    if (!automationGuard) { renderStatus('봇 업데이트 필요', '중복 실행 방지 모듈을 불러오지 못해 자동 동작을 멈췄습니다.'); return; }
    try { return await automationGuard.run(guardedLoop); }
    catch (error) { renderStatus('봇 실행 보류', String(error?.message || error).slice(0, 120)); }
  }
  async function guardedLoop() {
    if (!state.settings.enabled || state.loopRunning || Date.now() < state.retryAt) return;
    if (globalPaused()) { renderStatus('전체 일시정지', '요청 봇과 고객 채팅 봇을 함께 멈췄습니다.'); writeHeartbeat('전체 일시정지'); return; }
    state.loopRunning = true;
    try {
      if (await serverPaused()) { renderStatus('서버 점검 · 자동 동작 정지', 'Relay Desk의 점검 정지가 해제되면 감시를 이어갑니다.'); return; }
      writeHeartbeat('감시 중');
      if (await recoverBusyWatchdog()) return;
      // 새 견적·업무 상태만으로 채팅방을 열거나 새로고침하지 않는다.
      // 고객의 실제 안 읽은 답장이 표시될 때만 processChatList가 방을 연다.
      if (await enforceRoomTimeout()) return;
      if (await recoverStalledChat()) return;
      if (await processPendingHire()) return;
      if (await refreshAfterAcceptedJob()) return;
      if (await processAstraRoomOutbox()) return;
      // 고객 답변보다 먼저 결과 전달·결제처럼 이미 고용된 업무의
      // 대기 액션을 처리한다. 목록에 읽지 않음 배지가 남아 있거나
      // 오래된 방이 위에 있어도 1차 결과 전달이 뒤로 밀리지 않는다.
      if (await processChatList()) return;
      if (await processWorkflowList()) return;
      if (isChatPage(pageText()) && latestIncomingMessage(pageText(), { preferUnhandled: true })) {
        if (await processChat()) return;
      }
      await processChat();
    } catch (error) {
      state.retryAt = Date.now() + 5000;
      renderStatus('채팅 확인 오류 · 재시도 예정', String(error.message || error).slice(0, 160));
      writeHeartbeat('채팅 확인 오류');
    } finally {
      state.loopRunning = false;
    }
  }

  // 되돌릴 수 없는 동작(결제·리뷰·결과 전달)의 중복 방지 규칙을 실제로
  // 실행해 검증하기 위한 시험용 통로다. 시험 코드가 먼저 전역 훅을
  // 설정한 경우에만 동작하므로 브라우저 실행에는 영향을 주지 않는다.
  if (typeof globalThis !== 'undefined' && typeof globalThis.__relaySoomgoChatTestHook === 'function') {
  globalThis.__relaySoomgoChatTestHook({ state, processWorkflowList, renderStatus, loop, deliverWorkflow, requestSoomgoPayment, loadSettings, attemptKey, getAttempt, markAttempt, clearAttempt, sendChatText, findChatInput, generateReplyDraft, latestIncomingMessage, isSystemChatMessage, quoteReadNoticeIn, quoteReadNoticeNode, processQuoteReadFollowup, refreshAfterAcceptedJob, isChatListPage, isChatUiPlaceholder, stripChatUiChrome, detectPaymentCompletion, inferCustomerStartDate, chooseTimeButton, platformConfirmation, shouldOpenUnreadRoom, processChatList, returnToChatList, workflowFileInComposer, finishWorkflowDelivery });
  }

  // 설정 저장소가 일시적으로 비어 있거나 확장 프로그램이 업데이트되는
  // 순간에도 패널이 사라지지 않도록 먼저 표시한다. 설정 복구가 실패해도
  // 사용자는 봇 상태를 보고 수동으로 재시도할 수 있어야 한다.
  if (typeof document?.getElementById === 'function' && typeof document?.createElement === 'function') makePanel();
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
    setInterval(roomWatchdog, 2000);
    loop();
  }).catch(error => {
    renderStatus('설정 복구 대기', `채팅봇 설정을 읽지 못했습니다. 새로고침 후 다시 시작합니다. ${String(error?.message || error).slice(0, 120)}`);
    writeHeartbeat('설정 복구 대기', true);
    setTimeout(() => location.reload(), 5000);
  });
})();
