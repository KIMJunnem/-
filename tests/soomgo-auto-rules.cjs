'use strict';

// D'(2026-09-21 준희 승인) 숨고 자동 처리 규칙 회귀 검사. 외부 API 0회.
const assert = require('node:assert/strict');
let apiCalls = 0;
global.fetch = async () => { apiCalls += 1; throw new Error('network_disabled_in_test'); };
const { buildSoomgoQuote, soomgoReply } = require('../server/relay-server');
const autoRules = require('../server/soomgo-auto-rules');
// 9/24 지시 27: 이 시험은 숨고 문서·교정·PPT 자동 견적이 켜져 있을 때의 규칙을 본다(멈춤은 tests/soomgo-pause-27.cjs).
autoRules.setPauseConfigForTest({ document_writing: true, presentation: true });
const registry = require('../server/service-registry');
const pricing = require('../server/pricing-table');

const supported = registry.listServices({ channel: 'soomgo' }).map(service => service.id);
const run = (input, { existing = null, state = {}, requestedServiceId = null } = {}) => {
  const { parsed, quote } = buildSoomgoQuote(input);
  const result = autoRules.applySoomgoAutoRules({ body: input, request: parsed, quote, requestedServiceId, existingLead: existing, state, requestId: input.requestId || 'T', supportedServiceIds: supported, sampleAmount: a => a });
  return { parsed, quote, result };
};
const mk = (category, body, id = 'T') => ({ requestId: id, text: `요청 상세\n고객 정보\n견적 보낸 고수 2명\n30분 전\n${category}\n\n${body}\n고객 정보\n신고하기\n\n김가명\n` });
const proof = (lang, pages) => mk('교정/교열', `희망 서비스\n교정교열\n작성 언어\n${lang}\n작업 분량\nA4 ${pages}쪽`);

// 규칙은 정의 파일에 있다
assert.equal(autoRules.RULES.deleteSafety.dailyCap, 30);
assert.deepEqual(pricing.DOCUMENT_RULES.largeDocument && [pricing.DOCUMENT_RULES.largeDocument.minPages, pricing.DOCUMENT_RULES.largeDocument.perPageAbove, pricing.DOCUMENT_RULES.largeDocument.deleteAbovePages], [40, 3500, 100]);
assert.deepEqual([pricing.DOCUMENT_RULES.foreignProofreading.base, pricing.DOCUMENT_RULES.foreignProofreading.includedPages, pricing.DOCUMENT_RULES.foreignProofreading.perPage], [34000, 4, 8000]);

// 한국어 교정: 40쪽 초과분 3,500원, 100쪽 초과 삭제
for (const [pages, amount] of [[4, 21000], [40, 201000], [80, 341000], [100, 411000]]) {
  const { quote, result } = run(proof('한국어', pages));
  assert.equal(result.action, 'none'); assert.equal(quote.amount, amount, `한국어 ${pages}쪽`); assert.equal(quote.autoSend, true);
}
assert.equal(run(proof('한국어', 120)).quote.deleteRequest, true, '한국어 120쪽 삭제');
// 영어 교정: 기본 34,000원(4쪽)·쪽당 8,000원·40쪽 초과분 3,500원
for (const [pages, amount] of [[4, 34000], [10, 82000], [40, 322000], [60, 392000]]) {
  const { quote, result } = run(proof('영어', pages));
  assert.equal(result.ruleId, 'english_proofreading'); assert.equal(quote.amount, amount, `영어 ${pages}쪽`);
  assert.equal(quote.autoSend, true); assert.equal(quote.manualReview, false);
}
assert.equal(run(proof('영어', 150)).result.ruleId, 'large_document', '영어 150쪽 삭제');
assert.equal(run(proof('일본어', 5)).result.ruleId, 'foreign_other_language', '영어 외 언어 삭제');
// 문서 작성 50쪽: 21,000 + 38×9,000 + 10×3,500
assert.equal(run(mk('문서/글 작성', '작성 주제\n회사 소개 자료 작성\n작업 분량\nA4 50쪽')).quote.amount, 398000);
// 삭제 규칙
const deleted = {
  // 9/24 준희: 영상 편집은 삭제 대신 기록·사람 확인이 되어 대표 미판매 카테고리를 통계 분석으로 바꿈
  unsold_category: mk('통계 분석', '분석 내용\nSPSS 회귀분석 결과 해석 부탁드립니다 설문 200명'),
  translation_en: mk('영어 번역', '작업 분량\nA4 2쪽 한국어 문서를 영어로 번역'),
  resume_self_intro: mk('문서/글 작성', '작성 주제\n자기소개서 작성 부탁드립니다 대기업 지원'),
  academic: mk('문서/글 작성', '작성 주제\n석사 졸업 논문 작성 부탁드립니다 30쪽'),
  forgery: mk('문서/글 작성', '작성 주제\n재직증명서를 만들어 주세요 급합니다')
};
for (const [ruleId, input] of Object.entries(deleted)) {
  const { quote, result } = run(input);
  assert.equal(result.ruleId, ruleId); assert.equal(quote.deleteRequest, true, ruleId); assert.equal(quote.autoSend, false);
}
// 제브 시뮬레이션에서 발견(2026-09-21): 상세 화면 원문에 섞인 '이력서/자소서 컨설팅' 카드나
// '최근 작성한 견적' 예시의 '자기소개서' 때문에 속기·교정 요청이 삭제되면 안 된다.
const stray = mk('속기(타이핑)', '작업 분량\n녹음 20분\n\n최근 작성한 견적\n안녕하세요. 공기업 지원·기타: 공무원 직무 자기소개서 요청 확인했습니다.\n\n자세히 보기\n견적 보낸 고수\n이력서/자소서 컨설팅\n가능한 빨리 진행하고 싶어요');
const strayResult = run(stray);
assert.notEqual(strayResult.quote.deleteRequest, true, '원문 속 다른 카드·예시로 삭제하지 않음');
assert.notEqual(strayResult.result.ruleId, 'resume_self_intro');
// 오탐 방지: '현금영수증 발행' 문의는 삭제하지 않는다(기존 사람 확인 유지)
const receipt = run(mk('문서/글 작성', '작성 주제\n회사 보고서 작성, 현금영수증 발행 가능한가요 A4 3쪽'));
assert.notEqual(receipt.quote.deleteRequest, true);
// 자막 가격표 그대로: 33분 99,000원(9/23 준희: 30분 초과 5분마다 10,000원)
const subtitle = run({ requestId: 'S', purpose: '자막 제작', volume: '33분', topic: '한국어 인터뷰 SRT 자막', format: 'SRT', text: '요청 상세\n자막 제작\n작업 분량\n33분 인터뷰 영상 한국어 자막 SRT 부탁드립니다' });
assert.equal(subtitle.quote.amount, 99000); assert.equal(subtitle.result.action, 'none');
// 분류 불가: 1회 재조회 후 삭제
const unknownInput = { requestId: 'U', text: '요청 상세\n고객 정보\n견적 보낸 고수 1명\n로고 디자인 부탁드립니다 심플하게 만들어 주세요 급해요' };
const lead = {};
assert.equal(run(unknownInput, { existing: lead }).result.action, 'retry');
assert.equal(run(unknownInput, { existing: lead }).result.action, 'delete');
// 서비스 불일치: 카테고리 있으면 카테고리 기준 견적, 없으면 삭제
const withCategory = run(proof('한국어', 5), { requestedServiceId: 'presentation' });
assert.equal(withCategory.quote.autoSend, true); assert.equal(withCategory.quote.autoRule.action, 'quote_by_category');
const noCategory = run({ requestId: 'M', text: '요청 상세\n5분 인터뷰 영상에 한국어 자막 SRT 파일을 만들어 주세요 부탁드립니다' }, { requestedServiceId: 'presentation' });
assert.equal(noCategory.result.ruleId, 'service_mismatch'); assert.equal(noCategory.quote.deleteRequest, true);
// 안전장치: 기술 오류(본문 부족)는 삭제 금지, 하루 30건 상한, 삭제 기록 1회
assert.equal(run({ requestId: 'E', text: '통계 분석' }).result.action, 'retain_technical');
// 영상 편집: 삭제하지 않고 기록·사람 확인(9/24 준희), 짧은 본문이어도 삭제 없음
assert.equal(run({ requestId: 'E2', text: '영상 편집' }).result.action, 'quote'); // 9/25: 길이 모름도 "자료 보고 확정" 시작가로 견적
assert.equal(run(mk('영상 편집', '유튜브 영상 컷 편집 부탁드립니다 10분 분량')).quote.deleteRequest, false);
const full = { soomgoAutoDeletes: Array.from({ length: 30 }, (_, i) => ({ at: new Date().toISOString(), requestId: `D${i}` })) };
const capped = run(deleted.unsold_category, { state: full });
assert.equal(capped.result.action, 'retain_cap'); assert.equal(capped.quote.deleteRequest, false); assert.equal(capped.quote.manualReview, true);
const yesterday = { soomgoAutoDeletes: Array.from({ length: 30 }, (_, i) => ({ at: new Date(Date.now() - 36 * 3600 * 1000).toISOString(), requestId: `Y${i}` })) };
assert.equal(run(deleted.unsold_category, { state: yesterday }).result.action, 'delete', '어제 기록은 상한에 안 셈');
const logState = {};
run(deleted.forgery, { state: logState }); run(deleted.forgery, { state: logState });
assert.equal(logState.soomgoAutoDeletes.length, 1); assert.equal(logState.soomgoAutoDeletes[0].ruleId, 'forgery');
// 흥정: 금액 유지·범위 조정안 자동 발송
const bargain = soomgoReply({ conversationId: '235999998', message: '좀 더 싸게 안될까요?' });
assert.equal(bargain.templateKey, 'guard_price_negotiation'); assert.equal(bargain.autoSend, true);
assert.ok(!/\d[\d,]*\s*원/.test(bargain.text), '흥정 답변에 새 금액 없음');
assert.equal(apiCalls, 0);
console.log('soomgo-auto-rules: PASS');
