const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VERSION = 1;
// production_draft / PRODUCTION_DRAFT (2026-09-23): PPT 슬라이드 내용 작성 — Codex 대화방 제작 경로(server/codex-production.js).
// subtitle_translation_draft / SUBTITLE_TRANSLATION (2026-09-23): 번역 자막 블록별 한국어 — server/codex-subtitle-translation.js.
const EVENT_TYPES = new Set(['customer_message', 'system_notice', 'ops_incident', 'production_review', 'production_draft', 'subtitle_translation_draft']);
const MODES = new Set(['CUSTOMER_REPLY', 'OPS_DIAGNOSIS', 'PRODUCTION_REVIEW', 'PRODUCTION_DRAFT', 'SUBTITLE_TRANSLATION', 'NO_ACTION']);
// 제작 사건 종류마다 받을 수 있는 모드. 다른 사건은 이 두 제작 모드를 받지 않는다.
const DRAFT_MODES = { production_draft: 'PRODUCTION_DRAFT', subtitle_translation_draft: 'SUBTITLE_TRANSLATION' };
const CUSTOMER_DECISIONS = new Set(['SEND', 'WAIT', 'ESCALATE']);

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeText(value, max = 20000) {
  return String(value ?? '').replace(/\u0000/g, '').slice(0, max);
}

function parseFields(text) {
  const source = safeText(text, 50000).trim();
  const first = source.match(/^\[MODE:(CUSTOMER_REPLY|OPS_DIAGNOSIS|PRODUCTION_REVIEW|PRODUCTION_DRAFT|SUBTITLE_TRANSLATION|NO_ACTION)\]\s*$/m);
  if (!first || first.index !== 0) throw new Error('astra_room_mode_missing');
  const mode = first[1];
  if (!MODES.has(mode)) throw new Error('astra_room_mode_invalid');

  const matches = [...source.matchAll(/^\[([A-Z_]+)(?::([^\]]+))?\]\s*$/gm)];
  const fields = {};
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const key = current[1];
    const inline = safeText(current[2] || '', 200).trim();
    const start = current.index + current[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    const body = source.slice(start, end).trim();
    fields[key] = inline || body;
  }

  const parsed = { mode, fields, raw: source };
  if (mode === 'CUSTOMER_REPLY') {
    const decision = safeText(fields.DECISION, 40).trim();
    if (!CUSTOMER_DECISIONS.has(decision)) throw new Error('astra_room_customer_decision_invalid');
    if (decision === 'SEND' && !safeText(fields.REPLY, 4000).trim()) throw new Error('astra_room_reply_missing');
    parsed.decision = decision;
    parsed.reply = decision === 'SEND' ? safeText(fields.REPLY, 4000).trim() : '';
  }
  if (mode === 'PRODUCTION_DRAFT') {
    const body = safeText(fields.SLIDES_JSON, 50000).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (!body) throw new Error('astra_room_slides_json_missing');
    let slides;
    try { slides = JSON.parse(body); } catch { throw new Error('astra_room_slides_json_invalid'); }
    if (!slides || typeof slides !== 'object' || !Array.isArray(slides.slides)) throw new Error('astra_room_slides_json_invalid');
    parsed.slides = slides;
  }
  if (mode === 'SUBTITLE_TRANSLATION') {
    const body = safeText(fields.SUBTITLES_JSON, 50000).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (!body) throw new Error('astra_room_subtitles_json_missing');
    let translations;
    try { translations = JSON.parse(body); } catch { throw new Error('astra_room_subtitles_json_invalid'); }
    if (!Array.isArray(translations)) throw new Error('astra_room_subtitles_json_invalid');
    parsed.translations = translations;
  }
  return parsed;
}

function createAstraRoomBridge(options = {}) {
  const dataFile = path.resolve(options.dataFile || path.join(__dirname, 'data', 'astra-room-bridge.json'));
  const configFile = path.resolve(options.configFile || path.join(__dirname, 'config', 'astra-room-bridge.json'));
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.mkdirSync(path.dirname(configFile), { recursive: true });

  function defaultConfig() {
    return {
      version: VERSION,
      enabled: false,
      status: 'prepared',
      targetThreadId: null,
      targetTitle: 'Swan Astra 운영·고객대응실',
      promptFile: path.join('server', 'config', 'swan-astra-operations-room-prompt.md'),
      policyVersion: 'swan-astra-room-v1',
      updatedAt: now()
    };
  }

  function readJson(file, fallback) {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return value && typeof value === 'object' ? value : clone(fallback);
    } catch {
      return clone(fallback);
    }
  }

  function writeJson(file, value) {
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, file);
  }

  function config() {
    const value = { ...defaultConfig(), ...readJson(configFile, defaultConfig()) };
    if (!fs.existsSync(configFile)) writeJson(configFile, value);
    return value;
  }

  function state() {
    const fallback = { version: VERSION, events: [], updatedAt: now() };
    const value = readJson(dataFile, fallback);
    value.events = Array.isArray(value.events) ? value.events : [];
    if (!fs.existsSync(dataFile)) writeJson(dataFile, value);
    return value;
  }

  function deterministicEventId(idempotencyKey) {
    return `AR-${crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
  }

  function enqueue(input = {}) {
    const eventType = safeText(input.eventType || input.event_type, 80).trim();
    if (!EVENT_TYPES.has(eventType)) throw new Error('astra_room_event_type_invalid');
    const caseId = safeText(input.caseId || input.case_id, 200).trim();
    const idempotencyKey = safeText(input.idempotencyKey || input.idempotency_key, 500).trim();
    if (!caseId) throw new Error('astra_room_case_id_required');
    if (!idempotencyKey) throw new Error('astra_room_idempotency_key_required');

    const current = state();
    const eventId = deterministicEventId(idempotencyKey);
    const existing = current.events.find(item => item.eventId === eventId || item.idempotencyKey === idempotencyKey);
    if (existing) return { duplicate: true, event: clone(existing) };

    const event = {
      eventId,
      caseId,
      eventType,
      source: safeText(input.source || 'relay_desk', 80),
      idempotencyKey,
      policyVersion: safeText(input.policyVersion || config().policyVersion, 120),
      occurredAt: input.occurredAt || now(),
      snapshotVersion: safeText(input.snapshotVersion || input.snapshot?.version || 'unknown', 160),
      payload: clone(input.payload || {}),
      evidence: Array.isArray(input.evidence) ? clone(input.evidence).slice(0, 50) : [],
      status: 'pending',
      attempts: 0,
      createdAt: now(),
      updatedAt: now()
    };
    current.events.unshift(event);
    current.events = current.events.slice(0, 5000);
    current.updatedAt = now();
    writeJson(dataFile, current);
    return { duplicate: false, event: clone(event) };
  }

  function list(filter = {}) {
    const current = state();
    let events = current.events;
    if (filter.status) events = events.filter(item => item.status === filter.status);
    if (filter.eventType) events = events.filter(item => item.eventType === filter.eventType);
    return clone(events.slice(0, Math.max(1, Math.min(Number(filter.limit) || 100, 500))));
  }

  function get(eventId) {
    const event = state().events.find(item => item.eventId === String(eventId || ''));
    return event ? clone(event) : null;
  }

  function claim(eventId, workerId) {
    const current = state();
    const event = current.events.find(item => item.eventId === eventId);
    if (!event) throw new Error('astra_room_event_not_found');
    if (event.status === 'completed') return { duplicate: true, event: clone(event) };
    if (!['pending', 'failed'].includes(event.status)) throw new Error('astra_room_event_not_claimable');
    event.status = 'dispatched';
    event.workerId = safeText(workerId || 'codex-heartbeat', 160);
    event.claimedAt = now();
    event.attempts = Number(event.attempts || 0) + 1;
    event.updatedAt = now();
    current.updatedAt = event.updatedAt;
    writeJson(dataFile, current);
    return { duplicate: false, event: clone(event) };
  }

  function complete(eventId, response) {
    const parsed = parseFields(response);
    const current = state();
    const event = current.events.find(item => item.eventId === eventId);
    if (!event) throw new Error('astra_room_event_not_found');
    if (event.status === 'completed') return { duplicate: true, event: clone(event) };
    // 제작 초안 사건은 PRODUCTION_DRAFT 또는 NO_ACTION만 받고, 다른 사건은 PRODUCTION_DRAFT를 받지 않는다.
    const draftMode = DRAFT_MODES[event.eventType];
    if (draftMode && ![draftMode, 'NO_ACTION'].includes(parsed.mode)) throw new Error('astra_room_mode_mismatch');
    if (!draftMode && Object.values(DRAFT_MODES).includes(parsed.mode)) throw new Error('astra_room_mode_mismatch');
    if (parsed.mode === 'SUBTITLE_TRANSLATION') {
      const problem = require('./codex-subtitle-translation').checkTranslations(event, parsed.translations);
      if (problem) throw new Error(`astra_room_translation_mismatch:${problem}`);
    }
    event.status = 'completed';
    event.response = parsed;
    event.deliveryStatus = event.eventType === 'customer_message'
      ? (parsed.mode === 'CUSTOMER_REPLY' && parsed.decision === 'SEND' ? 'ready' : 'held')
      : 'not_applicable';
    event.completedAt = now();
    event.updatedAt = event.completedAt;
    current.updatedAt = event.updatedAt;
    writeJson(dataFile, current);
    return { duplicate: false, event: clone(event) };
  }

  // 9/24 지시 28: 보낼 시각(payload.releaseAt)이 안 됐으면 내보내지 않는다(답장 1분 30초~4분 지연, 안부 멘트 2~4시간).
  // 나눠 보내는 두 번째 통(payload.afterEventId)은 첫 통이 실제로 나간 뒤 payload.gapMs가 지나야 내보낸다.
  function released(event, events, at) {
    const releaseAt = Date.parse(event.payload?.releaseAt || '');
    if (Number.isFinite(releaseAt) && releaseAt > at) return false;
    const after = String(event.payload?.afterEventId || '');
    if (after) {
      const first = events.find(item => item.eventId === after);
      if (!first || first.deliveryStatus !== 'sent') return false;
      const sentAt = Date.parse(first.deliveryUpdatedAt || '') || 0;
      if (at < sentAt + Number(event.payload?.gapMs || 0)) return false;
    }
    return true;
  }

  function outbox(filter = {}) {
    const limit = Math.max(1, Math.min(Number(filter.limit) || 20, 100));
    const events = state().events;
    const at = typeof filter.now === 'number' ? filter.now : Date.now();
    return clone(events.filter(event =>
      event.eventType === 'customer_message'
        && event.status === 'completed'
        && event.response?.mode === 'CUSTOMER_REPLY'
        && event.response?.decision === 'SEND'
        && event.deliveryStatus === 'ready'
        && (!filter.conversationId || String(event.payload?.conversationId || '') === String(filter.conversationId))
        && released(event, events, at)
    ).slice(0, limit));
  }

  // 9/24 지시 28: 아직 안 나간 예약(안부 멘트 등)을 취소한다. 고객이 먼저 말하면 안부 멘트는 보내지 않는다.
  function cancelScheduled(conversationId, kinds = [], reason = 'cancelled', at = Date.now()) {
    const current = state();
    const cancelled = [];
    for (const event of current.events) {
      if (event.eventType !== 'customer_message' || event.deliveryStatus !== 'ready') continue;
      if (String(event.payload?.conversationId || '') !== String(conversationId || '')) continue;
      if (kinds.length && !kinds.includes(String(event.payload?.kind || ''))) continue;
      const releaseAt = Date.parse(event.payload?.releaseAt || '');
      if (!Number.isFinite(releaseAt) || releaseAt <= at) continue;
      event.deliveryStatus = 'skipped';
      event.deliveryEvidence = { reason, at: new Date(at).toISOString() };
      event.deliveryUpdatedAt = new Date(at).toISOString();
      event.updatedAt = event.deliveryUpdatedAt;
      cancelled.push(event.eventId);
    }
    if (cancelled.length) { current.updatedAt = now(); writeJson(dataFile, current); }
    return cancelled;
  }

  function markDelivery(eventId, status, evidence = {}) {
    const allowed = new Set(['sent', 'skipped', 'uncertain']);
    if (!allowed.has(status)) throw new Error('astra_room_delivery_status_invalid');
    const current = state();
    const event = current.events.find(item => item.eventId === eventId);
    if (!event) throw new Error('astra_room_event_not_found');
    if (event.deliveryStatus === 'sent') return { duplicate: true, event: clone(event) };
    if (event.deliveryStatus !== 'ready' && status === 'sent') throw new Error('astra_room_delivery_not_ready');
    event.deliveryStatus = status;
    event.deliveryEvidence = clone(evidence || {});
    event.deliveryUpdatedAt = now();
    event.updatedAt = event.deliveryUpdatedAt;
    current.updatedAt = event.updatedAt;
    writeJson(dataFile, current);
    return { duplicate: false, event: clone(event) };
  }

  function fail(eventId, error, uncertain = false) {
    const current = state();
    const event = current.events.find(item => item.eventId === eventId);
    if (!event) throw new Error('astra_room_event_not_found');
    event.status = uncertain ? 'uncertain' : 'failed';
    event.error = safeText(error || 'unknown_error', 1000);
    event.failedAt = now();
    event.updatedAt = event.failedAt;
    current.updatedAt = event.updatedAt;
    writeJson(dataFile, current);
    return clone(event);
  }

  function link(input = {}) {
    const current = config();
    const threadId = safeText(input.targetThreadId, 200).trim();
    if (!threadId) throw new Error('astra_room_thread_id_required');
    const next = {
      ...current,
      enabled: input.enabled !== false,
      status: input.enabled === false ? 'prepared' : 'linked',
      targetThreadId: threadId,
      targetTitle: safeText(input.targetTitle || current.targetTitle, 200),
      updatedAt: now()
    };
    writeJson(configFile, next);
    return clone(next);
  }

  function summary() {
    const cfg = config();
    const current = state();
    const counts = {};
    for (const event of current.events) counts[event.status] = Number(counts[event.status] || 0) + 1;
    return { config: cfg, counts, total: current.events.length, dataFile, configFile };
  }

  return { config, summary, enqueue, list, get, claim, complete, outbox, markDelivery, fail, link, parseFields, cancelScheduled };
}

module.exports = { createAstraRoomBridge, parseFields };
