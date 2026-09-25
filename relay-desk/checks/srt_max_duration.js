'use strict';
const { parse } = require('./_srt');
// 한 블록 노출 시간이 maxDurationSeconds(기본 7.0초)를 넘으면 실패.
module.exports = (deliverable, context) => {
  const result = parse(deliverable);
  if (result.error) return { passed: false, detail: result.error, location: 'srt' };
  const maximum = Number(context.checkParams?.maxDurationSeconds ?? 7) * 1000;
  const block = result.blocks.find(item => item.end - item.start > maximum);
  return block
    ? { passed: false, detail: `노출 시간이 ${(block.end - block.start) / 1000}초로 최대 ${maximum / 1000}초를 초과합니다.`, location: block.location }
    : { passed: true };
};
