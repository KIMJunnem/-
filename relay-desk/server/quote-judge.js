'use strict';

// 견적 판단(감독 스타일) — 2026-09-24 개발방 지시 19, decisions 7-10. 프롬프트 원문: docs/quote-judge-prompt.md(감독 작성, 그대로 씀).
// - 대상: 숨고 새 요청 중 규칙이 자동 견적·삭제로 정하지 못하고 사람 확인으로 남긴 것(영상 편집 알림·범위 확인·멈춘 건).
//   문서·교정·PPT 숨고 자동 견적 멈춤(7-13) 건은 판단하지 않는다(팔지 않음).
// - Claude에는 요청 칸(이름·연락처 빼고) + docs/astra-brief.md + decisions 7-4 + 프롬프트만. 고객 이름·전화·이메일·링크는 보내기 전에 지운다.
// - 결과: "보내기 추천" → 금액이 서버 계산값과 같고 하루 자동 발송 10건 안이면 자동 발송 / "보류" → 준희 알림 / "보내지 않음" → 삭제 판정(요청봇은 지금 실제 삭제를 하지 않고 "삭제 승인 대기"로 남긴다).
// - 스위치: 정책 quoteJudge.enabled(기본 false, quote-judge-on/off.bat). 하루 호출 40회(채팅봇과 따로), 월 금액은 채팅봇과 합쳐 customerRoomFallback.monthlyBudgetKrw 안.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PROMPT_FILE = path.join(ROOT, 'docs', 'quote-judge-prompt.md');
const BRIEF_FILE = path.join(ROOT, 'docs', 'astra-brief.md');
const DECISIONS_FILE = path.join(ROOT, 'docs', 'decisions.md');
const MESSAGE_ID = 'claude.quote_judge.v1';
const LOG_LIMIT = 1300;
const DECISIONS = ['보내기 추천', '보류', '보내지 않음'];

function kstDay(ms = Date.now()) { return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); }

function readConfig(policy) {
  const raw = policy?.quoteJudge;
  if (!raw || raw.enabled !== true) return null;
  const fb = policy?.customerRoomFallback || {};
  const cfg = {
    model: String(raw.model || 'claude-opus-5-5'),
    dailyMaxCalls: Number(raw.dailyMaxCalls ?? 40),
    dailyMaxAutoSends: Number(raw.dailyMaxAutoSends ?? 10),
    monthlyBudgetKrw: Number(fb.monthlyBudgetKrw ?? 15000),
    krwPerUsd: Number(raw.krwPerUsd ?? fb.krwPerUsd),
    usdPerMillionInputTokens: Number(raw.usdPerMillionInputTokens ?? fb.usdPerMillionInputTokens),
    usdPerMillionOutputTokens: Number(raw.usdPerMillionOutputTokens ?? fb.usdPerMillionOutputTokens),
    maxOutputTokens: Number(raw.maxOutputTokens || 700),
    timeoutMs: Number(raw.timeoutMs || 45000)
  };
  const ok = Number.isInteger(cfg.dailyMaxCalls) && cfg.dailyMaxCalls >= 0 && Number.isInteger(cfg.dailyMaxAutoSends) && cfg.dailyMaxAutoSends >= 0
    && cfg.monthlyBudgetKrw >= 0 && cfg.krwPerUsd > 0 && cfg.usdPerMillionInputTokens > 0 && cfg.usdPerMillionOutputTokens > 0;
  return ok ? cfg : null;
}

function costKrw(cfg, inputTokens, outputTokens) {
  const usd = (Number(inputTokens || 0) * cfg.usdPerMillionInputTokens + Number(outputTokens || 0) * cfg.usdPerMillionOutputTokens) / 1e6;
  return Math.round(usd * cfg.krwPerUsd * 100) / 100;
}

function usage(state, now = Date.now()) {
  const day = kstDay(now); const month = day.slice(0, 7);
  const judge = (Array.isArray(state?.quoteJudgeLog) ? state.quoteJudgeLog : []).filter(item => item.called);
  const chat = (Array.isArray(state?.customerRoomFallbackLog) ? state.customerRoomFallbackLog : []).filter(item => item.called);
  const sum = list => list.reduce((acc, item) => acc + Number(item.krw || 0), 0);
  return {
    todayCalls: judge.filter(item => item.day === day).length,
    todayAutoSends: judge.filter(item => item.day === day && item.autoSend).length,
    monthKrw: sum(judge.filter(item => String(item.day || '').slice(0, 7) === month)) + sum(chat.filter(item => String(item.day || '').slice(0, 7) === month))
  };
}

// 규칙이 사람 확인으로 남긴 요청만(자동 견적·삭제·멈춤(7-13)·제공 불가 사유는 제외, 영상 편집 알림은 포함)
function eligible(quote = {}) {
  if (quote.autoSend === true || quote.deleteRequest === true) return false;
  if (['doc_soomgo_paused', 'ppt_soomgo_paused'].includes(String(quote.autoRule?.ruleId || ''))) return false;
  if (quote.unsupportedService && quote.unsupportedService !== 'unsold_category_review') return false;
  return quote.manualReview === true;
}

// 요청 칸(이름·연락처 제외). 숨고 상세 화면 아래쪽(다른 견적·카드)은 자른다.
function requestFields(request = {}) {
  let text = String(request.text || '').replace(/\r/g, '').split(/최근\s*작성한\s*견적|견적\s*보낸\s*고수\s*목록/)[0];
  for (const name of [request.customerName, request.company, request.role].map(v => String(v || '').trim()).filter(v => v.length >= 2)) text = text.split(name).join('[비공개]');
  text = text.split('\n').filter(line => !/고객\s*정보|신고하기|프로필|연락처/.test(line)).join('\n');
  return redact(text).replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}
function redact(text) {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[이메일]')
    .replace(/(?:01[016789]|070|02|0[3-6][1-5])[-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[전화번호]')
    .replace(/\b(?:sk|pk|ghp|AIza|Bearer)[-_A-Za-z0-9.]{8,}\b/gi, '[인증정보]')
    .replace(/https?:\/\/\S+/g, '[링크]');
}

function readText(file) { try { return fs.readFileSync(file, 'utf8').replace(/\r/g, ''); } catch (_) { return ''; } }
function promptBody() {
  const doc = readText(PROMPT_FILE);
  const at = doc.indexOf('## 프롬프트 본문');
  return (at >= 0 ? doc.slice(at + '## 프롬프트 본문'.length) : doc).trim();
}
function decisions74() {
  const doc = readText(DECISIONS_FILE);
  return (doc.match(/## 7-4\.[\s\S]*?(?=\n## )/) || [''])[0].trim();
}

function buildPrompt(request = {}, quote = {}) {
  const server = quote.videoEdit?.amount ? `서버 계산 영상 편집 금액: ${Number(quote.videoEdit.amount).toLocaleString('ko-KR')}원 · 기간 ${quote.videoEdit.days || '미정'}` : '서버 계산 금액: 없음(길이 모름 등)';
  return [
    promptBody(),
    '',
    '[숨고 요청 칸 — 이름·연락처는 뺐다]',
    requestFields(request),
    '',
    '[서버 계산]',
    server,
    '',
    '[docs/astra-brief.md — 금액·기간·수정 횟수 기준]',
    readText(BRIEF_FILE).slice(0, 12000),
    '',
    '[decisions.md 7-4 — 영상 편집 판매]',
    decisions74()
  ].join('\n');
}

function parseOutput(text) {
  const raw = String(text || '').replace(/\r/g, '').trim();
  const decision = raw.match(/판단\s*:\s*(보내기 추천|보류|보내지 않음)\s*(?:[—–-]\s*([^\n]*))?/);
  const amount = raw.match(/견적\s*금액\s*:\s*([\d,]+)\s*원/);
  const message = raw.match(/견적\s*설명\s*:\s*\n?([\s\S]+)$/);
  if (!decision) return null;
  return { decision: decision[1], reason: String(decision[2] || '').trim().slice(0, 300), amount: amount ? Number(amount[1].replace(/,/g, '')) : null, message: message ? message[1].trim().slice(0, 1200) : '' };
}

// 보내기 추천 → 자동 발송해도 되는지 검사. 반환: 실패 이유 코드('' = 통과)
function sendCheck(parsed, quote = {}) {
  const serverAmount = Number(quote.videoEdit?.amount || quote.amount || 0);
  if (!(serverAmount > 0)) return 'no_server_amount';
  if (parsed.amount !== serverAmount) return 'amount_mismatch';
  const won = `${serverAmount.toLocaleString('ko-KR')}원`;
  const flat = parsed.message.replace(/\s+/g, '');
  if (!parsed.message || !flat.includes(won.replace(/\s+/g, ''))) return 'message_amount_missing';
  const amounts = (parsed.message.replace(/,/g, '').match(/\d+\s*원/g) || []).map(a => a.replace(/\s/g, ''));
  if (amounts.some(a => a !== `${serverAmount}원`)) return 'message_other_amount';
  if (/할인|정상가|최고|완벽|보장/.test(parsed.message)) return 'forbidden_words';
  if (parsed.message.length > 600) return 'message_too_long';
  return '';
}

// deps: { runClaude(prompt, options) → { text, usage, model }, hasKey(), readPolicy(), readState() }
async function attempt({ requestId, request, quote, deps, now = Date.now() }) {
  const cfg = readConfig(deps.readPolicy());
  if (!cfg) return null;
  const log = { at: new Date(now).toISOString(), day: kstDay(now), requestId, messageId: MESSAGE_ID, called: false };
  if (!eligible(quote)) return null;
  if (!deps.hasKey()) return { log: { ...log, error: 'claude_key_missing' } };
  const used = usage(deps.readState(), now);
  if (used.todayCalls >= cfg.dailyMaxCalls) return { log: { ...log, error: 'daily_call_cap' }, capped: 'daily_call_cap' };
  if (used.monthKrw >= cfg.monthlyBudgetKrw) return { log: { ...log, error: 'monthly_budget_cap' }, capped: 'monthly_budget_cap' };
  const prompt = buildPrompt(request, quote);
  log.called = true;
  let result;
  try {
    result = await deps.runClaude(prompt, { model: cfg.model, maxTokens: cfg.maxOutputTokens, timeoutMs: cfg.timeoutMs });
  } catch (error) {
    return { log: { ...log, error: String(error?.message || error).slice(0, 160) } };
  }
  log.model = result.model || cfg.model;
  log.inputTokens = Number(result.usage?.input_tokens || 0);
  log.outputTokens = Number(result.usage?.output_tokens || 0);
  log.krw = costKrw(cfg, log.inputTokens, log.outputTokens);
  const parsed = parseOutput(result.text);
  if (!parsed) return { log: { ...log, error: 'output_unparsed' } };
  log.decision = parsed.decision; log.amount = parsed.amount;
  const judge = { ...parsed, judgedAt: log.at, model: log.model };
  if (parsed.decision === '보내기 추천') {
    const problem = sendCheck(parsed, quote);
    const overCap = used.todayAutoSends >= cfg.dailyMaxAutoSends;
    if (!problem && !overCap) { log.autoSend = true; return { log, judge, action: 'send' }; }
    return { log: { ...log, sendBlocked: problem || 'daily_auto_send_cap' }, judge: { ...judge, sendBlocked: problem || 'daily_auto_send_cap' }, action: 'hold' };
  }
  if (parsed.decision === '보내지 않음') return { log, judge, action: 'delete' };
  return { log, judge, action: 'hold' };
}

function appendLog(state, log) {
  if (!log) return;
  state.quoteJudgeLog = [log, ...(Array.isArray(state.quoteJudgeLog) ? state.quoteJudgeLog : [])].slice(0, LOG_LIMIT);
}

// 판단 결과를 규칙 결과(quote)에 붙인다. 알림 첫 줄: "견적 판단 · 분야 · 금액 · 판단"
function applyResult(quote, outcome, request = {}) {
  if (!outcome?.judge) return false;
  const j = outcome.judge;
  const field = String(request.soomgoCategory || quote.label || quote.serviceId || '분야 모름');
  const won = j.amount ? `${Number(j.amount).toLocaleString('ko-KR')}원` : '금액 없음';
  const head = `견적 판단 · ${field} · ${won} · ${j.decision}`;
  quote.quoteJudge = { ...j, head };
  if (outcome.action === 'send') {
    Object.assign(quote, {
      serviceId: quote.serviceId || (quote.videoEdit ? 'video_edit' : quote.serviceId),
      amount: j.amount, regularAmount: j.amount, originalAmount: j.amount, message: j.message,
      quoteMessageId: MESSAGE_ID, quoteMessageVersion: 'v1', messageId: MESSAGE_ID, messageVersion: 'v1',
      autoSend: true, manualReview: false, reason: null, unsupportedService: null,
      autoRule: { ruleId: 'quote_judge_send', action: 'quote', previous: quote.autoRule || null }
    });
    if (quote.videoEdit) quote.videoEdit.manualSendOnly = false;
    return true;
  }
  if (outcome.action === 'delete') {
    Object.assign(quote, { autoSend: false, manualReview: false, deleteRequest: true, reason: `${head} — ${j.reason}`.slice(0, 300), autoRule: { ruleId: 'quote_judge_delete', action: 'delete', previous: quote.autoRule || null } });
    return true;
  }
  Object.assign(quote, { autoSend: false, manualReview: true, reason: `${head} — ${j.reason}${j.sendBlocked ? ` (자동 발송 안 함: ${j.sendBlocked})` : ''}\n견적 설명 초안: ${j.message}`.slice(0, 900) });
  return true;
}

// 하루 요약(알림방 1줄): 판단 보내지 않음(삭제 판정) 분야별 건수
function dailySummary(state, day = kstDay()) {
  const log = (Array.isArray(state?.quoteJudgeLog) ? state.quoteJudgeLog : []).filter(item => item.day === day && item.called);
  const deletes = {};
  for (const lead of Array.isArray(state?.soomgoLeads) ? state.soomgoLeads : []) {
    if (lead?.quote?.autoRule?.ruleId !== 'quote_judge_delete' || kstDay(Date.parse(lead.createdAt) || 0) !== day) continue;
    const field = String(lead.request?.soomgoCategory || lead.quote?.serviceId || '분야 모름');
    deletes[field] = (deletes[field] || 0) + 1;
  }
  const total = Object.values(deletes).reduce((a, b) => a + b, 0);
  return { day, calls: log.length, autoSends: log.filter(item => item.autoSend).length, krw: Math.round(log.reduce((s, i) => s + Number(i.krw || 0), 0)), deletes, line: total ? `견적 판단 삭제 ${total}건(${Object.entries(deletes).map(([k, v]) => `${k} ${v}`).join(', ')})` : '' };
}

module.exports = { MESSAGE_ID, DECISIONS, kstDay, readConfig, costKrw, usage, eligible, requestFields, redact, buildPrompt, parseOutput, sendCheck, attempt, appendLog, applyResult, dailySummary };
