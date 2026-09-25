// Read-only evidence audit: preparation is not proof of delivery.
const fs = require('node:fs');
const path = require('node:path');
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/state.json'), 'utf8'));
const templates = new Set(['quote_read_followup', 'quote_read_context_fallback', 'quote_read_followup_relinked', 'quote_read_followup_relinked_self_intro']);
const rows = (state.soomgoReplies || []).filter(row => /^\d+$/.test(String(row.conversationId)) && templates.has(row.reply?.templateKey) && !row.reply?.skip);
const confirmed = rows.filter(row => {
  const evidence = row.replyEvidence;
  if (evidence?.status !== 'sent') return false;
  try {
    const url = new URL(evidence.url);
    return url.hostname === 'soomgo.com' && url.pathname === `/pro/chats/${row.conversationId}`;
  } catch { return false; }
});
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  preparedRecords: rows.length,
  sentEvidenceRecords: confirmed.length,
  sentEvidenceConversations: new Set(confirmed.map(row => row.conversationId)).size,
  withoutVerifiedSendEvidence: rows.length - confirmed.length,
  note: 'Bot-reported send evidence, not an independent platform receipt. Numeric conversation IDs do not establish that a customer is non-test. No read-rate or conversion-rate inferred.'
}, null, 2));
