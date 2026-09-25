'use strict';

const assert = require('node:assert/strict');
const { soomgoPricePair, buildSoomgoQuote, workflowHireConfirmed } = require('../server/relay-server.js');

assert.deepEqual(soomgoPricePair(20000), {
  original: 20000,
  regular: 20000,
  discounted: 15000,
  saved: 5000,
  totalSaved: 5000,
  marketAdjustmentRate: 0,
  openingDiscountRate: 0.3,
  priceLabel: '할인가'
});

assert.deepEqual(soomgoPricePair(50000), {
  original: 50000,
  regular: 50000,
  discounted: 35000,
  saved: 15000,
  totalSaved: 15000,
  marketAdjustmentRate: 0,
  openingDiscountRate: 0.3,
  priceLabel: '할인가'
});
assert.deepEqual(soomgoPricePair(30000), {
  original: 30000,
  regular: 30000,
  discounted: 21000,
  saved: 9000,
  totalSaved: 9000,
  marketAdjustmentRate: 0,
  openingDiscountRate: 0.3,
  priceLabel: '할인가'
});

const fixedEntryCases = [
  ['문서 글 작성', 24000, 21000],
  ['이력서 자소서 대필', 50000, 39000],
  ['교정 교열', 28000, 22000],
  ['속기 타이핑', 24000, 19000],
  ['PPT 제작', 50000, 40000],
  ['사업계획서 작성', 160000, 128000],
  ['카피라이팅', 60000, 48000],
  ['영어 번역', 32000, 26000],
  ['일본어 번역', 35000, 28000],
  ['중국어 번역', 40000, 32000],
  ['프랑스어 번역', 60000, 48000],
  ['자막 제작', 40000, 32000],
  ['영상 편집', 60000, 48000],
  ['사진 편집 보정', 15000, 15000],
  ['썸네일 제작', 25000, 20000],
  ['상세페이지 제작', 150000, 120000],
  ['인쇄물 디자인', 60000, 48000],
  ['로고 디자인', 70000, 56000],
  ['데이터 크롤링', 96000, 77000],
  ['통계분석', 80000, 64000],
];
for (const [purpose, regular, entry] of fixedEntryCases) {
  const quote = buildSoomgoQuote({ purpose, volume: '1쪽' }).quote;
  assert.equal(quote.regularAmount, regular, `${purpose} should use its fixed regular price`);
  assert.equal(quote.amount, entry, `${purpose} should use its fixed entry price`);
  assert.equal(quote.discountLabel, '할인가');
}

const pptQuote = buildSoomgoQuote({ purpose: 'PPT 제작', volume: '10장' }).quote;
assert.equal(pptQuote.originalAmount, 50000);
assert.equal(pptQuote.regularAmount, 50000);
assert.equal(pptQuote.amount, 40000);
assert.match(pptQuote.message, /원가 50,000원 → 할인가 40,000원으로 제안드립니다/);
assert.doesNotMatch(pptQuote.message, /숨고 평균가|30% 조정 기준가|기준가 대비/);
assert.doesNotMatch(pptQuote.message, /1\) 진행\s+2\) 샘플 먼저\s+3\) 질문/, '숫자 선택형 CTA는 사용자 요청으로 제거됐다');
assert.match(pptQuote.followupMessage, /견적은 40,000원/);
assert.match(pptQuote.followupMessage, /이 조건으로 진행 어떠실까요\?/);
assert.doesNotMatch(pptQuote.followupMessage, /😊|:\)/, '첫 상담 문구에는 이모지와 웃는 기호를 넣지 않는다');
assert.doesNotMatch(pptQuote.followupMessage, /1\) 진행\s+2\) 샘플 먼저\s+3\) 질문/, '후속 안내에도 숫자 선택형 CTA를 넣지 않는다');
assert.doesNotMatch(pptQuote.followupMessage, /예:\s*1-분량/);
assert.ok(pptQuote.message.indexOf('이 조건으로 진행 어떠실까요? :)') < pptQuote.message.indexOf('샘플 구매 가능'), 'CTA must appear before the optional sample detail');
assert.doesNotMatch(pptQuote.message, /진행 여부를 편하게 알려주시면/);

const selfIntroQuote = buildSoomgoQuote({ purpose: '자기소개서', topic: '기존 초안 교정', volume: '2,000자', text: '자기소개서 교정' }).quote;
assert.equal(selfIntroQuote.amount, 39000);
assert.match(selfIntroQuote.message, /원가 50,000원 → 할인가 39,000원으로 제안드립니다/);
assert.doesNotMatch(selfIntroQuote.message, /숨고 평균가|30% 조정 기준가|기준가 대비/);
assert.match(selfIntroQuote.followupMessage, /자기소개서 대필 견적은 39,000원/);
assert.doesNotMatch(selfIntroQuote.followupMessage, /1\) 진행\s+2\) 샘플 먼저\s+3\) 질문/, '자소서 후속 안내도 자연어 대화를 사용한다');

const smallQuote = buildSoomgoQuote({ purpose: '카피라이팅', volume: '1쪽' }).quote;
assert.equal(smallQuote.marketAdjustmentRate, 0);
assert.equal(smallQuote.discountRate, 0.2);
assert.match(smallQuote.message, /할인가/);

assert.equal(workflowHireConfirmed({ soomgoLeads: [{ id: 'LEAD-1', hireEvidence: { confirmed: true } }] }, { id: 'WF-1', leadId: 'LEAD-1' }), true);
assert.equal(workflowHireConfirmed({ soomgoLeads: [{ id: 'LEAD-1', hiredAt: '2026-09-16T00:00:00Z' }] }, { id: 'WF-1', leadId: 'LEAD-1' }), false);
assert.equal(workflowHireConfirmed({}, { hireEvidence: { confirmed: true } }), true);
assert.equal(workflowHireConfirmed({}, { hiredAt: '2026-09-16T00:00:00Z' }), false);

console.log('Soomgo pricing tiers and confirmed-hire filters passed.');
