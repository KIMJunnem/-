'use strict';

// 로컬 전사 모듈(2026-09-22, T-3). faster-whisper(Python)를 이 PC 안에서만 돌린다. 유료 API·외부 업로드 없음.
// - 값(파이썬 경로, 모델 폴더, 스레드, VAD, 우선순위, 시간 제한)은 정책 파일 transcribe 블록에서 읽는다.
// - 한 번에 1건만(나머지는 줄 세움). 낮은 우선순위로 실행해 숨고 봇·서버가 느려지지 않게 한다.
// - 결과는 server/data/transcripts/<작업ID>/ 아래 transcript.json(구간+단어 시각)과 draft.srt(SRT 초안).
//   transcript.json은 checks/_transcript.js(sync_drift·srt_coverage의 독립 전사 읽기)와 같은 모양이다.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const srtDraft = require('./srt-draft');

const SCRIPT = path.join(__dirname, 'transcribe.py');
const REPO_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_OUTPUT = path.join(__dirname, '..', 'data', 'transcripts');
const PRIORITIES = { normal: 'PRIORITY_NORMAL', below_normal: 'PRIORITY_BELOW_NORMAL', low: 'PRIORITY_LOW' };

function readConfig(policy) {
  const raw = policy?.transcribe;
  if (!raw || raw.enabled !== true) return null;
  const cfg = {
    pythonPath: String(raw.pythonPath || ''),
    modelDir: String(raw.modelDir || ''),
    modelDirs: raw.modelDirs && typeof raw.modelDirs === 'object' ? Object.fromEntries(Object.entries(raw.modelDirs).map(([k, v]) => [String(k), String(v)])) : {},
    ffmpegRoot: String(raw.ffmpegRoot || ''),
    computeType: String(raw.computeType || 'int8'),
    threads: Math.floor(Number(raw.threads)),
    maxThreads: Math.floor(Number(raw.maxThreads || 6)),
    vad: raw.vad !== false,
    priority: PRIORITIES[raw.priority] ? raw.priority : 'below_normal',
    timeoutMinutes: Number(raw.timeoutMinutes || 120),
    outputDir: raw.outputDir ? path.resolve(REPO_ROOT, raw.outputDir) : DEFAULT_OUTPUT,
    allowedInputRoots: (Array.isArray(raw.allowedInputRoots) ? raw.allowedInputRoots : []).map(p => path.isAbsolute(String(p)) || /^[A-Za-z]:[\\/]/.test(String(p)) ? path.resolve(String(p)) : path.resolve(REPO_ROOT, String(p)))
  };
  if (!cfg.pythonPath || !cfg.modelDir) return null;
  if (!(cfg.threads >= 1)) cfg.threads = 4;
  cfg.threads = Math.min(cfg.threads, Math.max(1, cfg.maxThreads), 6); // 준희 지시: 최대 6
  return cfg;
}

// 용어 목록(S-2): 주문 정보의 고유명사·전문용어. 쉼표·줄바꿈 구분 문자열이나 배열. 최대 50개, 한 개 40자.
function cleanTerms(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,\n]/);
  const out = [];
  for (const item of list) {
    const term = String(item || '').replace(/[\r\n\t"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (term && !out.includes(term)) out.push(term);
    if (out.length >= 50) break;
  }
  return out;
}

// 허용된 폴더 안의 파일만 받는다(임의 경로 읽기 방지)
function inputAllowed(cfg, filePath) {
  const target = path.resolve(String(filePath || ''));
  const roots = [...cfg.allowedInputRoots, cfg.outputDir];
  return roots.some(root => target === root || target.startsWith(root + path.sep));
}

// FFmpeg는 PATH에 없다(준희 결정). 설치 폴더 아래에서 bin/ffmpeg(.exe)를 찾는다. T-4(자막 삽입)에서 쓴다.
function resolveFfmpeg(cfg, fsImpl = fs) {
  if (!cfg?.ffmpegRoot) return null;
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const direct = path.join(cfg.ffmpegRoot, 'bin', exe);
  if (fsImpl.existsSync(direct)) return direct;
  try {
    for (const name of fsImpl.readdirSync(cfg.ffmpegRoot)) {
      const candidate = path.join(cfg.ffmpegRoot, name, 'bin', exe);
      if (fsImpl.existsSync(candidate)) return candidate;
    }
  } catch (_) {}
  return null;
}

// ─── SRT 초안: 전사 구간 하나 = 자막 블록 하나. 한 줄이 길면 가운데 쪽 공백에서 두 줄로 나눈다(초안이라 단순하게). ───
function ts(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, x = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`;
}
function splitLine(text, maxChars = 20) {
  const t = String(text || '').trim();
  if ([...t].length <= maxChars) return [t];
  const mid = t.length / 2;
  const spaces = []; for (let i = 1; i < t.length - 1; i += 1) if (t[i] === ' ') spaces.push(i);
  if (!spaces.length) return [t];
  // 문장부호(. ? ! ,) 뒤 공백을 먼저, 없으면 가운데에 가장 가까운 공백
  const punct = spaces.filter(i => /[.?!,。]/.test(t[i - 1]));
  const pool = punct.length ? punct : spaces;
  const cut = pool.reduce((best, i) => (Math.abs(i - mid) < Math.abs(best - mid) ? i : best), pool[0]);
  return [t.slice(0, cut).trim(), t.slice(cut).trim()];
}
function srtFromSegments(segments, { maxChars = 20 } = {}) {
  return (segments || []).filter(s => String(s.text || '').trim() && Number(s.end) > Number(s.start))
    .map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${splitLine(s.text, maxChars).join('\n')}`).join('\n\n') + '\n';
}

// ─── CPU 사용률 표본(T-5 측정용): 1초마다 os.cpus() 누적 시간 차이로 전체 사용률(%)을 잰다. 외부 도구 없음. ───
function cpuList(osImpl) { try { return typeof osImpl?.cpus === 'function' ? (osImpl.cpus() || []) : []; } catch (_) { return []; } }
function cpuTotals(osImpl = os) {
  let idle = 0, total = 0;
  for (const c of cpuList(osImpl)) { const t = c.times || {}; idle += t.idle || 0; total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.irq || 0) + (t.idle || 0); }
  return { idle, total };
}
function startCpuSampler(osImpl = os, intervalMs = 1000) {
  const samples = [];
  let prev = cpuTotals(osImpl);
  const timer = setInterval(() => {
    const cur = cpuTotals(osImpl);
    const dt = cur.total - prev.total, di = cur.idle - prev.idle;
    if (dt > 0) samples.push(Math.round(1000 * (1 - di / dt)) / 10);
    prev = cur;
  }, intervalMs);
  if (timer.unref) timer.unref();
  return () => {
    clearInterval(timer);
    if (!samples.length) return { samples: 0, avgPercent: null, maxPercent: null };
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    return { samples: samples.length, avgPercent: Math.round(avg * 10) / 10, maxPercent: Math.max(...samples), cores: cpuList(osImpl).length };
  };
}

// ─── 한 번에 1건 ───
let chain = Promise.resolve();
let running = null; let waiting = 0;
function status() { return { running, waiting }; }

function runOnce({ cfg, inputPath, language, jobId, checkParams = null, terms = [], termMode = 'hotwords', spawnImpl = spawn, osImpl = os, now = Date.now() }) {
  return new Promise(resolve => {
    const dir = path.join(cfg.outputDir, jobId);
    fs.mkdirSync(dir, { recursive: true });
    const outJson = path.join(dir, 'transcript.json');
    const args = [SCRIPT, '--input', inputPath, '--out', outJson, '--model', cfg.modelDir, '--threads', String(cfg.threads), '--compute', cfg.computeType, '--vad', cfg.vad ? '1' : '0'];
    if (language) args.push('--language', String(language));
    if (terms.length) args.push('--terms', terms.join(', '), '--term-mode', ['hotwords', 'prompt', 'both'].includes(termMode) ? termMode : 'hotwords');
    const env = { ...process.env, OMP_NUM_THREADS: String(cfg.threads), HF_HUB_OFFLINE: '1', PYTHONIOENCODING: 'utf-8' };
    const child = spawnImpl(cfg.pythonPath, args, { windowsHide: true, env });
    const stopCpu = startCpuSampler(osImpl);
    try { if (child.pid) osImpl.setPriority(child.pid, osImpl.constants.priority[PRIORITIES[cfg.priority]]); } catch (_) {}
    let stdout = ''; let stderr = '';
    child.stdout?.on('data', d => { stdout += d; });
    child.stderr?.on('data', d => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} }, cfg.timeoutMinutes * 60000);
    child.on('error', error => { clearTimeout(timer); stopCpu(); resolve({ ok: false, jobId, error: `spawn_failed:${error.message}` }); });
    child.on('close', code => {
      clearTimeout(timer);
      const cpu = stopCpu();
      const last = String(stdout).trim().split('\n').pop() || '';
      let info = null; try { info = JSON.parse(last); } catch (_) {}
      if (code !== 0 || !info?.ok || !fs.existsSync(outJson)) return resolve({ ok: false, jobId, error: info?.error || `exit_${code}`, stderr: stderr.slice(-800) });
      const transcript = JSON.parse(fs.readFileSync(outJson, 'utf8'));
      const srtPath = path.join(dir, 'draft.srt');
      // checkParams가 오면(T-4) 단어 시각으로 기준에 맞춰 끊은 초안 + 싱크 검사용 독립 전사(블록 크기)도 만든다
      let checksTranscriptPath = null;
      if (checkParams) {
        const blocks = srtDraft.buildBlocks(transcript, checkParams, { language: transcript.language });
        fs.writeFileSync(srtPath, srtDraft.toSrt(blocks));
        checksTranscriptPath = path.join(dir, 'checks-transcript.json');
        fs.writeFileSync(checksTranscriptPath, JSON.stringify(srtDraft.checksTranscript(blocks, { language: transcript.language, derivedFrom: 'transcript.json' })));
      } else fs.writeFileSync(srtPath, srtFromSegments(transcript.segments));
      const meta = { jobId, inputName: path.basename(inputPath), createdAt: new Date(now).toISOString(), finishedAt: new Date().toISOString(), language: transcript.language, languageProbability: transcript.languageProbability, duration: transcript.duration, elapsedSeconds: transcript.elapsedSeconds, segments: transcript.segments.length, settings: transcript.settings, priority: cfg.priority, threads: cfg.threads, model: cfg.modelName || path.basename(cfg.modelDir), terms: terms.length, cpu };
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
      resolve({ ok: true, ...meta, transcriptPath: outJson, srtPath, checksTranscriptPath });
    });
  });
}

// 줄 세워 실행. 반환: 결과 Promise
function transcribe({ policy, inputPath, language = '', jobId, checkParams = null, threads = null, model = null, terms = null, termMode = 'hotwords', spawnImpl, osImpl } = {}) {
  const cfg = readConfig(policy);
  // 모델 고르기(S-2): 정책 modelDirs에 적힌 이름만(small, medium …). 없는 이름이면 실행하지 않는다.
  if (cfg && model) {
    const dir = cfg.modelDirs[String(model)];
    if (!dir) return Promise.resolve({ ok: false, error: 'model_not_configured' });
    cfg.modelDir = dir; cfg.modelName = String(model);
  }
  const termList = cleanTerms(terms);
  // 측정용 스레드 지정(T-5): 정책 maxThreads·6을 넘지 못한다
  if (cfg && Number(threads) >= 1) cfg.threads = Math.min(Math.floor(Number(threads)), Math.max(1, cfg.maxThreads), 6);
  if (!cfg) return Promise.resolve({ ok: false, error: 'transcribe_disabled' });
  if (!inputPath || !inputAllowed(cfg, inputPath)) return Promise.resolve({ ok: false, error: 'input_not_allowed' });
  if (!fs.existsSync(inputPath)) return Promise.resolve({ ok: false, error: 'input_missing' });
  const id = String(jobId || `TR-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`).replace(/[^A-Za-z0-9_-]/g, '');
  waiting += 1;
  const task = chain.then(async () => {
    waiting -= 1; running = id;
    try { return await runOnce({ cfg, inputPath, language, jobId: id, checkParams, terms: termList, termMode, spawnImpl, osImpl }); }
    finally { running = null; }
  });
  chain = task.catch(() => {});
  return task;
}

module.exports = { SCRIPT, PRIORITIES, cpuTotals, startCpuSampler, cleanTerms, readConfig, inputAllowed, resolveFfmpeg, srtFromSegments, splitLine, transcribe, status };
