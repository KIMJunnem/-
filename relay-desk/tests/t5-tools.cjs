'use strict';

// T-5 측정 도구: 스레드 지정 상한·CPU 표본·샘플 받기(한 폴더·이어 쓰기)·자막 입히기(허용 폴더·가짜 FFmpeg). 실제 실행·외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const tr = require('../server/transcribe');
const t5 = require('../server/transcribe/t5-tools');
const root = path.join(__dirname, '..');
const P = JSON.parse(fs.readFileSync(path.join(root, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8')).transcribe;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't5-'));
  try {
    const samples = path.join(tmp, 'samples'); fs.mkdirSync(samples);
    const audio = path.join(samples, 'a.wav'); fs.writeFileSync(audio, 'fake');
    const policy = { transcribe: { ...P, allowedInputRoots: [samples], outputDir: path.join(tmp, 'out') } };
    const calls = [];
    const fakeSpawn = (cmd, args, opts) => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 1; child.kill = () => {};
      calls.push({ args, env: opts.env });
      const out = args[args.indexOf('--out') + 1];
      setTimeout(() => {
        fs.writeFileSync(out, JSON.stringify({ language: 'ko', languageProbability: 0.9, duration: 2, elapsedSeconds: 1, segments: [{ id: 1, start: 0, end: 2, text: '안녕하세요.', words: [] }], settings: {} }));
        child.stdout.emit('data', JSON.stringify({ ok: true }) + '\n'); child.emit('close', 0);
      }, 1200);
      return child;
    };
    let tick = 0;
    const fakeOs = { setPriority: () => {}, constants: os.constants, cpus: () => { tick += 1; return [{ times: { user: tick * 500, nice: 0, sys: 0, irq: 0, idle: tick * 500 } }, { times: { user: tick * 500, nice: 0, sys: 0, irq: 0, idle: tick * 500 } }]; } };

    // 1) 스레드 지정: 6 초과는 6, 지정 없으면 정책 값
    let r = await tr.transcribe({ policy, inputPath: audio, jobId: 'T5-A', threads: 12, spawnImpl: fakeSpawn, osImpl: fakeOs });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(calls[0].args[calls[0].args.indexOf('--threads') + 1], '6'); assert.equal(calls[0].env.OMP_NUM_THREADS, '6'); assert.equal(r.threads, 6);
    r = await tr.transcribe({ policy, inputPath: audio, jobId: 'T5-B', spawnImpl: fakeSpawn, osImpl: fakeOs });
    assert.equal(calls[1].args[calls[1].args.indexOf('--threads') + 1], String(P.threads));
    r = await tr.transcribe({ policy: { transcribe: { ...policy.transcribe, maxThreads: 4 } }, inputPath: audio, jobId: 'T5-C', threads: 6, spawnImpl: fakeSpawn, osImpl: fakeOs });
    assert.equal(r.threads, 4, '정책 maxThreads를 넘지 못한다');
    // 2) CPU 표본: 1초마다 → 50%
    assert.ok(r.cpu.samples >= 1, JSON.stringify(r.cpu)); assert.equal(r.cpu.avgPercent, 50); assert.equal(r.cpu.cores, 2);
    const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'out', 'T5-C', 'meta.json'), 'utf8'));
    assert.equal(meta.threads, 4); assert.equal(meta.cpu.avgPercent, 50);
    // cpus 없는 os도 멈추지 않는다
    const stop = tr.startCpuSampler({}); assert.equal(stop().samples, 0);

    // 3) 샘플 받기: 이름 검사·이어 쓰기·offset 확인·크기 상한·폴더 밖 금지
    const dir = path.join(tmp, 'storage', 't5-samples');
    const b64 = s => Buffer.from(s).toString('base64');
    assert.equal(t5.writeSampleChunk({ dir, name: '../x.webm', offset: 0, dataBase64: b64('a') }).error, 'bad_name');
    assert.equal(t5.writeSampleChunk({ dir, name: 'x.exe', offset: 0, dataBase64: b64('a') }).error, 'bad_name');
    assert.equal(t5.writeSampleChunk({ dir, name: 'ko.webm', offset: 0, dataBase64: b64('abc') }).size, 3);
    assert.equal(t5.writeSampleChunk({ dir, name: 'ko.webm', offset: 3, dataBase64: b64('def') }).size, 6);
    assert.equal(t5.writeSampleChunk({ dir, name: 'ko.webm', offset: 2, dataBase64: b64('z') }).error, 'offset_mismatch');
    assert.equal(fs.readFileSync(path.join(dir, 'ko.webm'), 'utf8'), 'abcdef');
    assert.equal(t5.writeSampleChunk({ dir, name: 'big.webm', offset: t5.MAX_SAMPLE_BYTES, dataBase64: b64('a') }).error, 'offset_mismatch');
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'storage')), ['t5-samples'], '한 폴더에만 쓴다');

    // 4) 자막 입히기: 허용 폴더 안만, 결과는 outputDir/burnin-*/burned.mp4
    const video = path.join(samples, 'v.webm'); fs.writeFileSync(video, 'v');
    const srt = path.join(samples, 'v.srt'); fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nhi\n');
    const seen = [];
    const render = async ({ inputPath, outputPath, subtitlePath, ffmpegPath }) => { seen.push({ inputPath, subtitlePath, ffmpegPath }); fs.writeFileSync(outputPath, 'mp4'); return { outputPath, sha256: 'x' }; };
    let b = await t5.burnIn({ policy, inputPath: video, srtPath: srt, render, ffmpegPath: 'C:\\ff\\ffmpeg.exe' });
    assert.equal(b.ok, true, JSON.stringify(b)); assert.ok(b.outputPath.startsWith(path.join(tmp, 'out', 'burnin-'))); assert.equal(seen[0].ffmpegPath, 'C:\\ff\\ffmpeg.exe');
    assert.equal((await t5.burnIn({ policy, inputPath: path.join(tmp, 'secret.webm'), srtPath: srt, render })).error, 'input_not_allowed');
    b = await t5.burnIn({ policy, inputPath: video, srtPath: srt, render: async () => { throw new Error('ffmpeg_unavailable'); } });
    assert.equal(b.ok, false); assert.match(b.error, /ffmpeg_unavailable/);
    assert.equal(seen.length, 1);

    // 4-1) 싱크 검사만: 허용 폴더 안만, 응답에 글자 없음, 전체 결과는 outputDir 아래 저장
    const tj = path.join(samples, 't.json');
    fs.writeFileSync(tj, JSON.stringify({ segments: [{ start: 0, end: 1, text: '비밀 고객 문장입니다', words: [{ start: 0, end: 1, word: '비밀 고객 문장입니다' }] }] }));
    const ss = path.join(samples, 's.srt'); fs.writeFileSync(ss, '1\n00:00:00,000 --> 00:00:01,000\n비밀 고객 문장입니다\n');
    const sc = t5.syncCheck({ policy, srtPath: ss, transcriptPath: tj, checkParams: { syncRequireWordTimestamps: true }, label: 'x/../y' });
    assert.equal(sc.ok, true, JSON.stringify(sc)); assert.equal(sc.summary.passed, true);
    assert.ok(!JSON.stringify(sc.summary).includes('비밀'), '응답에 자막·전사 글자 없음');
    assert.ok(sc.savedPath.startsWith(path.join(tmp, 'out', 'sync-checks')));
    assert.equal(t5.syncCheck({ policy, srtPath: path.join(tmp, 'secret.srt'), transcriptPath: tj }).error, 'input_not_allowed');

    // 4-2) PC 회귀 검사 실행: 정해진 스크립트만, 요약·첫 실패만 돌려준다, 동시에 하나만
    const spawned = [];
    const fakeNode = (cmd, args, opts) => {
      spawned.push({ cmd, args, cwd: opts.cwd });
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      setTimeout(() => { child.stdout.emit('data', 'PASS  a (tests/a.cjs)\r\nPASS  b (tests/b.cjs)\r\nFAIL  c (tests/c.cjs)\r\nboom\r\n\r\n전체 결과: 2/3 통과\r\n'); child.emit('close', 1); }, 20);
      return child;
    };
    const [t1, t2] = [t5.runAllTests({ repoRoot: tmp, spawnImpl: fakeNode }), t5.runAllTests({ repoRoot: tmp, spawnImpl: fakeNode })];
    assert.equal(t1, t2, '동시에 하나만');
    const tr1 = await t1;
    assert.equal(spawned.length, 1); assert.deepEqual(spawned[0].args, [path.join(tmp, 'tests', 'run-all.cjs')]); assert.equal(spawned[0].cwd, tmp);
    assert.equal(tr1.ok, false); assert.equal(tr1.passed, 2); assert.equal(tr1.summary, '전체 결과: 2/3 통과'); assert.equal(tr1.firstFailure, 'FAIL  c (tests/c.cjs)');

    // 5) 서버 경로: 로컬 전용·관리자 헤더
    const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
    for (const route of ['/api/admin/t5-sample', '/api/admin/burn-in', '/api/admin/sync-check', '/api/admin/timing-check', '/api/admin/run-tests']) {
      const i = server.indexOf(`pathname === '${route}'`); assert.ok(i > 0, route);
      const block = server.slice(i, i + 600);
      assert.match(block, /if \(!local\)/); assert.match(block, /x-relay-admin/);
    }
    assert.equal(netCalls, 0);
    console.log('t5-tools ok');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
