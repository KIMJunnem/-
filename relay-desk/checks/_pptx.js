'use strict';
const { bufferOf, zipEntries } = require('./_files');

function inspect(deliverable) {
  const buffer = bufferOf(deliverable);
  if (!buffer) throw new Error('PPTX 파일을 읽을 수 없습니다.');
  const entries = zipEntries(buffer);
  if (!entries.has('[Content_Types].xml') || !entries.has('ppt/presentation.xml')) throw new Error('PPTX 필수 구조가 없습니다.');
  const slides = [...entries.entries()]
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(([left], [right]) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  if (!slides.length) throw new Error('PPTX에 슬라이드가 없습니다.');
  return { entries, slides };
}

module.exports = { inspect };
