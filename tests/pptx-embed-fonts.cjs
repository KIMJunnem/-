'use strict';

// PPTX 글꼴 넣기(Node판, 2026-09-23 지시 5): tools/embed-fonts.py와 같은 결과인지. 파이썬판으로 같은 글꼴을 넣었을 때의
// fntdata 해시(2026-09-23 Cowork, fontTools 4.62.1)를 기록해 두고 대조한다. 외부 호출 없음.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { eot, embedFonts, FONT_DIR } = require('../server/pptx-embed-fonts');
const JSZip = require('jszip');
const PptxGenJS = require('pptxgenjs');

const PYTHON = {
  regular: { sha256: '84663b72aadc2578bbfb1064e665a30e346fe129b2a03e0a4a9bdb03c738829d', bytes: 2726024 },
  bold: { sha256: '48d13be7b90afc9cd3af4283303cdaa0060ad0d48bdd80cdad1f88f9395fcb3d', bytes: 2661936 }
};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-'));
(async () => {
  try {
    const reg = eot(path.join(FONT_DIR, 'Pretendard-Regular.ttf'));
    const bold = eot(path.join(FONT_DIR, 'Pretendard-Bold.ttf'));
    assert.equal(reg.family, 'Pretendard'); assert.equal(bold.style, 'Bold');
    assert.equal(reg.bytes.length, PYTHON.regular.bytes); assert.equal(sha(reg.bytes), PYTHON.regular.sha256, '파이썬판과 같은 EOT');
    assert.equal(bold.bytes.length, PYTHON.bold.bytes); assert.equal(sha(bold.bytes), PYTHON.bold.sha256);

    const pres = new PptxGenJS(); pres.layout = 'LAYOUT_WIDE';
    pres.addSlide().addText('시험', { x: 1, y: 1, w: 4, h: 1, fontFace: 'Pretendard' });
    const src = path.join(tmp, 'a.pptx'); const out = path.join(tmp, 'b.pptx');
    await pres.writeFile({ fileName: src });
    const r = await embedFonts({ src, out });
    assert.equal(r.family, 'Pretendard');
    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    assert.equal(sha(await zip.file('ppt/fonts/font1.fntdata').async('nodebuffer')), PYTHON.regular.sha256);
    assert.ok(!zip.files['ppt/fonts/'], '폴더 항목 없음(파이썬판과 같은 목록)');
    const xml = await zip.file('ppt/presentation.xml').async('string');
    assert.match(xml, /<p:presentation embedTrueTypeFonts="1" /);
    assert.match(xml, /<p:notesSz[^>]*\/><p:embeddedFontLst><p:embeddedFont><p:font typeface="Pretendard" pitchFamily="2" charset="-127"\/><p:regular r:id="rIdSwanFont1"\/><p:bold r:id="rIdSwanFont2"\/><\/p:embeddedFont><\/p:embeddedFontLst>/);
    assert.match(await zip.file('[Content_Types].xml').async('string'), /Extension="fntdata" ContentType="application\/x-fontdata"/);
    await assert.rejects(() => embedFonts({ src: out, out: path.join(tmp, 'c.pptx') }), /fonts_already_embedded/, '두 번 넣지 않음');
    console.log('pptx-embed-fonts: PASS');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
