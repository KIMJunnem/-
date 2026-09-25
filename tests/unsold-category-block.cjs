// 2026-09-23: 판매하지 않는 숨고 카테고리(통계 분석·데이터 가공 및 라벨링·이력서/자소서 컨설팅·영상 편집)는 견적 없이 삭제된다.
// 9/16~19에 이 카테고리로 견적 74건이 나갔고(답장 3건, 고용 0) 9/21 규칙 이후로는 0건 — 규칙이 계속 살아 있는지 지킨다.
const assert = require('node:assert/strict');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { buildSoomgoQuote } = require('../server/relay-server');
const autoRules = require('../server/soomgo-auto-rules');
const registry = require('../server/service-registry');
const supported = registry.listServices({ channel: 'soomgo' }).map(service => service.id);
const mk = (category, body) => ({ requestId: 'T', text: `요청 상세\n고객 정보\n견적 보낸 고수 2명\n30분 전\n${category}\n\n${body}\n고객 정보\n신고하기\n\n김가명\n` });
const run = input => { const { parsed, quote } = buildSoomgoQuote(input); return autoRules.applySoomgoAutoRules({ body: input, request: parsed, quote, requestedServiceId: null, existingLead: null, state: {}, requestId: 'T', supportedServiceIds: supported, sampleAmount: a => a }); };
for (const [category, body] of [
  ['통계분석', '분석 내용\nSPSS 회귀분석 결과 해석 부탁드립니다 설문 200명'],
  ['데이터 가공 및 라벨링', '작업 내용\n이미지 500장 라벨링 부탁드립니다'],
  ['이력서/자소서 컨설팅', '희망 서비스\n자기소개서 첨삭 대기업 지원']
]) {
  const result = run(mk(category, body));
  assert.equal(result.action, 'delete', category);
}
// 2026-09-24 준희 결정: 영상 편집은 삭제하지 않고 기록·사람 확인(견적 안 보냄, Claude 견적 판단에서도 빠짐)
{
  const input = mk('영상 편집', '유튜브 영상 컷 편집 부탁드립니다 10분 분량');
  const { parsed, quote } = buildSoomgoQuote(input);
  const result = autoRules.applySoomgoAutoRules({ body: input, request: parsed, quote, requestedServiceId: null, existingLead: null, state: {}, requestId: 'T', supportedServiceIds: supported, sampleAmount: a => a });
  assert.equal(result.action, 'quote', '영상 편집 삭제 안 함(9/25부터 길이 모름도 시작가 견적)');
  assert.equal(quote.deleteRequest, false);
  assert.equal(quote.autoSend, true, '9/25: 길이 모름 영상 편집은 시작가로 자동 발송');
  assert.match(quote.message, /자료를 보고 정확한 금액을 확정/);
  assert.equal(require('../server/claude-quote').eligible(quote), false, 'Claude 견적 판단 대상 아님');
}
// 판매하는 카테고리는 삭제하지 않는다
for (const [category, body] of [['문서/글 작성', '작성 주제\n회사 소개 자료 작성\n작업 분량\nA4 2쪽'], ['PPT 제작', '작업 분량\n10장\n원고 있음']]) {
  assert.notEqual(run(mk(category, body)).action, 'delete', category);
}
// 2026-09-23 준희 결정: 대본/시나리오는 판매한다 — 삭제하지 않고 견적 판단 알림(사람 확인)으로 넘긴다.
{
  const input = mk('대본/시나리오', '작성 주제\n유튜브 단편 애니메이션 대본\n작업 분량\nA4 2쪽');
  const { parsed, quote } = buildSoomgoQuote(input);
  const result = autoRules.applySoomgoAutoRules({ body: input, request: parsed, quote, requestedServiceId: null, existingLead: null, state: {}, requestId: 'T', supportedServiceIds: supported, sampleAmount: a => a });
  assert.notEqual(result.action, 'delete', '대본/시나리오 삭제 안 함');
  assert.notEqual(result.action, 'retry', '분류 불가로 두 번째에 삭제되지 않게 서비스에 매핑');
  assert.equal(quote.serviceId, 'document_writing');
  assert.equal(quote.manualReview, true, '가격은 준희가 정한다');
  assert.equal(quote.autoSend, false);
}
console.log('unsold-category-block: PASS');
