'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runChecks } = require('../server/quality-runner');

const samples = path.join(__dirname, 'samples');
fs.mkdirSync(samples, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(value);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  const count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
function write(name, value) { const target = path.join(samples, name); fs.writeFileSync(target, value); return target; }
function pptx(slides) {
  const entries = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    'ppt/presentation.xml': '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>'
  };
  slides.forEach((text, index) => { entries[`ppt/slides/slide${index + 1}.xml`] = `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${text ? `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>` : ''}</p:spTree></p:cSld></p:sld>`; });
  return zip(entries);
}
function docx(text) {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  });
}

const goodSrt = '1\n00:00:00,000 --> 00:00:02,000\n안녕하세요\n\n2\n00:00:02,200 --> 00:00:04,200\n반갑습니다\n';
const srtCases = {
  srt_parse: [goodSrt, 'one\nnot-a-time\nbad\n'],
  srt_order: [goodSrt, '2\n00:00:00,000 --> 00:00:02,000\n안녕하세요\n'],
  srt_overlap: [goodSrt, '1\n00:00:00,000 --> 00:00:02,000\n하나\n\n2\n00:00:01,500 --> 00:00:03,000\n둘\n'],
  srt_min_duration: [goodSrt, '1\n00:00:00,000 --> 00:00:00,500\n짧아요\n'],
  srt_max_duration: [goodSrt, '1\n00:00:00,000 --> 00:00:08,000\n너무 오래 떠 있는 자막\n'],
  srt_line_length: [goodSrt, `1\n00:00:00,000 --> 00:00:03,000\n${'가'.repeat(21)}\n`],
  srt_cps: [goodSrt, `1\n00:00:00,000 --> 00:00:01,000\n${'가'.repeat(16)}\n`]
};
for (const [id, [pass, fail]] of Object.entries(srtCases)) { write(`${id}-pass.srt`, pass); write(`${id}-fail.srt`, fail); }

write('pptx_open-pass.pptx', pptx(['정상'])); write('pptx_open-fail.pptx', 'broken');
write('pptx_slide_count-pass.pptx', pptx(['하나', '둘'])); write('pptx_slide_count-fail.pptx', pptx(['하나']));
write('pptx_empty_slide-pass.pptx', pptx(['내용'])); write('pptx_empty_slide-fail.pptx', pptx(['']));
write('doc_open-pass.docx', docx('정상 문서 내용입니다.')); write('doc_open-fail.docx', 'broken');
write('doc_length-pass.docx', docx('충분한 문서 내용이 들어 있습니다.')); write('doc_length-fail.docx', docx('짧음'));
write('doc_open-pass.pdf', '%PDF-1.4\n1 0 obj <<>> endobj\nBT (PDF text) Tj ET\n%%EOF\n'); write('doc_open-fail.pdf', 'broken');
const hwp = Buffer.alloc(512); Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]).copy(hwp); Buffer.from('FileHeader','utf16le').copy(hwp,64);
write('doc_open-pass.hwp', hwp); write('doc_open-fail.hwp', Buffer.from('broken'));

const checkParams = { minDurationSeconds: 0.8, maxLineChars: 20, maxLines: 2, maxCps: 15 };
async function direct(id, passFile, failFile, context = {}) {
  const check = require(`../checks/${id}`);
  assert.equal((await check({ path: passFile }, { checkParams, ...context }, { id, blocking: true })).passed, true, `${id} pass sample`);
  assert.equal((await check({ path: failFile }, { checkParams, ...context }, { id, blocking: true })).passed, false, `${id} fail sample`);
}

(async () => {
  for (const id of Object.keys(srtCases)) await direct(id, path.join(samples, `${id}-pass.srt`), path.join(samples, `${id}-fail.srt`));
  await direct('pptx_open', path.join(samples,'pptx_open-pass.pptx'), path.join(samples,'pptx_open-fail.pptx'));
  await direct('pptx_slide_count', path.join(samples,'pptx_slide_count-pass.pptx'), path.join(samples,'pptx_slide_count-fail.pptx'), { expectedSlides: 2 });
  await direct('pptx_empty_slide', path.join(samples,'pptx_empty_slide-pass.pptx'), path.join(samples,'pptx_empty_slide-fail.pptx'));
  await direct('doc_open', path.join(samples,'doc_open-pass.docx'), path.join(samples,'doc_open-fail.docx'));
  const docOpen = require('../checks/doc_open');
  assert.equal((await docOpen({path:path.join(samples,'doc_open-pass.pdf')}, {}, {})).passed, true);
  assert.equal((await docOpen({path:path.join(samples,'doc_open-fail.pdf')}, {}, {})).passed, false);
  assert.equal((await docOpen({path:path.join(samples,'doc_open-pass.hwp')}, {}, {})).passed, true);
  assert.equal((await docOpen({path:path.join(samples,'doc_open-fail.hwp')}, {}, {})).passed, false);
  await direct('doc_length', path.join(samples,'doc_length-pass.docx'), path.join(samples,'doc_length-fail.docx'), { minimumChars: 10 });

  const serviceResults = {
    subtitle: await runChecks('subtitle', { path: path.join(samples,'srt_parse-pass.srt') }, {}),
    presentation: await runChecks('presentation', { path: path.join(samples,'pptx_slide_count-pass.pptx') }, { expectedSlides: 2 }),
    document_writing: await runChecks('document_writing', { path: path.join(samples,'doc_length-pass.docx') }, { minimumChars: 10 }),
    translation_en: await runChecks('translation_en', {}, {})
  };
  // 2026-09-22: 전사가 없으면 싱크·누락 구간 검사 둘 다 manual_review
  assert.equal(serviceResults.subtitle.status, 'manual_review');
  assert.deepEqual(serviceResults.subtitle.failures.map(item => item.id).sort(), ['coverage_manual_review_required', 'sync_manual_review_required']);
  assert.equal(serviceResults.presentation.passed, true);
  assert.equal(serviceResults.document_writing.passed, true);
  assert.equal(serviceResults.translation_en.passed, true);
  console.log(JSON.stringify(serviceResults, null, 2));
  console.log('quality-runner-stage4-2: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
