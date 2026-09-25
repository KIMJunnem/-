'use strict';

// T-5 측정 도구(2026-09-22 준희 승인). 로컬 전용 관리자 경로에서만 쓴다.
// - writeSampleChunk: 공개 샘플을 조각(base64)으로 받아 한 폴더(server/storage/t5-samples)에만 이어 쓴다. 덮어쓰기는 offset 0일 때 같은 이름만.
// - burnIn: 허용 폴더 안의 영상+SRT로 설치 FFmpeg를 불러 MP4를 만든다(server/data/transcripts/burnin-*/).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const transcribe = require('./index');

const MAX_SAMPLE_BYTES = 100 * 1024 * 1024;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(webm|mp4|mov|ogg|oga|opus|wav|mp3|m4a|srt)$/;

function writeSampleChunk({ dir, name, offset, dataBase64 }) {
  const safe = String(name || '');
  if (!NAME_RE.test(safe) || safe.includes('..')) return { ok: false, error: 'bad_name' };
  const off = Number(offset);
  if (!Number.isInteger(off) || off < 0) return { ok: false, error: 'bad_offset' };
  const buffer = Buffer.from(String(dataBase64 || ''), 'base64');
  if (!buffer.length) return { ok: false, error: 'empty_chunk' };
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, safe);
  const current = fs.existsSync(target) ? fs.statSync(target).size : 0;
  if (off !== 0 && off !== current) return { ok: false, error: 'offset_mismatch', size: current };
  if (off + buffer.length > MAX_SAMPLE_BYTES) return { ok: false, error: 'sample_too_large' };
  if (off === 0) fs.writeFileSync(target, buffer); else fs.appendFileSync(target, buffer);
  const size = fs.statSync(target).size;
  return { ok: true, name: safe, path: target, size };
}

async function burnIn({ policy, inputPath, srtPath, render, ffmpegPath, position = null, now = Date.now() }) {
  const cfg = transcribe.readConfig(policy);
  if (!cfg) return { ok: false, error: 'transcribe_disabled' };
  for (const p of [inputPath, srtPath]) {
    if (!p || !transcribe.inputAllowed(cfg, p)) return { ok: false, error: 'input_not_allowed' };
    if (!fs.existsSync(p)) return { ok: false, error: 'input_missing' };
  }
  const id = `burnin-${new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(cfg.outputDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const outputPath = path.join(dir, 'burned.mp4');
  const started = Date.now();
  try {
    const result = await render({ inputPath, outputPath, subtitlePath: srtPath, ffmpegPath, position });
    return { ok: true, id, outputPath, position: position || null, sha256: result.sha256, bytes: fs.statSync(outputPath).size, elapsedSeconds: Math.round((Date.now() - started) / 100) / 10, ffmpegPath };
  } catch (error) { return { ok: false, id, error: String(error.message || error).slice(0, 600) }; }
}

// 싱크 검사만 따로(33분 실거래 확인용, 2026-09-23): 허용 폴더 안의 SRT·전사로 checks/sync_drift를 돌린다.
// 고객 자료 보호: 응답에는 판정 숫자만(자막·전사 글자 없음). 전체 결과는 outDir(server/data/transcripts 아래)에만 저장.
function syncSummary(r) {
  const pick = ['passed', 'status', 'type', 'id', 'detail', 'location', 'matchMethod', 'anchorBlocks', 'matchedBlocks', 'matchRatio', 'smoothed', 'wordTimestamps', 'driftStartBlock', 'driftStartSeconds', 'driftPerMinuteSeconds', 'totalDriftSeconds', 'offsetBeforeSeconds', 'medianDeviationSeconds', 'recommendedOffsetSeconds', 'r2', 'recheckAfterFix', 'firstVerdict', 'correction', 'advisory'];
  const out = {};
  for (const k of pick) if (r && r[k] !== undefined) out[k] = r[k];
  if (Array.isArray(r?.unmatchedBlockNumbers)) out.unmatchedCount = r.unmatchedBlockNumbers.length;
  if (Array.isArray(r?.pairs) && r.pairs.length) {
    const ds = r.pairs.map(p => p.deviationSeconds).sort((a, b) => a - b);
    out.deviation = { min: ds[0], median: ds[Math.floor(ds.length / 2)], max: ds[ds.length - 1] };
  }
  return out;
}
function syncCheck({ policy, srtPath, transcriptPath, checkParams, outDir, label = 'sync', syncDrift = require('../../checks/sync_drift') }) {
  const cfg = transcribe.readConfig(policy);
  if (!cfg) return { ok: false, error: 'transcribe_disabled' };
  for (const p of [srtPath, transcriptPath]) {
    if (!p || !transcribe.inputAllowed(cfg, p)) return { ok: false, error: 'input_not_allowed' };
    if (!fs.existsSync(p)) return { ok: false, error: 'input_missing' };
  }
  const result = syncDrift({ path: srtPath }, { checkParams: checkParams || {}, independentTranscript: { path: transcriptPath } });
  const dir = outDir || path.join(cfg.outputDir, 'sync-checks');
  fs.mkdirSync(dir, { recursive: true });
  const safeLabel = String(label).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'sync';
  const savedPath = path.join(dir, `${safeLabel}-${Date.now()}.json`);
  fs.writeFileSync(savedPath, JSON.stringify({ srtPath, transcriptPath, checkedAt: new Date().toISOString(), result }, null, 2));
  return { ok: true, savedPath, summary: syncSummary(result) };
}

// 시각만으로 맞추기(번역 자막용). 응답에는 숫자만, 전체 결과는 outDir에만 저장.
async function timingCheck({ policy, srtPath, mediaPath, transcriptPath, options, selfTestShifts, driftSpecs, tableRange = null, label = 'timing', ffmpegPath, align = require('./timing-align') }) {
  const cfg = transcribe.readConfig(policy);
  if (!cfg) return { ok: false, error: 'transcribe_disabled' };
  const inputs = [srtPath, mediaPath || transcriptPath];
  for (const p of inputs) {
    if (!p || !transcribe.inputAllowed(cfg, p)) return { ok: false, error: 'input_not_allowed' };
    if (!fs.existsSync(p)) return { ok: false, error: 'input_missing' };
  }
  const result = mediaPath
    ? await align.analyzeAudio({ srtPath, audioPath: mediaPath, ffmpegPath: ffmpegPath || transcribe.resolveFfmpeg(cfg), options, selfTestShifts, driftSpecs, tableRange, tableTranscriptPath: transcriptPath && transcribe.inputAllowed(cfg, transcriptPath) ? transcriptPath : null })
    : align.analyzeFiles({ srtPath, transcriptPath, options, selfTestShifts });
  if (!result.ok) return result;
  const dir = path.join(cfg.outputDir, 'sync-checks');
  fs.mkdirSync(dir, { recursive: true });
  const safeLabel = String(label).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'timing';
  const savedPath = path.join(dir, `${safeLabel}-${Date.now()}.json`);
  fs.writeFileSync(savedPath, JSON.stringify({ srtPath, mediaPath: mediaPath || null, transcriptPath: transcriptPath || null, checkedAt: new Date().toISOString(), result }, null, 2));
  const { windows, blockTable, ...summary } = result;
  return { ok: true, savedPath, summary: { ...summary, windowCount: windows.length, windows: windows.map(w => [w.fromBlock, w.fromSeconds, w.deviationSeconds, w.uncertaintySeconds, w.matchScore]) }, blockTable: blockTable ? blockTable.map(r => [r.block, r.start, r.end, r.speechOnset, r.diff, r.transcriptSegmentStart ?? null, r.diffTranscript ?? null]) : undefined };
}

// PC에서 회귀 검사 돌리기(2026-09-23): 클라우드 복사본이 아니라 이 PC의 node로 tests/run-all.cjs를 돌려 요약만 돌려준다.
// 한 번에 하나만. 정해진 스크립트만 실행한다(인자·경로를 받지 않음).
let testsRunning = null;
function runAllTests({ repoRoot, spawnImpl = require('node:child_process').spawn, nodePath = process.execPath, timeoutMinutes = 20 }) {
  if (testsRunning) return testsRunning;
  testsRunning = new Promise(resolve => {
    const started = Date.now();
    const child = spawnImpl(nodePath, [path.join(repoRoot, 'tests', 'run-all.cjs')], { cwd: repoRoot, windowsHide: true, env: { ...process.env, NODE_ENV: 'test' } });
    let out = '';
    const keep = d => { out += d.toString(); if (out.length > 400000) out = out.slice(-400000); };
    child.stdout?.on('data', keep); child.stderr?.on('data', keep);
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} }, timeoutMinutes * 60000);
    const finish = code => {
      clearTimeout(timer);
      const lines = out.split(/\r?\n/);
      const passLines = lines.filter(l => l.startsWith('PASS  ')).length;
      const failIndex = lines.findIndex(l => l.startsWith('FAIL  '));
      const summary = lines.reverse().find(l => l.includes('전체 결과')) || null;
      resolve({ ok: code === 0, exitCode: code, seconds: Math.round((Date.now() - started) / 1000), passed: passLines, summary, firstFailure: failIndex >= 0 ? out.split(/\r?\n/)[failIndex] : null, failureTail: code === 0 ? null : out.slice(-3000), node: process.version, platform: process.platform });
    };
    child.on('error', error => finish(`spawn_error:${error.message}`));
    child.on('close', finish);
  }).finally(() => { testsRunning = null; });
  return testsRunning;
}

// Jev 내용 대조 한 건(2026-09-23 준희 승인, 사람이 부를 때만)
async function jevPairProbe({ policy, srtPath, transcriptPath, fromSeconds, toSeconds, neighbors = 1, maxCalls = 300, deps }) {
  const cfg = transcribe.readConfig(policy);
  if (!cfg) return { ok: false, error: 'transcribe_disabled' };
  for (const p of [srtPath, transcriptPath]) {
    if (!p || !transcribe.inputAllowed(cfg, p)) return { ok: false, error: 'input_not_allowed' };
    if (!fs.existsSync(p)) return { ok: false, error: 'input_missing' };
  }
  const from = Number(fromSeconds), to = Number(toSeconds);
  if (!(to > from) || to - from > 900) return { ok: false, error: 'bad_range' };
  return require('./jev-probe').probe({ srtPath, transcriptPath, fromSeconds: from, toSeconds: to, neighbors: Math.min(1, Math.max(0, Number(neighbors) || 0)), maxCalls: Math.min(300, Number(maxCalls) || 300), outDir: path.join(cfg.outputDir, 'sync-checks'), ...deps });
}

// 번역 자막 두 단계 싱크 검사(2026-09-23 준희 승인). 참고용, 사람이 부를 때만.
async function translatedSyncCheck({ policy, srtPath, mediaPath, transcriptPath, ffmpegPath, deps }) {
  const cfg = transcribe.readConfig(policy);
  if (!cfg) return { ok: false, error: 'transcribe_disabled' };
  for (const p of [srtPath, transcriptPath, ...(mediaPath ? [mediaPath] : [])]) {
    if (!p || !transcribe.inputAllowed(cfg, p)) return { ok: false, error: 'input_not_allowed' };
    if (!fs.existsSync(p)) return { ok: false, error: 'input_missing' };
  }
  return require('./translated-sync').run({ srtPath, mediaPath, transcriptPath, ffmpegPath: ffmpegPath || transcribe.resolveFfmpeg(cfg), deps, outDir: path.join(cfg.outputDir, 'sync-checks') });
}

module.exports = { MAX_SAMPLE_BYTES, writeSampleChunk, burnIn, syncCheck, syncSummary, timingCheck, runAllTests, jevPairProbe, translatedSyncCheck };
