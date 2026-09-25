'use strict';
const { parse } = require('./_srt');
module.exports = deliverable => {
  const result = parse(deliverable);
  if (result.error) return { passed: false, detail: result.error, location: 'srt' };
  for (let index = 0; index < result.blocks.length; index += 1) {
    const block = result.blocks[index];
    if (block.number !== index + 1) return { passed: false, detail: `블록 번호 ${block.number}의 순서가 올바르지 않습니다.`, location: block.location };
    if (index && block.start < result.blocks[index - 1].start) return { passed: false, detail: '타임코드 시작 순서가 역전되었습니다.', location: block.location };
  }
  return { passed: true };
};
