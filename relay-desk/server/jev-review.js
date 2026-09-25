'use strict';

// Jev 납품 검수(2026-09-22, 1단계: 번역 자막 내용 대조).
// - 기계 검사(quality-runner)가 끝나고 최종 확인 대기(queueManualFinalReview)로 넘어간 뒤 비동기로 돈다.
// - 한국어 SRT 블록과 원어 SRT(context.sourceLanguageSrt) 블록을 시작 시각 ±허용치(checkParams.syncInheritedStartToleranceSeconds)로
//   짝짓고, 짝마다 Jev same_content(noul)를 묻는다. 값이 flagThreshold 미만이면 flagged.
// - 결과는 workflow.jevReview에만 기록한다. 납품을 막지 않는다(blockOnFlags는 이번 단계에서 읽기만 하고 쓰지 않음).
// - 실패·키 없음·예산 부족은 status:'skipped'. 정책 enabled:false면 아무것도 하지 않는다(호출 0, 상태 쓰기 0).
// - 예산: jevSimulation과 같은 하루 주머니. tokensToday/limitStatus를 그대로 쓰고, 쓴 토큰은 jev-sim 폴더에
//   기록 파일(JEVREVIEW-*.json)로 남겨 같은 합계에 잡히게 한다.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jevSimulation = require('./jev-simulation');
// SRT 해석은 기계 검사와 같은 checks/_srt.js를 쓴다. 서버만 복사한 환경(일부 테스트)도 있으니 쓸 때 불러온다.
const parse = input => require('../checks/_srt').parse(input);

const CHECK_ID = 'translated_sync';
const QUESTION = {
  same_content: {
    type: 'noul',
    instructions: 'Does srt_block express the same content as transcript? They may be in different languages. Judge meaning only.',
    criteria: { true: 'same content', false: 'different content' }
  }
};
const CONCURRENCY = 4;
const LOG_LIMIT = 200;

function kstDay(ms = Date.now()) { return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); }
const textOf = block => (block?.lines || []).map(line => String(line).trim()).filter(Boolean).join(' ');
const estimateTokens = state => Math.ceil((JSON.stringify(state).length + JSON.stringify(QUESTION).length) / 3) + 50;

function readConfig(policy) {
  const raw = policy?.jevReview;
  if (!raw || raw.enabled !== true) return null;
  return {
    blockOnFlags: raw.blockOnFlags === true,
    maxCallsPerDelivery: Number(raw.maxCallsPerDelivery) > 0 ? Math.floor(Number(raw.maxCallsPerDelivery)) : 800,
    flagThreshold: Number.isFinite(Number(raw.flagThreshold)) ? Number(raw.flagThreshold) : 0.5,
    services: raw.services && typeof raw.services === 'object' ? raw.services : {}
  };
}

// 짝짓기: 한국어 블록마다 시작 시각 차가 허용치 이내인 가장 가까운 원어 블록 하나(원어 블록은 한 번만 쓴다).
function pairBlocks(koBlocks, sourceBlocks, toleranceSeconds) {
  const tol = Number(toleranceSeconds) * 1000;
  const used = new Set();
  const pairs = []; const unpaired = [];
  for (let i = 0; i < koBlocks.length; i += 1) {
    const ko = koBlocks[i];
    let best = -1; let bestGap = Infinity;
    for (let j = 0; j < sourceBlocks.length; j += 1) {
      if (used.has(j)) continue;
      const gap = Math.abs(sourceBlocks[j].start - ko.start);
      if (gap <= tol + 1e-6 && gap < bestGap) { best = j; bestGap = gap; }
    }
    if (best < 0) { unpaired.push({ index: i + 1, start: ko.start, ko: textOf(ko) }); continue; }
    used.add(best);
    pairs.push({ index: i + 1, start: ko.start, gapMs: bestGap, ko: textOf(ko), source: textOf(sourceBlocks[best]) });
  }
  return { pairs, unpaired };
}

function noulOf(body) {
  const a = body?.answers?.same_content ?? body?.same_content;
  const v = Number(a?.noul ?? a?.value ?? a);
  return Number.isFinite(v) ? v : null;
}

function srtSource(value) { return typeof value === 'string' ? { path: value } : value; }

async function reviewDeliverable({ serviceId, files = [], context = {}, checkParams = {}, policy = {}, limits, dataDir, getKey = () => '', fetchImpl = global.fetch, now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  const base = { check: CHECK_ID, calls: 0, tokens: 0, krw: 0, items: [], flagged: [], checkedAt: at };
  const skip = (reason, extra = {}) => ({ ...base, status: 'skipped', reason, ...extra });
  const cfg = readConfig(policy);
  if (!cfg) return skip('disabled');
  const checks = Array.isArray(cfg.services[serviceId]) ? cfg.services[serviceId] : [];
  if (!checks.includes(CHECK_ID)) return skip('service_not_configured');
  const translated = context.translated === true || Boolean(context.sourceLanguageSrt);
  if (!translated) return skip('not_translated');
  if (!context.sourceLanguageSrt) return skip('source_srt_missing');
  const srtFile = (Array.isArray(files) ? files : []).find(file => /\.srt$/i.test(String(file?.name || file?.path || '')));
  if (!srtFile) return skip('srt_missing');
  const ko = parse(srtFile); const src = parse(srtSource(context.sourceLanguageSrt));
  if (ko.error) return skip('srt_parse_error', { detail: ko.error });
  if (src.error) return skip('source_srt_parse_error', { detail: src.error });
  const tolerance = Number(checkParams.syncInheritedStartToleranceSeconds ?? 0.05);
  const { pairs, unpaired } = pairBlocks(ko.blocks, src.blocks, tolerance);
  const key = String(getKey() || '').trim();
  if (!key) return skip('no_key', { pairs: pairs.length, unpaired: unpaired.length });
  // 예산: 시뮬레이션과 같은 하루 주머니
  let status;
  try { status = jevSimulation.limitStatus(dataDir, limits, now); } catch (error) { return skip('budget_unavailable', { detail: error.message }); }
  const planned = pairs.slice(0, cfg.maxCallsPerDelivery);
  const estimate = planned.reduce((sum, p) => sum + estimateTokens({ srt_block: p.ko, transcript: p.source }), 0);
  if (status.capReached || estimate > status.remainingTokens) return skip('daily_budget', { estimateTokens: estimate, remainingTokens: status.remainingTokens, pairs: pairs.length });

  const price = Number(limits?.usdPerMillionInputTokens) || jevSimulation.PRICE_USD_PER_MTOK;
  const krwPerUsd = Number(limits?.krwPerUsd) || 0;
  const items = new Array(planned.length);
  let tokens = 0; let calls = 0; let authError = null; let errors = 0; let next = 0;
  const worker = async () => {
    while (!authError && next < planned.length) {
      const i = next; next += 1;
      const p = planned[i];
      const state = { srt_block: p.ko, transcript: p.source };
      calls += 1;
      try {
        const body = await jevSimulation.callJev({ key, questions: QUESTION, state, fetchImpl });
        tokens += Number(body?.usage?.input_tokens) || estimateTokens(state);
        items[i] = { index: p.index, start: p.start, ko: p.ko, source: p.source, answer: noulOf(body) };
      } catch (error) {
        tokens += estimateTokens(state); errors += 1;
        if ([401, 403].includes(error.status)) authError = error;
        items[i] = { index: p.index, start: p.start, ko: p.ko, source: p.source, answer: null, error: error.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, planned.length || 1) }, worker));
  const done = items.filter(Boolean);
  const krw = krwPerUsd ? Math.round(tokens * price / 1e6 * krwPerUsd * 100) / 100 : null;
  const result = {
    ...base,
    status: authError ? 'skipped' : 'done',
    reason: authError ? `jev_auth:${authError.status}` : (errors ? `errors:${errors}` : null),
    calls, tokens, krw,
    items: done,
    flagged: done.filter(item => item.answer != null && item.answer < cfg.flagThreshold),
    pairs: pairs.length, unpaired, skippedByCap: Math.max(0, pairs.length - planned.length), errors,
    flagThreshold: cfg.flagThreshold, blockOnFlags: cfg.blockOnFlags, toleranceSeconds: tolerance
  };
  if (calls && dataDir) recordSpend(dataDir, { calls, tokens, krw, price, now });
  return result;
}

// 쓴 토큰을 jev-sim 폴더에 남겨 tokensToday/limitStatus(같은 하루 주머니)에 잡히게 한다.
function recordSpend(dataDir, { calls, tokens, krw, price, now }) {
  const dir = path.join(dataDir, 'jev-sim');
  fs.mkdirSync(dir, { recursive: true });
  const id = `JEVREVIEW-${new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const record = { id, kind: 'jev_review', status: 'completed', day: kstDay(now), startedAt: new Date(now).toISOString(), finishedAt: new Date().toISOString(), experiments: ['jev_review'], cost: { calls, inputTokens: tokens, usd: Number((tokens * price / 1e6).toFixed(6)), krw }, summary: {} };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2));
  return id;
}

function appendLog(state, workflowId, serviceId, result) {
  const entry = { at: result.checkedAt, workflowId, serviceId, status: result.status, reason: result.reason || null, calls: result.calls, krw: result.krw, flaggedCount: result.flagged.length };
  state.jevReviewLog = [entry, ...(Array.isArray(state.jevReviewLog) ? state.jevReviewLog : [])].slice(0, LOG_LIMIT);
}

// relay-server에서 queueManualFinalReview 직후 한 번 부른다. 상태 저장 뒤(다음 틱)에 시작하고,
// 끝나면 상태를 새로 읽어 해당 워크플로에 결과만 붙여 저장한다(읽기·쓰기 사이에 await 없음).
function schedule({ workflowId, serviceId, files, context, checkParams, deps }) {
  const cfg = readConfig(deps.readPolicy());
  if (!cfg) return null; // 꺼져 있으면 아무것도 하지 않는다
  const task = new Promise(resolve => setImmediate(resolve)).then(async () => {
    let result;
    try {
      result = await reviewDeliverable({ serviceId, files, context, checkParams, policy: deps.readPolicy(), limits: deps.limits(), dataDir: deps.dataDir, getKey: deps.getKey, fetchImpl: deps.fetchImpl || global.fetch });
    } catch (error) {
      result = { check: CHECK_ID, status: 'skipped', reason: `error:${String(error?.message || error).slice(0, 120)}`, calls: 0, tokens: 0, krw: 0, items: [], flagged: [], checkedAt: new Date().toISOString() };
    }
    try {
      const latest = deps.readState();
      const workflow = (Array.isArray(latest.soomgoWorkflows) ? latest.soomgoWorkflows : []).find(item => String(item.id) === String(workflowId));
      if (!workflow) return result;
      workflow.jevReview = result;
      appendLog(latest, workflowId, serviceId, result);
      deps.writeState(latest);
    } catch (_) {}
    return result;
  });
  return task;
}

// /api/attention: 최종 확인 대기 중인 납품별 flagged 수
function attentionFlags(state) {
  return (Array.isArray(state?.soomgoWorkflows) ? state.soomgoWorkflows : [])
    .filter(item => item?.manualFinalReview?.status === 'pending' && item.jevReview)
    .map(item => ({ workflowId: item.id, status: item.jevReview.status, reason: item.jevReview.reason || null, flagged: (item.jevReview.flagged || []).length, calls: item.jevReview.calls || 0, checkedAt: item.jevReview.checkedAt || null }));
}

module.exports = { CHECK_ID, QUESTION, readConfig, pairBlocks, reviewDeliverable, recordSpend, appendLog, schedule, attentionFlags };
