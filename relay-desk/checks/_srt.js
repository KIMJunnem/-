'use strict';

const { bufferOf } = require('./_files');

function timestamp(value) {
  const match = String(value).match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number(match[4]);
}

function parse(deliverable) {
  const source = typeof deliverable?.text === 'string'
    ? deliverable.text
    : bufferOf(deliverable)?.toString('utf8');
  if (!source?.trim()) return { error: 'SRT 내용이 비어 있습니다.', blocks: [] };
  const chunks = source.replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split(/\n{2,}/);
  const blocks = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const lines = chunks[index].split('\n');
    if (lines.length < 3 || !/^\d+$/.test(lines[0].trim())) return { error: `${index + 1}번째 블록 번호 형식이 올바르지 않습니다.`, blocks };
    const timing = lines[1].trim().match(/^(\S+)\s*-->\s*(\S+)$/);
    const start = timing && timestamp(timing[1]);
    const end = timing && timestamp(timing[2]);
    if (!timing || start == null || end == null || end <= start) return { error: `${index + 1}번째 블록 타임코드가 올바르지 않습니다.`, blocks };
    if (!lines.slice(2).some(line => line.trim())) return { error: `${index + 1}번째 블록 대사가 비어 있습니다.`, blocks };
    blocks.push({ number: Number(lines[0]), start, end, lines: lines.slice(2), location: `block:${index + 1}` });
  }
  return { error: null, blocks };
}

// 글자 폭 가중치(2026-09-22 준희 지시): 전각(한글·한자·가나 등) 1, 반각(영문·숫자·공백·기호 등) 0.5.
// 가중치 값은 services/subtitle.json checkParams(charWeightFullWidth / charWeightHalfWidth)에서 읽는다.
function isHalfWidth(codePoint) {
  if (codePoint < 0x1100) return true; // 기본 라틴·숫자·공백·일반 기호·라틴 확장
  if (codePoint >= 0x2000 && codePoint <= 0x206F) return true; // 일반 구두점(…, ‘’ 등)
  if (codePoint >= 0xFF61 && codePoint <= 0xFFDC) return true; // 반각 가나·반각 한글
  if (codePoint >= 0xFFE8 && codePoint <= 0xFFEE) return true;
  return false;
}

function weightedLength(text, params = {}) {
  const full = Number(params.charWeightFullWidth ?? 1);
  const half = Number(params.charWeightHalfWidth ?? 0.5);
  let total = 0;
  for (const char of String(text || '')) total += isHalfWidth(char.codePointAt(0)) ? half : full;
  return Math.round(total * 100) / 100;
}

module.exports = { parse, weightedLength, isHalfWidth };
