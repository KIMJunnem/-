'use strict';
const { bufferOf, extensionOf, pdfText, xmlText, zipEntries } = require('./_files');

const compoundHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function inspect(deliverable) {
  const buffer = bufferOf(deliverable);
  const format = extensionOf(deliverable);
  if (!buffer) throw new Error('문서 파일을 읽을 수 없습니다.');
  if (format === 'docx') {
    const entries = zipEntries(buffer);
    const document = entries.get('word/document.xml');
    if (!entries.has('[Content_Types].xml') || !document) throw new Error('DOCX 필수 구조가 없습니다.');
    return { format, text: xmlText(document.toString('utf8')) };
  }
  if (format === 'pdf') {
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-')) || !/%%EOF\s*$/s.test(buffer.toString('latin1'))) throw new Error('PDF 헤더 또는 종료 표식이 없습니다.');
    return { format, text: pdfText(buffer) };
  }
  if (format === 'hwp') {
    const fileHeaderMarker = Buffer.from('FileHeader', 'utf16le');
    if (buffer.length >= 512 && buffer.subarray(0, 8).equals(compoundHeader) && buffer.includes(fileHeaderMarker)) return { format, text: '', lengthUnavailable: true };
    try {
      const entries = zipEntries(buffer);
      if (!entries.has('mimetype') || !/hwp\+zip|hwpx/i.test(entries.get('mimetype').toString('utf8'))) throw new Error('HWPX 구조가 아닙니다.');
      const text = [...entries.entries()].filter(([name]) => /Contents\/section\d+\.xml/i.test(name)).map(([, value]) => xmlText(value.toString('utf8'))).join(' ');
      return { format, text };
    } catch (_) { throw new Error('HWP/HWPX 파일 구조를 확인할 수 없습니다.'); }
  }
  throw new Error(`지원하지 않는 문서 형식입니다: ${format || '(없음)'}`);
}

module.exports = { inspect };
