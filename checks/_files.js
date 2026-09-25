'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function filePathOf(deliverable) {
  if (typeof deliverable === 'string') return deliverable;
  return deliverable?.path || deliverable?.filePath || null;
}

function bufferOf(deliverable) {
  if (Buffer.isBuffer(deliverable)) return deliverable;
  if (Buffer.isBuffer(deliverable?.buffer)) return deliverable.buffer;
  const filePath = filePathOf(deliverable);
  return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

function extensionOf(deliverable) {
  const explicit = deliverable?.format || deliverable?.extension;
  if (explicit) return String(explicit).replace(/^\./, '').toLowerCase();
  const filePath = filePathOf(deliverable);
  return filePath ? path.extname(filePath).slice(1).toLowerCase() : '';
}

function zipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('ZIP 파일이 아니거나 손상되었습니다.');
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('ZIP 중앙 디렉터리를 찾지 못했습니다.');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP 항목 헤더가 손상되었습니다.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP 로컬 헤더가 손상되었습니다: ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null;
    if (!data) throw new Error(`지원하지 않는 ZIP 압축 방식입니다: ${method}`);
    entries.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlText(xml) {
  return String(xml || '')
    .replace(/<w:tab\s*\/?>/gi, '\t')
    .replace(/<w:(?:br|cr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function pdfText(buffer) {
  return [...buffer.toString('latin1').matchAll(/\(([^()]*)\)\s*Tj/g)]
    .map(match => match[1].replace(/\\([()\\])/g, '$1'))
    .join(' ');
}

module.exports = { bufferOf, extensionOf, filePathOf, pdfText, xmlText, zipEntries };
