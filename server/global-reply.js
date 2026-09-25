'use strict';

// 해외 채널(파이버) 영어 답장 초안(2026-09-22, G-1 3단계). 준희 승인: Claude API(기존 키), 모델 claude-haiku-4-5(정책 globalReply.model), 하루 상한 정책값.
// - 로컬 화면(dist/global-reply.html)에서 준희가 고객 메시지를 붙여넣고 버튼을 눌렀을 때만 1회 호출한다. 자동 호출 없음.
// - 보내기 기능 없음. 결과는 화면에 보여 주고 복사만 한다. 파이버 페이지를 읽거나 누르지 않는다.
// - 금액은 모델이 쓰지 않는다. 모델은 {{PRICE_LINE}} 자리만 남기고, 서버가 services/subtitle.json channels.fiverr로 계산해 채운다.

const MESSAGE_ID = 'fiverr.reply.v1';
const LOG_LIMIT = 300;

function kstDay(ms = Date.now()) { return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); }

function readConfig(policy) {
  const raw = policy?.globalReply;
  if (!raw || raw.enabled !== true) return null;
  const cfg = {
    dailyMaxCalls: Number(raw.dailyMaxCalls),
    dailyBudgetKrw: Number(raw.dailyBudgetKrw),
    krwPerUsd: Number(raw.krwPerUsd),
    usdPerMillionInputTokens: Number(raw.usdPerMillionInputTokens),
    usdPerMillionOutputTokens: Number(raw.usdPerMillionOutputTokens),
    model: String(raw.model || 'claude-haiku-4-5'),
    maxOutputTokens: Number(raw.maxOutputTokens || 900),
    timeoutMs: Number(raw.timeoutMs || 45000)
  };
  const ok = Number.isInteger(cfg.dailyMaxCalls) && cfg.dailyMaxCalls > 0 && cfg.dailyBudgetKrw > 0 && cfg.krwPerUsd > 0 && cfg.usdPerMillionInputTokens > 0 && cfg.usdPerMillionOutputTokens > 0;
  return ok ? cfg : null;
}

const costKrw = (cfg, input, output) => Math.round(((Number(input || 0) * cfg.usdPerMillionInputTokens + Number(output || 0) * cfg.usdPerMillionOutputTokens) / 1e6) * cfg.krwPerUsd * 100) / 100;

function todayUsage(state, now = Date.now()) {
  const day = kstDay(now);
  const log = (Array.isArray(state?.globalReplyLog) ? state.globalReplyLog : []).filter(item => item.day === day && item.called);
  return { day, calls: log.length, krw: Math.round(log.reduce((sum, item) => sum + Number(item.krw || 0), 0) * 100) / 100 };
}

function redact(text) {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[phone]')
    .replace(/https?:\/\/\S+/g, '[link]')
    .slice(0, 4000);
}

// 금액: 파이버 채널 패키지(분 이하)에서 고르고, 자막 삽입은 5분 단위로 더한다. 30분 초과는 맞춤 견적.
function priceFor(fiverr, { minutes, burnIn } = {}) {
  if (!fiverr) return { ok: false, reason: 'channel_missing' };
  const m = Number(minutes);
  if (!(m > 0)) return { ok: false, reason: 'minutes_unknown' };
  const pkg = (fiverr.packages || []).find(p => m <= Number(p.when?.minutesLte));
  if (!pkg) return { ok: false, reason: 'custom_offer', minutes: m };
  let usd = Number(pkg.amountUsd);
  const option = (fiverr.options || []).find(o => o.id === 'burn_in');
  let burnInUsd = 0;
  // 2026-09-23: 파이버에 자막 입히기 옵션이 없으면(offeredOnFiverr:false) 삽입 요청은 맞춤 견적
  if (burnIn === true && option && option.offeredOnFiverr === false) return { ok: false, reason: 'custom_offer', burnIn: true, minutes: m };
  if (burnIn === true && option) {
    if (option.amountUsd == null) return { ok: false, reason: 'burn_in_price_missing' };
    const size = Number(option.unit?.sizeMinutes || 5);
    burnInUsd = Math.ceil(m / size) * Number(option.amountUsd);
    usd += burnInUsd;
  }
  return { ok: true, usd, packageMinutes: Number(pkg.when.minutesLte), burnInUsd, deliveryDays: Number(pkg.deliveryDays) || null, revisions: Number(fiverr.includedRevisions) || null, pendingApproval: fiverr.pendingApproval === true || option?.pendingApproval === true && burnIn === true };
}

function priceLines(price) {
  const tag = price.pendingApproval ? '[가격 승인 전] ' : '';
  if (!price.ok) {
    if (price.reason === 'custom_offer') return { en: '[맞춤 견적 — 준희가 금액을 정해 Custom offer로 보냄]', ko: '[맞춤 견적 — 준희가 금액을 정해 Custom offer로 보냄]' };
    if (price.reason === 'minutes_unknown') return { en: '', ko: '' };
    return { en: '[금액 계산 불가 — 준희 확인]', ko: '[금액 계산 불가 — 준희 확인]' };
  }
  const days = price.deliveryDays ? ` · Delivery within ${price.deliveryDays} day${price.deliveryDays > 1 ? 's' : ''} after I receive the video` : '';
  const daysKo = price.deliveryDays ? ` · 영상 받은 뒤 ${price.deliveryDays}일 안에 납품` : '';
  const rev = price.revisions ? ` · ${price.revisions} revisions included` : '';
  const revKo = price.revisions ? ` · 수정 ${price.revisions}회 포함` : '';
  return { en: `${tag}Price: $${price.usd}${days}${rev}`, ko: `${tag}금액 $${price.usd}${daysKo}${revKo}` };
}

function buildPrompt({ message, hints = {}, fiverr }) {
  const scope = (fiverr?.scope || []).join(' / ');
  const burnOffered = !(fiverr?.options || []).some(o => o.id === 'burn_in' && o.offeredOnFiverr === false);
  return [
    'You are drafting a first reply for a Korean subtitle seller on Fiverr. The seller (a native Korean speaker) will read, edit and send it herself.',
    'Service: Korean subtitles (SRT). Scope: ' + scope + (burnOffered ? '. Optional: subtitles burned into the video (MP4).' : '. Burned-in MP4 is not a standard option; if the buyer asks for it, say the seller will send a custom offer.') + ' AI tools are used for the first transcript and draft translation; a native Korean speaker reviews it and checks the timing against the audio from start to finish. Never claim it is 100% human-made, never invent experience, numbers of past clients, or credentials. No words like "best" or "perfect". Do not ask the buyer to contact outside Fiverr and do not share contact details.',
    'Reply structure (short, 4-6 lines, plain and polite, not overly smooth):',
    '1) Restate the request in the buyer\'s own words (video length, language, purpose if given).',
    '2) Write exactly the placeholder {{PRICE_LINE}} on its own line. Do NOT write any price, currency amount or delivery time yourself.',
    '3) One short line about the full sync check (timing checked across the whole video, not spot-checked).',
    '4) Exactly one question: the single most important missing detail (priority: ' + (burnOffered ? 'video length, then burned-in MP4 or SRT only, then script availability' : 'video length, then script availability') + '). If the request is outside scope (e.g. subtitles in a language other than Korean, document translation only), say politely that it is not offered and ask no question.',
    'Return ONLY JSON: {"messageKo": Korean translation of the buyer message, "replyEn": the English reply, "replyKo": Korean translation of replyEn (keep {{PRICE_LINE}} as is), "detected": {"minutes": number or null, "sourceLanguage": string or null, "burnIn": true/false/null, "inScope": true/false}}',
    hints.minutes ? `Seller note: video length is ${hints.minutes} minutes.` : '',
    hints.sourceLanguage ? `Seller note: spoken language is ${hints.sourceLanguage}.` : '',
    typeof hints.burnIn === 'boolean' ? `Seller note: burned-in MP4 ${hints.burnIn ? 'requested' : 'not requested'}.` : '',
    'Buyer message:',
    '"""', redact(message), '"""'
  ].filter(Boolean).join('\n');
}

function parseOutput(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const out = JSON.parse(raw.slice(start, end + 1));
    if (typeof out.replyEn !== 'string' || typeof out.replyKo !== 'string' || typeof out.messageKo !== 'string') return null;
    return out;
  } catch (_) { return null; }
}

// 모델이 금액·납기를 직접 쓰면 쓰지 않는다(서버 계산값만 허용).
function problems(out) {
  const list = [];
  if (!out.replyEn.includes('{{PRICE_LINE}}')) list.push('price_placeholder_missing');
  const withoutPlaceholder = out.replyEn.replace('{{PRICE_LINE}}', '');
  if (/\$\s?\d|USD\s?\d|\d+\s?(?:dollars|usd)/i.test(withoutPlaceholder)) list.push('model_wrote_price');
  if ((out.replyEn.match(/\?/g) || []).length > 1) list.push('more_than_one_question');
  if (/100%\s*(?:human|hand)|no ai|without ai|years of experience|best|perfect/i.test(out.replyEn)) list.push('forbidden_claim');
  if (/whatsapp|telegram|kakao|e-?mail me|@gmail|outside fiverr/i.test(out.replyEn)) list.push('off_platform');
  return list;
}

// runClaude 오류 문구: claude_<상태>_<내용>. 401·403 = 인증, 잔액은 400/402 + credit/balance/billing 문구.
function isBalanceOrAuthError(message) {
  const m = String(message || '');
  return /^claude_(401|402|403)_/.test(m) || /credit balance|insufficient|billing|payment required|authentication|invalid x-api-key|permission/i.test(m);
}

async function draft({ message, hints = {}, state, deps, now = Date.now() }) {
  const at = new Date(now).toISOString();
  const cfg = readConfig(deps.readPolicy());
  if (!cfg) return { ok: false, error: 'global_reply_disabled' };
  if (!String(message || '').trim()) return { ok: false, error: 'message_empty' };
  if (!deps.hasKey()) return { ok: false, error: 'claude_key_missing' };
  const usage = todayUsage(state, now);
  const reserve = costKrw(cfg, Math.ceil(buildPrompt({ message, hints, fiverr: deps.fiverr() }).length / 2), cfg.maxOutputTokens);
  if (usage.calls >= cfg.dailyMaxCalls) return { ok: false, error: 'daily_max_calls', usage };
  if (usage.krw + reserve > cfg.dailyBudgetKrw) return { ok: false, error: 'daily_budget_krw', usage };
  const fiverr = deps.fiverr();
  const prompt = buildPrompt({ message, hints, fiverr });
  const log = { at, day: kstDay(now), messageId: MESSAGE_ID, called: true, model: deps.model, krw: reserve };
  let result;
  try { result = await deps.runClaude(prompt, { trigger: 'manual', model: cfg.model, maxTokens: cfg.maxOutputTokens, timeoutMs: cfg.timeoutMs }); }
  catch (error) {
    log.error = String(error?.message || error).slice(0, 160);
    // 잔액 부족·인증 실패: 재시도 없이 한 줄 안내만(화면에서 'API 잔액이 없어 초안을 만들 수 없습니다')
    if (isBalanceOrAuthError(log.error)) { log.krw = 0; return { ok: false, error: 'api_unavailable', log }; }
    return { ok: false, error: 'call_failed', detail: log.error, log };
  }
  const inTok = Number(result?.usage?.input_tokens || 0); const outTok = Number(result?.usage?.output_tokens || 0);
  log.inputTokens = inTok; log.outputTokens = outTok;
  log.krw = inTok || outTok ? costKrw(cfg, inTok, outTok) : reserve;
  const out = parseOutput(result?.text);
  if (!out) { log.error = 'parse_failed'; return { ok: false, error: 'parse_failed', log }; }
  const d = out.detected || {};
  const minutes = Number(hints.minutes) > 0 ? Number(hints.minutes) : (Number(d.minutes) > 0 ? Number(d.minutes) : null);
  const burnIn = typeof hints.burnIn === 'boolean' ? hints.burnIn : d.burnIn === true;
  const price = d.inScope === false ? { ok: false, reason: 'out_of_scope' } : priceFor(fiverr, { minutes, burnIn });
  const lines = d.inScope === false ? { en: '', ko: '' } : priceLines(price);
  const fill = (text, line) => text.replace('{{PRICE_LINE}}', line).replace(/\n{3,}/g, '\n\n').trim();
  const issues = problems(out);
  log.issues = issues; log.price = price.ok ? price.usd : price.reason;
  return {
    ok: true,
    messageId: MESSAGE_ID,
    messageKo: out.messageKo,
    replyEn: fill(out.replyEn, lines.en),
    replyKo: fill(out.replyKo, lines.ko),
    detected: { minutes, sourceLanguage: hints.sourceLanguage || d.sourceLanguage || null, burnIn, inScope: d.inScope !== false },
    price, issues, cost: { krw: log.krw, inputTokens: inTok, outputTokens: outTok },
    usage: { calls: usage.calls + 1, maxCalls: cfg.dailyMaxCalls, krw: Math.round((usage.krw + log.krw) * 100) / 100, budgetKrw: cfg.dailyBudgetKrw },
    log
  };
}

function appendLog(state, log) {
  if (!log) return;
  state.globalReplyLog = [log, ...(Array.isArray(state.globalReplyLog) ? state.globalReplyLog : [])].slice(0, LOG_LIMIT);
}

module.exports = { isBalanceOrAuthError, MESSAGE_ID, readConfig, costKrw, todayUsage, redact, priceFor, priceLines, buildPrompt, parseOutput, problems, draft, appendLog, kstDay };
