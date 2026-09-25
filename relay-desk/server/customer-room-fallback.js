'use strict';

// 고객응대실 합치기(2026-09-22 준희 지시: "둘중 하나가 없으면 다른애가 대답하게").
// 고객 채팅은 먼저 Astra 고객응대실 대기열에 들어간다. Astra가 정해진 시간 안에 안 받으면
// 1) Claude가 답을 쓴다(서버 확정 초안의 금액·기간 숫자가 모두 그대로여야 통과).
// 2) Claude가 안 되면(키 없음·한도 초과·오류·검사 불합격) 서버의 검증된 정해진 문구로 보낸다.
// 3) 정해진 문구도 자동 발송 대상이 아니면 보내지 않고 사람 확인(ESCALATE)으로 둔다.
// 3시간 넘은 메시지, 숫자가 아닌 대화 ID(테스트 기록), 같은 방에 더 새 메시지가 있는 옛 메시지는 답하지 않고 닫는다(WAIT).
// 정책 파일 customerRoomFallback.enabled=false면 아무것도 하지 않는다(기존 흐름 그대로).

const chatTiming = require('./chat-timing');

const WORKER_ID = 'claude-fallback';
const MESSAGE_ID = 'claude.customer_reply.v1';
// 2026-09-24 지시 17: 월 한도를 기록에서 세므로 한 달치(하루 40건 × 31일)를 남긴다. 이전 500
const LOG_LIMIT = 1300;

function kstDay(ms = Date.now()) { return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); }

function readConfig(policy) {
  const raw = policy?.customerRoomFallback;
  if (!raw || raw.enabled !== true) return null;
  const cfg = {
    waitMs: Number(raw.waitSeconds ?? 60) * 1000,
    staleDispatchMs: Number(raw.staleDispatchMinutes ?? 10) * 60000,
    maxAgeMs: Number(raw.maxAgeHours ?? 3) * 3600000,
    perTick: Number(raw.perTick ?? 3),
    claudeEnabled: raw.claudeEnabled !== false,
    dailyMaxCalls: Number(raw.dailyMaxCalls),
    dailyBudgetKrw: Number(raw.dailyBudgetKrw),
    // 2026-09-24 지시 17(decisions 7-5): 월 한도(원). 없으면 월 한도 없음(기존 동작)
    monthlyBudgetKrw: raw.monthlyBudgetKrw === undefined ? Infinity : Number(raw.monthlyBudgetKrw),
    krwPerUsd: Number(raw.krwPerUsd),
    usdPerMillionInputTokens: Number(raw.usdPerMillionInputTokens),
    usdPerMillionOutputTokens: Number(raw.usdPerMillionOutputTokens),
    maxOutputTokens: Number(raw.maxOutputTokens || 400),
    // 2026-09-23 준희 지시: 모델은 정책 파일에서 정한다(없으면 서버 기본 모델).
    model: String(raw.model || '').trim(),
    timeoutMs: Number(raw.timeoutMs || 30000)
  };
  const ok = cfg.waitMs >= 0 && cfg.staleDispatchMs > 0 && cfg.maxAgeMs > 0 && Number.isInteger(cfg.perTick) && cfg.perTick > 0
    && Number.isInteger(cfg.dailyMaxCalls) && cfg.dailyMaxCalls >= 0 && cfg.dailyBudgetKrw >= 0 && cfg.krwPerUsd > 0
    && cfg.usdPerMillionInputTokens > 0 && cfg.usdPerMillionOutputTokens > 0 && cfg.maxOutputTokens > 0
    && cfg.monthlyBudgetKrw >= 0;
  return ok ? cfg : null;
}

function costKrw(cfg, inputTokens, outputTokens) {
  const usd = (Number(inputTokens || 0) * cfg.usdPerMillionInputTokens + Number(outputTokens || 0) * cfg.usdPerMillionOutputTokens) / 1e6;
  return Math.round(usd * cfg.krwPerUsd * 100) / 100;
}

// 2026-09-24 지시 20(decisions 7-7): 고객 첨부 판단(attachmentJudgeLog) 호출도 7-5 상한(하루 호출·금액·월 금액)에 같이 센다
function fallbackAndAttachmentLog(state) {
  return [...(Array.isArray(state?.customerRoomFallbackLog) ? state.customerRoomFallbackLog : []), ...(Array.isArray(state?.attachmentJudgeLog) ? state.attachmentJudgeLog : [])];
}

function monthUsage(state, now = Date.now()) {
  const month = kstDay(now).slice(0, 7);
  const log = fallbackAndAttachmentLog(state).filter(item => String(item.day || '').slice(0, 7) === month && item.called);
  return { calls: log.length, krw: log.reduce((sum, item) => sum + Number(item.krw || 0), 0) };
}

function todayUsage(state, now = Date.now()) {
  const day = kstDay(now);
  const log = fallbackAndAttachmentLog(state).filter(item => item.day === day && item.called);
  return { calls: log.length, krw: log.reduce((sum, item) => sum + Number(item.krw || 0), 0) };
}

// 외부 API로 보내기 전에 연락처·링크·인증정보를 가린다.
function redact(text) {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[이메일]')
    .replace(/(?:01[016789]|070|02|0[3-6][1-5])[-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[전화번호]')
    .replace(/\b(?:sk|pk|ghp|AIza|Bearer)[-_A-Za-z0-9.]{8,}\b/gi, '[인증정보]')
    .replace(/https?:\/\/\S+/g, '[링크]');
}

function responseText(decision, fields = {}) {
  const lines = ['[MODE:CUSTOMER_REPLY]', `[DECISION:${decision}]`];
  if (fields.source) lines.push(`[SOURCE:${fields.source}]`);
  if (fields.attachment) lines.push(`[ATTACHMENT:${fields.attachment}]`);
  if (fields.reason) lines.push(`[REASON:${String(fields.reason).replace(/[\]\n]/g, ' ').slice(0, 150)}]`);
  if (decision === 'SEND') lines.push('[REPLY]', String(fields.reply || '').trim());
  return lines.join('\n');
}

// 2026-09-24 지시 17(decisions 7-5): 한도를 넘으면 정해진 문구로도 보내지 않고 멈춘다(ESCALATE → 준희 알림).
const CAP_REASONS = new Set(['daily_call_cap', 'daily_budget_cap', 'monthly_budget_cap']);

function eventAt(value) { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? ms : 0; }

// 이번 차례에 맡을 이벤트 고르기: Astra가 정해진 시간 안에 안 받은 것, 받고도 오래 멈춘 것, 실패한 것.
// 9/24 지시 28: 예약 문구(안부 멘트·두 번째 통)는 이미 완료된 사건이라 여기서 다루지 않는다.
// 보낼 시각(payload.releaseAt, 받은 뒤 1분 30초~4분)이 있으면 그 시각이 된 뒤에 답을 쓴다.
function dueEvents(events, cfg, now) {
  return events.filter(event => {
    if (event.eventType !== 'customer_message' || event.payload?.kind) return false;
    if (event.status === 'pending') {
      const releaseAt = Date.parse(event.payload?.releaseAt || '');
      return Number.isFinite(releaseAt) ? now >= releaseAt : now - eventAt(event.createdAt) >= cfg.waitMs;
    }
    if (event.status === 'failed') return true;
    if (event.status === 'dispatched') return now - eventAt(event.claimedAt || event.updatedAt) >= cfg.staleDispatchMs;
    return false;
  }).sort((a, b) => eventAt(a.createdAt) - eventAt(b.createdAt));
}

function closeReason(event, events, cfg, now) {
  const conversationId = String(event.payload?.conversationId || '');
  if (!/^\d+$/.test(conversationId)) return 'test_or_invalid_conversation';
  if (now - eventAt(event.createdAt) > cfg.maxAgeMs) return 'older_than_max_age';
  const newer = events.some(other => other.eventId !== event.eventId && other.eventType === 'customer_message' && !other.payload?.kind
    && String(other.payload?.conversationId || '') === conversationId && eventAt(other.createdAt) > eventAt(event.createdAt));
  if (newer) return 'newer_customer_message_exists';
  return '';
}

// deps: { bridge, readPolicy, readState, writeState, runClaude, hasKey, cleanText, validReply, now? }
async function tick(deps) {
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const cfg = readConfig(deps.readPolicy());
  if (!cfg) return { enabled: false, handled: [] };
  const events = deps.bridge.list({ eventType: 'customer_message', limit: 500 });
  const due = dueEvents(events, cfg, now).slice(0, cfg.perTick);
  const handled = [];
  for (const event of due) {
    try {
      if (event.status === 'dispatched') deps.bridge.fail(event.eventId, 'claude_fallback_stale_dispatch');
      const claimed = deps.bridge.claim(event.eventId, WORKER_ID);
      if (claimed.duplicate) continue;
      const reason = closeReason(event, events, cfg, now);
      if (reason) {
        deps.bridge.complete(event.eventId, responseText('WAIT', { source: 'fallback_close', reason }));
        handled.push({ eventId: event.eventId, decision: 'WAIT', source: 'fallback_close', reason });
        continue;
      }
      const det = event.payload?.deterministicReply || {};
      const attachment = String(det.attachment || '');
      let claudeText = '';
      let claudeFailure = '';
      const usage = todayUsage(deps.readState(), now);
      const month = monthUsage(deps.readState(), now);
      if (!cfg.claudeEnabled) claudeFailure = 'claude_disabled';
      else if (!deps.hasKey()) claudeFailure = 'claude_key_missing';
      else if (usage.calls >= cfg.dailyMaxCalls) claudeFailure = 'daily_call_cap';
      else if (usage.krw >= cfg.dailyBudgetKrw) claudeFailure = 'daily_budget_cap';
      else if (month.krw >= cfg.monthlyBudgetKrw) claudeFailure = 'monthly_budget_cap';
      else if (!event.payload?.replyPrompt || !det.text) claudeFailure = 'prompt_missing';
      else {
        const log = { at: new Date(now).toISOString(), day: kstDay(now), eventId: event.eventId, conversationId: String(event.payload?.conversationId || ''), messageId: MESSAGE_ID, called: true };
        try {
          const result = await deps.runClaude(redact(event.payload.replyPrompt), { maxTokens: cfg.maxOutputTokens, timeoutMs: cfg.timeoutMs, ...(cfg.model ? { model: cfg.model } : {}) });
          log.model = result.model || '';
          log.inputTokens = Number(result.usage?.input_tokens || 0);
          log.outputTokens = Number(result.usage?.output_tokens || 0);
          log.krw = costKrw(cfg, log.inputTokens, log.outputTokens);
          const text = deps.cleanText(result.text);
          // 9/24 지시 28: 보내기 직전 AI 티 점검(이모지·점 나열·금지 말투·기계 말투·앞 답장과 같은 문장). 걸리면 보내지 않고 준희 알림
          const valid = deps.validReply(text, det.factsText ? `${det.text}\n${det.factsText}` : det.text, { requireNumbers: det.requireNumbers !== false, amountRange: det.amountRange || null });
          const tell = valid ? chatTiming.aiTellCheck(text, event.payload?.conversationText || '') : '';
          if (!valid) { claudeFailure = 'claude_reply_validation_failed'; log.passed = false; }
          else if (tell) { claudeFailure = `ai_tell:${tell}`; log.passed = false; log.tell = tell; }
          else { claudeText = text; log.passed = true; }
        } catch (error) {
          claudeFailure = String(error?.message || error).slice(0, 160);
          log.error = claudeFailure;
          log.passed = false;
        }
        const state = deps.readState();
        state.customerRoomFallbackLog = [log, ...(Array.isArray(state.customerRoomFallbackLog) ? state.customerRoomFallbackLog : [])].slice(0, LOG_LIMIT);
        deps.writeState(state);
      }
      const sendText = claudeText || (det.autoSend === true && det.text && !CAP_REASONS.has(claudeFailure) && !String(claudeFailure).startsWith('ai_tell:') ? det.text : '');
      const parts = sendText ? chatTiming.splitReply(sendText) : null;
      if (sendText && !parts) {
        // 120자 넘는데 문장 경계로 두 통을 못 만들면 보내지 않는다
        deps.bridge.complete(event.eventId, responseText('ESCALATE', { source: 'fallback', reason: 'reply_too_long' }));
        handled.push({ eventId: event.eventId, decision: 'ESCALATE', reason: 'reply_too_long' });
      } else if (sendText) {
        const source = claudeText ? 'claude' : 'deterministic';
        const whole = parts.length === 2 && typeof deps.bridge.enqueue !== 'function';
        deps.bridge.complete(event.eventId, responseText('SEND', { source, attachment, ...(claudeText ? {} : { reason: claudeFailure }), reply: whole ? sendText : parts[0] }));
        if (parts.length === 2 && !whole) {
          // 두 번째 통: 첫 통이 나간 뒤 20~40초
          const second = deps.bridge.enqueue({
            eventType: 'customer_message', caseId: String(event.caseId || event.payload?.conversationId || ''), idempotencyKey: `split:${event.eventId}`, source: WORKER_ID,
            payload: { conversationId: String(event.payload?.conversationId || ''), messageId: String(event.payload?.messageId || ''), kind: 'split_part', afterEventId: event.eventId, gapMs: chatTiming.splitGapMs(event.eventId) }
          });
          if (!second.duplicate) deps.bridge.complete(second.event.eventId, responseText('SEND', { source, reply: parts[1] }));
        }
        handled.push({ eventId: event.eventId, decision: 'SEND', source, ...(claudeText ? {} : { reason: claudeFailure }), parts: whole ? 1 : parts.length });
      } else {
        deps.bridge.complete(event.eventId, responseText('ESCALATE', { source: 'fallback', reason: claudeFailure || 'no_auto_send_reply' }));
        handled.push({ eventId: event.eventId, decision: 'ESCALATE', reason: claudeFailure || 'no_auto_send_reply' });
      }
    } catch (error) {
      handled.push({ eventId: event.eventId, error: String(error?.message || error).slice(0, 160) });
    }
  }
  return { enabled: true, handled };
}

function dailySummary(state, day = kstDay()) {
  const log = (Array.isArray(state?.customerRoomFallbackLog) ? state.customerRoomFallbackLog : []).filter(item => item.day === day && item.called);
  return { day, calls: log.length, passed: log.filter(item => item.passed).length, krw: Math.round(log.reduce((sum, item) => sum + Number(item.krw || 0), 0)) };
}

function capStatus(state, policy, now = Date.now()) {
  const cfg = readConfig(policy);
  if (!cfg || !cfg.claudeEnabled) return { enabled: false, capped: false };
  const today = todayUsage(state, now); const month = monthUsage(state, now);
  const reason = today.calls >= cfg.dailyMaxCalls ? 'daily_call_cap' : today.krw >= cfg.dailyBudgetKrw ? 'daily_budget_cap' : month.krw >= cfg.monthlyBudgetKrw ? 'monthly_budget_cap' : '';
  return { enabled: true, capped: Boolean(reason), reason, today, month, dailyMaxCalls: cfg.dailyMaxCalls, monthlyBudgetKrw: cfg.monthlyBudgetKrw };
}

module.exports = { CAP_REASONS, capStatus, monthUsage, WORKER_ID, MESSAGE_ID, readConfig, costKrw, todayUsage, redact, responseText, dueEvents, closeReason, tick, dailySummary, kstDay };
