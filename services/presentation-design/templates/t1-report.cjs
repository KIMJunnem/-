'use strict';

// T1 보고형 템플릿 v2 (2026-09-22). 기관·공공 보고형 / 기업 내부 보고형 공용, 팔레트만 교체.
// 위치·크기는 ../quality-rules.json(페이블 품질 규칙 v1) slide_layouts의 % 값을 그대로 쓴다.
// 색·글자 크기는 ../design-types.json 유형별 값. 아직 제작 파이프라인에 연결하지 않았다(시안 확인용).
// 사용: node t1-report.cjs <type_id> <content.json> <out.pptx>

const fs = require('node:fs');
const path = require('node:path');
const PptxGenJS = require('pptxgenjs');

const W = 13.333, H = 7.5;
const X = pct => (W * pct) / 100;
const Y = pct => (H * pct) / 100;
const hex = c => String(c).replace('#', '').toUpperCase();
const CARD = 'F4F5F7';

function buildT1(typeDef, content, rules) {
  const p = typeDef.palette;
  const L = rules.slide_layouts;
  const T = rules.typography.scale_report_pt;
  const font = 'Pretendard';
  const C = { primary: hex(p.primary), secondary: hex(p.secondary), fill: hex(p.accentFill), accent: hex(p.accentText), bg: hex(p.background), text: hex(p.text), muted: hex(p.mutedText), line: 'D9D9D9', gridline: 'E5E7EB', white: 'FFFFFF' };
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = content.meta.title;
  pres.author = 'Swan';
  pres.company = '';
  pres.theme = { headFontFace: font, bodyFontFace: font };
  const total = content.slides.length;
  const text = (slide, value, opts) => slide.addText(value, { fontFace: font, color: C.text, margin: 0, isTextBox: true, valign: 'top', lineSpacingMultiple: 1.5, fit: 'none', ...opts });
  const box = (slide, b, opts) => text(slide, opts.value, { x: X(b.x), y: Y(b.y), w: X(b.w), h: Y(b.h), ...opts, value: undefined });
  const para = T.body * rules.typography.ratios.paragraph_gap_multiple_of_body;
  const bullets = (items, size = T.body) => items.map((item, i) => ({ text: item, options: { bullet: { indent: 16 }, breakLine: i < items.length - 1, paraSpaceAfter: para, fontSize: size } }));

  let index = 0;
  const addSlide = (sd, { label, band = false } = {}) => {
    index += 1;
    const slide = pres.addSlide();
    slide.background = { color: C.bg };
    if (band) slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: Y(L.cover.elements.top_band.h), fill: { color: C.primary }, line: { type: 'none' } });
    if (index > 1) {
      const fe = rules.deck_structure.fixed_elements;
      text(slide, `${index} / ${total}`, { x: X(85), y: Y(fe.page_number.pos_pct.y), w: X(95.6 - 85), h: Y(3), fontSize: fe.page_number.size_pt, color: C.muted, align: 'right', lineSpacingMultiple: 1 });
      if (content.meta.footer) text(slide, content.meta.footer, { x: X(fe.footer_text.pos_pct.x), y: Y(fe.footer_text.pos_pct.y), w: X(50), h: Y(3), fontSize: fe.footer_text.size_pt, color: C.muted, lineSpacingMultiple: 1 });
      if (label) text(slide, label, { x: X(fe.section_label.pos_pct.x), y: Y(fe.section_label.pos_pct.y), w: X(50), h: Y(3), fontSize: fe.section_label.size_pt, color: C.muted, lineSpacingMultiple: 1 });
    }
    return slide;
  };
  const title = (slide, value) => box(slide, L.common.title, { value, fontSize: T.slide_title, bold: true, valign: 'bottom', lineSpacingMultiple: rules.typography.ratios.line_height_title });

  for (const sd of content.slides) {
    if (sd.type === 'cover') {
      const slide = addSlide(sd, { band: true });
      const e = L.cover.elements;
      box(slide, e.title, { value: content.meta.title, fontSize: T.cover_title, bold: true, valign: 'bottom', lineSpacingMultiple: 1.2 });
      box(slide, e.subtitle, { value: content.meta.subtitle, fontSize: T.subtitle, color: C.muted });
      box(slide, e.org_date, { value: `${content.meta.org}  ·  ${content.meta.date}`, fontSize: T.caption + 2, lineSpacingMultiple: 1 });
    } else if (sd.type === 'agenda') {
      const slide = addSlide(sd);
      title(slide, '목차');
      const e = L.agenda.elements.items;
      sd.items.slice(0, e.max).forEach((item, i) => {
        const y = e.y + i * e.row_gap_pct;
        text(slide, String(i + 1).padStart(2, '0'), { x: X(e.x), y: Y(y), w: X(7), h: Y(6), fontSize: T.subtitle, bold: true, color: C.primary, lineSpacingMultiple: 1 });
        text(slide, item, { x: X(e.x + 8), y: Y(y), w: X(e.w - 8), h: Y(6), fontSize: T.subtitle, lineSpacingMultiple: 1 });
      });
    } else if (sd.type === 'section') {
      const slide = addSlide(sd, { label: sd.title });
      const e = L.section.elements;
      box(slide, e.number, { value: sd.number, fontSize: e.number.size_pt, bold: true, color: C.primary, valign: 'bottom', lineSpacingMultiple: 1 });
      box(slide, e.title, { value: sd.title, fontSize: T.slide_title, bold: true, lineSpacingMultiple: 1.2 });
    } else if (sd.type === 'text') {
      const slide = addSlide(sd, { label: sd.chapter });
      title(slide, sd.headline);
      const b = L.common.body_area;
      text(slide, bullets(sd.bullets), { x: X(b.x), y: Y(b.y), w: X(58), h: Y(b.h) });
      if (sd.note) {
        const nb = L.chart.elements.takeaway;
        slide.addShape(pres.shapes.RECTANGLE, { x: X(nb.x), y: Y(nb.y), w: X(nb.w), h: Y(40), fill: { color: CARD }, line: { type: 'none' } });
        // 카드(#F4F5F7) 위 글자는 muted 대비가 4.5 미만일 수 있어 본문색
        text(slide, sd.note.label, { x: X(nb.x + 2), y: Y(nb.y + 3), w: X(nb.w - 4), h: Y(5), fontSize: T.caption, bold: true, color: C.text, lineSpacingMultiple: 1 });
        text(slide, sd.note.number, { x: X(nb.x + 2), y: Y(nb.y + 9), w: X(nb.w - 4), h: Y(12), fontSize: T.key_number, bold: true, color: C.accent, lineSpacingMultiple: 1 });
        text(slide, sd.note.body, { x: X(nb.x + 2), y: Y(nb.y + 23), w: X(nb.w - 4), h: Y(14), fontSize: T.body });
      }
    } else if (sd.type === 'two_column') {
      const slide = addSlide(sd, { label: sd.chapter });
      title(slide, sd.headline);
      const e = L.two_column.elements;
      [[e.left, sd.left], [e.right, sd.right]].forEach(([b, col]) => {
        text(slide, col.title, { x: X(b.x), y: Y(b.y), w: X(b.w), h: Y(e.column_heads.h - 1), fontSize: T.subtitle, bold: true, color: C.primary, valign: 'bottom', lineSpacingMultiple: 1 });
        slide.addShape(pres.shapes.RECTANGLE, { x: X(b.x), y: Y(b.y + e.column_heads.h), w: X(b.w), h: Y(0.4), fill: { color: C.primary }, line: { type: 'none' } });
        text(slide, bullets(col.bullets), { x: X(b.x), y: Y(b.y + e.column_heads.h + 3), w: X(b.w), h: Y(b.h - e.column_heads.h - 3) });
      });
    } else if (sd.type === 'table') {
      const slide = addSlide(sd, { label: sd.chapter });
      title(slide, sd.headline);
      const e = L.table.elements.table;
      const lim = L.table.limits;
      if (sd.header.length > lim.max_cols || sd.rows.length > lim.max_rows_report) throw new Error('table_over_limit');
      const none = { type: 'none' };
      const hLine = { type: 'solid', pt: 0.5, color: C.line };
      const head = sd.header.map(h => ({ text: h, options: { bold: true, color: C.white, fill: { color: C.primary }, align: 'center', border: [none, none, none, none] } }));
      const rows = sd.rows.map((r, ri) => r.map((cell, ci) => ({ text: cell, options: { align: ci === 0 ? 'left' : 'right', bold: ri === sd.highlight?.row, color: sd.highlight && ri === sd.highlight.row && ci === sd.highlight.col ? C.accent : C.text, border: [none, none, hLine, none] } })));
      const rowH = 0.45;
      const pad = lim.cell_padding_cm / 2.54;
      slide.addTable([head, ...rows], { x: X(e.x), y: Y(e.y), w: X(e.w), colW: sd.colPct.map(v => X(e.w) * v / 100), fontFace: font, fontSize: T.table_body, rowH, valign: 'middle', margin: [0, pad, 0, pad] });
      text(slide, sd.source, { x: X(e.x), y: Y(e.y) + rowH * (rows.length + 1) + 0.12, w: X(e.w), h: Y(4), fontSize: T.caption, color: C.muted, lineSpacingMultiple: 1 });
    } else if (sd.type === 'chart') {
      const slide = addSlide(sd, { label: sd.chapter });
      title(slide, sd.headline);
      const e = L.chart.elements;
      const common = {
        x: X(e.chart.x), y: Y(e.chart.y), w: X(e.chart.w), h: Y(e.chart.h - 5), showLegend: false, showTitle: false, showValue: true, dataLabelColor: C.text, dataLabelFontSize: T.chart_label, dataLabelFontFace: font,
        catAxisLabelColor: C.muted, catAxisLabelFontSize: T.chart_label, catAxisLabelFontFace: font, valAxisHidden: true, valAxisLabelFontFace: font, valAxisMinVal: 0, valAxisLineShow: false,
        valGridLine: { color: C.gridline, size: 0.5 }, catGridLine: { style: 'none' }, catAxisLineShow: true, catAxisLineColor: C.line
      };
      if (sd.kind === 'line') {
        slide.addChart(pres.charts.LINE, [{ name: sd.series, labels: sd.labels, values: sd.values }], { ...common, chartColors: [C.primary], lineSize: 2.5, lineDataSymbol: 'circle', lineDataSymbolSize: 8, dataLabelPosition: 't', dataLabelFormatCode: sd.format || '#,##0' });
      } else {
        const normal = sd.values.map((v, i) => (i === sd.highlight ? 0 : v));
        const high = sd.values.map((v, i) => (i === sd.highlight ? v : 0));
        slide.addChart(pres.charts.BAR, [{ name: sd.series, labels: sd.labels, values: normal }, { name: `${sd.series} 강조`, labels: sd.labels, values: high }], { ...common, barDir: 'col', barGrouping: 'clustered', barOverlapPct: 100, barGapWidthPct: 80, chartColors: [C.primary, C.fill], dataLabelPosition: 'outEnd', dataLabelFormatCode: `${sd.format || '#,##0'};;;` });
      }
      text(slide, sd.source, { x: X(e.chart.x), y: Y(e.chart.y + e.chart.h - 4), w: X(e.chart.w), h: Y(4), fontSize: T.caption, color: C.muted, lineSpacingMultiple: 1 });
      const t = e.takeaway;
      text(slide, sd.takeaway.number, { x: X(t.x), y: Y(t.y + 2), w: X(t.w), h: Y(12), fontSize: T.key_number, bold: true, color: sd.kind === 'line' ? C.accent : C.primary, lineSpacingMultiple: 1 });
      text(slide, sd.takeaway.body, { x: X(t.x), y: Y(t.y + 16), w: X(t.w), h: Y(30), fontSize: T.body });
    } else if (sd.type === 'key_number') {
      const slide = addSlide(sd, { label: sd.chapter });
      title(slide, sd.headline);
      const c = L.key_number.elements.cards;
      sd.items.slice(0, c.count_max).forEach((it, i) => {
        const x = c.x_start + i * (c.w_each + c.gap);
        slide.addShape(pres.shapes.RECTANGLE, { x: X(x), y: Y(c.y), w: X(c.w_each), h: Y(c.h), fill: { color: CARD }, line: { type: 'none' } });
        text(slide, it.number, { x: X(x + 2), y: Y(c.y + 5), w: X(c.w_each - 4), h: Y(13), fontSize: T.key_number, bold: true, color: i === sd.highlight ? C.accent : C.primary, lineSpacingMultiple: 1 });
        text(slide, it.label, { x: X(x + 2), y: Y(c.y + 21), w: X(c.w_each - 4), h: Y(10), fontSize: T.body, bold: true, lineSpacingMultiple: 1.3 });
        text(slide, it.delta, { x: X(x + 2), y: Y(c.y + 33), w: X(c.w_each - 4), h: Y(10), fontSize: T.caption + 2, lineSpacingMultiple: 1.3 });
      });
    } else if (sd.type === 'summary') {
      const slide = addSlide(sd, { label: '요약' });
      title(slide, sd.headline);
      const b = L.common.body_area;
      sd.points.slice(0, L.summary.elements.points.max).forEach((pt, i) => {
        const y = b.y + 2 + i * 15;
        text(slide, String(i + 1), { x: X(b.x), y: Y(y), w: X(4), h: Y(6), fontSize: T.subtitle, bold: true, color: C.primary, lineSpacingMultiple: 1 });
        text(slide, pt.head, { x: X(b.x + 5), y: Y(y), w: X(80), h: Y(6), fontSize: T.subtitle, bold: true, lineSpacingMultiple: 1 });
        text(slide, pt.body, { x: X(b.x + 5), y: Y(y + 6.5), w: X(80), h: Y(6), fontSize: T.body, color: C.muted, lineSpacingMultiple: 1 });
      });
      const n = L.summary.elements.next_step;
      slide.addShape(pres.shapes.LINE, { x: X(b.x), y: Y(n.y), w: X(b.w), h: 0, line: { color: C.primary, width: 0.75 } });
      text(slide, '다음 단계·요청 사항', { x: X(b.x), y: Y(n.y + 2), w: X(30), h: Y(4), fontSize: T.caption, bold: true, color: C.primary, lineSpacingMultiple: 1 });
      text(slide, sd.ask, { x: X(b.x), y: Y(n.y + 7), w: X(b.w), h: Y(6), fontSize: T.body, bold: true, lineSpacingMultiple: 1 });
    } else if (sd.type === 'closing') {
      const slide = addSlide(sd, { label: '맺음', band: true });
      title(slide, sd.headline);
      const e = L.closing.elements.line;
      text(slide, sd.steps.join('   →   '), { x: X(e.x), y: Y(e.y), w: X(e.w), h: Y(e.h), fontSize: T.subtitle, lineSpacingMultiple: 1.2 });
      text(slide, [{ text: '문의  ', options: { bold: true, color: C.primary } }, { text: content.meta.contact }], { x: X(e.x), y: Y(e.y + 16), w: X(e.w), h: Y(6), fontSize: T.body, lineSpacingMultiple: 1 });
    } else {
      throw new Error(`unknown_slide_type:${sd.type}`);
    }
  }
  return pres;
}

module.exports = { buildT1 };

if (require.main === module) {
  const [typeId, contentFile, out] = process.argv.slice(2);
  const dir = path.join(__dirname, '..');
  const design = JSON.parse(fs.readFileSync(path.join(dir, 'design-types.json'), 'utf8'));
  const rules = JSON.parse(fs.readFileSync(path.join(dir, 'quality-rules.json'), 'utf8'));
  const typeDef = design.types.find(t => t.type_id === typeId);
  if (!typeDef || typeDef.template !== 'T1') throw new Error(`T1 유형이 아님: ${typeId}`);
  buildT1(typeDef, JSON.parse(fs.readFileSync(contentFile, 'utf8')), rules).writeFile({ fileName: out }).then(f => console.log(f));
}
