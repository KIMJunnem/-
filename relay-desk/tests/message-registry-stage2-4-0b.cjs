'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const messages = require('../server/message-registry');
const { buildSoomgoQuote, markSoomgoCustomerReplyAfterOutbound } = require('../server/relay-server');

const root = path.join(__dirname, '..');
const backup = fs.readFileSync(path.join(root, 'backups', 'chatbot-local-texts-20260921-151751.md'), 'utf8');
const exactTexts = [
  '문의는 언제든 남겨주세요. 자동 상담으로 기본 내용을 안내하고, 작업 가능 여부와 최종 견적은 담당자 확인 후 안내드립니다. 답변까지 시간이 걸릴 수 있습니다.',
  '【샘플 구매 가능】 [샘플 금액]원으로 핵심 일부를 먼저 확인할 수 있고, 본 작업 진행 시 샘플 비용을 전액 차감합니다.',
  '학교 제출용 문서는 제출처의 AI 활용·인용 기준을 먼저 확인해 주세요. 일반 과제·레포트는 접수하고 논문·학위논문·학술 원고는 진행하지 않습니다.',
  '현재 자기소개서 초안은 어느 정도 준비돼 있나요? 편하게 알려주세요.',
  '현재 초안은 ① 있음 ② 없음 ③ 일부만 있음 중 어느 상태인가요? 숫자만 보내주셔도 됩니다.',
  'PPT로 옮길 원고와 희망 장수, 사용 목적, 필요한 날짜를 보내주실 수 있을까요?',
  '현재 자료는 어느 정도 준비돼 있나요? 편하게 알려주세요.',
  '자료는 ① 준비됨 ② 정리 필요 ③ 아직 없음 중 어느 상태인가요? 숫자만 보내주셔도 됩니다.',
  '샘플 구매가 확인됐습니다. 예상 작업 기간은 [예상 기간]이에요. 먼저 [샘플 범위]를 만들어 보내드리고, 본 작업을 맡기시면 샘플 비용은 전액 빼드립니다. 진행 상황은 이 채팅에 남길게요.',
  '고용이 확인됐습니다. 맡겨주셔서 감사합니다. 예상 작업 기간은 [예상 기간]이에요. 1차본을 먼저 보내드린 뒤 말씀해 주신 내용을 반영해 수정본과 최종본을 전달하겠습니다. 필요한 내용은 이 채팅에서 여쭤볼게요.',
  '거래 확정 요청을 진행했습니다. 이용해 주셔서 감사합니다. 결과물이 도움이 되셨다면 숨고 리뷰도 남겨주시면 큰 도움이 됩니다.'
];
for (const text of exactTexts) assert.ok(backup.includes(text), `백업 원문 누락: ${text}`);

const definedTexts = [
  messages.getMessage('common.first_notice.v1').text,
  messages.getMessage('common.sample_offer.v1').text.replace('{{sampleAmountFormatted}}', '[샘플 금액]').trim(),
  messages.getMessage('common.school_notice.v1').text.trim(),
  JSON.parse(fs.readFileSync(path.join(root, 'services', '_common', 'messages.json'), 'utf8')).messages.find(item => item.id === 'legacy.self_intro_followup_a.v1').text,
  JSON.parse(fs.readFileSync(path.join(root, 'services', '_common', 'messages.json'), 'utf8')).messages.find(item => item.id === 'legacy.self_intro_followup_b.v1').text,
  messages.getMessage('presentation.followup.v1', 'presentation').text,
  messages.getMessage('document_writing.followup.material_status_a.v1', 'document_writing').text,
  messages.getMessage('document_writing.followup.material_status_b.v1', 'document_writing').text,
  messages.getMessage('common.sample_hire_greeting.v1').text.replace('{{days}}', '[예상 기간]').replace('{{sampleScope}}', '[샘플 범위]'),
  messages.getMessage('common.hire_greeting.v1').text.replace('{{days}}', '[예상 기간]'),
  messages.getMessage('common.transaction_review_thanks.v1').text
];
// 2026-09-21 합니다체 통일(준희 지시): 바뀐 문구는 version을 올리고 아래 기준으로 비교한다.
const toneUpdates = {
  '현재 자기소개서 초안은 어느 정도 준비돼 있나요? 편하게 알려주세요.': '현재 자기소개서 초안은 어느 정도 준비되어 있으신가요? 편하게 알려주세요.',
  '현재 자료는 어느 정도 준비돼 있나요? 편하게 알려주세요.': '현재 자료는 어느 정도 준비되어 있으신가요? 편하게 알려주세요.',
  '샘플 구매가 확인됐습니다. 예상 작업 기간은 [예상 기간]이에요. 먼저 [샘플 범위]를 만들어 보내드리고, 본 작업을 맡기시면 샘플 비용은 전액 빼드립니다. 진행 상황은 이 채팅에 남길게요.': '샘플 구매가 확인됐습니다. 예상 작업 기간은 [예상 기간]입니다. 먼저 [샘플 범위]를 만들어 보내드리고, 본 작업을 맡기시면 샘플 비용은 전액 차감해 드립니다. 진행 상황은 이 채팅으로 알려드리겠습니다.',
  '고용이 확인됐습니다. 맡겨주셔서 감사합니다. 예상 작업 기간은 [예상 기간]이에요. 1차본을 먼저 보내드린 뒤 말씀해 주신 내용을 반영해 수정본과 최종본을 전달하겠습니다. 필요한 내용은 이 채팅에서 여쭤볼게요.': '고용 확인했어요, 맡겨주셔서 감사합니다! 예상 작업 기간은 [예상 기간]이고, 1차본 먼저 보내드린 뒤 말씀 주시는 대로 고쳐서 최종본 드릴게요.' // 9/26 준희 말투(짧게)
};
assert.deepEqual(definedTexts, exactTexts.map(text => toneUpdates[text] || text));
assert.equal(messages.getMessage('common.hire_greeting.v1').version, 'v3');
assert.equal(messages.getMessage('common.sample_hire_greeting.v1').version, 'v2');
assert.equal(messages.getMessage('document_writing.followup.material_status_a.v1', 'document_writing').version, 'v2');
assert.equal(messages.getMessage('legacy.self_intro_followup_a.v1'), null);
assert.equal(messages.getMessage('legacy.self_intro_followup_b.v1'), null);

for (const serviceId of ['subtitle', 'document_writing', 'presentation', 'translation_en']) {
  const picked = messages.selectFollowup({ serviceId, rawText: serviceId, eventId: 'event-2' });
  assert.ok(picked.messageId);
  assert.match(picked.version, /^v[12]$/);
  assert.equal(picked.serviceId, serviceId);
  assert.ok(picked.followupMessage.startsWith(exactTexts[0]));
}
const ppt = messages.selectFollowup({ serviceId: 'presentation', rawText: 'PPT 보고서 변환', eventId: 'ppt' });
assert.equal(ppt.messageId, 'presentation.followup.v1');
assert.match(ppt.followupMessage, /희망 장수/);

// 기존 followupText() 조합 규칙(공백·줄바꿈 포함)과 글자 단위로 같은지 확인한다.
const composed = messages.selectFollowup({
  serviceId: 'document_writing',
  rawText: '학교 과제 문서',
  topic: '리포트',
  eventId: 'event-2',
  sampleAmount: 5500
});
assert.equal(composed.followupMessage,
  `${exactTexts[0]}\n안녕하세요! 일반 문서·글 작성(리포트) 문의 확인했습니다. `
  + '【샘플 구매 가능】 5,500원으로 핵심 일부를 먼저 확인할 수 있고, 본 작업 진행 시 샘플 비용을 전액 차감합니다. '
  + ' 학교 제출용 문서는 제출처의 AI 활용·인용 기준을 먼저 확인해 주세요. 일반 과제·레포트는 접수하고 논문·학위논문·학술 원고는 진행하지 않습니다. '
  + toneUpdates[exactTexts[6]]);

const quote = buildSoomgoQuote({ purpose: '자막 제작', volume: '5분', text: '한국어 영상 자막' }).quote;
assert.equal(quote.quoteMessageId, 'subtitle.quote.v1');
assert.equal(quote.quoteMessageVersion, JSON.parse(fs.readFileSync(path.join(root, 'services', 'subtitle.json'), 'utf8')).quoteMessageVersion, '자막 견적 문구 버전은 정의 파일 값');
assert.ok(quote.messageId);
assert.match(quote.messageVersion, /^v[12]$/);

const state = {
  soomgoLeads: [{ conversationId: 'room-1', quoteEvidence: { status: 'sent', at: '2026-09-21T00:00:00.000Z' } }],
  soomgoReplies: [{ conversationId: 'room-1', createdAt: '2026-09-21T00:01:00.000Z', replyEvidence: { status: 'sent', at: '2026-09-21T00:01:00.000Z' } }]
};
markSoomgoCustomerReplyAfterOutbound(state, 'room-1', '2026-09-21T00:02:00.000Z', 'customer-1');
assert.equal(state.soomgoLeads[0].quoteEvidence.customerReplied, true);
assert.equal(state.soomgoReplies[0].customerReplied, true);
assert.equal(state.soomgoReplies[0].customerReplyMessageId, 'customer-1');

console.log('2-4-0b message registry, exact text, metadata and reply tracking checks passed.');
