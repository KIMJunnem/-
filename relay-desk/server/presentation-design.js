'use strict';

// PPT 디자인 유형 고르기(2026-09-22). 데이터 파일(services/presentation-design/design-types.json)만 읽는다.
// 아직 견적·봇·제작 어디에도 연결하지 않는다(부르는 곳 없음). 템플릿 시안 확인 후 연결 여부를 정한다.

const fs = require('node:fs');
const path = require('node:path');

const DESIGN_FILE = path.join(__dirname, '..', 'services', 'presentation-design', 'design-types.json');

function loadDesignTypes() {
  return JSON.parse(fs.readFileSync(DESIGN_FILE, 'utf8'));
}

// WCAG 대비 비율
function luminance(hex) {
  const v = String(hex).replace('#', '');
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// 요청서·원고 글 → 유형. 위에서부터 먼저 맞는 규칙. 고객 양식이 있다는 말이 있으면 customerTemplate=true.
function selectDesignType(text, data = loadDesignTypes()) {
  const body = String(text || '');
  const customerTemplate = data.selection.customerTemplateKeywords.some(word => body.includes(word));
  for (const rule of data.selection.rules) {
    const keyword = rule.keywords.find(word => body.includes(word));
    const pattern = !keyword && rule.patterns.map(p => body.match(new RegExp(p))).find(Boolean);
    if (keyword || pattern) return { typeId: rule.type_id, matched: keyword || pattern[0], customerTemplate, fallback: false };
  }
  return { typeId: data.selection.default, matched: null, customerTemplate, fallback: true };
}

module.exports = { DESIGN_FILE, loadDesignTypes, selectDesignType, contrast };
