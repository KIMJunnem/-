'use strict';

// 자막 번역 가산 20%·납기·번역 문구 일치(2026-09-22 준희 승인)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSoomgoQuote, workflowAdditionalFee } = require('../server/relay-server');
const service = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'services', 'subtitle.json'), 'utf8'));

const quote = (minutes, text) => buildSoomgoQuote({ purpose: '자막 제작', volume: `${minutes}분`, text, topic: text }).quote;
const korean = m => quote(m, '한국어 인터뷰 영상 자막');
const translated = m => quote(m, '영어 영상 한국어 번역 자막');

// 값은 subtitle.json에 있다(코드에 박지 않음)
const rule = service.pricing.additionalFees.find(item => item.id === 'translation');
assert.equal(rule.rate, 0.2); assert.equal(rule.rounding, 1000); assert.equal(rule.amount, undefined, '5분당 고정 번역비 폐지');

const expected = { 5: [32000, 38000], 10: [49000, 59000], 33: [99000, 119000] };
const table = {};
for (const [minutes, [ko, tr]] of Object.entries(expected)) {
  const k = korean(Number(minutes)), t = translated(Number(minutes));
  table[`${minutes}분`] = { korean: k.amount, translated: t.amount, koreanDays: k.days, translatedDays: t.days, translatedVersion: t.quoteMessageVersion };
  assert.equal(k.amount, ko, `한국어 ${minutes}분`);
  assert.equal(t.amount, tr, `번역 ${minutes}분`);
  assert.equal(t.translationIncluded, true);
  assert.equal(k.translationIncluded, false);
}
// 삽입(5분당 15,000)은 번역 가산 뒤에 더한다: 33분 번역 119,000 + 7×15,000 = 224,000
const burnIn = quote(33, '영어 영상 번역 자막, 영상에 자막 삽입');
assert.equal(burnIn.amount, 119000 + 7 * 15000);
table['33분 번역+삽입'] = burnIn.amount;

// 납기: 준희 결정 — 영상 길이와 상관없이 당일~1일.
assert.equal(korean(33).days, '당일~1일');
assert.equal(translated(33).days, '당일~1일');

// 번역 추가금(견적 후 번역 요청): 자막 금액의 20%, 천 원 반올림
assert.equal(workflowAdditionalFee({ serviceId: 'subtitle', label: '자막 제작', amount: 49000 }, '번역도 해주세요'), 10000);
assert.equal(workflowAdditionalFee({ serviceId: 'subtitle', label: '자막 제작', amount: 109000 }, '번역도 해주세요'), 22000);

// 금액과 문구 일치: 번역비가 들어간 견적에 '번역은 포함되지 않' 문구가 있으면 실패
const noTranslation = /번역[^.。\n]{0,40}포함(?:되지|하지)\s*않/;
for (const minutes of [5, 10, 33]) {
  for (const q of [translated(minutes), burnIn]) {
    for (const text of [q.message, q.basicScope, q.scope].filter(Boolean)) {
      assert.equal(noTranslation.test(text), false, `번역 견적(${q.amount}원)에 번역 미포함 문구: ${text}`);
    }
    // 2026-09-22 준희 정정: 미포함 문장만 지우고 새 문장은 넣지 않는다. 견적 문구·버전은 한국어와 같다.
    assert.equal(q.message.includes('한국어로 옮긴 뒤'), false);
    assert.equal(q.quoteMessageVersion, service.quoteMessageVersion);
  }
  const k = korean(minutes);
  assert.equal(k.quoteMessageVersion, service.quoteMessageVersion, '한국어 영상 견적 문구는 그대로');
  // 9/24 지시 24: 영상 편집을 팔기 시작해서(7-4) "영상 편집은 하지 않습니다" 문장을 뺐다. 범위 문구의 나머지는 그대로.
  assert.ok(/자막 파일\(SRT\) 제작과 수정 2회입니다\.$/.test(k.basicScope), '한국어 영상 범위 문구');
  assert.ok(!/영상 편집은 하지 않습니다/.test(k.basicScope), '영상 편집 불가 문장 없음');
}
console.log(JSON.stringify(table, null, 2));
console.log(translated(33).message);
console.log('subtitle-translation-pricing: PASS');
process.exit(0);
