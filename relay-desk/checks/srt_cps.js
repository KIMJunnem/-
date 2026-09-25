'use strict';
const { parse, weightedLength } = require('./_srt');
// 초당 글자 수는 블록의 모든 줄(앞뒤 공백 제외, 줄 안 공백 포함)을 가중치 글자 수(전각 1, 반각 0.5)로 세어 노출 시간으로 나눈다.
module.exports = (deliverable, context) => {
  const result = parse(deliverable);
  if (result.error) return { passed: false, detail: result.error, location: 'srt' };
  const params = context.checkParams || {};
  const maxCps = Number(params.maxCps);
  for (const block of result.blocks) {
    const chars = block.lines.reduce((sum, line) => sum + weightedLength(line.trim(), params), 0);
    const cps = chars / ((block.end - block.start) / 1000);
    if (cps > maxCps) return { passed: false, detail: `초당 글자 수가 ${cps.toFixed(1)}자(전각 1·반각 0.5 기준)로 상한 ${maxCps}자를 초과합니다.`, location: block.location };
  }
  return { passed: true };
};
