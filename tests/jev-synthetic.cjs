'use strict';

// Jev 대량 합성 표본(tests/fixtures/jev-synthetic.cjs) 검사. 외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const gen = require('./fixtures/jev-synthetic.cjs');
const quality = require('../server/jev-quality-data');

const sets = { edit_pairs: gen.editPairs(), document_claims: gen.documentClaims(), subtitle_pairs: gen.subtitlePairs(), subtitle_blocks: gen.subtitleBlocks() };

// 1) 출처마다 서로 다른 3,000개, 같은 시드면 같은 결과
for (const [name, rows] of Object.entries(sets)) {
  assert.equal(rows.length, 3000, name);
  const fields = quality.QUALITY_SOURCES[name];
  assert.equal(new Set(rows.map(r => JSON.stringify(fields.map(f => r[f])))).size, 3000, `${name} 중복 없음`);
  assert.equal(new Set(rows.map(r => r.id)).size, 3000, `${name} id 중복 없음`);
  assert.deepEqual(gen[{ edit_pairs: 'editPairs', document_claims: 'documentClaims', subtitle_pairs: 'subtitlePairs', subtitle_blocks: 'subtitleBlocks' }[name]](), rows, `${name} 재현`);
  for (const r of rows) for (const f of fields) assert.ok(String(r[f] ?? '').trim(), `${name} ${r.id}.${f} 비어 있지 않음`);
}

// 2) 정답 비율: 질문마다 예·아니오가 30% 이상씩
const ratio = (rows, q) => { const g = rows.map(r => r.gold[q]).filter(v => typeof v === 'boolean'); return { n: g.length, yes: g.filter(Boolean).length / g.length }; };
for (const [name, qs] of [['edit_pairs', ['original_had_error', 'meaning_changed']], ['document_claims', ['supported']], ['subtitle_pairs', ['same_content', 'omits_meaning', 'adds_meaning']], ['subtitle_blocks', ['breaks_mid_phrase']]]) {
  for (const q of qs) { const { n, yes } = ratio(sets[name], q); assert.ok(n >= 1000, `${name}.${q} 정답 ${n}`); assert.ok(yes >= 0.3 && yes <= 0.7, `${name}.${q} 예 비율 ${yes}`); }
}

// 3) 정답이 만든 방식과 맞는지
const WRONG = ['왠만하면', '몇일', '금새', '됬습니다', '보낼께요', '안았습니다', '예정 입니다', '역활', '오랫만에', '일부로', '궂이', '어떻해요', '드릴께요', '붇습니다', '꼼꼼이', '제출헤', '깨끗히', '틈틈히', '안 되요', '설레임', '금빵', '바꼈습니다', '마춰', '어짜피'];
const hasWrong = s => WRONG.some(w => s.includes(w));
for (const r of sets.edit_pairs) {
  assert.equal(hasWrong(r.original), r.gold.original_had_error, `${r.id} 원문 오류 표시`);
  assert.ok(!hasWrong(r.edited), `${r.id} 교정본에는 오류 없음`);
  assert.ok(!/같어요|없어요요|습니다요|겠겠|을를|은는|이가/.test(r.edited + r.original), `${r.id} 조사·어미 깨짐 없음`);
}
for (const r of sets.document_claims) {
  const nums = (r.claim.match(/[\d,]+(?=억|명|개|건|%)/g) || []).filter(n => !r.claim.includes(`${n}%`));
  if (r.gold.supported) for (const n of nums) assert.ok(r.material.includes(n), `${r.id} 맞는 주장의 숫자 ${n}는 자료에 있음`);
  assert.ok(!/은는|이가/.test(r.claim + r.material), `${r.id} 조사`);
}
const lines = r => r.srt_block.split('\n').slice(2);
const sentences = s => s.split(/(?<=\.)\s+/).filter(Boolean);
for (const r of sets.subtitle_pairs) {
  const k = lines(r).length; const e = sentences(r.transcript).length;
  if (r.id.endsWith('aligned')) assert.equal(k, e, r.id);
  if (r.id.endsWith('omission')) assert.ok(k === 1 && e === 2, r.id);
  if (r.id.endsWith('addition')) assert.ok(k === 2 && e === 1, r.id);
  assert.match(r.srt_block, /^\d+\n\d{2}:\d{2}:\d{2},000 --> \d{2}:\d{2}:\d{2},000\n/);
  assert.ok(!/은\/는|을\/를|이\/가|\{/.test(r.srt_block + r.transcript), r.id);
}
for (const r of sets.subtitle_blocks) assert.equal(r.id.endsWith('-mid'), r.gold.breaks_mid_phrase, r.id);

// 4) 받침 조사
assert.equal(gen.josa('보고서', '을/를'), '보고서를'); assert.equal(gen.josa('자료', '은/는'), '자료는'); assert.equal(gen.josa('회의록', '이/가'), '회의록이'); assert.equal(gen.josa('매출', '은/는'), '매출은');

// 5) 개인정보 모양·실제 자료 경로 없음, 외부 호출 코드 없음
const all = JSON.stringify(sets);
assert.ok(!/\d{2,3}-\d{3,4}-\d{4}|@[a-z0-9-]+\.[a-z]|SOOMGO-|LEAD-|REQ-/i.test(all));
const src = fs.readFileSync(path.join(__dirname, 'fixtures', 'jev-synthetic.cjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
assert.ok(!/require\(|fetch\(|http|server[\\/]+data|readState/.test(src), '생성기는 아무것도 불러오지 않음');

// 6) 품질 데이터 모듈 연결: *_large 출처는 3,000개, 출처 표시는 tests/
for (const name of Object.keys(sets)) {
  const items = quality.qualityItems(`${name}_large`, []);
  assert.equal(items.length, 3000);
  assert.ok(items.every(i => i.compare.synthetic === true && /^tests\/fixtures\/jev-synthetic\.cjs/.test(i.compare.origin)));
  assert.deepEqual(Object.keys(items[0].state), quality.QUALITY_SOURCES[`${name}_large`]);
}
// 기본 출처는 그대로(대량 표본이 섞이지 않음)
assert.ok(quality.qualityItems('edit_pairs', []).length <= 30);
console.log('jev-synthetic: PASS');
