'use strict';

const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createWorkflowXlsx } = require('../server/workflow-xlsx');

const file = createWorkflowXlsx('| 항목 | 내용 |\n| --- | --- |\n| 제목 | 검수 결과 |', { purpose: '문서 작업', topic: '형식 검증' });
assert.equal(file.readUInt32LE(0), 0x04034b50, 'XLSX must be a ZIP package');
const entries = new Map();
let offset = 0;
while (offset + 30 <= file.length && file.readUInt32LE(offset) === 0x04034b50) {
  const method = file.readUInt16LE(offset + 8);
  const compressedSize = file.readUInt32LE(offset + 18);
  const nameLength = file.readUInt16LE(offset + 26);
  const extraLength = file.readUInt16LE(offset + 28);
  const nameStart = offset + 30;
  const name = file.toString('utf8', nameStart, nameStart + nameLength);
  const dataStart = nameStart + nameLength + extraLength;
  const packed = file.subarray(dataStart, dataStart + compressedSize);
  const content = method === 8 ? zlib.inflateRawSync(packed) : packed;
  entries.set(name, content.toString('utf8'));
  offset = dataStart + compressedSize;
}
assert.ok(entries.has('[Content_Types].xml'));
assert.match(entries.get('xl/workbook.xml'), /작업 결과/);
assert.match(entries.get('xl/workbook.xml'), /작업 정보/);
assert.match(entries.get('xl/worksheets/sheet1.xml'), /검수 결과/);
assert.match(entries.get('xl/worksheets/sheet2.xml'), /형식 검증/);
assert.ok(file.includes(Buffer.from([0x50, 0x4b, 0x01, 0x02])), 'XLSX must include a central directory');
console.log('workflow-xlsx: valid OOXML package and expected sheets');
