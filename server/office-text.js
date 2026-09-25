'use strict';

// 고객 파일에서 글자만 뽑는다(2026-09-21). 외부 패키지 없이 Node 기본 기능만 쓴다.
// 지원: docx·pptx·xlsx·hwpx(압축 XML), hwp(한글 5.0 바이너리), txt·csv·srt.
// 암호·배포용 한글 문서, 스캔 이미지만 있는 문서는 글자를 뽑지 못한다.

const zlib = require('zlib');

const MAX_TEXT = 60000;

function extOf(name = '') {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]{2,5})(?:$|[?#\s])/);
  return match ? match[1] : '';
}

// ---------- ZIP ----------
function readZip(buffer) {
  const files = new Map();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip_eocd_missing');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && offset + 46 <= buffer.length; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8');
    files.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...files.keys()],
    read(name) {
      const entry = files.get(name);
      if (!entry) return null;
      const local = entry.localOffset;
      if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('zip_local_header');
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.slice(start, start + entry.compressedSize);
      if (entry.method === 0) return data;
      if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 50 * 1024 * 1024 });
      throw new Error(`zip_method_${entry.method}`);
    }
  };
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

// 문단 경계를 줄바꿈으로 바꾼 뒤 지정한 텍스트 태그만 모은다.
function xmlText(xml, textTag, paragraphTag) {
  const withBreaks = String(xml).replace(new RegExp(`</${paragraphTag}>`, 'g'), '\n');
  const parts = [];
  const pattern = new RegExp(`<${textTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${textTag}>|(\\n)|<(?:w:tab|hp:tab)\\b[^>]*/>`, 'g');
  let match;
  while ((match = pattern.exec(withBreaks))) parts.push(match[2] ? '\n' : match[1] !== undefined ? decodeXml(match[1]) : '\t');
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const byNumber = (a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] || 0) - Number(b.match(/(\d+)\.xml$/)?.[1] || 0);

function zipDocumentText(buffer, ext) {
  const zip = readZip(buffer);
  const text = name => zip.read(name)?.toString('utf8') || '';
  if (ext === 'docx') return { format: 'docx', text: xmlText(text('word/document.xml'), 'w:t', 'w:p') };
  if (ext === 'pptx') {
    const slides = zip.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber);
    return { format: 'pptx', pages: slides.length, text: slides.map((n, i) => `[슬라이드 ${i + 1}]\n${xmlText(text(n), 'a:t', 'a:p')}`).join('\n\n') };
  }
  if (ext === 'xlsx') {
    const shared = xmlText(text('xl/sharedStrings.xml'), 't', 'si');
    const sheets = zip.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(byNumber);
    const inline = sheets.map(n => xmlText(text(n), 't', 'c')).filter(Boolean).join('\n');
    return { format: 'xlsx', pages: sheets.length, text: [shared, inline].filter(Boolean).join('\n') };
  }
  if (ext === 'hwpx') {
    const sections = zip.names.filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort(byNumber);
    return { format: 'hwpx', text: sections.map(n => xmlText(text(n), 'hp:t', 'hp:p')).join('\n\n') };
  }
  throw new Error('zip_format_unknown');
}

// ---------- HWP 5.0 (OLE 복합 문서) ----------
function readCfb(buffer) {
  if (buffer.length < 512 || buffer.readUInt32LE(0) !== 0xe011cfd0 || buffer.readUInt32LE(4) !== 0xe11ab1a1) throw new Error('cfb_signature');
  const sectorSize = 1 << buffer.readUInt16LE(0x1e);
  const miniSectorSize = 1 << buffer.readUInt16LE(0x20);
  const fatCount = buffer.readUInt32LE(0x2c);
  const dirStart = buffer.readUInt32LE(0x30);
  const miniCutoff = buffer.readUInt32LE(0x38);
  const miniFatStart = buffer.readUInt32LE(0x3c);
  let difatNext = buffer.readUInt32LE(0x44);
  const sectorOffset = id => (id + 1) * sectorSize;
  const difat = [];
  for (let i = 0; i < 109; i += 1) difat.push(buffer.readUInt32LE(0x4c + i * 4));
  for (let guard = 0; difatNext < 0xfffffffa && guard < 1000; guard += 1) {
    const base = sectorOffset(difatNext);
    for (let i = 0; i < sectorSize / 4 - 1; i += 1) difat.push(buffer.readUInt32LE(base + i * 4));
    difatNext = buffer.readUInt32LE(base + sectorSize - 4);
  }
  const fat = [];
  for (const sector of difat.slice(0, fatCount)) {
    if (sector >= 0xfffffffa) continue;
    const base = sectorOffset(sector);
    for (let i = 0; i < sectorSize / 4; i += 1) fat.push(buffer.readUInt32LE(base + i * 4));
  }
  const chain = (start, table) => {
    const ids = [];
    for (let id = start, guard = 0; id < 0xfffffffa && guard < 1000000; guard += 1) { ids.push(id); id = table[id]; }
    return ids;
  };
  const readChain = start => Buffer.concat(chain(start, fat).map(id => buffer.slice(sectorOffset(id), sectorOffset(id) + sectorSize)));
  const dirData = readChain(dirStart);
  const entries = [];
  for (let off = 0; off + 128 <= dirData.length; off += 128) {
    const nameLength = dirData.readUInt16LE(off + 0x40);
    entries.push({
      name: dirData.slice(off, off + Math.max(0, nameLength - 2)).toString('utf16le'),
      type: dirData[off + 0x42], left: dirData.readUInt32LE(off + 0x44), right: dirData.readUInt32LE(off + 0x48),
      child: dirData.readUInt32LE(off + 0x4c), start: dirData.readUInt32LE(off + 0x74), size: dirData.readUInt32LE(off + 0x78)
    });
  }
  const root = entries[0];
  const miniStream = root && root.start < 0xfffffffa ? readChain(root.start) : Buffer.alloc(0);
  const miniFat = [];
  if (miniFatStart < 0xfffffffa) {
    const data = readChain(miniFatStart);
    for (let i = 0; i + 4 <= data.length; i += 4) miniFat.push(data.readUInt32LE(i));
  }
  const readStream = entry => {
    if (entry.size < miniCutoff) {
      return Buffer.concat(chain(entry.start, miniFat).map(id => miniStream.slice(id * miniSectorSize, (id + 1) * miniSectorSize))).slice(0, entry.size);
    }
    return readChain(entry.start).slice(0, entry.size);
  };
  const children = index => {
    const out = [];
    const walk = (id, depth) => {
      if (id >= entries.length || id === 0xffffffff || depth > 64) return;
      const entry = entries[id];
      walk(entry.left, depth + 1); out.push(entry); walk(entry.right, depth + 1);
    };
    walk(entries[index]?.child, 0);
    return out;
  };
  const find = (parentIndex, name) => children(parentIndex).find(entry => entry.name === name);
  return { entries, readStream, children, find, indexOf: entry => entries.indexOf(entry) };
}

const HWPTAG_PARA_TEXT = 0x10 + 51;
// 8칸(16바이트)을 차지하는 인라인·확장 컨트롤 문자
const WIDE_CONTROLS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

function hwpSectionText(data) {
  const lines = [];
  let offset = 0;
  while (offset + 4 <= data.length) {
    const header = data.readUInt32LE(offset);
    const tag = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;
    offset += 4;
    if (size === 0xfff) { size = data.readUInt32LE(offset); offset += 4; }
    if (tag === HWPTAG_PARA_TEXT) {
      let text = '';
      for (let i = offset; i + 1 < offset + size;) {
        const code = data.readUInt16LE(i);
        if (code < 32) {
          if (code === 9) text += '\t';
          else if (code === 10) text += '\n';
          i += WIDE_CONTROLS.has(code) ? 16 : 2;
          continue;
        }
        text += String.fromCharCode(code);
        i += 2;
      }
      lines.push(text);
    }
    offset += size;
  }
  return lines.join('\n');
}

function hwpText(buffer) {
  const cfb = readCfb(buffer);
  const fileHeader = cfb.find(0, 'FileHeader');
  if (!fileHeader) throw new Error('hwp_header_missing');
  const header = cfb.readStream(fileHeader);
  if (!header.slice(0, 17).toString('latin1').startsWith('HWP Document File')) throw new Error('hwp_signature');
  const flags = header.readUInt32LE(36);
  if (flags & 0x2) return { format: 'hwp', text: '', status: 'encrypted' };
  if (flags & 0x4) return { format: 'hwp', text: '', status: 'distribution' };
  const compressed = Boolean(flags & 0x1);
  const body = cfb.find(0, 'BodyText');
  if (!body) throw new Error('hwp_body_missing');
  const sections = cfb.children(cfb.indexOf(body)).filter(entry => /^Section\d+$/.test(entry.name))
    .sort((a, b) => Number(a.name.slice(7)) - Number(b.name.slice(7)));
  const texts = sections.map(entry => {
    let raw = cfb.readStream(entry);
    if (compressed) raw = zlib.inflateRawSync(raw, { maxOutputLength: 50 * 1024 * 1024 });
    return hwpSectionText(raw);
  });
  return { format: 'hwp', text: texts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() };
}

function extractText(buffer, name = '', mediaType = '') {
  const ext = extOf(name) || ({ 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/x-hwp': 'hwp', 'application/haansofthwp': 'hwp', 'application/vnd.hancom.hwp': 'hwp', 'application/hwp+zip': 'hwpx', 'application/vnd.hancom.hwpx': 'hwpx', 'text/plain': 'txt', 'text/csv': 'csv' })[String(mediaType).toLowerCase()] || '';
  try {
    let result;
    if (['txt', 'csv', 'srt', 'md'].includes(ext)) result = { format: ext, text: buffer.toString('utf8').replace(/^﻿/, '') };
    else if (['docx', 'pptx', 'xlsx', 'hwpx'].includes(ext)) result = zipDocumentText(buffer, ext);
    else if (ext === 'hwp') result = hwpText(buffer);
    else return { status: 'unsupported', format: ext || 'unknown', text: '' };
    if (result.status) return { ...result, text: '' };
    const text = String(result.text || '').trim();
    if (!text) return { status: 'empty', format: result.format, text: '' };
    return { status: 'ok', format: result.format, pages: result.pages || null, chars: text.length, truncated: text.length > MAX_TEXT, text: text.slice(0, MAX_TEXT) };
  } catch (error) {
    return { status: 'error', format: ext, code: String(error.message || error).slice(0, 80), text: '' };
  }
}

module.exports = { extractText, extOf, readZip, readCfb, hwpSectionText, MAX_TEXT };
