'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'artifacts', 'document-templates', 'rotation-pack', 'rotation-manifest.json');
const USAGE = path.join(__dirname, 'data', 'document-template-usage.json');

// Astra 운영 검토(2026-09-20): 시험 상품은 결과 비교가 가능하도록
// 카테고리별 기본 템플릿을 고정한다. 순환은 명시적으로 experiment=true인
// 내부 실험에서만 허용한다.
const FIXED_TEMPLATE_BY_CATEGORY = Object.freeze({
  '보고서': '01',
  '원고': '06',
  '소개서': '07',
  '요약': '10',
  '제안서': '11',
  '가이드': '16',
  '업무': '21'
});

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function categoryFor(text) {
  const value = String(text || '').toLowerCase();
  if (/블로그|카페|카드뉴스|제품\s*소개|원고/.test(value)) return '원고';
  if (/회사\s*소개|서비스\s*소개|브랜드|프로필|소개서/.test(value)) return '소개서';
  if (/요약|브리프|회의\s*내용|기사|도서/.test(value)) return '요약';
  if (/제안|기획|행사/.test(value)) return '제안서';
  if (/매뉴얼|가이드|안내서/.test(value)) return '가이드';
  if (/주간|회의록|인수인계|업무/.test(value)) return '업무';
  return '보고서';
}

function selectDocumentTemplate(input = {}) {
  const manifest = readJson(MANIFEST, { templates: [] });
  const usage = readJson(USAGE, { counts: {}, lastGlobal: null, lastByCustomer: {}, events: [] });
  const customerId = String(input.customerId || 'anonymous');
  const category = categoryFor(`${input.category || ''} ${input.purpose || ''} ${input.topic || ''}`);
  let candidates = manifest.templates.filter(item => item.category === category);
  if (!candidates.length) candidates = manifest.templates.slice();
  if (input.experiment !== true) {
    const preferredPrefix = FIXED_TEMPLATE_BY_CATEGORY[category];
    const fixed = candidates.find(item => String(item.id || '').startsWith(preferredPrefix)) || candidates[0] || null;
    if (!fixed) return null;
    return { ...fixed, category, selectionMode: 'fixed-by-category', path: path.join(path.dirname(MANIFEST), fixed.file) };
  }
  const lastCustomer = usage.lastByCustomer[customerId] || null;
  const eligible = candidates.filter(item => item.id !== lastCustomer && item.id !== usage.lastGlobal);
  const pool = eligible.length ? eligible : candidates;
  const selected = pool.slice().sort((a, b) => {
    const count = (usage.counts[a.id] || 0) - (usage.counts[b.id] || 0);
    return count || a.id.localeCompare(b.id);
  })[0] || null;
  if (!selected) return null;
  usage.counts[selected.id] = (usage.counts[selected.id] || 0) + 1;
  usage.lastGlobal = selected.id;
  usage.lastByCustomer[customerId] = selected.id;
  usage.events.unshift({ at: new Date().toISOString(), customerId, category, templateId: selected.id });
  usage.events = usage.events.slice(0, 1000);
  fs.writeFileSync(USAGE, JSON.stringify(usage, null, 2), 'utf8');
  return { ...selected, category, selectionMode: 'controlled-experiment', path: path.join(path.dirname(MANIFEST), selected.file) };
}

module.exports = { categoryFor, selectDocumentTemplate, FIXED_TEMPLATE_BY_CATEGORY, MANIFEST, USAGE };
