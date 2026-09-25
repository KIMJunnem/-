'use strict';

// 제작 파이프라인 A/B/C 시뮬레이터: 가짜 제공자로 집계·채점·차단만 검사(외부 호출 0회).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const sim = require('../server/pipeline-sim');

const config = sim.loadConfig();
assert.equal(config.enabled, false, '기본은 실제 호출 금지');
assert.ok(Number(config.defaultCapKrw) > 0, '실제 실행 기본 상한(원)');
assert.ok(config.arms.A && config.arms.B && config.arms.C, '갈래 A/B/C');
assert.ok(config.models.high.id === 'claude-fable-5-1', '상위 = Fable 5.1');

const tasks = sim.buildTasks({ editN: 6, translateN: 4 });
assert.equal(tasks.length, 10);
assert.ok(tasks.every(t => t.input && t.gold), '과제마다 입력·정답');
assert.ok(!tasks.some(t => t.id.includes('fix_meaning')), 'fix_meaning 제외');

// 채점
const fix = tasks.find(t => t.kind === 'edit' && t.goldHadError);
assert.deepEqual(sim.scoreEdit(fix, fix.gold), { correct: true, overEdit: false, missed: false });
assert.deepEqual(sim.scoreEdit(fix, fix.input), { correct: false, overEdit: false, missed: true });
const clean = tasks.find(t => t.kind === 'edit' && !t.goldHadError);
assert.deepEqual(sim.scoreEdit(clean, clean.input + ' 감사합니다.'), { correct: false, overEdit: true, missed: false });
assert.equal(sim.scoreTranslate(tasks[9], 'x', null).correct, null);
assert.equal(sim.scoreTranslate(tasks[9], 'x', { same_content: 0.9, omits_meaning: 0.1, adds_meaning: 0.1 }).correct, true);

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipesim-'));
  try {
    // 실제 모드는 enabled=false면 시작 안 함
    await assert.rejects(() => sim.runSimulation({ n: 4, real: true, config, dataDir }), /pipeline_sim_disabled/);
    // 가짜 모드 A/B/C/D
    const run = await sim.runSimulation({ n: 20, arms: ['A', 'B', 'C', 'D'], config, dataDir });
    assert.equal(run.mode, 'fake'); assert.equal(run.stopReason, null); assert.equal(run.tasks, 20);
    for (const k of ['A', 'B', 'C', 'D']) {
      const s = run.summary[k];
      assert.equal(s.tasks, 20); assert.equal(s.errors, 0);
      assert.ok(s.edit.correct >= 0 && s.edit.correct <= 1); assert.ok(s.translate.correct >= 0 && s.translate.correct <= 1);
      assert.ok(s.calls > 0);
    }
    assert.ok(run.summary.C.callsByProvider.jev > run.summary.A.callsByProvider.jev, 'C가 Jev를 더 부른다(A는 번역 채점용만)');
    assert.ok(run.summary.C.calls > run.summary.A.calls, 'C가 호출이 더 많다');
    assert.deepEqual(run.summary.B.cost.priceUnknownFor, [], '단가 전부 입력됨');
    assert.ok(run.summary.B.cost.krw > 0, '상위 모델 비용이 원화로 계산됨');
    assert.ok(run.comparison.C.vsFirst.krw !== undefined);
    assert.ok(fs.existsSync(path.join(dataDir, `${run.id}.json`)));
    // 비용 상한
    const capped = await sim.runSimulation({ n: 20, arms: ['A'], config, dataDir, capKrw: 1 });
    assert.ok(String(capped.stopReason).startsWith('cap_krw_'), '상한에서 멈춤');
    console.log('pipeline-sim: PASS');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
