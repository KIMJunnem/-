'use strict';
const { inspect } = require('./_pptx');
module.exports = (deliverable, context) => {
  try {
    const { slides } = inspect(deliverable);
    const expected = Number(context.expectedSlides ?? context.orderSlides ?? context.pages);
    if (!Number.isFinite(expected) || expected < 1) return { passed: false, status: 'manual_review', detail: '주문 장수 기준이 없어 자동으로 장수를 판정할 수 없습니다.', location: 'context.expectedSlides' };
    return slides.length === expected ? { passed: true } : { passed: false, detail: `슬라이드가 ${slides.length}장으로 주문한 ${expected}장과 다릅니다.`, location: 'pptx/slides' };
  } catch (error) { return { passed: false, detail: error.message, location: 'pptx' }; }
};
