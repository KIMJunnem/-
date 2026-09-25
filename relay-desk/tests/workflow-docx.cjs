'use strict';

const assert = require('assert');
const zlib = require('zlib');
const { createWorkflowDocx } = require('../server/workflow-docx');

function readEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.toString('utf8', nameStart, nameStart + nameLength);
    entries.set(name, zlib.inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize)).toString('utf8'));
    offset = dataStart + compressedSize;
  }
  return entries;
}

const docx = createWorkflowDocx('### 제목\n\n본문의 **중요한 내용** & 확인');
assert.strictEqual(docx.readUInt32LE(0), 0x04034b50, 'DOCX must be a ZIP package');
const entries = readEntries(docx);
assert(entries.has('[Content_Types].xml'));
assert(entries.has('_rels/.rels'));
assert(entries.has('word/document.xml'));
const xml = entries.get('word/document.xml');
assert(xml.includes('제목'));
assert(xml.includes('본문의 중요한 내용 &amp; 확인'));
assert(!xml.includes('**중요한 내용**'));
console.log('[PASS] Word deliverable is a readable DOCX package with escaped Unicode text');
