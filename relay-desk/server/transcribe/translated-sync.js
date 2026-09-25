'use strict';

// 번역 자막 두 단계 싱크 검사(2026-09-23 준희 승인). 참고용: 납품을 막지 않고, 자동 보정도 하지 않는다.
//   1단계 시각 맞춤(timing-align): 말/쉼과 자막 시각 → 일정·점점 밀림
//   2단계 Jev 내용 대조(jev-probe 방식, 전 블록): 블록마다 같은 시각·앞·뒤 원어와 "같은 내용인가"
//     - 5블록 중 3블록 이상이 한 칸 앞섬/늦음 → "내용 밀림 구간"(시작·끝 블록)
//     - "셋 다 안 맞음" 30% 초과 → 사람 확인
//     - 수정안만 만든다("k번 한국어를 한 칸 뒤로/앞으로"). 적용은 사람이.
// 실행은 관리자 경로에서 사람이 부를 때만. 비용 상한: 1회 1,500호출·50원(넘을 것 같으면 부르지 않고 skipped, 도중에 넘으면 멈춤).
// Jev에는 글자만(파일명·경로 없음), 이름은 가림. 전체 결과(글자 포함)는 outDir(PC)에만.

const fs = require('node:fs');
const path = require('node:path');
const probe = require('./jev-probe');

const LIMITS = { maxCalls: 1500, maxKrw: 50, window: 5, needShift: 3, noMatchManualRatio: 0.3 };
const r3 = v => Number(Number(v).toFixed(3));
const estimateTokens = state => Math.ceil((JSON.stringify(state).length + JSON.stringify(probe.QUESTION).length) / 3) + 50;
// 사전 비용 추정(2026-09-23 지시 3): 건당 토큰은 정책 파일 jevSimulation.translatedSyncTokensPerCall(실측값)을 쓴다.
// 글자 수÷3은 한국어를 적게 센다(33분 건 추정 12.5원 → 실제 27원). 값이 없거나 잘못되면 예전 방식(글자 수÷3)으로 돌아간다.
function configuredTokensPerCall(limits) {
  if (Number(limits?.tokensPerCall) > 0) return Number(limits.tokensPerCall);
  try { const v = Number(require('../operating-policy').readOperatingPolicy().jevSimulation?.translatedSyncTokensPerCall); return v > 0 ? v : null; } catch (_) { return null; }
}
const krwOf = (tokens, limits) => {
  const price = Number(limits?.usdPerMillionInputTokens) || 0.042;
  const rate = Number(limits?.krwPerUsd) || 1500;
  return Math.round(tokens * price / 1e6 * rate * 100) / 100;
};

function findSegments(rows, { window = LIMITS.window, needShift = LIMITS.needShift } = {}) {
  const segments = [];
  for (const dir of ['early_one', 'late_one']) {
    let current = null;
    for (let i = 0; i + window <= rows.length || (i < rows.length && i === 0); i += 1) {
      const win = rows.slice(i, i + window);
      if (win.length < Math.min(window, rows.length)) break;
      const hits = win.filter(r => r.verdict === dir);
      if (hits.length >= needShift) {
        const from = hits[0], to = hits[hits.length - 1];
        if (current && from.block <= current.toBlock + 1) { if (to.block > current.toBlock) { current.toBlock = to.block; current.toSeconds = to.start; } }
        else { current = { direction: dir === 'early_one' ? 'early' : 'late', fromBlock: from.block, fromSeconds: from.start, toBlock: to.block, toSeconds: to.start }; segments.push(current); }
      }
    }
  }
  return segments.sort((a, b) => a.fromBlock - b.fromBlock);
}

function suggestions(rows, segments) {
  const out = [];
  for (const seg of segments) {
    for (const r of rows) {
      if (r.block < seg.fromBlock || r.block > seg.toBlock) continue;
      if (seg.direction === 'early' && r.verdict === 'early_one') out.push({ block: r.block, action: 'move_back_one', text: `${r.block}번 한국어를 한 칸 뒤(${r.block + 1}번 시각)로` });
      if (seg.direction === 'late' && r.verdict === 'late_one') out.push({ block: r.block, action: 'move_forward_one', text: `${r.block}번 한국어를 한 칸 앞(${r.block - 1}번 시각)으로` });
    }
  }
  return out;
}

async function run({ srtPath, mediaPath, transcriptPath, ffmpegPath, deps = {}, limits = {}, outDir, timingImpl = null, now = Date.now(), parseImpl = null, concurrency = 4 }) {
  const cap = { ...LIMITS, ...limits };
  const parse = parseImpl || require('../../checks/_srt').parse;
  const parsed = parse({ path: srtPath });
  if (parsed.error) return { ok: false, error: `srt_parse:${parsed.error}` };
  const blocks = parsed.blocks.map(b => ({ number: b.number, start: b.start / 1000, end: b.end / 1000, lines: b.lines }));

  // 1단계: 시각 맞춤(무료)
  let timing = null;
  try {
    const align = timingImpl || require('./timing-align');
    const t = mediaPath ? await align.analyzeAudio({ srtPath, audioPath: mediaPath, ffmpegPath, parseImpl }) : align.analyzeFiles({ srtPath, transcriptPath, parseImpl });
    timing = t.ok ? { type: t.type, medianDeviationSeconds: t.medianDeviationSeconds ?? null, driftStartWindow: t.driftStartWindow || null, totalDriftSeconds: t.totalDriftSeconds ?? null, minMatchScore: t.matchScore?.minValue ?? null, recheck: t.recheck?.type || null, lowScoreWindows: (t.windows || []).filter(w => w.matchScore < 0.4).map(w => w.fromBlock) } : { error: t.error };
  } catch (error) { timing = { error: String(error.message || error).slice(0, 200) }; }

  // 2단계: Jev 내용 대조(전 블록)
  const words = probe.wordsOf(JSON.parse(fs.readFileSync(transcriptPath, 'utf8')));
  const pairs = probe.planPairs({ blocks, words, fromSeconds: -1, toSeconds: Infinity, neighbors: 1 });
  const perCall = configuredTokensPerCall(limits);
  const estimate = perCall ? Math.ceil(perCall * pairs.length) : pairs.reduce((s, p) => s + estimateTokens({ srt_block: p.ko, transcript: p.fr }), 0);
  const base = { ok: true, status: 'reference', blocks: blocks.length, timing, planned: pairs.length, estimateMethod: perCall ? `per_call:${perCall}` : 'chars_div_3', estimateTokens: estimate, estimateKrw: krwOf(estimate, deps.limits) };
  const skip = reason => ({ ...base, jev: { status: 'skipped', reason, calls: 0 } });
  if (!pairs.length) return skip('no_pairs');
  if (pairs.length > cap.maxCalls) return skip(`over_max_calls:${pairs.length}>${cap.maxCalls}`);
  if (base.estimateKrw > cap.maxKrw) return skip(`over_max_krw:${base.estimateKrw}>${cap.maxKrw}`);
  const key = String(deps.getKey ? deps.getKey() : '').trim();
  if (!key) return skip('no_key');
  const status = deps.limitStatus(deps.dataDir, deps.limits, now);
  if (status.capReached || estimate > status.remainingTokens) return skip('daily_budget');

  const items = new Array(pairs.length);
  let nextIndex = 0, tokens = 0, calls = 0, errors = 0, stopped = null;
  const worker = async () => {
    while (!stopped && nextIndex < pairs.length) {
      const i = nextIndex; nextIndex += 1;
      const p = pairs[i];
      const state = { srt_block: p.ko, transcript: p.fr };
      calls += 1;
      try {
        const body = await deps.callJev({ key, questions: probe.QUESTION, state, fetchImpl: deps.fetchImpl || global.fetch });
        tokens += Number(body?.usage?.input_tokens) || perCall || estimateTokens(state);
        const a = body?.answers?.same_content ?? body?.same_content;
        const v = Number(a?.noul ?? a?.value ?? a);
        items[i] = { ...p, answer: Number.isFinite(v) ? v : null };
      } catch (error) {
        tokens += perCall || estimateTokens(state); errors += 1;
        if ([401, 403].includes(error.status)) stopped = `jev_auth:${error.status}`;
        items[i] = { ...p, answer: null, error: error.message };
      }
      if (!stopped && krwOf(tokens, deps.limits) > cap.maxKrw) stopped = 'max_krw_reached';
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker));
  const krw = krwOf(tokens, deps.limits);
  if (calls && deps.recordSpend) deps.recordSpend(deps.dataDir, { calls, tokens, krw, price: Number(deps.limits?.usdPerMillionInputTokens) || 0.042, now });
  const done = items.filter(Boolean);
  const judged = probe.judge(done);
  const segments = findSegments(judged.rows, cap);
  const noMatch = judged.counts.no_match || 0;
  const noMatchRatio = judged.rows.length ? r3(noMatch / judged.rows.length) : 0;
  const verdict = noMatchRatio > cap.noMatchManualRatio ? 'manual_review' : segments.length ? 'content_shift' : 'ok';
  const fixes = suggestions(judged.rows, segments);
  let savedPath = null;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    savedPath = path.join(outDir, `translated-sync-${Date.now()}.json`);
    fs.writeFileSync(savedPath, JSON.stringify({ srtPath, mediaPath: mediaPath || null, transcriptPath, checkedAt: new Date(now).toISOString(), timing, calls, tokens, krw, errors, stopped, verdict, segments, suggestions: fixes, items: done, rows: judged.rows }, null, 2));
  }
  return { ...base, verdict, jev: { status: stopped ? 'stopped' : 'done', reason: stopped, calls, tokens, krw, errors }, counts: judged.counts, noMatchRatio, segments, suggestionCount: fixes.length, suggestions: fixes.map(f => ({ block: f.block, action: f.action })), savedPath };
}

module.exports = { LIMITS, findSegments, suggestions, run };
