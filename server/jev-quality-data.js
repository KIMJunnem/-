'use strict';

// Jev 제작 품질 실험용 데이터(2026-09-22). 운영에는 연결하지 않는다.
// 데이터는 두 곳에서만 만든다:
//   1) tests/fixtures/jev-quality-gold.json — 직접 만든 합성 정답 샘플
//   2) tests/samples/sync/translated — 시험용 자막 샘플(정렬 쌍 = 같은 내용, 한 칸 어긋난 쌍 = 다른 내용)
//   4) tests/fixtures/change-guard-gold.json — 코드 변경(diff) 417개, 가격·고객 문구·삭제·외부 발송·유료 API 정답
//   3) tests/fixtures/jev-synthetic.cjs — 규칙으로 만든 대량 합성 표본(*_large, 출처별 3,000개, 정답 자동)
// 실제 고객 자료(영상 전사·고객 문서·제작 결과)는 읽지 않는다.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GOLD_FILE = path.join(ROOT, 'tests', 'fixtures', 'jev-quality-gold.json');
const SYNTHETIC_FILE = path.join(ROOT, 'tests', 'fixtures', 'jev-synthetic.cjs');
// 대량 표본 생성기는 *_large 출처를 쓸 때만 불러온다. 파일이 없으면(서버만 복사한 환경) 빈 목록.
function syntheticRows(base) {
  if (!fs.existsSync(SYNTHETIC_FILE)) return [];
  return require(SYNTHETIC_FILE).generated(base);
}
const LARGE_SUFFIX = '_large';
const CHANGE_GUARD_FILE = path.join(ROOT, 'tests', 'fixtures', 'change-guard-gold.json');
const QUALITY_SOURCES = Object.freeze({
  subtitle_pairs: ['srt_block', 'transcript', 'source_lang'],
  subtitle_blocks: ['srt_block', 'prev_block', 'next_block'],
  document_claims: ['claim', 'material'],
  edit_pairs: ['original', 'edited'],
  // 대량 합성 표본(2026-09-22): 입력 필드는 원래 출처와 같다
  subtitle_pairs_large: ['srt_block', 'transcript', 'source_lang'],
  subtitle_blocks_large: ['srt_block', 'prev_block', 'next_block'],
  document_claims_large: ['claim', 'material'],
  edit_pairs_large: ['original', 'edited'],
  // 변경 안전장치 측정(2026-09-22): 코드 변경 한 덩어리가 승인 필요 영역을 건드리는지
  code_diffs: ['file', 'diff']
});

function parseSrt(text) {
  return String(text || '').replace(/\r/g, '').trim().split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
}

function readSample(rel) {
  const file = path.join(ROOT, 'tests', 'samples', ...rel.split('/'));
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function derivedSubtitlePairs() {
  const ko = parseSrt(readSample('sync/translated/subtitles.srt'));
  const src = parseSrt(readSample('sync/translated/source-language.srt'));
  const textOf = block => block.split('\n').slice(2).join(' ').trim();
  const items = [];
  const n = Math.min(ko.length, src.length);
  for (let i = 0; i < n; i += 1) {
    items.push({ id: `sp-sample-aligned-${i + 1}`, origin: 'tests/samples/sync/translated', source_lang: 'en', srt_block: ko[i], transcript: textOf(src[i]), gold: { same_content: true } });
  }
  // 일부러 밀린 싱크: 한국어 자막 i와 원어 i+1을 짝지으면 내용이 다르다.
  for (let i = 0; i + 1 < n; i += 1) {
    items.push({ id: `sp-sample-shifted-${i + 1}`, origin: 'tests/samples/sync/translated (한 칸 어긋남)', source_lang: 'en', srt_block: ko[i], transcript: textOf(src[i + 1]), gold: { same_content: false } });
  }
  return items;
}

function derivedSubtitleBlocks() {
  const blocks = parseSrt(readSample('sync/translated/subtitles.srt'));
  return blocks.map((block, i) => ({ id: `sb-sample-${i + 1}`, origin: 'tests/samples/sync/translated', srt_block: block, prev_block: blocks[i - 1] || '', next_block: blocks[i + 1] || '', gold: null }));
}

function loadGold() {
  return fs.existsSync(GOLD_FILE) ? JSON.parse(fs.readFileSync(GOLD_FILE, 'utf8')) : {};
}

// source 이름 → 실험 항목 목록. questionNames가 주어지면 그 질문의 정답이 있는 항목을 앞에 둔다.
function qualityItems(source, questionNames = []) {
  const fields = QUALITY_SOURCES[source];
  if (!fields) return [];
  const gold = loadGold();
  let rows = Array.isArray(gold[source]) ? gold[source].map(row => ({ ...row, origin: 'tests/fixtures/jev-quality-gold.json' })) : [];
  if (source === 'code_diffs' && fs.existsSync(CHANGE_GUARD_FILE)) rows = JSON.parse(fs.readFileSync(CHANGE_GUARD_FILE, 'utf8')).rows.map(row => ({ ...row, origin: `tests/fixtures/change-guard-gold.json (${row.origin})` }));
  if (source.endsWith(LARGE_SUFFIX)) rows = syntheticRows(source.slice(0, -LARGE_SUFFIX.length)).map(row => ({ ...row, origin: 'tests/fixtures/jev-synthetic.cjs (규칙 생성)' }));
  if (source === 'subtitle_pairs') rows = [...rows, ...derivedSubtitlePairs()];
  if (source === 'subtitle_blocks') rows = [...rows, ...derivedSubtitleBlocks()];
  const hasGold = row => row.gold && questionNames.some(q => typeof row.gold[q] === 'boolean' || typeof row.gold[q] === 'string');
  rows.sort((a, b) => Number(hasGold(b)) - Number(hasGold(a)));
  return rows.map(row => ({
    key: row.id,
    state: Object.fromEntries(fields.map(field => [field, String(row[field] ?? '')])),
    compare: { gold: row.gold || null, origin: row.origin, synthetic: true }
  }));
}

function goldCounts() {
  const out = {};
  for (const source of Object.keys(QUALITY_SOURCES)) {
    const items = qualityItems(source);
    const byQuestion = {};
    for (const item of items) for (const [q, v] of Object.entries(item.compare.gold || {})) if (typeof v === 'boolean') byQuestion[q] = (byQuestion[q] || 0) + 1;
    out[source] = { items: items.length, goldByQuestion: byQuestion };
  }
  return out;
}

module.exports = { QUALITY_SOURCES, GOLD_FILE, qualityItems, goldCounts, parseSrt };
