'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { soomgoQuoteReadFollowupReply: followupReplyRaw, soomgoConversationIdFromUrl, buildSoomgoAiReplyPrompt } = require('../server/relay-server');
// 9/25 준희: 안부 멘트는 정책 quoteReadFollowup.enabled(기본 false)로 꺼져 있다. 아래 시험은 스위치를 켠 상태의 문장 규칙을 본다.
const soomgoQuoteReadFollowupReply = (state, body) => followupReplyRaw(state, body, { policy: { quoteReadFollowup: { enabled: true } } });
assert.equal(followupReplyRaw({ soomgoLeads: [], soomgoWorkflows: [] }, { conversationId: 'off-1', quoteReadFollowup: true, quoteReadEvidence: true, quote: { serviceId: 'video_edit', amount: 69000 } }, { policy: { quoteReadFollowup: { enabled: false } } }).templateKey, 'quote_read_followup_off');

const lead = {
  conversationId: 'chat-12345',
  quoteEvidence: { status: 'sent', at: new Date().toISOString() },
  request: { topic: '항공사 지원 자기소개서 3문항', purpose: '자기소개서' },
  quote: { label: '이력서·자소서 대필', amount: 39000 }
};
const state = { soomgoLeads: [lead], soomgoWorkflows: [] };

const followup = soomgoQuoteReadFollowupReply(state, { conversationId: lead.conversationId, customerRequestedFollowup: true });
assert.equal(followup.autoSend, true);
assert.equal(followup.templateKey, 'quote_read_followup');
assert.equal(followup.text, '앞서 안내드린 견적에서 범위나 일정상 확인이 필요한 부분이 있을까요? 진행 여부를 알려주시면 제작 가능 일정을 다시 확인해 드리겠습니다.');
assert.doesNotMatch(followup.text, /9,000원/);

const urlLinkedLead = {
  ...lead,
  conversationId: undefined,
  quoteEvidence: { status: 'sent', at: new Date().toISOString(), url: 'https://soomgo.com/pro/chats/chat-12345?from=request_detail' }
};
const recoveredState = { soomgoLeads: [urlLinkedLead], soomgoWorkflows: [] };
const recovered = soomgoQuoteReadFollowupReply(recoveredState, { conversationId: 'chat-12345', customerRequestedFollowup: true });
assert.equal(soomgoConversationIdFromUrl(urlLinkedLead.quoteEvidence.url), 'chat-12345');
assert.equal(soomgoConversationIdFromUrl('https://example.com/pro/chats/chat-12345'), '');
assert.equal(recovered.autoSend, true, 'a sent quote URL must recover a missing conversation link');
assert.equal(recoveredState.soomgoLeads[0].conversationId, 'chat-12345');
assert.equal(recovered.linkedLeadRequestId, lead.requestId);

const contextOnly = soomgoQuoteReadFollowupReply({ soomgoLeads: [], soomgoWorkflows: [] }, {
  conversationId: 'chat-without-record',
  quoteReadFollowup: true,
  quoteReadEvidence: true,
  quote: { label: '이력서·자소서 대필', amount: 39000 },
  request: { topic: '항공사 지원 자기소개서 3문항' },
  conversationText: '[고객] 항공사 지원 자기소개서 3문항을 작성해 주세요.'
});
assert.equal(contextOnly.autoSend, true, 'a visible quote-read notice should not go silent when the lead record is missing');
assert.equal(contextOnly.text, '앞서 안내드린 견적에서 범위나 일정상 확인이 필요한 부분이 있을까요? 진행 여부를 알려주시면 제작 가능 일정을 다시 확인해 드리겠습니다.');
assert.doesNotMatch(contextOnly.text, /추가금|\d{1,3},?\d{3}원/);

const subtitleFollowup = soomgoQuoteReadFollowupReply({ soomgoLeads: [], soomgoWorkflows: [] }, {
  conversationId: 'subtitle-chat',
  quoteReadFollowup: true,
  quoteReadEvidence: true,
  quote: { label: '자막 제작', amount: 32000 },
  request: { topic: '프랑스어 영상 30분 SRT 자막' }
});
// 9/24 지시 24·28: 서비스를 알면 docs/followup-after-read.md 문장. 자막·영상 편집은 21시대 짧은 판({주제} = 고객이 쓴 영상 종류,
// 길이를 이미 알면 2번). 문서·PPT는 2문장을 돌려 쓰고 같은 문장 연속 금지. 서비스를 모르면 위 공통 문구.
const registry = require('../server/message-registry');
const doc = fs.readFileSync(require('node:path').join(__dirname, '..', 'docs', 'followup-after-read.md'), 'utf8').replace(/\r/g, '');
for (const [title, sid] of [['자막', 'subtitle'], ['문서·교정', 'document_writing'], ['PPT', 'presentation'], ['영상 편집', 'video_edit']]) {
  const body = doc.split(new RegExp(`\\n## ${title}[^\\n]*\\n`))[1].split('\n## ')[0];
  const lines = body.split('\n').filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, '').replace(/^\((?:영상 길이|원본 길이)를 이미 알 때\)\s*/, '').trim());
  assert.equal(lines.length, 2, title);
  lines.forEach((text, i) => assert.equal(registry.getMessage(`common.quote_read_followup.${sid}.${i + 1}`).text, text.replace('{주제}', '{{topic}}'), `${title} ${i + 1}번 = 문서 문장(글자 그대로)`));
}
assert.equal(subtitleFollowup.messageId, 'common.quote_read_followup.subtitle.2', '프랑스어 영상 30분: 길이를 이미 앎 → 2번');
assert.equal(subtitleFollowup.text, '안녕하세요, 프랑스어 영상 자막 건으로 다시 인사드려요! 고민되시는 부분 있으면 편하게 물어봐 주세요. 원하시는 완성 날짜만 알려주시면 바로 일정 잡아드릴 수 있습니다!');
assert.doesNotMatch(subtitleFollowup.text, /견적 보셨군요|드릴게요|\d[\d,]*원|\{/);
const noTopic = soomgoQuoteReadFollowupReply({ soomgoLeads: [], soomgoWorkflows: [] }, { conversationId: 'sub-3', quoteReadFollowup: true, quoteReadEvidence: true, quote: { label: '자막 제작' }, request: { topic: '자막 부탁드려요' } });
assert.equal(noTopic.text, '안녕하세요, 자막 건으로 다시 인사드려요! 고민되시는 부분 있으면 편하게 물어봐 주세요. 영상 길이만 알려주시면 바로 확정해 드릴 수 있습니다!', '주제 없으면 "자막 건", 길이 모르면 1번');
// 문서·PPT: 같은 서비스에서 바로 전에 1번을 보냈으면 이번엔 2번
const afterOne = soomgoQuoteReadFollowupReply({ soomgoLeads: [], soomgoWorkflows: [], soomgoReplies: [{ conversationId: 'other-room', createdAt: new Date().toISOString(), reply: { templateKey: 'quote_read_followup_relinked', messageId: 'common.quote_read_followup.document_writing.1' } }] }, {
  conversationId: 'doc-chat-2', quoteReadFollowup: true, quoteReadEvidence: true, quote: { serviceId: 'document_writing', amount: 30000 }, request: { topic: '안내문 작성' }
});
assert.equal(afterOne.messageId, 'common.quote_read_followup.document_writing.2', '같은 문장 연속 금지');
const videoFollowup = soomgoQuoteReadFollowupReply({ soomgoLeads: [], soomgoWorkflows: [] }, {
  conversationId: 'video-chat', quoteReadFollowup: true, quoteReadEvidence: true, quote: { serviceId: 'video_edit', amount: 69000 }, request: { soomgoCategory: '영상 편집', topic: '돌잔치 영상 편집 부탁드려요' }
});
assert.equal(videoFollowup.messageId, 'common.quote_read_followup.video_edit.1');
assert.match(videoFollowup.text, /^안녕하세요, 돌잔치 영상 건으로 다시 인사드려요!/);

const hiredState = { ...state, soomgoWorkflows: [{ conversationId: lead.conversationId, stage: 'in_progress' }] };
assert.equal(soomgoQuoteReadFollowupReply(hiredState, { conversationId: lead.conversationId, customerRequestedFollowup: true }).skip, true);
assert.equal(soomgoQuoteReadFollowupReply(state, { conversationId: 'unmatched' }).skip, true);

const prompt = buildSoomgoAiReplyPrompt({ quoteReadFollowup: true, conversationText: '고객은 보고서 2장을 문의함' }, followup);
assert.match(prompt, /견적을 읽었다는 시스템 문구만으로 고객의 동의·고용 확정으로 간주하지 마라/);

const chat = fs.readFileSync('soomgo-chat-bot/chat-content.js', 'utf8');
assert.match(chat, /if \(await refreshAfterAcceptedJob\(\)\) return;/, 'accepted-job event must be handled by the active loop');
// E(2026-09-22): 읽음 표시는 목록에서 기다렸다가 10분이 지나면 한 번만 연다.
assert.match(chat, /quoteReadWaiting[\s\S]{0,700}quoteReadNoticeIn\(item\.link\.textContent\)/, 'a newly visible quote-read receipt must be selected once');
assert.match(chat, /const quoteReadCandidate = quoteReadWaiting\.find\(item => now - item\.readAt >= QUOTE_READ_FOLLOWUP_DELAY_MS\)/, 'the room opens only after ten minutes on the list');
assert.match(chat, /quote-read:\$\{conversationId\}:\$\{eventId\}/, 'read-receipt followup must have a per-event dedupe key');
assert.match(chat, /async function processQuoteReadFollowup\(\)[\s\S]{0,1600}latestIncomingMessage\(pageText\(\), \{ preferUnhandled: true \}\)/, 'actual unanswered customer messages take precedence');
assert.match(chat, /templateKey === 'quote_read_unmatched'[\s\S]{0,700}견적 읽음 고객 연결 재확인 중/, 'unmatched quote-read events must retry instead of being silently marked handled');
assert.match(chat, /failedQuoteReads[\s\S]{0,900}quote-read-retry:/, 'previously skipped read receipts must be reopened after the fix');
assert.match(chat, /Date\.now\(\) < delayUntil\) \{[\s\S]{0,300}await returnToChatList\(\);/, 'quote-read waiting happens on the chat list, not inside the room');
assert.doesNotMatch(chat, /Date\.now\(\) < delayUntil\) \{ state\.retryAt = delayUntil;/, 'quote-read waiting must not park the whole bot until the deadline');
assert.match(chat, /function chatListClockAt\([\s\S]{0,1200}observed\.getTime\(\)/, 'the visible quote-read clock must be converted to an event timestamp');
assert.match(chat, /quoteReadAt: quoteReadAt|\{ quoteReadAt, quoteReadDelayUntil: quoteReadAt \+ QUOTE_READ_FOLLOWUP_DELAY_MS \}/, 'reopened rooms must retain the visible read time instead of restarting the ten-minute timer');

const serverSource = fs.readFileSync('server/relay-server.js', 'utf8');
assert.match(serverSource, /existing\.reply = body\.quoteReadFollowup === true\s*\? deterministicReply/, 'an approved read followup must not be diverted into emergency Astra review on a retry');
assert.match(serverSource, /(?:const|let) reply = body\.quoteReadFollowup === true\s*\? deterministicReply/, 'an approved read followup must not be diverted into emergency Astra review on first handling');
assert.match(serverSource, /\['quote_read_unmatched', 'emergency_astra_review'\]\.includes/, 'a read followup previously blocked by emergency review must be eligible for one safe retry');

console.log('quote-read-followup: topic-aware single followup, hire/unmatched guards, dedupe, and accepted-job refresh verified');
