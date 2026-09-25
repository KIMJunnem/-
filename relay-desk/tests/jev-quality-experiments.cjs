'use strict';

// Jev 제작 품질 실험 등록(2026-09-22): 등록만, 실행 0회, 시험·합성 데이터만, 운영 코드 미연결.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const root = path.join(__dirname, '..');
const sim = require('../server/jev-simulation');
const quality = require('../server/jev-quality-data');
const { jevSimulationLimits } = require('../server/operating-policy');
const L = jevSimulationLimits();

// 1) 등록된 11개(기본 5 + 대량 5 + 변경 안전장치 1): 이름·출처·질문·표본 수, 표시, 설계 검사 통과
const presets = sim.readPresets({ runMaxCalls: L.runMaxCalls });
assert.equal(presets.tag, '품질 실험 · 운영 미적용');
const expected = {
  q1_sync_crosslang: ['subtitle_pairs', ['same_content']],
  q2_split: ['subtitle_blocks', ['breaks_mid_phrase']],
  q3_translation_gap: ['subtitle_pairs', ['omits_meaning', 'adds_meaning']],
  q4_unsupported: ['document_claims', ['supported']],
  q5_overedit: ['edit_pairs', ['original_had_error', 'meaning_changed']]
};
// 2026-09-22 준희 지시 '몇천 개 큰 표본': 같은 질문을 규칙 생성 표본 3,000개에 1회씩
for (const [id, [source, questions]] of Object.entries({ ...expected })) expected[`${id}_large`] = [`${source}_large`, questions];
const isLarge = id => id.endsWith('_large');
// 2026-09-22 변경 안전장치 그림자 측정: 코드 변경 417개
expected.q6_change_guard = ['code_diffs', ['touches_price', 'touches_customer_text', 'touches_delete', 'touches_external_send', 'touches_paid_api']];
const isCode = id => id === 'q6_change_guard';
assert.deepEqual(presets.experiments.map(e => e.id), Object.keys(expected));
for (const def of presets.experiments) {
  const [source, questions] = expected[def.id];
  assert.equal(def.source, source, def.id);
  assert.deepEqual(Object.keys(def.questions), questions, def.id);
  // 2026-09-22 준희 지시: 표본 상한 10000(= 데이터 전부), 같은 항목 300회 반복
  assert.equal(def.sampleLimit, isLarge(def.id) ? 3000 : 10000, def.id);
  assert.equal(def.repeats, 1, `${def.id} (q5 실험: 반복해도 답 동일 → 전부 1회)`);
  assert.equal(def.operational, false);
  assert.equal(def.tag, '품질 실험 · 운영 미적용');
  assert.deepEqual(def.problems, [], `${def.id} 설계 검사`);
  for (const q of Object.values(def.questions)) assert.equal(q.type, 'noul');
}
const raw = JSON.parse(fs.readFileSync(sim.PRESETS_FILE, 'utf8'));
assert.equal(raw.operational, false);

// 2) 정답 샘플: 실험·질문마다 10개 이상, 예·아니오 둘 다 있음
for (const def of presets.experiments) {
  const items = sim.customItems({}, def, {});
  if (isLarge(def.id)) assert.equal(items.length, 3000, `${def.id} 항목 ${items.length}`);
  else if (isCode(def.id)) assert.ok(items.length >= 400, `${def.id} 항목 ${items.length}`);
  else assert.ok(items.length >= 10 && items.length <= 30, `${def.id} 항목 ${items.length}`);
  if (isLarge(def.id)) assert.equal(new Set(items.map(i => JSON.stringify(i.state))).size, items.length, `${def.id} 표본이 서로 다름`);
  for (const name of Object.keys(def.questions)) {
    const gold = items.map(i => i.compare.gold?.[name]).filter(v => typeof v === 'boolean');
    assert.ok(gold.length >= 10, `${def.id}.${name} 정답 ${gold.length}개`);
    assert.ok(gold.some(v => v) && gold.some(v => !v), `${def.id}.${name} 예·아니오 모두`);
  }
  // 입력 필드는 출처 정의대로만
  for (const item of items) assert.deepEqual(Object.keys(item.state), quality.QUALITY_SOURCES[def.source]);
}

// 3) 데이터 경계: 운영 기록(state)을 읽지 않고, tests/ 밖 자료가 없고, 개인정보 모양이 없다
const poison = { soomgoLeads: [{ id: 'LEAD-REAL', requestId: 'REAL-1', request: { text: 'POISON 고객 원문 010-9999-8888' } }], soomgoReplies: [{ id: 'C-REAL', incoming: 'POISON' }] };
for (const def of presets.experiments) {
  const items = sim.customItems(poison, def, {});
  const text = JSON.stringify(items);
  assert.ok(!text.includes('POISON'), `${def.id} 운영 기록 미사용`);
  assert.ok(items.every(i => i.compare.synthetic === true && /^tests\//.test(i.compare.origin)), `${def.id} 출처 tests/`);
  // 코드 변경(q6)은 파일 경로·식별자에 soomgo- 등이 들어가므로 전화번호·이메일 모양만 본다
  if (isCode(def.id)) assert.ok(!/\d{2,3}-\d{3,4}-\d{4}|@[a-z0-9-]+\.[a-z]{2}/i.test(JSON.stringify(items.map(i => i.state))), `${def.id} 전화번호·이메일 없음`);
  else assert.ok(!/\d{2,3}-\d{3,4}-\d{4}|@[a-z0-9-]+\.[a-z]|SOOMGO-|LEAD-|REQ-/i.test(JSON.stringify(items.map(i => i.state))), `${def.id} 개인정보·실요청 ID 없음`);
}
const qualitySrc = fs.readFileSync(path.join(root, 'server', 'jev-quality-data.js'), 'utf8');
assert.ok(!/server[\\/]+data|fulfillment|soomgoLeads|readState|DATA_DIR/.test(qualitySrc.replace(/^\s*\/\/.*$/gm, '')), '품질 데이터 모듈은 운영 데이터 경로를 참조하지 않음');

// 4) 운영 코드 미연결: 숨고·크몽 봇과 자동화 모듈은 Jev 모듈을 불러오지 않는다. 등록 목록 경로는 읽기만.
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
const operational = [...walk(path.join(root, 'soomgo-bot-extension')), ...walk(path.join(root, 'soomgo-chat-bot')), ...['kmong-automation.js', 'soomgo-auto-rules.js', 'reply-guards.js', 'pricing-table.js'].map(f => path.join(root, 'server', f))].filter(f => /\.(js|json|html)$/.test(f));
for (const file of operational) assert.ok(!/jev-quality|jev-simulation|typesafe/i.test(fs.readFileSync(file, 'utf8')), `운영 코드에 Jev 연결 없음: ${path.relative(root, file)}`);
const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
assert.equal((server.match(/jevSimulation\.startSimulation\(/g) || []).length, 1, '실행 경로는 /api/jev/simulate 하나');
const presetRoute = server.slice(server.indexOf("pathname === '/api/jev/presets'"), server.indexOf("pathname === '/api/jev/presets'") + 700);
assert.ok(presetRoute.includes('readPresets') && !presetRoute.includes('startSimulation'), '등록 목록 경로는 실행하지 않음');

// 5) 정답 비교 요약(가짜 Jev): 한 건만 일부러 틀리게 답하면 일치율 11/12, 확신도 구간이 채워진다
const wait = async id => { for (let i = 0; i < 200 && sim.activeRuns.has(id); i += 1) await new Promise(r => setTimeout(r, 20)); };
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevq-'));
  try {
    const q4 = presets.experiments.find(e => e.id === 'q4_unsupported');
    const items = sim.customItems({}, q4, {});
    const byClaim = new Map(items.map(i => [i.state.claim, i.compare.gold.supported]));
    const wrongClaim = items[0].state.claim;
    let calls = 0;
    const fakeFetch = async (url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body.state), ['claim', 'material']);
      const gold = byClaim.get(body.state.claim);
      const v = body.state.claim === wrongClaim ? (gold ? 0.2 : 0.8) : (gold ? 0.95 : 0.05);
      return { ok: true, status: 200, text: async () => JSON.stringify({ answers: { supported: { type: 'noul', noul: v } }, usage: { input_tokens: 300 } }) };
    };
    const { tag, operational: _o, problems, ...def } = q4;
    const started = sim.startSimulation({ dataDir, limits: L, state: poison, deps: {}, getKey: () => 'k'.repeat(20), fetchImpl: fakeFetch, custom: [{ ...def, repeats: 1 }] });
    await wait(started.id);
    const run = sim.readRun(dataDir, started.id);
    assert.equal(run.status, 'completed'); assert.equal(calls, 12);
    const g = run.summary['custom:q4_unsupported'].questions.supported.gold;
    assert.equal(g.labeled, 12); assert.equal(g.accuracy, Number((11 / 12).toFixed(3)));
    assert.equal(g.confusion.tp + g.confusion.tn, 11); assert.equal(g.misses.length, 1);
    const high = g.byConfidence.find(b => b.range.startsWith('높음')); const mid = g.byConfidence.find(b => b.range.startsWith('중간'));
    assert.equal(high.n, 11); assert.equal(high.accuracy, 1); assert.equal(mid.n, 1); assert.equal(mid.accuracy, 0);
    assert.ok(!fs.readFileSync(path.join(dataDir, 'jev-sim', `${started.id}.json`), 'utf8').includes('POISON'));
    console.log('jev-quality-experiments: PASS');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
