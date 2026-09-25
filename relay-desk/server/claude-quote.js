'use strict';

// Claude(Fable 5.1) 견적 판단·자동 발송(2026-09-22 준희 지시).
// - 대상: 규칙(buildSoomgoQuote + D' 자동 규칙)이 사람 확인(human_review)으로 남긴 숨고 요청만. 규칙이 견적·삭제로 정한 건은 건드리지 않는다.
// - Claude는 서비스·분량(params)과 문구(text)만 낸다. 금액은 서버가 params로 기존 가격 계산(buildSoomgoQuote)을 돌려 정하고,
//   text 안의 금액이 그 값과 같아야 한다. 검사 6개를 모두 통과해야 autoSend. 하나라도 실패하면 사람 확인 유지. 재시도 없음.
// - 한도·비상 정지: 정책 파일 claudeQuote(enabled·하루 호출 수·하루 원화 예산). 키가 없거나 꺼져 있으면 기존 흐름 그대로.
const fs = require('node:fs');
const path = require('node:path');

const SKILL_FILE = path.join(__dirname, 'config', 'claude-quote-copy-skill.md');
const SERVICES_DIR = path.join(__dirname, '..', 'services');
const AUTO_RULES_FILE = path.join(SERVICES_DIR, '_common', 'soomgo-auto-rules.json');
const MESSAGE_ID = 'claude.quote.v1';
const LOG_LIMIT = 500;
const FORBIDDEN = [/최고/, /완벽/, /리뷰가\s*없어/];

function kstDay(ms = Date.now()) { return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); }

// 정책 파일 값 검사. 잘못되면 null(기능 꺼짐 = 기존 흐름).
function readConfig(policy) {
  const raw = policy?.claudeQuote;
  if (!raw || raw.enabled !== true) return null;
  const cfg = {
    dailyMaxCalls: Number(raw.dailyMaxCalls),
    dailyBudgetKrw: Number(raw.dailyBudgetKrw),
    krwPerUsd: Number(raw.krwPerUsd),
    usdPerMillionInputTokens: Number(raw.usdPerMillionInputTokens),
    usdPerMillionOutputTokens: Number(raw.usdPerMillionOutputTokens),
    maxOutputTokens: Number(raw.maxOutputTokens || 700),
    timeoutMs: Number(raw.timeoutMs || 45000)
  };
  const ok = Number.isInteger(cfg.dailyMaxCalls) && cfg.dailyMaxCalls > 0 && cfg.dailyBudgetKrw > 0 && cfg.krwPerUsd > 0
    && cfg.usdPerMillionInputTokens > 0 && cfg.usdPerMillionOutputTokens > 0 && cfg.maxOutputTokens > 0;
  return ok ? cfg : null;
}

function costKrw(cfg, inputTokens, outputTokens) {
  const usd = (Number(inputTokens || 0) * cfg.usdPerMillionInputTokens + Number(outputTokens || 0) * cfg.usdPerMillionOutputTokens) / 1e6;
  return Math.round(usd * cfg.krwPerUsd * 100) / 100;
}

function todayUsage(state, pending = { calls: 0, krw: 0 }, now = Date.now()) {
  const day = kstDay(now);
  const log = (Array.isArray(state?.claudeQuoteLog) ? state.claudeQuoteLog : []).filter(item => item.day === day && item.called);
  return { calls: log.length + pending.calls, krw: log.reduce((sum, item) => sum + Number(item.krw || 0), 0) + pending.krw };
}

// 규칙 결과가 사람 확인인지: 삭제·자동 견적·제공 불가(자소서·도장 등)는 제외.
function eligible(quote = {}) {
  return quote.deleteRequest !== true && quote.autoSend !== true && !quote.unsupportedService;
}

function soldServiceIds(listServices) {
  let blocked = [];
  try {
    const rules = JSON.parse(fs.readFileSync(AUTO_RULES_FILE, 'utf8'));
    blocked = (rules.deleteRules || []).filter(rule => rule.when === 'serviceId').flatMap(rule => rule.serviceIds || []);
  } catch (_) {}
  return listServices({ channel: 'soomgo' }).map(service => service.id).filter(id => !blocked.includes(id));
}

// 프롬프트에 넣을 서비스 정의: 가격·범위·수정 횟수·납기만.
function serviceBrief(id) {
  try {
    const def = JSON.parse(fs.readFileSync(path.join(SERVICES_DIR, `${id}.json`), 'utf8'));
    const pick = ({ id: sid, label, pricing, includedRevisions, scope, scopeTranslated, scopeRules, leadDaysRules, schoolAssignmentRevisions }) =>
      ({ id: sid, label, pricing, includedRevisions, scope, scopeTranslated, scopeRules, leadDaysRules, schoolAssignmentRevisions });
    return JSON.parse(JSON.stringify(pick(def)));
  } catch (_) { return null; }
}

function redactRequest(text, request = {}) {
  let value = String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[이메일]')
    .replace(/(?:01[016789]|070|02|0[3-6][1-5])[-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[전화번호]')
    .replace(/\b(?:sk|pk|ghp|AIza|Bearer)[-_A-Za-z0-9.]{8,}\b/gi, '[인증정보]')
    .replace(/https?:\/\/\S+/g, '[링크]')
    // 숨고 요청 상세의 고객 이름 줄('신고하기' 다음 줄)
    .replace(/(신고하기\s*\n+)[^\n]{1,30}\n/g, '$1[고객]\n');
  for (const name of [request.customerName, request.company, request.role].map(v => String(v || '').trim()).filter(v => v.length >= 2)) value = value.split(name).join('[비공개]');
  return value.slice(0, 4000);
}

const PARAM_GUIDE = {
  subtitle: '{ "minutes": 영상 분(정수), "translated": 외국어 영상이면 true, "burnIn": 영상에 자막을 입혀야 하면 true }',
  document_writing: '{ "workType": "writing"(새로 작성)|"formatting"(양식·편집 정리)|"proofreading"(교정·교열·윤문)|"stenography"(녹음 타이핑), "pages": A4 쪽수(정수, 타이핑이면 생략), "minutes": 녹음 분(타이핑일 때만), "english": 영문 교정이면 true }',
  presentation: '{ "slides": 완성 장수(정수) }'
};

function buildPrompt({ skillText, requestText, services }) {
  return [
    '너는 숨고에서 디지털 제작 서비스를 파는 Swan의 견적 담당이다. 아래 [견적 문구 규칙]을 지켜 숨고 요청에 보낼 견적을 판단한다.',
    '',
    '[견적 문구 규칙]',
    skillText,
    '',
    '[판매 서비스 정의 — 가격표·범위·수정 횟수·납기는 여기 값만 쓴다]',
    JSON.stringify(services),
    '',
    '[이 작업의 추가 규칙 — 위 규칙과 다르면 이쪽을 따른다]',
    '- 출력은 JSON 객체 하나만. 설명·코드블록 없이.',
    '- 형식: {"serviceId": "subtitle|document_writing|presentation", "params": {...}, "action": "quote" 또는 "hold", "text": "고객에게 보낼 견적 문구", "memo": "담당자 메모", "reason": "hold 사유(quote면 빈 문자열)"}',
    `- params 형식: subtitle ${PARAM_GUIDE.subtitle} / document_writing ${PARAM_GUIDE.document_writing} / presentation ${PARAM_GUIDE.presentation}`,
    '- 금액은 네가 정하지 않는다. 서버가 params로 가격표를 계산한다. text에는 가격표로 계산한 금액을 "N원" 형식으로 딱 한 번만 쓴다. 서버 계산과 다르면 발송되지 않는다.',
    '- 수정 횟수는 서비스 정의의 includedRevisions 값을 쓴다(규칙 예시의 "수정 1회"가 아니다). 납기는 서비스 정의 leadDaysRules 값을 쓴다.',
    '- text: 250~450자, 물음표는 정확히 1개(확인 질문 하나), 느낌표는 1개 이하, 이모지 금지, "최고"·"완벽"·"리뷰가 없어" 금지.',
    '- 분량을 요청서에서 알 수 없거나, 판매하지 않는 작업이거나, 해석이 확실하지 않으면 action을 "hold"로 하고 reason에 이유를 쓴다. 억지로 견적을 내지 않는다.',
    '',
    '[숨고 요청서]',
    requestText
  ].join('\n');
}

function parseOutput(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch (_) { return null; }
}

// params → 기존 가격 계산 입력(요청서 필드). 같은 가격 엔진·D' 규칙을 그대로 탄다.
function bodyFromParams(serviceId, params = {}) {
  const int = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : null);
  if (serviceId === 'subtitle') {
    const minutes = int(params.minutes);
    if (!minutes) return null;
    const topic = `${params.translated === true ? '외국어 영상 한국어 번역 자막' : '한국어 영상 자막'}${params.burnIn === true ? ', 영상에 자막 삽입' : ''}`;
    return { purpose: '자막 제작', volume: `${minutes}분`, topic, expectType: null };
  }
  if (serviceId === 'presentation') {
    const slides = int(params.slides);
    return slides ? { purpose: 'PPT 제작', volume: `${slides}장`, topic: '보고서를 PPT로', expectType: null } : null;
  }
  if (serviceId === 'document_writing') {
    const type = String(params.workType || '');
    if (type === 'stenography') { const m = int(params.minutes); return m ? { purpose: '속기', volume: `${m}분`, topic: '녹취 타이핑', expectType: 'stenography' } : null; }
    const pages = int(params.pages);
    if (!pages) return null;
    if (type === 'writing') return { purpose: '문서/글 작성', volume: `A4 ${pages}쪽`, topic: '문서 작성', expectType: 'writing' };
    if (type === 'formatting') return { purpose: '문서/글 작성', volume: `A4 ${pages}쪽`, topic: '양식 편집 정리', expectType: 'formatting' };
    if (type === 'proofreading') return { purpose: '교정/교열', volume: `A4 ${pages}쪽`, topic: params.english === true ? '영문 교정교열' : '교정교열', expectType: 'proofreading' };
  }
  return null;
}

function priceFromParams(serviceId, params, deps, requestId) {
  const input = bodyFromParams(serviceId, params);
  if (!input) return { error: 'params_invalid' };
  const body = { requestId: `CLAUDEQ-${requestId}`, purpose: input.purpose, volume: input.volume, topic: input.topic, text: [input.purpose, input.volume, input.topic].join('\n') };
  const { parsed, quote } = deps.buildSoomgoQuote(body);
  // D' 규칙(영문 교정 단가·대량 문서·삭제)까지 적용. 기록이 남지 않게 빈 상태를 쓴다.
  deps.applyAutoRules({ body, request: parsed, quote, requestedServiceId: null, existingLead: null, state: {}, requestId: body.requestId, now: Date.now(), supportedServiceIds: deps.supportedServiceIds() });
  if (quote.serviceId !== serviceId) return { error: `price_service_mismatch:${quote.serviceId || 'none'}` };
  if (input.expectType && quote.pricing?.type && quote.pricing.type !== input.expectType) return { error: `price_worktype_mismatch:${quote.pricing.type}` };
  if (quote.deleteRequest || quote.autoSend !== true || !(Number(quote.amount) > 0)) return { error: 'price_not_quotable' };
  return { amount: Number(quote.amount), days: quote.days, quote };
}

function runChecks(out, priced, soldIds) {
  const text = String(out?.text || '');
  const failures = [];
  const amounts = [...text.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/g)].map(m => Number(m[1].replace(/,/g, '')));
  const checks = {
    amount: amounts.length === 1 && Boolean(priced?.amount) && amounts[0] === priced.amount,
    question: (text.match(/[?？]/g) || []).length === 1,
    length: [...text].length >= 250 && [...text].length <= 450,
    forbidden: !FORBIDDEN.some(re => re.test(text)) && (text.match(/[!！]/g) || []).length < 2 && !/\p{Extended_Pictographic}/u.test(text),
    soldService: soldIds.includes(String(out?.serviceId || '')),
    action: out?.action === 'quote'
  };
  if (!checks.amount) failures.push(priced?.error ? `amount:${priced.error}` : `amount:${amounts.length}개(${amounts.join('/')}) ≠ ${priced?.amount || '계산 불가'}`);
  if (!checks.question) failures.push(`question:${(text.match(/[?？]/g) || []).length}개`);
  if (!checks.length) failures.push(`length:${[...text].length}자`);
  if (!checks.forbidden) failures.push('forbidden');
  if (!checks.soldService) failures.push(`service:${out?.serviceId || 'none'}`);
  if (!checks.action) failures.push(`action:${out?.action || 'none'}${out?.reason ? `(${String(out.reason).slice(0, 80)})` : ''}`);
  return { checks, failures, passed: failures.length === 0 };
}

const pending = { calls: 0, krw: 0 };

// deps: { runClaude(prompt, opts), hasKey(), buildSoomgoQuote, applyAutoRules, listServices, supportedServiceIds(), readPolicy(), model }
async function attempt({ requestId, request, quote, snapshot, deps, now = Date.now() }) {
  let cfg = null;
  try { cfg = readConfig(deps.readPolicy()); } catch (_) { cfg = null; }
  if (!cfg || !deps.hasKey()) return null;
  if (!eligible(quote)) return null;
  const base = { at: new Date(now).toISOString(), day: kstDay(now), requestId, messageId: MESSAGE_ID, model: deps.model, called: false };
  const usage = todayUsage(snapshot, pending, now);
  const skillText = fs.readFileSync(SKILL_FILE, 'utf8');
  const soldIds = soldServiceIds(deps.listServices);
  const prompt = buildPrompt({ skillText, requestText: redactRequest(request.text, request), services: soldIds.map(serviceBrief).filter(Boolean) });
  // 호출 전 예약: 입력은 글자 수만큼 토큰으로 넉넉히, 출력은 상한 전부.
  const reserveKrw = costKrw(cfg, [...prompt].length, cfg.maxOutputTokens);
  if (usage.calls >= cfg.dailyMaxCalls) return { log: { ...base, skipped: 'daily_max_calls' } };
  if (usage.krw + reserveKrw > cfg.dailyBudgetKrw) return { log: { ...base, skipped: 'daily_budget_krw', reserveKrw } };
  pending.calls += 1; pending.krw += reserveKrw;
  let result;
  try {
    result = await deps.runClaude(prompt, { maxTokens: cfg.maxOutputTokens, timeoutMs: cfg.timeoutMs });
  } catch (error) {
    return { log: { ...base, called: true, krw: reserveKrw, error: String(error?.message || error).slice(0, 200), passed: false, failures: ['call_failed'] } };
  } finally { pending.calls -= 1; pending.krw -= reserveKrw; }
  const inputTokens = Number(result?.usage?.input_tokens || 0);
  const outputTokens = Number(result?.usage?.output_tokens || 0);
  const krw = inputTokens || outputTokens ? costKrw(cfg, inputTokens, outputTokens) : reserveKrw;
  const out = parseOutput(result?.text);
  const logBase = { ...base, called: true, model: result?.model || deps.model, inputTokens, outputTokens, krw };
  if (!out) return { log: { ...logBase, passed: false, failures: ['json_parse'] } };
  const priced = out.action === 'quote' && soldIds.includes(String(out.serviceId)) ? priceFromParams(String(out.serviceId), out.params || {}, deps, requestId) : { error: 'not_priced' };
  const verdict = runChecks(out, priced, soldIds);
  const log = { ...logBase, serviceId: out.serviceId || null, params: out.params || null, action: out.action || null, amount: priced.amount || null,
    checks: verdict.checks, passed: verdict.passed, failures: verdict.failures, memo: String(out.memo || '').slice(0, 500), reason: String(out.reason || '').slice(0, 300), textLength: [...String(out.text || '')].length, sendResult: null };
  if (!verdict.passed) return { log };
  const patch = {
    serviceId: out.serviceId, amount: priced.amount, regularAmount: priced.quote.regularAmount ?? priced.amount, originalAmount: priced.quote.originalAmount ?? priced.amount,
    days: priced.days, label: priced.quote.label, basicScope: priced.quote.basicScope, pricing: priced.quote.pricing || null,
    message: String(out.text).trim(), quoteMessageId: MESSAGE_ID, quoteMessageVersion: 'v1',
    autoSend: true, manualReview: false, reason: null,
    claudeQuote: { messageId: MESSAGE_ID, model: logBase.model, params: out.params, memo: log.memo, krw, at: base.at, previousReason: quote.reason || null }
  };
  return { log, patch };
}

function appendLog(state, entry) {
  if (!entry) return;
  state.claudeQuoteLog = [entry, ...(Array.isArray(state.claudeQuoteLog) ? state.claudeQuoteLog : [])].slice(0, LOG_LIMIT);
}

function recordSendResult(state, requestId, status, at) {
  const entry = (Array.isArray(state?.claudeQuoteLog) ? state.claudeQuoteLog : []).find(item => item.requestId === requestId && item.passed);
  if (!entry) return false;
  entry.sendResult = { status, at };
  return true;
}

// 알림방 하루 요약: 건수·비용·탈락 사유.
function dailySummary(state, day = kstDay()) {
  const log = (Array.isArray(state?.claudeQuoteLog) ? state.claudeQuoteLog : []).filter(item => item.day === day);
  const called = log.filter(item => item.called);
  const reasons = {};
  for (const item of called.filter(item => !item.passed)) for (const f of item.failures || []) { const k = String(f).split(':')[0]; reasons[k] = (reasons[k] || 0) + 1; }
  return {
    day, calls: called.length, passed: called.filter(item => item.passed).length, failed: called.filter(item => !item.passed).length,
    sent: log.filter(item => item.sendResult?.status === 'sent').length, skippedByLimit: log.filter(item => item.skipped).length,
    krw: Math.round(called.reduce((sum, item) => sum + Number(item.krw || 0), 0)), failureReasons: reasons
  };
}

module.exports = { MESSAGE_ID, SKILL_FILE, readConfig, costKrw, todayUsage, eligible, soldServiceIds, serviceBrief, redactRequest, buildPrompt, parseOutput, bodyFromParams, priceFromParams, runChecks, attempt, appendLog, recordSendResult, dailySummary, kstDay };
