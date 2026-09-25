'use strict';
const { parse } = require('./_srt');
module.exports = deliverable => {
  const result = parse(deliverable);
  if (result.error) return { passed: false, detail: result.error, location: 'srt' };
  for (let index = 1; index < result.blocks.length; index += 1) {
    if (result.blocks[index].start < result.blocks[index - 1].end) return { passed: false, detail: '앞 블록과 노출 시간이 겹칩니다.', location: result.blocks[index].location };
  }
  return { passed: true };
};
