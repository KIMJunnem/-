'use strict';

const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}

function documentLines(text) {
  const lines = String(text || '결과 내용 없음').replace(/\r\n?/g, '\n').split('\n');
  let firstContent = true;
  return lines.map(raw => {
    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    const bullet = raw.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    const value = (heading ? heading[2] : bullet ? `• ${bullet[1]}` : raw)
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trimEnd();
    if (!value.trim()) return { text: '', style: 'Normal' };
    // The first visible line becomes a compact title. Markdown headings after
    // it retain their hierarchy so Word output is scannable instead of a wall
    // of equally weighted paragraphs.
    const style = firstContent
      ? 'Title'
      : heading
        ? `Heading${Math.min(3, heading[1].length)}`
        : bullet
          ? 'ListBullet'
          : 'Normal';
    firstContent = false;
    return { text: value, style };
  });
}

function paragraphXml(line) {
  const spacing = line.style === 'Title' ? '<w:spacing w:before="0" w:after="260"/>' : '';
  const pPr = `<w:pPr><w:pStyle w:val="${line.style || 'Normal'}"/>${spacing}</w:pPr>`;
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${xmlEscape(line.text)}</w:t></w:r></w:p>`;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function designProfile(options = {}) {
  const seed = `${options.seed || 'relay-desk'}|${options.documentType || 'document'}|${options.topic || ''}`;
  const palettes = [
    ['111111', '444444', '888888'], ['1F4E79', '2F75B5', '5B9BD5'],
    ['2F5D50', '5B8E7D', 'A8C3B5'], ['5A3D5C', '8E668F', 'C6A5C7'],
    ['36454F', 'C26A4A', 'E0A58D'], ['493548', '755B69', 'BDA7B5'],
    ['263238', '546E7A', '90A4AE'], ['3E4A3D', '6B7C69', 'AAB8A8'],
    ['3D405B', '5F6485', '9EA2BE'], ['4A403A', '786A61', 'B6A79E']
  ];
  const layouts = [
    { margin: 1320, titleSize: 30 },
    { margin: 1440, titleSize: 32 },
    { margin: 1560, titleSize: 34 }
  ];
  const profileIndex = hashSeed(seed) % (palettes.length * layouts.length);
  const palette = palettes[Math.floor(profileIndex / layouts.length)];
  const layout = layouts[profileIndex % layouts.length];
  const theme = { primary: palette[0], secondary: palette[1], accent: palette[2], ...layout, profileIndex };
  const type = String(options.documentType || 'document').toLowerCase();
  return { ...theme, type, seed: hashSeed(seed).toString(16) };
}

function stylesXml(profile = designProfile()) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="맑은 고딕"/><w:lang w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="21"/></w:rPr><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:color w:val="${profile.primary}"/><w:sz w:val="${profile.titleSize}"/></w:rPr><w:pPr><w:keepNext/><w:spacing w:after="260"/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="8" w:color="${profile.accent}"/></w:pBdr></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:color w:val="${profile.primary}"/><w:sz w:val="26"/></w:rPr><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="120"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:color w:val="${profile.secondary}"/><w:sz w:val="23"/></w:rPr><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:color w:val="${profile.accent}"/><w:sz w:val="21"/></w:rPr><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:hanging="180"/><w:spacing w:after="80"/></w:pPr></w:style>` +
    `</w:styles>`;
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, source] of entries) {
    const filename = Buffer.from(name, 'utf8');
    const raw = Buffer.from(source, 'utf8');
    const compressed = zlib.deflateRawSync(raw, { level: 6 });
    const checksum = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, filename, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function createWorkflowDocx(text, options = {}) {
  const profile = designProfile(options);
  const paragraphs = documentLines(text).map(paragraphXml).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="${profile.margin}" w:right="${profile.margin}" w:bottom="${profile.margin}" w:left="${profile.margin}" w:header="708" w:footer="708" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`;
  return makeZip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`],
    ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`],
    ['word/document.xml', documentXml],
    ['word/styles.xml', stylesXml(profile)]
  ]);
}

module.exports = { createWorkflowDocx };
