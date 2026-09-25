'use strict';

// 싱크 검사 v3(2026-09-22 T-5): 실제 10분 전사로 "중간부터 점점 밀림" 재현. 블록 경계가 달라도·독립 전사여도
// 정답은 통과, 밀린 자막은 시작 블록을 1블록 이내로 지목, 보정 후 재검사 ok. 외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sync = require('../checks/sync_drift');
const { parse } = require('../checks/_srt');
const params = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'services', 'subtitle.json'), 'utf8')).checkParams;
const dir = path.join(__dirname, 'fixtures', 'sync-v3');
const run = (srt, ref) => sync({ path: path.join(dir, `${srt}.srt`) }, { checkParams: params, independentTranscript: { path: path.join(dir, ref) } });
const trueStart = { same: 39, diff: 54 };

for (const ref of ['ref-a-4threads.json', 'ref-b-6threads.json']) {
  for (const mode of ['same', 'diff']) {
    const truth = run(`truth-${mode}-j0.3`, ref);
    assert.equal(truth.passed, true, `${ref} ${mode} 정답은 통과해야: ${truth.type} ${truth.detail || ''}`);
    assert.equal(truth.matchMethod, 'word_stream');
    const drifted = run(`customer-drift-${mode}-j0.3`, ref);
    assert.equal(drifted.passed, false);
    assert.equal(drifted.type, 'drift_gradual', `${ref} ${mode}: ${drifted.type}`);
    assert.ok(Math.abs(drifted.driftStartBlock - trueStart[mode]) <= 1, `${ref} ${mode} 시작 블록 ${drifted.driftStartBlock} (정답 ${trueStart[mode]})`);
    assert.equal(drifted.recheckAfterFix, 'ok');
    assert.notEqual(drifted.status, 'manual_review');
    assert.equal(drifted.location, `block:${drifted.driftStartBlock}`);
    assert.ok(drifted.totalDriftSeconds > 8 && drifted.totalDriftSeconds < 11, `끝 밀림 ${drifted.totalDriftSeconds}`);
    // 보정식을 실제 자막에 적용하면 정답과 0.5초 안
    const c = drifted.correction;
    const fix = s => (s < c.tauSeconds + c.offsetSeconds ? s - c.offsetSeconds : (s - c.offsetSeconds + c.slope * c.tauSeconds) / (1 + c.slope));
    const a = parse({ path: path.join(dir, `truth-${mode}-j0.3.srt`) }).blocks;
    const b = parse({ path: path.join(dir, `customer-drift-${mode}-j0.3.srt`) }).blocks;
    const worst = Math.max(...a.map((x, i) => Math.abs(fix(b[i].start / 1000) - x.start / 1000)));
    assert.ok(worst < 0.5, `${ref} ${mode} 보정 후 최대 차이 ${worst.toFixed(3)}초`);
  }
}
// 불규칙(블록마다 ±3초 제멋대로) → 꺾임 모델로도 안 맞으니 사람 확인
const truthBlocks = parse({ path: path.join(dir, 'truth-diff-j0.3.srt') }).blocks;
let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const stamp = ms => { ms = Math.max(0, Math.round(ms)); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, x = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')},${String(r).padStart(3, '0')}`; };
let prev = 0;
const messy = truthBlocks.map((b, i) => { const s = Math.max(prev + 10, b.start + (rnd() * 2 - 1) * 3000); prev = s + 500; return `${i + 1}\n${stamp(s)} --> ${stamp(s + 500)}\n${b.lines.join('\n')}`; }).join('\n\n') + '\n';
const irregular = sync({ text: messy }, { checkParams: params, independentTranscript: { path: path.join(dir, 'ref-b-6threads.json') } });
assert.equal(irregular.passed, false); assert.equal(irregular.status, 'manual_review', `불규칙: ${irregular.type} ${irregular.recheckAfterFix}`);
// S-1: 기존 방식(단어 시각 없는 SRT 전사 → 블록 1:1)의 밀림 판정은 참고용. 납품을 막지 않는다.
const oldStyleRef = { path: path.join(dir, 'truth-same-j0.3.srt'), format: 'srt' };
const oldNoWordsRule = sync({ path: path.join(dir, 'customer-drift-same-j0.3.srt') }, { checkParams: { ...params, syncRequireWordTimestamps: false }, independentTranscript: oldStyleRef });
assert.equal(oldNoWordsRule.matchMethod, 'block_pair');
assert.equal(oldNoWordsRule.passed, true, '기존 방식 판정만으로는 막지 않음');
assert.ok(oldNoWordsRule.advisory && oldNoWordsRule.advisory.type !== 'ok', '참고 판정은 남긴다');
assert.match(oldNoWordsRule.advisory.detail, /참고·기존 방식/);
const oldWithRule = sync({ path: path.join(dir, 'customer-drift-same-j0.3.srt') }, { checkParams: params, independentTranscript: oldStyleRef });
assert.equal(oldWithRule.status, 'manual_review'); assert.equal(oldWithRule.id, 'sync_word_timestamps_missing', '단어 시각 없는 전사는 원래 규칙대로 사람 확인');
console.log('sync-drift-v3: PASS');
