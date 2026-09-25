'use strict';

// 알림방 중복 방지(2026-09-22 준희 지시: "같은 이상으로는 중복 안보내고").
// /api/attention?dedupe=1 결과에서 이미 알린 이상은 빼고 새 이상만 notify에 담는다.
// 이상이 사라지면 기록도 지워서, 나중에 같은 이상이 다시 생기면 다시 알린다.

const KEY_LIMIT = 1000;

function entryKey(entry) {
  if (entry.type === 'bot') return `bot:${entry.role}:stopped`;
  if (entry.type === 'alert') return `alert:${entry.code || ''}:${entry.workflowId || entry.provider || ''}`;
  const id = entry.requestId || entry.workflowId || entry.conversationId || entry.id || '';
  // 긴급으로 바뀐 견적 판단 건은 다시 알린다.
  return `item:${entry.kind || entry.type || ''}:${id}:${entry.at || ''}:${entry.urgent ? 'urgent' : ''}`;
}

function activeEntries(attention = {}) {
  const entries = [];
  for (const item of Array.isArray(attention.items) ? attention.items : []) entries.push({ type: 'item', ...item });
  for (const alert of Array.isArray(attention.alerts) ? attention.alerts : []) entries.push({ type: 'alert', ...alert });
  for (const role of ['request', 'chat']) {
    const bot = attention.bots?.[role];
    if (bot?.stopped) entries.push({ type: 'bot', role, lastSeenMinutesAgo: bot.lastSeenMinutesAgo });
  }
  return entries;
}

// state.attentionNotified = { key: firstNotifiedIso }. 바뀌면 changed=true(호출한 쪽이 저장).
function dedupe(state, attention, now = Date.now()) {
  const previous = state.attentionNotified && typeof state.attentionNotified === 'object' ? state.attentionNotified : {};
  const entries = activeEntries(attention);
  const next = {};
  const notify = [];
  for (const entry of entries) {
    const key = entryKey(entry);
    if (previous[key]) next[key] = previous[key];
    else { next[key] = new Date(now).toISOString(); notify.push({ ...entry, notifyKey: key }); }
  }
  const trimmed = Object.fromEntries(Object.entries(next).slice(-KEY_LIMIT));
  const changed = JSON.stringify(trimmed) !== JSON.stringify(previous);
  state.attentionNotified = trimmed;
  return { notify, activeCount: entries.length, alreadyNotified: entries.length - notify.length, changed };
}

module.exports = { entryKey, activeEntries, dedupe };
