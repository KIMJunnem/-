'use strict';

// T-4: 전사 → SRT 초안(checkParams 기준) → 기계 검사, 워크플로 연결, 자막 삽입 FFmpeg 경로. 실제 전사·외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const draft = require('../server/transcribe/srt-draft');
const pipeline = require('../server/transcribe/pipeline');
const { runChecks } = require('../server/quality-runner');
const { parse, weightedLength } = require('../checks/_srt');
const video = require('../server/video-pipeline');
const root = path.join(__dirname, '..');
const CP = JSON.parse(fs.readFileSync(path.join(root, 'services', 'subtitle.json'), 'utf8')).checkParams;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subdraft-'));
const W = { charWeightFullWidth: CP.charWeightFullWidth, charWeightHalfWidth: CP.charWeightHalfWidth };

function assertRules(srtText, label) {
  const parsed = parse({ text: srtText });
  assert.equal(parsed.error, null, label);
  let prevEnd = -1;
  for (const b of parsed.blocks) {
    assert.ok(b.lines.length <= CP.maxLines, `${label} ${b.location} 줄 수`);
    for (const l of b.lines) assert.ok(weightedLength(l.trim(), W) <= CP.maxLineChars, `${label} ${b.location} 줄 길이 ${l}`);
    const d = (b.end - b.start) / 1000;
    assert.ok(d >= CP.minDurationSeconds - 1e-9 && d <= CP.maxDurationSeconds + 1e-9, `${label} ${b.location} 노출 ${d}`);
    assert.ok(b.start >= prevEnd, `${label} 겹침 없음`); prevEnd = b.end;
  }
  return parsed.blocks;
}
function checkAll(blocks, name) {
  const srtPath = path.join(tmp, `${name}.srt`); const trPath = path.join(tmp, `${name}.checks.json`);
  fs.writeFileSync(srtPath, draft.toSrt(blocks)); fs.writeFileSync(trPath, JSON.stringify(draft.checksTranscript(blocks)));
  return runChecks('subtitle', { path: srtPath }, { independentTranscript: { path: trPath } });
}

try {
  // 1) 실제 PC 전사 결과(Windows 합성 음성, 고객 자료 아님) → 초안 → 기계 검사 전부 통과
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'transcribe-ko-tts-sample.json'), 'utf8'));
  let blocks = draft.buildBlocks(sample, CP);
  assert.deepEqual(blocks.map(b => b.text), ['안녕하세요.', '자막 전사 엔진 시험입니다.', '오늘은 9월 22일입니다.'], '문장 끝에서 끊음');
  assertRules(draft.toSrt(blocks), 'sample');
  let q = checkAll(blocks, 'sample');
  assert.equal(q.status, 'passed', JSON.stringify(q.failures));
  assert.equal(q.results.find(r => r.id === 'sync_drift').status, 'passed'); assert.equal(q.results.find(r => r.id === 'srt_coverage').status, 'passed');

  // 2) 긴 합성 말: 문장부호 없이 길게 이어지는 말·쉼·빠르지 않은 속도 → 줄 20자·2줄·노출 0.8~7초·겹침 없음·초당 글자 수
  const words = []; let t = 0;
  const vocab = ['오늘', '회의에서는', '다음', '분기', '예산과', '인력', '배치', '계획을', '함께', '정리하고', '담당자별로', '일정을', '다시', '확인하겠습니다', '그리고', '고객', '응대', '기준도', '새로', '맞춥니다'];
  for (let i = 0; i < 120; i += 1) {
    const w = vocab[i % vocab.length] + (i % 37 === 36 ? '.' : i % 11 === 10 ? ',' : '');
    const dur = 0.25 + [...w].length * 0.12;
    words.push({ start: Number(t.toFixed(3)), end: Number((t + dur).toFixed(3)), word: ' ' + w });
    t += dur + (i % 29 === 28 ? 1.4 : 0.05);
  }
  const long = { language: 'ko', segments: [{ start: 0, end: t, text: words.map(w => w.word).join(''), words }] };
  blocks = draft.buildBlocks(long, CP);
  const longBlocks = assertRules(draft.toSrt(blocks), 'long');
  for (const b of longBlocks) {
    const chars = b.lines.reduce((a, l) => a + weightedLength(l.trim(), W), 0);
    assert.ok(chars / ((b.end - b.start) / 1000) <= CP.maxCps + 1e-9, `초당 글자 수 ${b.location}`);
  }
  // 쉼(1.4초) 앞에서 끊고, 블록 시작은 단어 시작 그대로(싱크 기준)
  const pauseStarts = words.filter((w, i) => i > 0 && w.start - words[i - 1].end > 1).map(w => w.start * 1000);
  for (const s of pauseStarts) assert.ok(longBlocks.some(b => Math.abs(b.start - Math.round(s)) <= 1), '쉼 뒤 새 블록');
  assert.ok(longBlocks.every(b => words.some(w => Math.abs(Math.round(w.start * 1000) - b.start) <= 1)), '시작은 단어 시작');
  q = checkAll(blocks, 'long');
  assert.equal(q.status, 'passed', JSON.stringify(q.failures));

  // 3) 너무 빠른 말(늘릴 틈 없음) → 초당 글자 수 검사가 실패로 잡는다(초안이 기준을 속이지 않음)
  const fast = []; t = 0;
  for (let i = 0; i < 30; i += 1) { fast.push({ start: t, end: t + 0.15, word: ' 가나다라마바' }); t += 0.15; }
  q = checkAll(draft.buildBlocks({ language: 'ko', segments: [{ start: 0, end: t, text: '', words: fast }] }, CP), 'fast');
  assert.equal(q.status, 'failed'); assert.ok(q.failures.some(f => f.id === 'srt_cps'));

  // 4) 단어 시각이 없는 전사도 초안은 만든다(시각은 글자 수 비례 추정)
  blocks = draft.buildBlocks({ language: 'ko', segments: [{ start: 0, end: 4, text: '단어 시각이 없는 전사도 초안을 만듭니다.' }] }, CP);
  assert.ok(blocks.length >= 1); assertRules(draft.toSrt(blocks), 'nowords');

} catch (error) { console.error(error); process.exit(1); }

(async () => {
  try {
    // 5) 초벌 파이프라인(가짜 전사): 한국어 → 초안+기계 검사 결과 저장, 워크플로에 독립 전사·초안 기록
    const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'transcribe-ko-tts-sample.json'), 'utf8');
    const tr = require('../server/transcribe');
    const fakeTranscribe = lang => async ({ checkParams }) => {
      const dir = path.join(tmp, `job-${lang}`); fs.mkdirSync(dir, { recursive: true });
      const transcript = JSON.parse(sample); transcript.language = lang;
      const transcriptPath = path.join(dir, 'transcript.json'); fs.writeFileSync(transcriptPath, JSON.stringify(transcript));
      const blocks = draft.buildBlocks(transcript, checkParams, { language: lang });
      const srtPath = path.join(dir, 'draft.srt'); fs.writeFileSync(srtPath, draft.toSrt(blocks));
      const checksTranscriptPath = path.join(dir, 'checks-transcript.json'); fs.writeFileSync(checksTranscriptPath, JSON.stringify(draft.checksTranscript(blocks)));
      return { ok: true, jobId: `JOB-${lang}`, language: lang, languageProbability: 0.9, duration: 7, elapsedSeconds: 1, transcriptPath, srtPath, checksTranscriptPath };
    };
    let state = { soomgoWorkflows: [{ id: 'WF-KO', request: { serviceId: 'subtitle', purpose: '자막 제작' } }, { id: 'WF-FR', request: { serviceId: 'subtitle', purpose: '자막 제작', translationIncluded: true } }] };
    const deps = { checkParams: CP, runChecks, readState: () => JSON.parse(JSON.stringify(state)), writeState: next => { state = next; } };
    let r = await pipeline.prepareSubtitleSource({ ...deps, policy: {}, inputPath: 'x', workflowId: 'WF-KO', transcribeImpl: fakeTranscribe('ko') });
    assert.equal(r.ok, true); assert.equal(r.kind, 'korean_draft'); assert.equal(r.draft.quality.status, 'passed', JSON.stringify(r.draft.quality.failures));
    assert.ok(fs.existsSync(r.draft.qualityPath)); assert.equal(JSON.parse(fs.readFileSync(r.draft.qualityPath, 'utf8')).status, 'passed');
    const wfKo = state.soomgoWorkflows[0];
    assert.equal(wfKo.independentTranscript.path, path.join(tmp, 'job-ko', 'checks-transcript.json')); assert.equal(wfKo.subtitleDraft.quality.status, 'passed');
    assert.equal(state.translationQueue, undefined, '한국어는 번역 대기열 없음');
    // 외국어 → 원어 SRT 보관 + C-2 대기열 자리, 번역은 안 함
    r = await pipeline.prepareSubtitleSource({ ...deps, policy: {}, inputPath: 'x', workflowId: 'WF-FR', transcribeImpl: fakeTranscribe('fr') });
    assert.equal(r.kind, 'foreign_source'); assert.equal(r.translation.status, 'waiting_c2');
    const wfFr = state.soomgoWorkflows[1];
    assert.ok(fs.existsSync(wfFr.sourceLanguageSrt.path)); assert.equal(wfFr.sourceLanguageSrt.language, 'fr');
    assert.equal(state.translationQueue.length, 1); assert.deepEqual([state.translationQueue[0].workflowId, state.translationQueue[0].status, state.translationQueue[0].targetLanguage], ['WF-FR', 'waiting_c2', 'ko']);
    await pipeline.prepareSubtitleSource({ ...deps, policy: {}, inputPath: 'x', workflowId: 'WF-FR', transcribeImpl: fakeTranscribe('fr') });
    assert.equal(state.translationQueue.length, 1, '같은 작업은 대기열에 한 번만');
    // 워크플로 없이(시험 음성) → 상태를 쓰지 않음
    let writes = 0;
    r = await pipeline.prepareSubtitleSource({ ...deps, writeState: () => { writes += 1; }, policy: {}, inputPath: 'x', transcribeImpl: fakeTranscribe('ko') });
    assert.equal(r.ok, true); assert.equal(writes, 0);
    // 전사 실패 → 멈추고 이유
    r = await pipeline.prepareSubtitleSource({ ...deps, policy: {}, inputPath: 'x', workflowId: 'WF-KO', transcribeImpl: async () => ({ ok: false, error: 'input_not_allowed' }) });
    assert.deepEqual([r.ok, r.stage, r.error], [false, 'transcribe', 'input_not_allowed']);

    // 6) 연결: 워크플로에 독립 전사가 있으면 납품 기계 검사에서 sync_drift·srt_coverage가 manual_review가 아니라 자동 판정
    const server = require('../server/relay-server.js');
    const artifacts = [{ id: 'F1', name: 'draft.srt', customerDeliverable: true, localPath: path.join(tmp, 'job-ko', 'draft.srt') }];
    const withTr = server.buildWorkflowQualityResult({ ...wfKo }, artifacts);
    const without = server.buildWorkflowQualityResult({ id: 'WF-X', request: { serviceId: 'subtitle', purpose: '자막 제작' } }, artifacts);
    assert.equal(without.status, 'manual_review', '전사 없으면 사람 확인');
    assert.ok(without.failures.some(f => f.id === 'sync_manual_review_required') && without.failures.some(f => f.id === 'coverage_manual_review_required'));
    assert.equal(withTr.status, 'passed', JSON.stringify(withTr.failures));
    assert.ok(!withTr.failures.some(f => /manual_review/.test(f.id)), '독립 전사 연결 후 사람 확인 없음');

    // 7) 자막 삽입: PATH의 ffmpeg가 아니라 설치본 경로로 실행, Windows 경로 필터 처리, 없으면 ffmpeg_unavailable
    const calls = [];
    const fakeSpawn = (cmd, args) => { calls.push({ cmd, args }); const ch = new EventEmitter(); ch.stderr = new EventEmitter(); setTimeout(() => { fs.writeFileSync(args[args.length - 1], 'mp4'); ch.emit('close', 0); }, 5); return ch; };
    const out = path.join(tmp, 'out.mp4');
    await video.renderWithFfmpeg({ inputPath: 'in.mp4', outputPath: out, subtitlePath: 'C:\\Relay Tools\\a.srt', ffmpegPath: 'C:\\RelayDeskTools\\ffmpeg\\x\\bin\\ffmpeg.exe', spawnImpl: fakeSpawn });
    assert.equal(calls[0].cmd, 'C:\\RelayDeskTools\\ffmpeg\\x\\bin\\ffmpeg.exe');
    assert.equal(calls[0].args[calls[0].args.indexOf('-vf') + 1], "subtitles='C\\:/Relay Tools/a.srt'");
    await assert.rejects(video.renderWithFfmpeg({ inputPath: 'in.mp4', outputPath: out, ffmpegPath: null, spawnImpl: fakeSpawn }), /ffmpeg_unavailable/);
    assert.ok(!/spawn\('ffmpeg'/.test(fs.readFileSync(path.join(root, 'server', 'video-pipeline.js'), 'utf8')), 'PATH의 ffmpeg 호출 없음');
    // 서버 경로: 로컬·관리 헤더
    const src = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
    const at = src.indexOf("pathname === '/api/admin/subtitle-draft'"); assert.ok(at > 0);
    assert.ok(src.slice(at, at + 400).includes('write_server_local_only') && src.slice(at, at + 400).includes("'transcribe'"));
    assert.equal(netCalls, 0);
    console.log('subtitle-draft: PASS');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})();
