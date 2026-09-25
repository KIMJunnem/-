'use strict';
// 자동 업데이트(2026-09-25 준희 승인 "A"). PC 작업 스케줄러가 5분마다 부른다(auto-update-run.vbs → auto-update-run.bat).
// 하는 일:
//  1) GitHub KIMJunnem/- 의 relay-desk 브랜치를 받아 온다(이 폴더의 브랜치·원격은 건드리지 않고 refs/relay-auto-update/ 아래에만 둔다).
//  2) 마지막으로 적용한 지점부터 바뀐 파일만 파일별로 끼워 넣는다(git apply). 이미 들어가 있으면 건너뛴다.
//     이 PC에서 따로 고친 파일과 겹치면 아무것도 바꾸지 않고 멈춘다(기록만 남김).
//  3) 전체 시험(tests/run-all.cjs)을 API 키 없이 돌린다. 실패하면 바꾼 파일을 전부 원래대로 되돌린다.
//  4) 통과하면 서버를 재시작한다. 제작 중이라 재시작이 거절되면 다음 차례에 다시 시도한다.
// 절대 건드리지 않는 곳: server/data, server/storage, backups, bridge/config.json, .env 파일.
// 기록: backups/auto-update/log.txt, 상태: backups/auto-update/state.json, 원본 백업: backups/auto-update/<시각>/
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const REPO_URL = process.env.RELAY_AUTO_UPDATE_URL || 'https://github.com/KIMJunnem/-.git';
const BRANCH = 'relay-desk';
const REF = 'refs/relay-auto-update/relay-desk';
// 이 PC 폴더가 처음 만들어진 지점(Drive zip을 올린 커밋 뒤 dist 복구까지). 설치 때 한 번만 쓴다.
const INSTALL_BASE = process.env.RELAY_AUTO_UPDATE_BASE || '7367f2f';
const WORK = path.join(ROOT, 'backups', 'auto-update');
const STATE_FILE = path.join(WORK, 'state.json');
const LOG_FILE = path.join(WORK, 'log.txt');
const LOCK_FILE = path.join(WORK, 'lock');
const PROTECTED = [/^server\/data\//, /^server\/storage\//, /^backups\//, /^bridge\/config\.json$/, /(^|\/)\.env(\.|$)/];
const PORT = Number(process.env.RELAY_PORT || 8787);

fs.mkdirSync(WORK, { recursive: true });
const stamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
function log(line) { fs.appendFileSync(LOG_FILE, `[${stamp()}] ${line}\n`, 'utf8'); console.log(line); }
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; } }
function writeState(next) { fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), 'utf8'); }

function git(args, opts = {}) {
  const run = spawnSync('git', args, {
    cwd: ROOT, encoding: opts.encoding === null ? null : 'utf8', input: opts.input, maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
  });
  if (opts.allowFail) return run;
  if (run.status !== 0) throw new Error(`git ${args[0]} 실패: ${String(run.stderr || '').trim().slice(0, 300)}`);
  return run.stdout;
}

function restartServer() {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/admin/restart', method: 'POST', timeout: 15000,
      headers: { 'x-relay-admin': 'restart', 'content-type': 'application/json' } }, res => {
      let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 200) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.on('error', error => resolve({ status: 0, body: String(error.code || error.message) }));
    req.end('{}');
  });
}

function runTests() {
  const env = { ...process.env, NODE_ENV: 'test' };
  for (const key of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']) delete env[key]; // 시험이 진짜 API를 부르지 않게
  const check = spawnSync(process.execPath, ['--check', path.join(ROOT, 'server', 'relay-server.js')], { cwd: ROOT, encoding: 'utf8' });
  if (check.status !== 0) return { ok: false, detail: `문법 오류: ${String(check.stderr).trim().slice(0, 300)}` };
  const run = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'run-all.cjs')], { cwd: ROOT, encoding: 'utf8', env, timeout: 30 * 60 * 1000 });
  const summary = (String(run.stdout).match(/전체 결과:[^\n]*/) || [''])[0];
  const failed = (String(run.stdout).match(/^FAIL[^\n]*/m) || [''])[0];
  return { ok: run.status === 0, detail: [summary, failed].filter(Boolean).join(' · ') || `종료 코드 ${run.status}` };
}

// 파일 하나의 변경을 끼워 넣을 수 있는지: 'apply'(넣음) · 'already'(이미 들어 있음) · 'conflict'(이 PC에서 따로 고침)
function patchFor(base, target, file) {
  return git(['diff', '--binary', '--full-index', base, target, '--', file], { encoding: null });
}
// 이 폴더가 git 최상위가 아니면(상위 폴더가 저장소) 패치 경로 앞에 붙일 하위 경로
let applyDirectory = null;
function applyOpts() {
  if (applyDirectory === null) {
    const top = git(['rev-parse', '--show-toplevel']).trim();
    applyDirectory = path.relative(path.resolve(top), path.resolve(ROOT)).split(path.sep).join('/');
  }
  return ['apply', '--ignore-whitespace', '--whitespace=nowarn', ...(applyDirectory ? [`--directory=${applyDirectory}`] : [])];
}
function classify(patch) {
  const opts = applyOpts();
  if (git([...opts, '--check', '-'], { input: patch, allowFail: true }).status === 0) return 'apply';
  if (git([...opts, '--reverse', '--check', '-'], { input: patch, allowFail: true }).status === 0) return 'already';
  return 'conflict';
}
// 이 PC의 파일이 GitHub에 올라간 우리 쪽 예전 판 그대로면(예: 존댓말-업데이트.bat이 만든 판) 새 판으로 바꿔도 안전하다.
function knownVersionFor(base, target, file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return null;
  const mine = git(['hash-object', full]).trim();
  const commits = git(['log', '--format=%H', `${base}..${target}`, '--', file]).split('\n').map(line => line.trim()).filter(Boolean);
  const blobs = new Set(commits.map(commit => git(['rev-parse', `${commit}:${file}`], { allowFail: true }).stdout?.trim()).filter(Boolean));
  if (!blobs.has(mine)) return null;
  const t = git(['show', `${target}:${file}`], { encoding: null, allowFail: true });
  return t.status === 0 ? t.stdout : null;
}
// 패치가 그대로 안 맞는 파일(예: 존댓말-업데이트.bat으로 일부가 이미 들어간 파일)은 3방향 합치기를 해 본다.
// 같은 곳을 이 PC에서 다르게 고쳤으면 합치기가 실패해 그대로 "겹침"이 된다. 성공하면 합친 내용을 쓴다.
function mergeFor(base, target, file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return null;
  const blob = rev => git(['show', `${rev}:${file}`], { encoding: null, allowFail: true });
  const b = blob(base); const t = blob(target);
  if (b.status !== 0 || t.status !== 0) return null; // 새로 생기거나 지워지는 파일은 합치지 않음
  const dir = fs.mkdtempSync(path.join(WORK, 'merge-'));
  try {
    fs.writeFileSync(path.join(dir, 'base'), b.stdout);
    fs.writeFileSync(path.join(dir, 'target'), t.stdout);
    const run = spawnSync('git', ['merge-file', '-p', '--quiet', full, path.join(dir, 'base'), path.join(dir, 'target')], { cwd: ROOT, encoding: null, maxBuffer: 256 * 1024 * 1024 });
    return run.status === 0 ? run.stdout : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const install = process.argv.includes('--install');
  // 겹쳐 돌지 않게(30분 넘은 잠금은 죽은 것으로 본다)
  try {
    const lock = fs.statSync(LOCK_FILE);
    if (Date.now() - lock.mtimeMs < 30 * 60 * 1000) return;
  } catch (_) { /* 잠금 없음 */ }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  try {
    const state = readState();
    if (install && !state.lastApplied) state.lastApplied = INSTALL_BASE;
    if (!state.lastApplied) { log('설치가 안 됨(auto-update-install.bat을 먼저 실행)'); return; }

    // 재시작만 남은 경우(제작 중이라 거절됐던 것)
    if (state.restartPending) {
      const r = await restartServer();
      if (r.status === 202) { log(`서버 재시작 완료(미뤄 둔 것) · ${state.restartPending}`); delete state.restartPending; }
      else if (r.status === 0) { log('서버가 꺼져 있음 · 켜면 새 버전으로 켜짐'); delete state.restartPending; }
      writeState(state);
    }

    git(['fetch', '--no-tags', '--quiet', REPO_URL, `+${BRANCH}:${REF}`]);
    const target = git(['rev-parse', REF]).trim();
    const base = git(['rev-parse', state.lastApplied]).trim();
    state.lastCheck = stamp();
    if (target === base) { writeState(state); return; }
    if (state.lastFailed === target) { writeState(state); return; } // 같은 실패를 5분마다 되풀이하지 않음

    // -z: 한글 파일명(존댓말-업데이트.bat 등)을 따옴표·8진수로 바꾸지 않고 그대로 받는다
    const changed = git(['diff', '--name-only', '-z', '--no-renames', base, target]).split('\0').filter(Boolean);
    const files = changed.filter(file => !PROTECTED.some(re => re.test(file)));
    const skippedProtected = changed.filter(file => !files.includes(file));
    const plan = files.map(file => ({ file, patch: patchFor(base, target, file) })).map(item => ({ ...item, kind: classify(item.patch) }))
      .map(item => {
        if (item.kind !== 'conflict') return item;
        const known = knownVersionFor(base, target, item.file);
        if (known) return { ...item, kind: 'merge', merged: known };
        const merged = mergeFor(base, target, item.file);
        return merged ? { ...item, kind: 'merge', merged } : item;
      });
    const conflicts = plan.filter(item => item.kind === 'conflict').map(item => item.file);
    const short = `${base.slice(0, 7)}→${target.slice(0, 7)}`;
    if (conflicts.length) {
      log(`적용 안 함(이 PC에서 따로 고친 파일과 겹침) ${short} · ${conflicts.join(', ')}`);
      Object.assign(state, { lastFailed: target, lastResult: `겹침: ${conflicts.join(', ')}` });
      writeState(state);
      return;
    }
    const toApply = plan.filter(item => item.kind === 'apply' || item.kind === 'merge');
    const backupDir = path.join(WORK, stamp().replace(/[: ]/g, '').replace(/-/g, ''));
    const created = [];
    for (const item of toApply) {
      const full = path.join(ROOT, item.file);
      if (fs.existsSync(full)) { fs.mkdirSync(path.dirname(path.join(backupDir, item.file)), { recursive: true }); fs.copyFileSync(full, path.join(backupDir, item.file)); }
      else created.push(item.file);
    }
    const rollback = () => {
      for (const item of toApply) {
        const saved = path.join(backupDir, item.file);
        const full = path.join(ROOT, item.file);
        if (fs.existsSync(saved)) fs.copyFileSync(saved, full);
      }
      for (const file of created) fs.rmSync(path.join(ROOT, file), { force: true });
    };
    try {
      for (const item of toApply) {
        if (item.kind === 'merge') fs.writeFileSync(path.join(ROOT, item.file), item.merged);
        else git([...applyOpts(), '-'], { input: item.patch });
      }
    } catch (error) {
      rollback();
      log(`적용 중 오류로 원래대로 되돌림 ${short} · ${error.message}`);
      Object.assign(state, { lastFailed: target, lastResult: `적용 오류: ${error.message}` });
      writeState(state);
      return;
    }
    const tests = toApply.length ? runTests() : { ok: true, detail: '바뀐 파일 없음' };
    if (!tests.ok) {
      rollback();
      log(`시험 실패로 원래대로 되돌림 ${short} · ${tests.detail}`);
      Object.assign(state, { lastFailed: target, lastResult: `시험 실패: ${tests.detail}` });
      writeState(state);
      return;
    }
    Object.assign(state, { lastApplied: target, lastResult: `적용 ${toApply.length}개 · ${tests.detail}`, lastAppliedAt: stamp() });
    delete state.lastFailed;
    log(`적용 완료 ${short} · 파일 ${toApply.length}개(이미 있던 것 ${plan.length - toApply.length}개, 보호 폴더라 건너뜀 ${skippedProtected.length}개) · ${tests.detail}`);
    if (toApply.length) {
      const r = await restartServer();
      if (r.status === 202) log('서버 재시작 완료');
      else if (r.status === 409) { state.restartPending = short; log('제작 중이라 재시작 미룸 · 다음 차례에 다시 시도'); }
      else if (r.status === 0) log('서버가 꺼져 있음 · 켜면 새 버전으로 켜짐');
      else log(`재시작 응답 ${r.status} ${r.body}`);
    }
    writeState(state);
  } catch (error) {
    log(`확인 실패 · ${error.message}`);
  } finally {
    fs.rmSync(LOCK_FILE, { force: true });
  }
}

// 9/25 준희 "응 만들어줘": 한 시간에 한 번 성과 숫자(숫자만)를 relay-stats 브랜치에 올린다. 실패해도 업데이트와 상관없음.
async function maybeExportStats() {
  if (process.env.RELAY_STATS_DISABLED === '1') return;
  const state = readState();
  if (!state.lastApplied) return;
  if (Date.now() - (Date.parse(state.lastStatsAt || '') || 0) < 60 * 60 * 1000) return;
  try {
    const result = await require('./stats-export.cjs').exportStats();
    if (!result?.ok) log('성과 숫자 올리기 실패');
  } catch (error) {
    log(`성과 숫자 올리기 실패 · ${String(error.message || error).slice(0, 200)}`);
  }
  const next = readState();
  next.lastStatsAt = new Date().toISOString();
  writeState(next);
}

main().then(maybeExportStats);
