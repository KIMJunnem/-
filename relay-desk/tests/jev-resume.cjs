'use strict';

// 제브 실행 이어 돌리기(2026-09-22): 끊긴 실행은 이미 답 받은 항목(실험·key·rep)을 다시 부르지 않는다. 가짜 fetch, 외부 호출 0회.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const sim = require('../server/jev-simulation');
const { jevSimulationLimits } = require('../server/operating-policy');
const L = jevSimulationLimits();

let calls = 0;
const fakeFetch = async (url, options) => {
  calls += 1;
  const body = JSON.parse(options.body);
  const answers = Object.fromEntries(Object.keys(body.questions).map(q => [q, { type: 'noul', noul: 0.2 }]));
  return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'jev-test', answers, usage: { input_tokens: 100 } }) };
};
const wait = async id => { for (let i = 0; i < 300 && sim.activeRuns.has(id); i += 1) await new Promise(r => setTimeout(r, 20)); };
const def = { id: 'resume_probe', label: '이어 돌리기 시험', source: 'subtitle_pairs', sampleLimit: 5, repeats: 2,
  questions: { omits_meaning: { type: 'noul', instructions: 'Does srt_block leave out meaning that is present in transcript?', criteria: { true: 'omitted', false: 'nothing omitted' } } } };

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevresume-'));
  try {
    const common = { dataDir, state: {}, deps: {}, getKey: () => 'k'.repeat(20), fetchImpl: fakeFetch, limits: L };
    // 1) 원래 실행(10회) → 서버가 4건 답 받은 뒤 끊긴 것처럼 파일을 되돌린다(성공 4 + 오류 1, 상태 running)
    const first = sim.startSimulation({ ...common, custom: [def] });
    await wait(first.id);
    assert.equal(calls, 10);
    const file = path.join(dataDir, 'jev-sim', `${first.id}.json`);
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    const all = run.results['custom:resume_probe'];
    assert.equal(all.length, 10);
    run.results['custom:resume_probe'] = [...all.slice(0, 4), { ...all[4], jev: undefined, error: { message: 'timeout' } }];
    run.status = 'running'; run.finishedAt = null; run.summary = {};
    fs.writeFileSync(file, JSON.stringify(run));

    // 2) 이어 돌리기: 남은 6건만 호출(오류 1건은 다시 부른다), 결과는 10건
    calls = 0;
    const resumed = sim.startSimulation({ ...common, resumeFrom: first.id });
    assert.equal(resumed.resumedFrom, first.id);
    assert.equal(resumed.carriedOver, 4);
    assert.equal(resumed.planned, 6);
    await wait(resumed.id);
    assert.equal(calls, 6, '이미 답 받은 4건은 다시 부르지 않음');
    const after = sim.readRun(dataDir, resumed.id);
    assert.equal(after.status, 'completed');
    assert.equal(after.results['custom:resume_probe'].length, 10);
    assert.equal(new Set(after.results['custom:resume_probe'].map(e => `${e.key}|${e.rep}`)).size, 10, '중복 없음');
    assert.equal(after.cost.calls, 6, '비용은 새로 부른 것만');
    assert.equal(after.summary['custom:resume_probe'].items, 10, '요약은 합친 결과 기준');
    const prev = sim.readRun(dataDir, first.id);
    assert.equal(prev.status, 'interrupted'); assert.equal(prev.resumedBy, resumed.id);

    // 3) 같은 실행을 두 번 잇거나, 끝난 실행을 이으면 거절
    assert.throws(() => sim.startSimulation({ ...common, resumeFrom: first.id }), /jev_resume_run_already_resumed/);
    assert.throws(() => sim.startSimulation({ ...common, resumeFrom: resumed.id }), /jev_resume_run_already_completed/);
    assert.throws(() => sim.startSimulation({ ...common, resumeFrom: 'JEVSIM-없음' }), /jev_resume_run_not_found/);
    console.log('jev-resume: PASS');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
