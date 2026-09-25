'use strict';

// T-3 로컬 전사 모듈: 가짜 파이썬 실행으로 인자·우선순위·한 번에 1건·결과 파일을 검사한다. 실제 전사·외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const tr = require('../server/transcribe');
const { readTranscript } = require('../checks/_transcript');
const { parse } = require('../checks/_srt');
const root = path.join(__dirname, '..');
const policyFile = JSON.parse(fs.readFileSync(path.join(root, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));

// 0) 정책 값
const P = policyFile.transcribe;
assert.equal(P.enabled, true); assert.equal(P.model, 'small'); assert.equal(P.computeType, 'int8'); assert.equal(P.vad, true);
assert.equal(P.priority, 'below_normal'); assert.equal(P.maxConcurrent, 1); assert.ok(P.threads >= 1 && P.threads <= 6, '스레드 최대 6');
assert.equal(P.pythonPath, 'C:\\RelayDeskTools\\venv\\Scripts\\python.exe'); assert.equal(P.modelDir, 'C:\\RelayDeskTools\\models\\small');
assert.equal(P.outputDir, 'server/data/transcripts', '결과는 server/data 아래');
assert.equal(tr.readConfig({ transcribe: { ...P, threads: 12 } }).threads, 6, '6개 넘게 적어도 6');
assert.equal(tr.readConfig({ transcribe: { ...P, enabled: false } }), null);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'));
  try {
    const samples = path.join(tmp, 'samples'); fs.mkdirSync(samples);
    const audio = path.join(samples, 'a.wav'); fs.writeFileSync(audio, 'fake');
    const policy = { transcribe: { ...P, allowedInputRoots: [samples], outputDir: path.join(tmp, 'out') } };
    const calls = []; const prio = []; let concurrent = 0; let maxConcurrent = 0;
    const fakeSpawn = (cmd, args, opts) => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 1000 + calls.length; child.kill = () => {};
      calls.push({ cmd, args, env: opts.env }); concurrent += 1; maxConcurrent = Math.max(maxConcurrent, concurrent);
      const out = args[args.indexOf('--out') + 1];
      setTimeout(() => {
        const segments = [{ id: 1, start: 0, end: 4.5, text: '안녕하세요. 자막 전사 엔진 시험입니다.', words: [{ start: 0, end: 0.8, word: ' 안녕하세요.', probability: 0.99 }] }, { id: 2, start: 4.5, end: 6.5, text: '오늘은 9월 22일입니다.', words: [{ start: 4.5, end: 5.0, word: ' 오늘은', probability: 0.98 }] }];
        fs.writeFileSync(out, JSON.stringify({ engine: 'faster-whisper', language: 'ko', languageProbability: 0.97, duration: 6.5, elapsedSeconds: 1.2, segments, settings: { model: 'small', computeType: 'int8', threads: 4, vad: true } }));
        child.stdout.emit('data', JSON.stringify({ ok: true, out }) + '\n');
        concurrent -= 1; child.emit('close', 0);
      }, 50);
      return child;
    };
    const fakeOs = { setPriority: (pid, value) => prio.push([pid, value]), constants: os.constants };

    // 1) 정상: 인자·환경·우선순위·결과 파일
    let r = await tr.transcribe({ policy, inputPath: audio, jobId: 'TR-TEST-1', spawnImpl: fakeSpawn, osImpl: fakeOs });
    assert.equal(r.ok, true, JSON.stringify(r));
    const c = calls[0];
    assert.equal(c.cmd, P.pythonPath); assert.equal(c.args[0], tr.SCRIPT);
    const arg = k => c.args[c.args.indexOf(k) + 1];
    assert.equal(arg('--model'), P.modelDir); assert.equal(arg('--threads'), String(P.threads)); assert.equal(arg('--compute'), 'int8'); assert.equal(arg('--vad'), '1');
    assert.ok(!c.args.includes('--language'), '원어 비우면 자동 감지');
    assert.equal(c.env.OMP_NUM_THREADS, String(P.threads)); assert.equal(c.env.HF_HUB_OFFLINE, '1');
    assert.deepEqual(prio[0], [c.pid ?? 1000, os.constants.priority.PRIORITY_BELOW_NORMAL], '낮은 우선순위');
    assert.equal(r.language, 'ko'); assert.equal(r.segments, 2);
    assert.ok(r.transcriptPath.startsWith(path.join(tmp, 'out', 'TR-TEST-1')));
    // transcript.json은 sync_drift·srt_coverage가 읽는 모양
    const t = readTranscript(r.transcriptPath);
    assert.equal(t.length, 2); assert.equal(t[1].start, 4500); assert.equal(t[0].words[0].text.trim(), '안녕하세요.');
    // SRT 초안
    const srt = parse({ text: fs.readFileSync(r.srtPath, 'utf8') });
    assert.equal(srt.error, null); assert.equal(srt.blocks.length, 2); assert.equal(srt.blocks[1].start, 4500);
    assert.deepEqual(srt.blocks[0].lines, ['안녕하세요.', '자막 전사 엔진 시험입니다.'], '긴 줄은 공백에서 두 줄로');
    assert.ok(fs.existsSync(path.join(tmp, 'out', 'TR-TEST-1', 'meta.json')));

    // 2) 원어 지정
    r = await tr.transcribe({ policy, inputPath: audio, language: 'fr', jobId: 'TR-TEST-2', spawnImpl: fakeSpawn, osImpl: fakeOs });
    assert.equal(calls[1].args[calls[1].args.indexOf('--language') + 1], 'fr');

    // 3) 한 번에 1건: 동시에 3건 넣어도 겹치지 않는다
    const jobs = [3, 4, 5].map(n => tr.transcribe({ policy, inputPath: audio, jobId: `TR-TEST-${n}`, spawnImpl: fakeSpawn, osImpl: fakeOs }));
    assert.equal(tr.status().waiting >= 1, true);
    const done = await Promise.all(jobs);
    assert.ok(done.every(x => x.ok)); assert.equal(maxConcurrent, 1, '동시 실행 1건');

    // 4) 허용 폴더 밖·없는 파일·꺼짐 → 실행 안 함
    const before = calls.length;
    const outside = path.join(tmp, 'secret.wav'); fs.writeFileSync(outside, 'x');
    assert.equal((await tr.transcribe({ policy, inputPath: outside, spawnImpl: fakeSpawn, osImpl: fakeOs })).error, 'input_not_allowed');
    assert.equal((await tr.transcribe({ policy, inputPath: path.join(samples, 'none.wav'), spawnImpl: fakeSpawn, osImpl: fakeOs })).error, 'input_missing');
    assert.equal((await tr.transcribe({ policy: { transcribe: { ...P, enabled: false } }, inputPath: audio, spawnImpl: fakeSpawn, osImpl: fakeOs })).error, 'transcribe_disabled');
    assert.equal(calls.length, before);

    // 5) 파이썬 실패 → ok:false, 다음 건은 계속 돈다
    const failSpawn = () => { const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter(); ch.kill = () => {}; setTimeout(() => { ch.stdout.emit('data', '{"ok": false, "error": "RuntimeError: bad audio"}\n'); ch.emit('close', 1); }, 10); return ch; };
    r = await tr.transcribe({ policy, inputPath: audio, jobId: 'TR-FAIL', spawnImpl: failSpawn, osImpl: fakeOs });
    assert.equal(r.ok, false); assert.match(r.error, /bad audio/);
    r = await tr.transcribe({ policy, inputPath: audio, jobId: 'TR-AFTER', spawnImpl: fakeSpawn, osImpl: fakeOs });
    assert.equal(r.ok, true, '실패 뒤에도 줄은 계속');

    // 6) FFmpeg 찾기(PATH 대신 설치 폴더 아래)
    const ff = path.join(tmp, 'ffmpeg', 'ffmpeg-9.0.2-essentials_build', 'bin'); fs.mkdirSync(ff, { recursive: true });
    const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'; fs.writeFileSync(path.join(ff, exe), '');
    assert.equal(tr.resolveFfmpeg({ ffmpegRoot: path.join(tmp, 'ffmpeg') }), path.join(ff, exe));

    // 7) 서버 경로: 로컬 전용·관리 헤더, 파이썬 스크립트는 외부 전송 없음
    const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
    const at = server.indexOf("pathname === '/api/admin/transcribe' && req.method === 'POST'"); assert.ok(at > 0);
    assert.ok(server.slice(at, at + 400).includes('write_server_local_only') && server.slice(at, at + 400).includes("'transcribe'"));
    const py = fs.readFileSync(tr.SCRIPT, 'utf8');
    assert.ok(/HF_HUB_OFFLINE/.test(py) && /local_files_only=True/.test(py) && /device='cpu'/.test(py));
    assert.ok(!/requests\.|urllib|http[s]?:\/\//.test(py.replace(/^#.*$/gm, '')), '파이썬 스크립트는 네트워크를 쓰지 않음');
    // 결과 폴더는 저장소 테스트 폴더가 아님
    assert.ok(!P.outputDir.startsWith('tests'));
    assert.equal(netCalls, 0);
    console.log('transcribe: PASS');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
