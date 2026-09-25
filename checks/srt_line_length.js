'use strict';
const { parse, weightedLength } = require('./_srt');
// 한 줄 길이는 가중치 글자 수(전각 1, 반각 0.5)로 센다. 줄 앞뒤 공백은 세지 않는다.
module.exports = (deliverable, context) => {
  const result = parse(deliverable);
  if (result.error) return { passed: false, detail: result.error, location: 'srt' };
  const params = context.checkParams || {};
  const maxChars = Number(params.maxLineChars);
  const maxLines = Number(params.maxLines);
  for (const block of result.blocks) {
    if (block.lines.length > maxLines) return { passed: false, detail: `자막이 ${block.lines.length}줄로 최대 ${maxLines}줄을 초과합니다.`, location: block.location };
    for (const item of block.lines) {
      const length = weightedLength(item.trim(), params);
      if (length > maxChars) return { passed: false, detail: `한 줄이 ${length}자(전각 1·반각 0.5 기준)로 최대 ${maxChars}자를 초과합니다.`, location: block.location };
    }
  }
  return { passed: true };
};
