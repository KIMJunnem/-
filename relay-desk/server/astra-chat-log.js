'use strict';

// Astra 숨고 답장 기록 (2026-09-23 준희 결정 B, next-soomgo 지시 5).
// 고객 채팅은 Astra가 크롬 숨고에서 직접 읽고 답하고, 답을 보낼 때마다 여기에 한 건씩 남긴다.
// Relay는 이 기록으로 미해결 질문과 진행 단계를 본다.
// - 고객 메시지·답장 본문은 저장하지 않는다(replySha = 답 글 sha256 앞 12자만).
// - note에 전화번호·이메일 형태가 오면 거절한다(이름·주소도 넣지 않도록 안내문에 적음).
// - delivery 'uncertain'(눌렀지만 목록에 안 보임)은 보냄으로 세지 않고 주의 목록에 올린다.
// - resolution은 delivery와 따로 저장한다(보냄 ≠ 해결).
// - 단계는 이름 그대로 센다. 견적 발송·결제 요청을 문의·주문으로 바꿔 세지 않는다.

const fs = require('fs');
const path = require('path');

const KINDS = ['reply_sent', 'question_seen', 'handoff_to_owner'];
const DELIVERIES = ['visible', 'uncertain'];
const RESOLUTIONS = ['open', 'resolved', 'waiting_customer_files', 'owner_needed'];
const STAGES = ['quote_sent', 'question', 'scope_agreed', 'payment_requested', 'payment_confirmed', 'in_production', 'delivered', 'deal_confirmed'];
const UNRESOLVED = ['open', 'owner_needed'];
const LIMIT = 5000;
const BODY_FIELDS = ['text', 'message', 'body', 'reply', 'replyText', 'customerMessage', 'customerText', 'content'];
const PHONE = /(?:01[016789]|070|02|0[3-6][1-5])[-\s.]?\d{3,4}[-\s.]?\d{4}/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;

const blank = value => value === undefined || value === null || value === '';
function isoOrNull(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function validate(body = {}, now = Date.now()) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: ['body_object_required'] };
  const conversationId = String(body.conversationId ?? '').trim();
  if (!/^\d{6,20}$/.test(conversationId)) errors.push('conversationId_numeric_required');
  const kind = String(body.kind || '');
  if (!KINDS.includes(kind)) errors.push('kind_invalid');
  const at = blank(body.at) ? new Date(now).toISOString() : isoOrNull(body.at);
  if (!at) errors.push('at_invalid');
  const customerMessageAt = isoOrNull(body.customerMessageAt);
  if (!customerMessageAt) errors.push('customerMessageAt_required');
  const delivery = blank(body.delivery) ? null : String(body.delivery);
  if (delivery !== null && !DELIVERIES.includes(delivery)) errors.push('delivery_invalid');
  if (kind === 'reply_sent' && delivery === null) errors.push('delivery_required_for_reply_sent');
  const resolution = String(body.resolution || '');
  if (!RESOLUTIONS.includes(resolution)) errors.push('resolution_invalid');
  const stage = blank(body.stage) ? null : String(body.stage);
  if (stage !== null && !STAGES.includes(stage)) errors.push('stage_invalid');
  const serviceId = blank(body.serviceId) ? null : String(body.serviceId);
  if (serviceId !== null && !/^[a-z][a-z0-9_]{0,39}$/.test(serviceId)) errors.push('serviceId_invalid');
  const quoteVersion = blank(body.quoteVersion) ? null : String(body.quoteVersion);
  if (quoteVersion !== null && !/^[\w.-]{1,20}$/.test(quoteVersion)) errors.push('quoteVersion_invalid');
  const replySha = blank(body.replySha) ? null : String(body.replySha).toLowerCase();
  if (replySha !== null && !/^[0-9a-f]{12}$/.test(replySha)) errors.push('replySha_12_hex');
  if (kind === 'reply_sent' && replySha === null) errors.push('replySha_required_for_reply_sent');
  const note = blank(body.note) ? '' : String(body.note);
  if (note.length > 120) errors.push('note_over_120');
  if (/[\r\n]/.test(note)) errors.push('note_single_line');
  if (PHONE.test(note) || EMAIL.test(note)) errors.push('note_personal_info');
  for (const key of BODY_FIELDS) if (!blank(body[key])) errors.push(`body_not_stored:${key}`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    entry: { conversationId, at, customerMessageAt, kind, delivery, resolution, stage, serviceId, quoteVersion, replySha, note, receivedAt: new Date(now).toISOString() }
  };
}

const dedupeKey = entry => [entry.conversationId, entry.customerMessageAt, entry.kind, entry.replySha || ''].join('|');

function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { version: 1, entries: Array.isArray(data?.entries) ? data.entries : [] };
  } catch (_) {
    return { version: 1, entries: [] };
  }
}

function save(file, log) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ version: 1, entries: log.entries.slice(-LIMIT) }, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function record(log, entry) {
  const key = dedupeKey(entry);
  const existing = log.entries.find(item => dedupeKey(item) === key);
  if (existing) return { duplicate: true, entry: existing };
  log.entries.push(entry);
  if (log.entries.length > LIMIT) log.entries.splice(0, log.entries.length - LIMIT);
  return { duplicate: false, entry };
}

function summary(log, now = Date.now()) {
  const entries = (Array.isArray(log?.entries) ? log.entries : []).slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || Date.parse(a.receivedAt || 0) - Date.parse(b.receivedAt || 0));
  const byConversation = new Map();
  for (const entry of entries) byConversation.set(entry.conversationId, entry);
  const minutesSince = value => Math.max(0, Math.round((now - Date.parse(value)) / 60000));
  const conversations = [...byConversation.values()].map(entry => ({
    conversationId: entry.conversationId,
    lastAt: entry.at,
    customerMessageAt: entry.customerMessageAt,
    kind: entry.kind,
    delivery: entry.delivery,
    resolution: entry.resolution,
    stage: entry.stage,
    serviceId: entry.serviceId,
    minutesSinceLast: minutesSince(entry.at),
    minutesSinceCustomer: minutesSince(entry.customerMessageAt)
  }));
  const unresolved = conversations
    .filter(item => UNRESOLVED.includes(item.resolution) || item.delivery === 'uncertain')
    .map(item => ({ ...item, reason: item.delivery === 'uncertain' ? 'delivery_uncertain' : item.resolution }))
    .sort((a, b) => b.minutesSinceCustomer - a.minutesSinceCustomer);
  const replies = entries.filter(entry => entry.kind === 'reply_sent');
  const stageCounts = Object.fromEntries(STAGES.map(stage => [stage, 0]));
  for (const item of conversations) if (item.stage) stageCounts[item.stage] += 1;
  return {
    generatedAt: new Date(now).toISOString(),
    totals: {
      entries: entries.length,
      conversations: conversations.length,
      repliesVisible: replies.filter(entry => entry.delivery === 'visible').length,
      repliesUncertain: replies.filter(entry => entry.delivery === 'uncertain').length,
      handoffs: entries.filter(entry => entry.kind === 'handoff_to_owner').length
    },
    // 대화방별 마지막 단계를 이름 그대로 센다(견적 발송·결제 요청은 문의·주문이 아니다).
    stageCounts,
    unresolved,
    attention: unresolved.filter(item => item.reason === 'delivery_uncertain' || item.reason === 'owner_needed'),
    conversations
  };
}

// relay-server.js가 부른다. local: 127.0.0.1에서 온 요청인지, origin: 브라우저 origin 헤더, header: x-relay-astra 값.
function handle({ local, origin, header, method, pathname, body, file, now = Date.now() }) {
  if (!local || (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(origin)))) return { status: 403, payload: { error: 'local_only' } };
  if (String(header || '') !== 'chat-log') return { status: 403, payload: { error: 'astra_chat_log_header_required' } };
  if (pathname === '/api/astra/chat-log' && method === 'POST') {
    const checked = validate(body, now);
    if (!checked.ok) return { status: 400, payload: { error: 'invalid_chat_log', details: checked.errors } };
    const log = load(file);
    const result = record(log, checked.entry);
    if (!result.duplicate) save(file, log);
    return {
      status: 200,
      payload: { ok: true, duplicate: result.duplicate, countedAsSent: result.entry.kind === 'reply_sent' && result.entry.delivery === 'visible', attention: result.entry.delivery === 'uncertain' || result.entry.resolution === 'owner_needed', entry: result.entry }
    };
  }
  if (pathname === '/api/astra/chat-log/summary' && method === 'GET') return { status: 200, payload: { ok: true, ...summary(load(file), now) } };
  return { status: 405, payload: { error: 'method_not_allowed' } };
}

module.exports = { KINDS, DELIVERIES, RESOLUTIONS, STAGES, LIMIT, validate, dedupeKey, load, save, record, summary, handle };
