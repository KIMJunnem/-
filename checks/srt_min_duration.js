'use strict';
const { parse } = require('./_srt');
module.exports = (deliverable, context) => {
  const result = parse(deliverable);
  if (result.error) return { passed: false, detail: result.error, location: 'srt' };
  const minimum = Number(context.checkParams.minDurationSeconds) * 1000;
  const block = result.blocks.find(item => item.end - item.start < minimum);
  return block ? { passed: false, detail: `노출 시간이 ${(block.end - block.start) / 1000}초로 최소 ${minimum / 1000}초보다 짧습니다.`, location: block.location } : { passed: true };
};
