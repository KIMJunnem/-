'use strict';

// 단가 질문('장당 39000원인가요?', '10장이면 얼마예요?')은 가격표로 계산해 답한다(2026-09-22). 정상가·할인 표현 금지.
const assert = require('node:assert/strict');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { soomgoReply, buildSoomgoQuote } = require('../server/relay-server');
const q = n => buildSoomgoQuote({ requestId: `UP-${n}`, text: `요청 상세\nPPT 제작\n이용 목적\n연설/강연\n작업 분량\n${n}장\n` }).quote;
const ppt = q(7);
const ask = (message, quote = ppt, ctx = null) => soomgoReply({ conversationId: `UP-${message}-${quote.amount}`, message, conversationText: `${ctx || `[swan] ${quote.message || ''}`}\n[고객] ${message}`, quote });

const unit = ask('장당39000원인가요?');
assert.equal(unit.templateKey, 'auto_unit_price'); assert.equal(unit.autoSend, true);
assert.match(unit.text, /장당 금액이 아니라 7장까지 전체 39,000원/);
// 장수 질문 금액 = 견적 엔진 금액
for (const n of [10, 13, 15, 20]) {
  const r = ask(`${n}장이면 얼마예요?`);
  assert.match(r.text, new RegExp(`${n}장이면 ${q(n).amount.toLocaleString('ko-KR')}원입니다`), `${n}장`);
}
// 견적에 서비스가 없어도(분류 실패 기록) 대화에 PPT가 보이면 PPT 기준
assert.match(ask('장당39000원인가요?', { amount: 28000, serviceId: null, label: '' }, '[고객] PPT 제작 요청').text, /7장까지 전체 39,000원/);
// 문서
const doc = buildSoomgoQuote({ requestId: 'UP-D', text: '요청 상세\n문서/글 작성\n작업 분량\nA4 기준 2\n작성 주제\n병원 소개 원고\n' }).quote;
assert.match(ask('쪽당 얼마예요?', doc).text, /A4 2쪽까지 21,000원이고, 1쪽 늘어날 때마다 9,000원/);
// 일반 가격 답변: 정상가·할인 표현 없음, 문장 깨짐 없음
const price = ask('가격이 얼마인가요?');
assert.equal(price.templateKey, 'auto_price');
assert.ok(!/정상가|할인/.test(price.text), price.text);
assert.ok(!/\.\./.test(price.text) && !/기준이고 예상/.test(price.text), price.text);
console.log('unit-price-reply: PASS');
