const assert = require('node:assert/strict');
const { soomgoReply, workflowReply, isSoomgoSystemMessage, buildSoomgoAiReplyPrompt, validSoomgoAiReply, shouldUseSoomgoAiReply } = require('../server/relay-server.js');

const quote = { amount: 9000, days: '당일~1일' };
const context = '[고객] 표준적인 레포트 2장으로 만들어주세요\n[고객] 자료를 이해하기 좋은 표 하나 정도 있으면 좋을 것 같아요';

const research = soomgoReply({ conversationId: 'TEST-RESEARCH', message: '자료조사는 안하세요?', conversationText: context, quote });
assert.equal(research.templateKey, 'research_addon_quote');
assert.equal(research.autoSend, true);
assert.match(research.text, /자료조사까지 (?:포함해 )?진행/);
assert.match(research.text, /추가금 10,000원/);
assert.match(research.text, /총 19,000원/);
assert.match(research.text, /표 1개/);
assert.doesNotMatch(research.text, /원문·참고자료.*보내/);

const accepted = soomgoReply({ conversationId: 'TEST-RESEARCH', message: '추가금 낼게요 자료조사', conversationText: context, quote });
assert.equal(accepted.templateKey, 'research_addon_quote');
assert.equal(accepted.hireRequest, false);
assert.match(accepted.text, /고용 요청과 일정 등록을 보내드릴까요/);

const availability = soomgoReply({ conversationId: 'TEST-AVAILABILITY', message: '바로 작업 가능하신가요?', conversationText: '[고객] 바로 작업 가능하신가요?', quote });
assert.equal(Boolean(availability.hireRequest), false);
assert.match(availability.text, /진행할 수 있|기간은/);

const system = soomgoReply({ conversationId: 'TEST-SYSTEM', message: '고객님이 견적을 읽었습니다', conversationText: '', quote });
assert.equal(system.skip, true);
assert.equal(isSoomgoSystemMessage('숨고 알리미 고용을 확정했어요. 9월 18일 오후 7:40분까지 고용을 취소할 수 있어요.'), true);
assert.equal(isSoomgoSystemMessage('고용 요청을 보내드려도 될까요?'), false);
assert.equal(isSoomgoSystemMessage('고용을 확정했어요?'), false);

const hiredConversation = soomgoReply({
  conversationId: 'TEST-HIRED-CHAT',
  hiredConversation: true,
  workflowStage: 'awaiting_first_result',
  message: '이후 진행은 어떻게 되나요?',
  conversationText: '[내 답변] 고용 요청과 일정 등록을 보내겠습니다.\n[숨고 알리미] 고용을 확정했어요.',
  quote
});
assert.equal(hiredConversation.autoSend, true);
assert.equal(hiredConversation.postHire, true);
assert.equal(hiredConversation.templateKey, 'post_hire_status');
assert.match(hiredConversation.text, /작업 진행 중/); // 9/26 준희 말투: "제작 큐" 같은 내부 말 없이
assert.doesNotMatch(hiredConversation.text, /고용 요청을 보내|진행하실까요/);
assert.equal(shouldUseSoomgoAiReply(hiredConversation), true);

const hiredFromAlertHistory = soomgoReply({
  conversationId: 'TEST-HIRED-HISTORY',
  message: '어떻게 진행되나요?',
  conversationText: '[숨고 알리미] 고용을 확정했어요.',
  quote
});
assert.equal(hiredFromAlertHistory.postHire, true);
assert.equal(hiredFromAlertHistory.templateKey, 'post_hire_status');

const hiredPrompt = buildSoomgoAiReplyPrompt({
  hiredConversation: true,
  workflowStage: 'awaiting_first_result',
  message: '이후 진행은 어떻게 되나요?',
  conversationText: '[숨고 알리미] 고용을 확정했어요.',
  quote
}, hiredConversation);
assert.match(hiredPrompt, /고용이 이미 확정된 고객/);
assert.match(hiredPrompt, /고용 요청을 다시 보내도 되는지 묻지 말고/);

const activeWorkflow = { id: 'WF-TEST-CHAT', conversationId: 'TEST-WORKFLOW-CHAT', stage: 'awaiting_feedback', quote };
const activeWorkflowState = { soomgoWorkflows: [activeWorkflow], activities: [] };
const customerQuestionDuringReview = workflowReply(activeWorkflowState, {
  conversationId: 'TEST-WORKFLOW-CHAT', message: '이미지로 받아도 될까요?'
});
assert.equal(customerQuestionDuringReview, null);
assert.equal(activeWorkflow.stage, 'awaiting_feedback');

const statusDuringReview = workflowReply(activeWorkflowState, {
  conversationId: 'TEST-WORKFLOW-CHAT', message: '1차 결과는 언제쯤 받을 수 있나요?'
});
assert.equal(statusDuringReview.templateKey, 'workflow_status');
assert.match(statusDuringReview.text, /1차 결과물/);
const firstResultWorkflow = { id: 'WF-TEST-START', conversationId: 'TEST-WORKFLOW-START', stage: 'awaiting_first_result', quote };
const startAvailability = workflowReply({ soomgoWorkflows: [firstResultWorkflow], activities: [] }, {
  conversationId: 'TEST-WORKFLOW-START', message: '바로 작업 가능하신가요?'
});
assert.equal(startAvailability.templateKey, 'workflow_status');
assert.match(startAvailability.text, /작업 진행 중/);

const contextualYes = soomgoReply({
  conversationId: 'TEST-CONTEXTUAL-YES',
  message: '네',
  conversationText: '[내 답변] 공개자료 조사까지 포함해서 진행해도 될까요?\n[고객] 네',
  quote
});
assert.equal(contextualYes.autoSend, true);
assert.equal(contextualYes.skip, undefined);
assert.equal(contextualYes.templateKey, 'contextual_affirmation');
assert.equal(shouldUseSoomgoAiReply(contextualYes), false);
assert.match(contextualYes.text, /자료조사 포함 요청 확인했습니다/);
assert.match(contextualYes.text, /추가금 10,000원/);
assert.match(contextualYes.text, /총 19,000원/);
assert.match(contextualYes.text, /고용 요청을 보내드릴까요/);

const yesToHire = soomgoReply({
  conversationId: 'TEST-CONTEXTUAL-YES',
  message: '네',
  conversationText: `[내 답변] ${contextualYes.text}\n[고객] 네`,
  quote
});
assert.equal(yesToHire.hireRequest, true);
assert.equal(shouldUseSoomgoAiReply(yesToHire), false);

const oneCharYesToHire = soomgoReply({
  conversationId: 'TEST-ONE-CHAR-YES',
  message: 'ㅇ',
  conversationText: '[내 답변] 이 조건으로 진행 원하시면 고용 요청과 일정 등록을 보내드릴까요?\n[고객] ㅇ',
  quote
});
assert.equal(oneCharYesToHire.hireRequest, true);

const repeatedProceed = soomgoReply({
  conversationId: 'TEST-REPEATED-PROCEED',
  message: '진행하겠습니다',
  conversationText: '[내 답변] 고용 요청과 일정 등록을 보내드려도 될까요?\n[고객] 진행하겠습니다',
  quote: { amount: 9000 }
});
assert.equal(repeatedProceed.hireRequest, true);
assert.doesNotMatch(repeatedProceed.text, /네 가지 조건|다시.*(?:확인|확정)|진행하실까요/);
assert.equal(repeatedProceed.text, '감사합니다. 작업 들어가기 전에 고용 요청 확정 부탁드리겠습니다.');

const explicitProceed = soomgoReply({
  conversationId: 'TEST-EXPLICIT-PROCEED',
  message: '진행하겠습니다',
  conversationText: '[내 답변] 기본 견적 9,000원, 보고서 A4 2쪽, 당일~1일, 수정 1회 포함입니다. 고용 요청을 보내드릴까요?\n[고객] 진행하겠습니다',
  quote: { amount: 9000, basicScope: '보고서 A4 2쪽, 수정 1회', days: '당일~1일' }
});
assert.equal(explicitProceed.hireRequest, true);
assert.doesNotMatch(explicitProceed.text, /가격.*확정해 주세요|네 가지 조건/);

const acceptFullQuote = soomgoReply({
  conversationId: 'TEST-ACCEPT-FULL-QUOTE',
  message: '네',
  conversationText: '[내 답변] 기본 견적 9,000원, 보고서 A4 2쪽, 당일~1일, 수정 1회와 추가비용 사전 안내입니다. 진행하실 거면 “진행하겠습니다”라고 답해 주세요.\n[고객] 네',
  quote: { amount: 9000, days: '당일~1일', basicScope: 'A4 2쪽 보고서, 수정 1회', extraScope: '추가 자료조사와 초과 수정은 사전 안내' }
});
assert.equal(acceptFullQuote.hireRequest, true);
assert.equal(acceptFullQuote.templateKey, 'hire_ready');
assert.equal(acceptFullQuote.text, '감사합니다. 작업 들어가기 전에 고용 요청 확정 부탁드리겠습니다.');

const repeatedExtraFee = soomgoReply({
  conversationId: 'TEST-REPEATED-FEE',
  message: '추가금 얼마예요?',
  conversationText: '[내 답변] 자료조사 추가금 10,000원, 총 19,000원입니다.\n[고객] 추가금 얼마예요?',
  quote
});
assert.equal(repeatedExtraFee.templateKey, 'additional_fee_previously_quoted');
assert.doesNotMatch(repeatedExtraFee.text, /\d[\d,]*\s*원/);
assert.equal(shouldUseSoomgoAiReply(repeatedExtraFee), false);

const baseOnlyThenAskFee = soomgoReply({
  conversationId: 'TEST-BASE-ONLY-THEN-FEE',
  message: '자료조사 추가금은 얼마인가요?',
  conversationText: '[내 답변] 기본 견적은 9,000원이며 자료조사가 필요하면 별도 추가 비용을 먼저 안내드립니다.\n[고객] 자료조사 추가금은 얼마인가요?',
  quote
});
assert.equal(baseOnlyThenAskFee.templateKey, 'additional_fee_info');
assert.match(baseOnlyThenAskFee.text, /15,000원이 추가됩니다/);

const standaloneYes = soomgoReply({ conversationId: 'TEST-STANDALONE-YES', message: '네', conversationText: '[고객] 네', quote });
assert.equal(standaloneYes.skip, true);

const firstQuoteChoiceContext = '[내 답변] 요청하신 보고서 견적은 29,000원입니다.\n이 조건으로 진행할까요?\n1) 진행  2) 샘플 먼저  3) 질문\n[고객] 1';
const quoteChoiceProceed = soomgoReply({
  conversationId: 'TEST-FIRST-QUOTE-CHOICE',
  message: '1',
  conversationText: firstQuoteChoiceContext,
  quote: { amount: 29000, days: '당일~1일', basicScope: 'A4 3쪽', extraScope: '추가 작업 사전 안내' },
  request: { purpose: '보고서' }
});
assert.equal(quoteChoiceProceed.templateKey, 'quote_intent_intake_form');
assert.equal(quoteChoiceProceed.intakeHandled, true);

const quoteChoiceSample = soomgoReply({
  conversationId: 'TEST-FIRST-QUOTE-SAMPLE', message: '2번', conversationText: firstQuoteChoiceContext,
  quote: { amount: 29000, label: '보고서' }
});
assert.equal(quoteChoiceSample.templateKey, 'sample_offer');
assert.match(quoteChoiceSample.text, /샘플은 15,000원/);

const quoteChoiceQuestion = soomgoReply({
  conversationId: 'TEST-FIRST-QUOTE-QUESTION', message: '3', conversationText: firstQuoteChoiceContext, quote
});
assert.equal(quoteChoiceQuestion.templateKey, 'quote_question_prompt');
assert.match(quoteChoiceQuestion.text, /가격, 작업 범위, 마감/);

const unrelatedNumber = soomgoReply({
  conversationId: 'TEST-UNRELATED-NUMBER', message: '1', conversationText: '[고객] 문항은 1개입니다.', quote
});
assert.equal(unrelatedNumber.skip, true);

const largeFile = soomgoReply({ conversationId: 'TEST-LARGE-FILE', message: '파일 용량이 커서 첨부가 안 돼요', conversationText: '[고객 요청] 문서 교정', quote });
assert.equal(largeFile.templateKey, 'large_file_email');
assert.equal(largeFile.autoSend, true);
assert.match(largeFile.text, /pd960723@gmail\.com/);
assert.match(largeFile.text, /메일 보냈습니다/);

const normalFile = soomgoReply({ conversationId: 'TEST-NORMAL-FILE', message: '파일은 어디에 첨부하면 되나요?', conversationText: '[고객 요청] 문서 교정', quote });
assert.notEqual(normalFile.templateKey, 'large_file_email');
assert.doesNotMatch(normalFile.text, /pd960723@gmail\.com/);

const schoolAssignment = soomgoReply({ conversationId: 'TEST-SCHOOL-ASSIGNMENT', message: '대학교 과제 레포트를 처음부터 대신 써주세요.', conversationText: '[고객 요청] 일반 교양 과제', quote });
assert.equal(schoolAssignment.manualReview, false);
assert.equal(schoolAssignment.autoSend, true);
assert.notEqual(schoolAssignment.templateKey, 'manual_academic');

const thesisWriting = soomgoReply({ conversationId: 'TEST-THESIS', message: '석사 학위 논문을 처음부터 대신 작성해주세요.', conversationText: '[고객 요청] 학위 논문', quote });
assert.equal(thesisWriting.manualReview, true);
assert.equal(thesisWriting.templateKey, 'manual_academic');

const prompt = buildSoomgoAiReplyPrompt({
  message: '자료조사까지 해주세요',
  conversationText: `${context}\n[내 답변] 기본 견적은 9,000원입니다.`,
  quote
}, research);
assert.match(prompt, /이전 대화/);
assert.match(prompt, /고객의 마지막 메시지/);
assert.match(prompt, /숫자와 조건을 하나도 바꾸거나 빠뜨리지/);
assert.match(prompt, /금액을 반복하지 않는다/);
assert.match(prompt, /고용 요청 단계로 넘긴다/);

assert.equal(validSoomgoAiReply('네, 자료조사도 가능합니다. 기본 견적 9,000원에 추가금 10,000원이 더해져 총 19,000원입니다. 공개자료 조사 1개 주제와 출처 정리, 표 1개, A4 2쪽, 수정 1회를 포함합니다.', research.text), true);
assert.equal(validSoomgoAiReply('네, 자료조사까지 모두 15,000원에 해드릴게요.', research.text), false);
assert.equal(validSoomgoAiReply('합격 보장해 드립니다. 기본 견적 9,000원, 추가금 10,000원, 총 19,000원, 표 1개, 수정 1회입니다.', research.text), false);

for (const message of ['추가가격은 얼마예요?', '추가 요금이 어떻게 돼요?', '추가 가격 요구는 어느 정도인가요?']) {
  const extra = soomgoReply({ conversationId: 'TEST-EXTRA-PRICE', message, conversationText: context, quote });
  assert.equal(extra.autoSend, true, message);
  assert.equal(extra.manualReview, false, message);
  assert.equal(extra.templateKey, 'additional_fee_info', message);
  assert.match(extra.text, /15,000원/, message);
}

const todayDeadline = soomgoReply({ conversationId: 'TEST-TODAY', message: '오늘까지 되나요?', conversationText: context, quote });
assert.equal(todayDeadline.autoSend, true);
assert.equal(todayDeadline.manualReview, false);
assert.equal(todayDeadline.templateKey, 'deadline_commitment');
assert.match(todayDeadline.text, /오늘까지 1차본 전달 가능/);

const fastCloseContext = '[고객] 시장조사부터 해주세요. A4 2쪽, 워드 PDF, 주제는 광고시장의 한계와 미래입니다.\n[내 답변] 기본 9,000원이며 자료조사는 추가금이 있습니다.';
const fastClose = soomgoReply({ conversationId: 'TEST-FAST-CLOSE', message: '오늘까지 되나요?', conversationText: fastCloseContext, quote });
assert.equal(fastClose.templateKey, 'deadline_commitment');
assert.match(fastClose.text, /총액은 19,000원/);
assert.match(fastClose.text, /자료조사 추가금 10,000원/);
assert.match(fastClose.text, /A4 2쪽/);
assert.match(fastClose.text, /고용 요청/);

const repeatedDeadline = soomgoReply({
  conversationId: 'TEST-FAST-CLOSE',
  message: '내일까지도 가능하죠?',
  conversationText: `${fastCloseContext}\n[내 답변] ${fastClose.text}\n[고객] 내일까지도 가능하죠?`,
  quote
});
assert.equal(repeatedDeadline.templateKey, 'deadline_commitment');
assert.doesNotMatch(repeatedDeadline.text, /\d[\d,]*\s*원/);
assert.doesNotMatch(repeatedDeadline.text, /고용 요청/);

const directDeadline = soomgoReply({
  conversationId: 'TEST-DIRECT-DEADLINE',
  message: '언제까지 가능하신가요?',
  conversationText: '[고객] 이미지 21장을 보내드립니다. 날짜별 금액과 월별 내역을 정리해 주세요.\n[내 답변] 총 21,000원이며 예상 소요일은 당일~1일입니다.',
  request: { volume: '이미지 21장' },
  quote: { ...quote, days: '당일~1일' }
});
assert.equal(directDeadline.autoSend, true);
assert.equal(directDeadline.manualReview, false);
assert.equal(directDeadline.templateKey, 'deadline_direct_answer');
assert.match(directDeadline.text, /급하시면/);
assert.match(directDeadline.text, /최대한 오늘 안으로/);
assert.doesNotMatch(directDeadline.text, /마감일이 언제/);

const acceptedAfterBundle = soomgoReply({
  conversationId: 'TEST-FAST-CLOSE',
  message: '네 진행해주세요',
  conversationText: `${fastCloseContext}\n[내 답변] ${fastClose.text}`,
  quote
});
assert.equal(acceptedAfterBundle.hireRequest, true);
assert.equal(acceptedAfterBundle.templateKey, 'hire_ready');
assert.match(acceptedAfterBundle.text, /작업 들어가기 전에 고용 요청 확정 부탁드리겠습니다/);

const pptContext = '[고객 요청] PPT 제작 / 20장 미만 / 예산 10만원 미만\n[고객] 원고는 있고 깔끔한 디자인을 원합니다.\n[내 답변] 10장 이내 PPT 디자인, 수정 1회, 35,000원, 자료조사·그래프는 별도 비용입니다.';
const pptDeadline = soomgoReply({ conversationId: 'TEST-PPT', message: '내일까지 가능해요?', conversationText: pptContext, quote: { amount: 35000, regularAmount: 50000, days: '당일~1일', basicScope: '10장 이내 기본 디자인, 수정 1회', extraScope: '자료조사·그래프·추가 장수 별도' } });
assert.match(pptDeadline.text, /35,000원/);
assert.match(pptDeadline.text, /10장 이내 PPT/);
assert.doesNotMatch(pptDeadline.text, /A4 20쪽|45,000원|공개자료 조사/);

const extraContext = '[고객 요청] A4 3쪽 보고서 / 수정 1회 / 내일 마감\n[고객] 진행 중에 2쪽 더 추가하면 얼마예요?';
const extraPages = soomgoReply({ conversationId: 'TEST-EXTRA-SCOPE', message: '진행 중에 2쪽 더 추가하면 얼마예요?', conversationText: extraContext, quote: { amount: 29000, days: '당일~1일', basicScope: 'A4 3쪽 보고서, 수정 1회', extraScope: '추가 페이지 10,000원, 추가 수정 10,000원' } });
assert.equal(extraPages.templateKey, 'scope_expansion_quote');
assert.match(extraPages.text, /총액은 49,000원/);
const extraRevision = soomgoReply({ conversationId: 'TEST-EXTRA-SCOPE', message: '추가 수정도 한 번 더 하고 싶어요', conversationText: `${extraContext}\n[내 답변] ${extraPages.text}\n[고객] 추가 수정도 한 번 더 하고 싶어요`, quote: { amount: 29000, days: '당일~1일', basicScope: 'A4 3쪽 보고서, 수정 1회', extraScope: '추가 페이지 10,000원, 추가 수정 10,000원' } });
assert.equal(extraRevision.templateKey, 'scope_expansion_quote');
assert.match(extraRevision.text, /총액은 59,000원/);

console.log('10 reply policy and AI guardrail checks passed.');
