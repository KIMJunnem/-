'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeFutureRoutingPolicy } = require('./model-router');

const POLICY_FILE = path.join(__dirname, 'config', 'astra-relay-operating-policy.json');

function readOperatingPolicy() {
  const raw = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'));
  if (!raw || raw.version !== 1 || !raw.limits || !raw.astraGate || !raw.delivery) {
    throw new Error('invalid_astra_relay_operating_policy');
  }
  const mode = String(raw.finalGrade?.mode || 'manual');
  if (!['manual', 'astra'].includes(mode)) throw new Error('invalid_final_grade_mode');
  raw.finalGrade = { ...(raw.finalGrade || {}), mode };
  return raw;
}

function paidOrderBudget({ orderAstraUsd = 0, activePaidOrders = 0 } = {}) {
  const policy = readOperatingPolicy();
  const reasons = [];
  if (Number(activePaidOrders) >= Number(policy.limits.maxConcurrentPaidOrders)) reasons.push('concurrent_paid_order_limit');
  if (Number(orderAstraUsd) >= Number(policy.limits.maxAstraUsdPerOrder)) reasons.push('astra_order_cost_limit');
  return { allowed: reasons.length === 0, reasons, limits: policy.limits };
}

function astraLaneAllowed(lane) {
  const policy = readOperatingPolicy();
  const map = {
    routine_quote: 'routineQuote', routine_chat: 'routineChat',
    payment_state: 'paymentStateTransition', delivery_state: 'deliveryStateTransition',
    paid_production: 'paidProduction', final_artifact_review: 'finalArtifactReview',
    exception_interpretation: 'exceptionInterpretation'
  };
  return Boolean(policy.astraGate[map[lane]]);
}

function finalGradeMode() {
  return readOperatingPolicy().finalGrade.mode;
}

function futureRoutingPolicy() {
  try {
    return normalizeFutureRoutingPolicy(readOperatingPolicy().futureRouting || {});
  } catch (_) {
    // 새 기능은 실패 시 보수적으로 shadow/default로 돌아가며 기존 운영을 건드리지 않는다.
    return normalizeFutureRoutingPolicy({ enabled: true, mode: 'shadow' });
  }
}

// 유료 제작(숨고·크몽 제작물 작성과 교차검수) 모델 제공자.
// 'hold'이면 제작 lane을 실행하지 않는다(API 호출 0, 게시물은 대기로 남음).
// 허용값이 아닌 값이나 읽을 수 없는 정책도 hold로 처리한다(오류 대신 안전하게 멈춤).
// 'Claude'이면 CLAUDE_MODEL(기본 claude-fable-5-1)로 제작하고 OpenAI로 자동 전환하지 않는다.
// 'codex_room'(2026-09-23 준희 결정): API 제작 lane은 hold와 똑같이 막고(API 호출 0), PPT만
// server/codex-production.js가 Codex 대화방(astra-room 브리지)으로 넘긴다. 대기 알림 사유는 'codex_room'.
const PRODUCTION_PROVIDERS = Object.freeze(['OpenAI', 'Claude', 'hold', 'codex_room']);

function productionState() {
  let configured;
  try { configured = readOperatingPolicy().production?.provider; } catch (error) {
    return { provider: 'hold', hold: true, reason: 'policy_unreadable', configured: null };
  }
  const value = String(configured || 'OpenAI');
  if (value === 'hold') return { provider: 'hold', hold: true, reason: 'policy_hold', configured: value };
  if (value === 'codex_room') return { provider: 'hold', hold: true, reason: 'codex_room', configured: value };
  if (PRODUCTION_PROVIDERS.includes(value)) return { provider: value, hold: false, reason: null, configured: value };
  return { provider: 'hold', hold: true, reason: `invalid_provider:${value.slice(0, 40)}`, configured: value };
}

function productionProvider() {
  return productionState().provider;
}

// 고객 첨부·링크 문서를 Claude API로 판독할지(유료). 기본 꺼짐. 켜려면 정책 파일에
// attachmentRead.enabled: true. 정책을 못 읽으면 꺼진 것으로 본다.
function attachmentReadEnabled() {
  try { return readOperatingPolicy().attachmentRead?.enabled === true; } catch (_) { return false; }
}

// Jev 내부 시뮬레이션 한도(2026-09-22). 값은 정책 파일에만 둔다. 없거나 잘못되면 오류를 던져
// 시뮬레이션이 시작되지 않게 한다(한도 없이 돌지 않도록).
function jevSimulationLimits() {
  // 하루 한도는 금액(원)으로 정하고, 토큰 한도는 금액 ÷ 환율 ÷ 단가로 계산한다(출력 토큰은 무료).
  const raw = readOperatingPolicy().jevSimulation;
  const dailyBudgetKrw = Number(raw?.dailyBudgetKrw);
  const krwPerUsd = Number(raw?.krwPerUsd);
  const usdPerMillionInputTokens = Number(raw?.usdPerMillionInputTokens);
  const runMaxCalls = Number(raw?.runMaxCalls);
  const timezone = String(raw?.timezone || '');
  if (!(dailyBudgetKrw > 0)) throw new Error('invalid_jev_daily_budget_krw');
  if (!(krwPerUsd > 0)) throw new Error('invalid_jev_krw_per_usd');
  if (!(usdPerMillionInputTokens > 0)) throw new Error('invalid_jev_token_price');
  const dailyInputTokens = Math.floor(dailyBudgetKrw / krwPerUsd / usdPerMillionInputTokens * 1e6);
  if (!Number.isInteger(runMaxCalls) || runMaxCalls <= 0) throw new Error('invalid_jev_run_max_calls');
  if (timezone !== 'Asia/Seoul') throw new Error('invalid_jev_timezone');
  return { dailyBudgetKrw, krwPerUsd, usdPerMillionInputTokens, dailyInputTokens, runMaxCalls, timezone };
}

// Jev 납품 검수(2026-09-22): 정책 jevReview 블록을 그대로 돌려준다. 없으면 꺼짐.
function jevReviewPolicy() {
  const raw = readOperatingPolicy().jevReview;
  return raw && typeof raw === 'object' ? raw : { enabled: false };
}

// 자동 유료 API 차단(2026-09-22 준희 결정): spendControls.automaticPaidQuotesPaused가 true(기본)면
// 사람이 버튼으로 부르는 호출(trigger:'manual')을 뺀 모든 자동 유료 호출(Claude·OpenAI·Gemini·Jev 자동 검수)을 막는다.
// 정책을 못 읽거나 값이 없으면 막힌 것으로 본다.
function automaticPaidCallsPaused() {
  try { return readOperatingPolicy().spendControls?.automaticPaidQuotesPaused !== false; } catch (_) { return true; }
}

// 일반 작업 대기열(제작 lane 아닌 게시물)의 제공자 허용(2026-09-22). queueProviders.claude가 true일 때만 Claude로 보낸다.
// OpenAI·Gemini는 값이 false로 적혀 있지 않으면 허용.
function queueProviderAllowed(provider) {
  let raw;
  try { raw = readOperatingPolicy().queueProviders || {}; } catch (_) { return provider !== 'Claude'; }
  if (provider === 'Claude') return raw.claude === true;
  const key = String(provider || '').toLowerCase();
  return raw[key] !== false;
}

module.exports = { automaticPaidCallsPaused, queueProviderAllowed, jevReviewPolicy, jevSimulationLimits, POLICY_FILE, PRODUCTION_PROVIDERS, readOperatingPolicy, paidOrderBudget, astraLaneAllowed, finalGradeMode, futureRoutingPolicy, productionProvider, productionState, attachmentReadEnabled };
