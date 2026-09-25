'use strict';

// 학교 과제 문서: 기본 수정 2회, 3번째부터 1회 10,000원 (2026-09-22 준희 결정). 일반 문서는 3회 그대로.
const assert = require('node:assert/strict');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { buildSoomgoQuote, soomgoReply } = require('../server/relay-server');
const pricing = require('../server/pricing-table');

const school = buildSoomgoQuote({ requestId: 'SCH1', text: '요청 상세\n문서/글 작성\n이용 목적\n학교 과제\n작업 분량\nA4 기준 3\n작성 주제\n광고시장의 한계와 개선 방향\n' });
assert.equal(school.parsed.serviceId, 'document_writing');
assert.equal(school.quote.schoolAssignment, true);
assert.equal(school.quote.includedRevisions, 2);
assert.match(school.quote.message, /수정 2회 포함/);
assert.match(school.quote.message, /3번째 수정부터는 1회 10,000원입니다\./);
assert.match(school.quote.basicScope, /수정 2회/);
assert.match(school.quote.quoteMessageVersion, /-school$/);

const work = buildSoomgoQuote({ requestId: 'WRK1', text: '요청 상세\n문서/글 작성\n이용 목적\n회사 업무\n작업 분량\nA4 기준 3\n작성 주제\n사내 교육 자료 정리\n' });
assert.equal(work.quote.schoolAssignment, false);
assert.match(work.quote.message, /수정 3회 포함/);
assert.ok(!/번째 수정부터/.test(work.quote.message), '일반 문서에는 추가 수정 문장 없음');
assert.ok(!/-school$/.test(work.quote.quoteMessageVersion));

// 요청서 칸만 본다: 페이지 다른 곳의 '과제' 글자로 학교 과제가 되지 않는다
assert.equal(pricing.isSchoolAssignment({ purpose: '회사 업무', topic: '분기 보고서', text: '다른 고수의 과제 대행 후기' }), false);
assert.equal(pricing.isSchoolAssignment({ purpose: '기타: 레포트' }), true);
assert.equal(pricing.SCHOOL_REVISIONS, 2);
// 과제는 서비스 상관없이 2회로 통일: PPT·자막 학교 과제 견적에도 추가 수정 문장
const ppt = buildSoomgoQuote({ requestId: 'PPT1', text: '요청 상세\nPPT 제작\n이용 목적\n학교 과제\n작업 분량\n10장\n작성 주제\n조별 과제 발표 자료\n' }).quote;
assert.equal(ppt.serviceId, 'presentation'); assert.equal(ppt.includedRevisions, 2);
assert.match(ppt.message, /수정 2회/); assert.match(ppt.message, /3번째 수정부터는 1회 10,000원입니다\./); assert.match(ppt.quoteMessageVersion, /-school$/);
assert.equal((ppt.message.match(/번째 수정부터/g) || []).length, 1, '문장 한 번만');
assert.match(ppt.message.split('\n').at(-1), /[?？]/, '확인 질문이 맨 끝'); assert.equal(ppt.quoteMessageVersion, require('../services/presentation.json').quoteMessageVersion + '-school');
assert.match(ppt.message, /내용 조사부터 필요하시면 10,000원이 추가됩니다/);
const pptWork = buildSoomgoQuote({ requestId: 'PPT2', text: '요청 상세\nPPT 제작\n이용 목적\n회사 업무\n작업 분량\n10장\n작성 주제\n분기 실적 보고\n' }).quote;
assert.ok(!/번째 수정부터/.test(pptWork.message)); assert.ok(!/-school$/.test(pptWork.quoteMessageVersion));
// 자료조사 추가금: 문서·PPT 모두 10,000원 고정 (2026-09-22 준희 결정), 견적 크기와 상관없음
const { intakeConversationReply, buildIntakeForm } = require('../server/relay-server');
const intakeForm = buildIntakeForm({}, { label: '보고서' }).text;
for (const q of [{ amount: 30000, label: '문서', serviceId: 'document_writing' }, { amount: 51000, label: 'PPT', serviceId: 'presentation' }, { amount: 200000, label: '문서', serviceId: 'document_writing' }]) {
  const r = intakeConversationReply({ conversationId: `RS-${q.serviceId}-${q.amount}`, message: '1-1, 2-2, 3-3, 4-2', conversationText: `[swan] ${intakeForm}`, quote: q });
  assert.match(r.text, /추가금 10,000원/, `${q.serviceId} ${q.amount}`);
  assert.match(r.text, new RegExp(`총액은 ${(q.amount + 10000).toLocaleString('ko-KR')}원`));
}
console.log('school-assignment-revisions: PASS');
