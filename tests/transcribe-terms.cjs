'use strict';

// S-2: 모델 고르기(small·medium)와 용어 목록(고유명사·전문용어)을 전사 엔진에 넘기는지. 가짜 실행, 외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const tr = require('../server/transcribe');
const pipeline = require('../server/transcribe/pipeline');
const root = path.join(__dirname, '..');
const P = JSON.parse(fs.readFileSync(path.join(root, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8')).transcribe;

// 정책: small·medium 폴더가 적혀 있고 기본은 small
assert.equal(P.modelDirs.small, 'C:\\RelayDeskTools\\models\\small');
assert.equal(P.modelDirs.medium, 'C:\\RelayDeskTools\\models\\medium');
assert.equal(P.modelDir, P.modelDirs.small, '기본 모델은 small 그대로');

// 용어 정리: 쉼표·줄바꿈, 중복 제거, 따옴표·줄바꿈 제거, 한 개 40자, 최대 50개
assert.deepEqual(tr.cleanTerms('SSG, 구단주\n문학야구장,, 팬서비스, SSG'), ['SSG', '구단주', '문학야구장', '팬서비스']);
assert.deepEqual(tr.cleanTerms(['"따옴표"', 'a\tb']), ['따옴표', 'a b']);
assert.equal(tr.cleanTerms(Array.from({ length: 80 }, (_, i) => `용어${i}`)).length, 50);
assert.equal(tr.cleanTerms(['가'.repeat(100)])[0].length, 40);
assert.deepEqual(tr.cleanTerms(null), []);

// transcribe.py가 hotwords·initial_prompt를 쓰고, 모르는 버전이면 initial_prompt로 물러난다
const py = fs.readFileSync(tr.SCRIPT, 'utf8');
assert.match(py, /kwargs\['hotwords'\] = terms/); assert.match(py, /kwargs\['initial_prompt'\] = terms/); assert.match(py, /except TypeError/);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trterms-'));
  try {
    const samples = path.join(tmp, 'samples'); fs.mkdirSync(samples);
    const audio = path.join(samples, 'a.wav'); fs.writeFileSync(audio, 'fake');
    const policy = { transcribe: { ...P, allowedInputRoots: [samples], outputDir: path.join(tmp, 'out') } };
    const calls = [];
    const fakeSpawn = (cmd, args) => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 1; child.kill = () => {};
      calls.push(args);
      const out = args[args.indexOf('--out') + 1];
      setTimeout(() => {
        fs.writeFileSync(out, JSON.stringify({ language: 'ko', languageProbability: 1, duration: 2, elapsedSeconds: 1, segments: [{ id: 1, start: 0, end: 2, text: '문학야구장', words: [{ start: 0, end: 2, word: ' 문학야구장' }] }], settings: {} }));
        child.stdout.emit('data', '{"ok": true}\n'); child.emit('close', 0);
      }, 5);
      return child;
    };
    const fakeOs = { setPriority: () => {}, constants: os.constants };
    const arg = (args, k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);

    // 1) 용어 없음 → --terms 없음, 기본 small
    let r = await tr.transcribe({ policy, inputPath: audio, jobId: 'TT-1', spawnImpl: fakeSpawn, osImpl: fakeOs });
    assert.equal(r.ok, true); assert.equal(arg(calls[0], '--terms'), undefined); assert.equal(arg(calls[0], '--model'), P.modelDirs.small);
    // 2) 용어 + medium
    r = await tr.transcribe({ policy, inputPath: audio, jobId: 'TT-2', model: 'medium', terms: 'SSG, 구단주, 문학야구장, 팬서비스', spawnImpl: fakeSpawn, osImpl: fakeOs });
    assert.equal(arg(calls[1], '--model'), P.modelDirs.medium); assert.equal(arg(calls[1], '--terms'), 'SSG, 구단주, 문학야구장, 팬서비스'); assert.equal(arg(calls[1], '--term-mode'), 'hotwords');
    assert.equal(r.model, 'medium'); assert.equal(r.terms, 4);
    // 3) 방식 지정·엉뚱한 값은 hotwords
    await tr.transcribe({ policy, inputPath: audio, jobId: 'TT-3', terms: ['SSG'], termMode: 'prompt', spawnImpl: fakeSpawn, osImpl: fakeOs });
    assert.equal(arg(calls[2], '--term-mode'), 'prompt');
    await tr.transcribe({ policy, inputPath: audio, jobId: 'TT-4', terms: ['SSG'], termMode: 'rm -rf', spawnImpl: fakeSpawn, osImpl: fakeOs });
    assert.equal(arg(calls[3], '--term-mode'), 'hotwords');
    // 4) 정책에 없는 모델 이름 → 실행 안 함
    const before = calls.length;
    r = await tr.transcribe({ policy, inputPath: audio, model: 'large-v3', spawnImpl: fakeSpawn, osImpl: fakeOs });
    assert.equal(r.error, 'model_not_configured'); assert.equal(calls.length, before);

    // 5) 워크플로 주문 정보의 용어 목록을 쓴다
    const state = { soomgoWorkflows: [{ id: 'WF-1', request: { terms: ['구단주', '문학야구장'] } }] };
    const seen = [];
    const fakeTranscribe = async opts => { seen.push(opts); return { ok: false, error: 'stop_here' }; };
    await pipeline.prepareSubtitleSource({ policy, inputPath: audio, workflowId: 'WF-1', checkParams: {}, runChecks: () => ({}), readState: () => state, writeState: () => {}, transcribeImpl: fakeTranscribe });
    assert.deepEqual(seen[0].terms, ['구단주', '문학야구장']);
    await pipeline.prepareSubtitleSource({ policy, inputPath: audio, workflowId: 'WF-1', terms: 'SSG', checkParams: {}, runChecks: () => ({}), readState: () => state, writeState: () => {}, transcribeImpl: fakeTranscribe });
    assert.equal(seen[1].terms, 'SSG', '직접 준 용어가 먼저');
    assert.equal(netCalls, 0);
    console.log('transcribe-terms: PASS');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
