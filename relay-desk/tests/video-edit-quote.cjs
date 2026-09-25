'use strict';

// 영상 편집 견적 (2026-09-24 개발방 지시 16, decisions.md 7-4 준희 승인).
// 합성 입력만 쓴다. 금액 기대값 + 숨고 자동 규칙에서 영상 편집은 자동 발송 안 함(retain_review) 확인. 외부 호출 없음.
const assert = require('node:assert/strict');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const { buildSoomgoQuote } = require('../server/relay-server');
const autoRules = require('../server/soomgo-auto-rules');
const registry = require('../server/service-registry');
const { videoEditQuote } = require('../server/video-edit-quote');
const claudeQuote = require('../server/claude-quote');
const supported = registry.listServices({ channel: 'soomgo' }).map(service => service.id);

// 자동 판매 목록에는 넣지 않는다(첫 2주 수동 견적만)
assert.ok(!supported.includes('video_edit'), '숨고 자동 판매 목록에 영상 편집 없음');
assert.equal(registry.getService('video_edit').includedRevisions, 2);

const mk = body => ({ requestId: 'VE', text: `요청 상세\n고객 정보\n견적 보낸 고수 2명\n30분 전\n영상 편집\n\n${body}\n고객 정보\n신고하기\n` });
const cases = [
  ['5분', '작업 분량\n5분 이내\n유튜브 토크 컷편집', 69000, '1~2일', null],
  ['10분', '작업 분량\n10분 이내\n강의 영상 컷편집 자막', 69000, '1~2일', null],
  ['25분', '작업 분량\n25분\n인터뷰 영상 편집', 129000, '2~3일', null],
  ['30분', '작업 분량\n30분\n행사 발언 영상 편집', 129000, '2~3일', null],
  ['33분', '작업 분량\n33분\n세미나 영상 편집', 144000, '3일', null],
  ['45분', '작업 분량\n45분\n강연 영상 편집', 174000, '3일', null],
  ['1시간', '작업 분량\n1시간 이내\n강연 영상 편집', 219000, '3일', null],
  ['쇼츠', '작업 분량\n원본 8분\n유튜브 쇼츠 1개 만들어 주세요', 39000, '당일~1일', null],
  ['쇼츠 원본 20분', '작업 분량\n20분\n릴스용 쇼츠 1개', 0, '', 'shorts_long_source'],
  ['길이 모름', '유튜브 영상 편집 부탁드립니다', 0, '', 'length_unknown'],
  ['번역 10분', '작업 분량\n10분\n영어 인터뷰 영상 한국어 자막 편집', 83000, '1~2일', null],
  ['배경음악 10분', '작업 분량\n10분\n브이로그 컷편집 배경음악 넣어주세요', 79000, '1~2일', null]
];
for (const [name, body, amount, days, scopeCheck] of cases) {
  const input = mk(body);
  const { parsed, quote } = buildSoomgoQuote(input);
  // 9/24 지시 24: 여기서는 자동 견적 스위치가 꺼졌을 때(수동 확인)의 계산을 본다. 켜졌을 때는 tests/video-auto-quote-24.cjs
  const result = autoRules.applySoomgoAutoRules({ body: input, request: parsed, quote, requestedServiceId: null, existingLead: null, state: {}, requestId: 'VE', supportedServiceIds: supported, sampleAmount: a => a, videoAutoQuoteConfig: { enabled: false } });
  assert.equal(result.action, 'retain_review', `${name}: 삭제하지 않고 사람 확인`);
  assert.equal(quote.autoSend, false, `${name}: 자동 발송 안 함`);
  assert.equal(quote.manualReview, true, `${name}: 준희 확인 알림`);
  assert.equal(quote.deleteRequest, false, name);
  assert.equal(claudeQuote.eligible(quote), false, `${name}: Claude 견적 판단 대상 아님`);
  assert.equal(quote.amount, amount, `${name} 금액`);
  assert.equal(quote.days, days, `${name} 작업 기간`);
  assert.equal(quote.pricing.scopeCheck || null, scopeCheck, `${name} 범위 확인`);
  assert.equal(quote.videoEdit.manualSendOnly, true);
  assert.equal(quote.quoteMessageVersion, 'v1');
  if (amount) {
    assert.match(quote.message, new RegExp(`견적 ${amount.toLocaleString('ko-KR')}원`), `${name} 문구 금액`);
    assert.match(quote.message, /수정 2회 포함/);
    assert.match(quote.message, /숨고페이/);
    assert.equal((quote.message.match(/\d[\d,]*원/g) || []).length, 1, `${name}: 금액은 하나만`);
  } else {
    assert.ok(!/\d[\d,]*원/.test(quote.message), `${name}: 금액 없음`);
  }
  assert.match(quote.message, /33분 분량 영상의 번역 자막을 실제로 제작해 납품했습니다\./, '경험 문장 그대로');
  assert.ok(!/할인|정상가|원가|모션그래픽|배경음악|밝기/.test(quote.message), `${name}: 할인·추가금·제외 조건을 처음부터 나열하지 않음`);
  assert.ok((quote.message.match(/[?？]/g) || []).length <= 1, `${name}: 확인 질문은 하나까지`);
  if (scopeCheck === 'length_unknown') assert.match(quote.message, /전체 몇 분인지 알려주시면/, '길이부터 묻기');
}
// 모듈 단독 계산도 같은 값
assert.equal(videoEditQuote({ volume: '10분' }).amount, 69000);
assert.equal(videoEditQuote({ volume: '31분' }).amount, 144000);
assert.equal(videoEditQuote({}).amount, null);
// 9/24 지시 25: 원본 31~69분 작업 기간 3일(감독 결정)
assert.equal(videoEditQuote({ volume: '45분' }).days, '3일');
// 금액 상한 249,000원(decisions 7-4, 준희 9/24 15시대): 70분 이상은 249,000원·3~4일, 옵션을 더해도 상한 그대로
assert.equal(require('../services/video_edit.json').pricing.cap.saleAmount, 249000);
assert.equal(videoEditQuote({ volume: '65분' }).amount, 234000);
assert.equal(videoEditQuote({ volume: '70분' }).amount, 249000);
assert.equal(videoEditQuote({ volume: '70분' }).days, '3~4일');
assert.equal(videoEditQuote({ volume: '1시간 30분' }).amount, 249000);
assert.equal(videoEditQuote({ volume: '3시간' }).amount, 249000);
assert.equal(videoEditQuote({ volume: '60분', topic: '영어 인터뷰 번역 자막 배경음악' }).amount, 249000);
assert.match(videoEditQuote({ volume: '80분' }).message, /견적 249,000원 · 작업 기간 3~4일/);
// 다른 서비스 견적은 그대로(대표 요청 몇 건)
assert.equal(buildSoomgoQuote({ requestId: 'S1', purpose: '자막 제작', volume: '10분', topic: '한국어 강의 영상 자막', format: 'SRT' }).quote.amount, 49000);
assert.equal(buildSoomgoQuote({ requestId: 'S2', purpose: '자막 제작', volume: '33분', topic: '한국어 강연 영상 자막', format: 'SRT' }).quote.amount, 99000);
assert.equal(buildSoomgoQuote({ requestId: 'D1', purpose: '문서/글 작성', volume: 'A4 3쪽', topic: '사업 안내문 작성' }).quote.amount, 30000);
assert.equal(netCalls, 0, '외부 호출 없음');
console.log('video-edit-quote: PASS');
process.exit(0);
