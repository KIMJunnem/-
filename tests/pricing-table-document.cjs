'use strict';

// 문서 계열 가격표(2026-09-21) 회귀 검사. 외부 API는 호출하지 않는다.
const assert = require('node:assert/strict');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { documentQuote, documentWorkType } = require('../server/pricing-table');
const { buildSoomgoQuote } = require('../server/relay-server');

assert.equal(documentWorkType({ purpose: '속기(타이핑)' }), 'stenography');
assert.equal(documentWorkType({ purpose: '교정/교열' }), 'proofreading');
assert.equal(documentWorkType({ purpose: '문서/글 작성', topic: '내용은 다되어있고 양식만 깔끔하게 다듬어주실분' }), 'formatting');
assert.equal(documentWorkType({ purpose: '문서/글 작성', topic: '회사 소개 문서 작성' }), 'writing');

assert.equal(documentQuote({ purpose: '문서/글 작성', pages: 1 }).amount, 21000);
assert.equal(documentQuote({ purpose: '문서/글 작성', pages: 10 }).amount, 93000);
assert.equal(documentQuote({ purpose: '문서/글 작성', topic: '양식만 정리', pages: 25 }).amount, 45000);
assert.equal(documentQuote({ purpose: '교정/교열', pages: 10 }).amount, 51000);
assert.equal(documentQuote({ purpose: '속기(타이핑)', volume: '30분' }).amount, 57000);
assert.equal(documentQuote({ purpose: '속기(타이핑)', volume: '1시간 20분' }).amount, 147000);
assert.ok(documentQuote({ purpose: '속기(타이핑)', volume: '1분' }).amount >= 15000, '숨고 최소 거래금액');

const text = '요청 상세\n고객 정보\n견적 보낸 고수 1명\n방금\n문서/글 작성\n\n이용 목적\n기술문서\n파일 형식\n워드\n작업 분량\nA4 기준 25\n작성 주제\n제품 메뉴얼 내용은 다되어있고 양식만 깔끔하게 다듬어주실분\n';
const { quote } = buildSoomgoQuote({ requestId: 'PRICE-T1', text, volume: 'A4 기준 25', format: '워드', topic: '제품 메뉴얼 내용은 다되어있고 양식만 깔끔하게 다듬어주실분' });
assert.equal(quote.serviceId, 'document_writing');
assert.equal(quote.amount, 45000);
assert.equal(quote.regularAmount, quote.amount, '가짜 할인 전 가격 없음');
assert.match(quote.message, /45,000원/);

const steno = buildSoomgoQuote({ requestId: 'PRICE-T2', text: '요청 상세\n방금\n속기(타이핑)\n\n작업 분량\n30분\n', volume: '30분' }).quote;
assert.equal(steno.serviceId, 'document_writing');
assert.equal(steno.amount, 57000);
assert.match(steno.message, /도장이나 인증은 해드리지 못합니다/);
console.log('pricing-table-document: PASS');
