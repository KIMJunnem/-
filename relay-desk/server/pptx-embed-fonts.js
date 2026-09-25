'use strict';

// PPTX에 OFL 글꼴(Pretendard Regular·Bold)을 원본 그대로 넣는다 — services/presentation-design/tools/embed-fonts.py를
// Node로 옮긴 것(2026-09-23 지시 5). PC에 python-pptx·fontTools를 설치할 수 없어서(셸 없음·PyPI 막힘) 같은 결과를 Node로 만든다.
// 결과 바이트는 파이썬 판과 같다(tests/pptx-embed-fonts.cjs가 파이썬 결과 기록값과 대조).
// PowerPoint 방식: ppt/fonts/*.fntdata(EOT, 압축 없음) + presentation.xml embeddedFontLst. 글꼴을 자르거나 고치지 않는다.

const fs = require('node:fs');
const path = require('node:path');

const ALLOWED = new Set(['Pretendard']); // OFL 확인된 글꼴만. 고객 지정 글꼴은 넣지 않는다.
const FONT_DIR = path.join(__dirname, '..', 'services', 'presentation-design', 'fonts', 'public', 'static', 'alternative');

function tables(buf) {
  const n = buf.readUInt16BE(4);
  const out = {};
  for (let i = 0; i < n; i += 1) {
    const at = 12 + i * 16;
    out[buf.toString('latin1', at, at + 4)] = { offset: buf.readUInt32BE(at + 8), length: buf.readUInt32BE(at + 12) };
  }
  return out;
}

// fontTools name.getDebugName과 같은 규칙: 표 순서대로 보며 (1,0)·(3,0x409)이 먼저 나오면 그것, 없으면 마지막으로 읽힌 것.
function debugName(buf, t, nameId) {
  const base = t.name.offset;
  const count = buf.readUInt16BE(base + 2);
  const strings = base + buf.readUInt16BE(base + 4);
  let some = null;
  for (let i = 0; i < count; i += 1) {
    const r = base + 6 + i * 12;
    const platform = buf.readUInt16BE(r), encoding = buf.readUInt16BE(r + 2), lang = buf.readUInt16BE(r + 4), id = buf.readUInt16BE(r + 6);
    if (id !== nameId) continue;
    const len = buf.readUInt16BE(r + 8), off = buf.readUInt16BE(r + 10);
    const raw = buf.subarray(strings + off, strings + off + len);
    let text;
    if (platform === 0 || platform === 3) { const le = Buffer.from(raw); le.swap16(); text = le.toString('utf16le'); }
    else if (platform === 1 && encoding === 0) text = raw.toString('latin1');
    else continue;
    some = text;
    if ((platform === 1 && lang === 0) || (platform === 3 && lang === 0x409)) return text;
  }
  return some;
}

function eot(file) {
  const data = fs.readFileSync(file);
  const t = tables(data);
  const os2 = t['OS/2'].offset, head = t.head.offset;
  const version = data.readUInt16BE(os2);
  const fsType = data.readUInt16BE(os2 + 8);
  if (fsType & 0x0002) throw new Error(`포함 금지 글꼴(fsType): ${file}`);
  const le16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const le32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
  const name = id => Buffer.from(debugName(data, t, id) || '', 'utf16le');
  const parts = [];
  for (const id of [1, 2, 5, 4]) { const n = name(id); parts.push(le16(0), le16(n.length), n); }
  parts.push(le16(0), le16(0)); // Padding5 + RootStringSize(0)
  const body = Buffer.concat(parts);
  const fixed = Buffer.concat([
    le32(0), le32(data.length), le32(0x00020001), le32(0),
    data.subarray(os2 + 32, os2 + 42), // PANOSE 10바이트
    Buffer.from([1, data.readUInt16BE(os2 + 62) & 1 ? 1 : 0]), // Charset, Italic(fsSelection bit 0)
    le32(data.readUInt16BE(os2 + 4)), le16(fsType), le16(0x504C),
    le32(data.readUInt32BE(os2 + 42)), le32(data.readUInt32BE(os2 + 46)), le32(data.readUInt32BE(os2 + 50)), le32(data.readUInt32BE(os2 + 54)),
    le32(version >= 1 ? data.readUInt32BE(os2 + 78) : 0), le32(version >= 1 ? data.readUInt32BE(os2 + 82) : 0),
    le32(data.readUInt32BE(head + 8)), le32(0), le32(0), le32(0), le32(0)
  ]);
  const total = fixed.length + body.length + data.length;
  return { bytes: Buffer.concat([le32(total), fixed.subarray(4), body, data]), family: debugName(data, t, 1), style: debugName(data, t, 2) };
}

async function embedFonts({ src, out, fontDir = FONT_DIR }) {
  const JSZip = require('jszip');
  const reg = eot(path.join(fontDir, 'Pretendard-Regular.ttf'));
  const bold = eot(path.join(fontDir, 'Pretendard-Bold.ttf'));
  if (!(reg.family === bold.family && ALLOWED.has(reg.family) && bold.style === 'Bold')) throw new Error(`font_mismatch:${reg.family}/${bold.family}/${bold.style}`);
  const zip = await JSZip.loadAsync(fs.readFileSync(src));
  if (Object.keys(zip.files).some(n => n.startsWith('ppt/fonts/'))) throw new Error('fonts_already_embedded');
  let ct = await zip.file('[Content_Types].xml').async('string');
  if (!ct.includes('Extension="fntdata"')) ct = ct.replace('<Default Extension="xml"', '<Default Extension="fntdata" ContentType="application/x-fontdata"/><Default Extension="xml"');
  const ids = ['rIdSwanFont1', 'rIdSwanFont2'];
  let rels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  rels = rels.replace('</Relationships>', ids.map((rid, i) => `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${i + 1}.fntdata"/>`).join('') + '</Relationships>');
  let pres = await zip.file('ppt/presentation.xml').async('string');
  const lst = `<p:embeddedFontLst><p:embeddedFont><p:font typeface="${reg.family}" pitchFamily="2" charset="-127"/><p:regular r:id="${ids[0]}"/><p:bold r:id="${ids[1]}"/></p:embeddedFont></p:embeddedFontLst>`;
  const m = /<p:notesSz[^>]*\/>/.exec(pres);
  if (!m) throw new Error('notesSz_missing');
  pres = pres.slice(0, m.index + m[0].length) + lst + pres.slice(m.index + m[0].length); // 스키마 순서: notesSz 다음
  pres = pres.replace('<p:presentation ', '<p:presentation embedTrueTypeFonts="1" ');
  zip.file('[Content_Types].xml', ct); zip.file('ppt/_rels/presentation.xml.rels', rels); zip.file('ppt/presentation.xml', pres);
  zip.file('ppt/fonts/font1.fntdata', reg.bytes, { createFolders: false }); zip.file('ppt/fonts/font2.fntdata', bold.bytes, { createFolders: false });
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(out, buf);
  return { out, bytes: buf.length, family: reg.family };
}

module.exports = { FONT_DIR, eot, embedFonts };
