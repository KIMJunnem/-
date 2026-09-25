'use strict';
// 성과 숫자 내보내기(2026-09-25 준희 "응 만들어줘"). auto-update.cjs가 한 시간에 한 번 부른다.
// 이 PC의 서버 기록에서 **숫자만** 모아(고객 이름·연락처·대화 본문·요청 원문·대화 번호 없음)
// GitHub KIMJunnem/- 의 relay-stats 브랜치에 stats/latest.json과 날짜별 파일로 올린다.
// 이 폴더의 브랜치·인덱스·작업 파일은 건드리지 않는다(임시 인덱스와 git 저수준 명령만 씀).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const REPO_URL = process.env.RELAY_AUTO_UPDATE_URL || 'https://github.com/KIMJunnem/-.git';
const BRANCH = 'relay-stats';
const REF = 'refs/relay-auto-update/relay-stats';
const STATE_FILE = process.env.RELAY_STATS_STATE_FILE || path.join(ROOT, 'server', 'data', 'state.json');
const PORT = Number(process.env.RELAY_PORT || 8787);
const DAYS = 7;

const kstDay = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const timeOf = item => Date.parse(item?.createdAt || item?.at || item?.updatedAt || '') || 0;
function count(list, keyOf) {
  const out = {};
  for (const item of list) { const key = String(keyOf(item) ?? '') || '(없음)'; out[key] = (out[key] || 0) + 1; }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 30));
}

function getJson(urlPath) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: 'GET', timeout: 15000 }, res => {
      let body = ''; res.on('data', c => { body += c; }); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (_) { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// 숫자만 뽑는다. 본문·이름·번호는 넣지 않는다.
function extraCounts(state = {}, now = Date.now()) {
  const since = now - DAYS * 24 * 3600e3;
  const recent = list => (Array.isArray(list) ? list : []).filter(item => timeOf(item) >= since);
  const leads = recent(state.soomgoLeads);
  const replies = recent(state.soomgoReplies);
  const byDay = list => count(list, item => kstDay(timeOf(item)));
  return {
    windowDays: DAYS,
    leadsByDay: byDay(leads),
    videoAutoDecision: count(leads.filter(item => item.quote?.videoEdit), item => item.quote.videoEdit.autoDecision),
    videoMaterialsQuotes: leads.filter(item => item.quote?.pricing?.type === 'video_edit' && item.quote?.autoSend && !item.quote?.pricing?.units).length,
    repliesByDay: byDay(replies),
    replyTemplates: count(replies, item => item.reply?.templateKey),
    replyAuto: replies.filter(item => item.reply?.autoSend).length,
    replyManual: replies.filter(item => item.reply?.manualReview).length,
    honorificHeld: replies.filter(item => item.reply?.honorificHold).length,
    paymentClaims: replies.filter(item => item.reply?.paymentCheck).length,
    agreedDiscounts: replies.filter(item => Number(item.reply?.agreedAmount || 0) > 0).length,
    jevGate: count(recent(state.jevGateLog), item => `${item.choice || '-'}:${item.action || '-'}`),
    // 9/25 준희 "많이 찾는 유형별 샘플": 최근 30일 영상 편집 요청을 종류별로 센다(글은 올리지 않음)
    videoRequestTypes: (() => {
      let typeOf = () => 'other';
      try { typeOf = require(path.join(ROOT, 'server', 'video-edit-quote.js')).videoType; } catch (_) { return {}; }
      const since30 = now - 30 * 24 * 3600e3;
      const video = (Array.isArray(state.soomgoLeads) ? state.soomgoLeads : []).filter(item => timeOf(item) >= since30
        && (item.quote?.pricing?.type === 'video_edit' || item.quote?.videoEdit || /영상\s*편집/.test(String(item.request?.soomgoCategory || item.category || ''))));
      return count(video, item => typeOf(item.request || item));
    })(),
    // 9/25: 봇이 멈추면 알림(마지막 신호 뒤 몇 분). 상태 글은 올리지 않고 오류 낱말이 있는지만
    botHealth: Object.fromEntries(Object.entries(state.botStatus && typeof state.botStatus === 'object' ? state.botStatus : {}).map(([role, item]) => [role, {
      minutesSinceHeartbeat: Math.round((now - Number(item?.at || 0)) / 60000),
      errorWord: /오류|실패|초과|quota|error|확인 필요/i.test(String(item?.status || ''))
    }])),
    // 9/25: 첫 고용부터 단계가 멈추면 알림(단계별 건수·가장 오래 멈춘 분)
    workflows: (() => {
      // 실제 고용(숨고 내 고용 확인·크몽 결제 확인)으로 생긴 작업만 센다 — 예전 시험 작업이 '멈춤'으로 잡히지 않게(9/25 첫 통계에서 44건 오탐)
      const open = (Array.isArray(state.soomgoWorkflows) ? state.soomgoWorkflows : []).filter(item => item?.hireEvidence?.confirmed === true && !['completed', 'cancelled', 'closed'].includes(String(item?.stage || '')) && !/SELFTEST|TEST|DEMO|SIMULATION/i.test(String(item?.id || '')));
      const ages = open.map(item => Math.round((now - (Date.parse(item.updatedAt || item.stageUpdatedAt || item.createdAt || '') || now)) / 60000));
      return { byStage: count(open, item => item.stage), oldestStuckMinutes: ages.length ? Math.max(...ages) : 0 };
    })()
  };
}

function git(args, opts = {}) {
  const run = spawnSync('git', args, {
    cwd: ROOT, encoding: 'utf8', input: opts.input, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...(opts.env || {}) }
  });
  if (opts.allowFail) return run;
  if (run.status !== 0) throw new Error(`git ${args[0]} 실패: ${String(run.stderr || '').trim().slice(0, 300)}`);
  return run.stdout;
}

async function exportStats(now = Date.now()) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { state = {}; }
  const funnel = await getJson('/api/soomgo/revenue-funnel');
  const pick = funnel ? { funnel: funnel.funnel, conversionRates: funnel.conversionRates, estimatedBookedRevenue: funnel.estimatedBookedRevenue, averageConfirmedOrderValue: funnel.averageConfirmedOrderValue, serviceMix: funnel.serviceMix } : { funnel: null, note: '서버가 꺼져 있어 깔때기 숫자 없음' };
  const stats = { generatedAt: new Date(now).toISOString(), kstDay: kstDay(now), ...pick, extra: extraCounts(state, now) };
  const text = `${JSON.stringify(stats, null, 2)}\n`;

  // relay-stats 브랜치를 받아(없으면 새로) 임시 인덱스로 파일 두 개를 바꾼 커밋을 만든다
  const fetched = git(['fetch', '--no-tags', '--quiet', REPO_URL, `+${BRANCH}:${REF}`], { allowFail: true });
  const parent = fetched.status === 0 ? git(['rev-parse', REF]).trim() : '';
  const index = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-stats-')), 'index');
  const env = { GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: 'Relay Desk PC', GIT_AUTHOR_EMAIL: 'relay-desk-pc@localhost', GIT_COMMITTER_NAME: 'Relay Desk PC', GIT_COMMITTER_EMAIL: 'relay-desk-pc@localhost' };
  try {
    if (parent) git(['read-tree', parent], { env });
    else git(['read-tree', '--empty'], { env });
    const blob = git(['hash-object', '-w', '--stdin'], { input: text }).trim();
    for (const name of ['stats/latest.json', `stats/${stats.kstDay}.json`]) git(['update-index', '--add', '--cacheinfo', `100644,${blob},${name}`], { env });
    const tree = git(['write-tree'], { env }).trim();
    const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `stats ${stats.generatedAt}`], { env }).trim();
    git(['push', '--quiet', REPO_URL, `${commit}:refs/heads/${BRANCH}`]);
    return { ok: true, commit, funnel: Boolean(funnel) };
  } finally {
    fs.rmSync(path.dirname(index), { recursive: true, force: true });
  }
}

module.exports = { exportStats, extraCounts };
if (require.main === module) exportStats().then(r => console.log(JSON.stringify(r))).catch(error => { console.error(error.message); process.exit(1); });
