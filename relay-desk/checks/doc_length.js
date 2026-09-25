'use strict';
const { inspect } = require('./_document');
module.exports = (deliverable, context) => {
  try {
    const document = inspect(deliverable);
    const expected = Number(context.minimumChars ?? context.expectedChars ?? context.orderChars);
    if (!Number.isFinite(expected) || expected < 0) return { passed: false, status: 'manual_review', detail: '주문 분량 기준이 없어 자동으로 분량을 판정할 수 없습니다.', location: 'context.minimumChars' };
    if (document.lengthUnavailable) return { passed: false, status: 'manual_review', detail: '이 HWP 형식은 자동 분량 추출이 불가능합니다.', location: 'document' };
    const actual = [...String(document.text || '').replace(/\s/g, '')].length;
    return actual >= expected ? { passed: true } : { passed: false, detail: `문서 분량이 ${actual}자로 주문 기준 ${expected}자보다 짧습니다.`, location: 'document:text' };
  } catch (error) { return { passed: false, detail: error.message, location: 'document' }; }
};
