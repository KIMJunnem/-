'use strict';

// D' 숨고 요청 자동 처리 규칙(2026-09-21 준희 승인).
// 규칙 문장·정규식은 services/_common/soomgo-auto-rules.json, 금액 숫자는
// services/document_writing.json(pricing.largeDocument / foreignProofreading)에만 둔다.
// 이 모듈은 견적 계산 결과(quote)를 받아 삭제·자동 견적·재조회 여부만 바꾼다.
// 외부 API는 부르지 않는다.

const fs = require('node:fs');
const path = require('node:path');
const pricingTable = require('./pricing-table');

const RULES_PATH = path.join(__dirname, '..', 'services', '_common', 'soomgo-auto-rules.json');

function loadRules() {
  try { return JSON.parse(fs.readFileSync(RULES_PATH, 'utf8')); } catch (_) { return null; }
}
const RULES = loadRules();

function seoulDay(value) {
  const time = Date.parse(String(value || '')) || Number(value) || Date.now();
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function deletesToday(state, now = Date.now()) {
  const today = seoulDay(now);
  return (Array.isArray(state?.soomgoAutoDeletes) ? state.soomgoAutoDeletes : []).filter(item => seoulDay(item.at) === today).length;
}

function fieldText(request = {}, fields = []) {
  return fields.map(field => request[field]).filter(value => typeof value === 'string' && value).join('\n');
}

function markRetain(quote, reason, extra = {}) {
  Object.assign(quote, { autoSend: false, manualReview: true, deleteRequest: false, reason, ...extra });
}

// 삭제 판정. 기술 오류(요청 본문이 비었거나 너무 짧음)면 삭제하지 않고 사람 확인으로 넘긴다.
function requestDelete(ctx, ruleId, reason) {
  const { quote, request, state, requestId, now } = ctx;
  const safety = RULES?.deleteSafety || {};
  const textLength = String(request.text || '').replace(/\s+/g, '').length;
  if (textLength < Number(safety.minRequestTextLength || 20)) {
    markRetain(quote, `요청 본문을 충분히 읽지 못해 삭제하지 않습니다(${ruleId}).`, { autoRule: { ruleId, action: 'retain_technical' } });
    return 'retain_technical';
  }
  if (state && deletesToday(state, now) >= Number(safety.dailyCap || 30)) {
    markRetain(quote, safety.capReachedReason || '자동 삭제 하루 상한 도달', { autoRule: { ruleId, action: 'retain_cap' } });
    return 'retain_cap';
  }
  Object.assign(quote, { autoSend: false, manualReview: false, deleteRequest: true, reason, unsupportedService: quote.unsupportedService || ruleId, autoRule: { ruleId, action: 'delete' } });
  if (state) {
    const log = Array.isArray(state.soomgoAutoDeletes) ? state.soomgoAutoDeletes : [];
    // 같은 요청은 한 번만 기록한다(재조회로 다시 들어와도 하루 상한을 두 번 쓰지 않음).
    if (!log.some(item => item.requestId === requestId)) {
      state.soomgoAutoDeletes = [{ at: new Date(now).toISOString(), requestId, ruleId, reason, serviceId: quote.serviceId || null, category: request.soomgoCategory || null, pages: Number(request.pages || 0) || null }, ...log].slice(0, Number(safety.logLimit || 500));
    }
  }
  return 'delete';
}

// 오늘(한국 시간) 영상 편집 자동 견적으로 판정한 요청 수. 같은 요청은 한 번만 센다.
function videoAutoQuotesToday(state, now = Date.now()) {
  const today = seoulDay(now);
  return new Set((Array.isArray(state?.videoEditAutoQuotes) ? state.videoEditAutoQuotes : []).filter(item => seoulDay(item.at) === today).map(item => item.requestId)).size;
}

// 영상 편집 견적값. 길이를 모르거나 쇼츠 원본이 길면 금액 없이 범위 확인으로 둔다.
// 9/24 지시 24(decisions 7-10): services/video_edit.json autoQuote.enabled가 true이고 조건을 다 맞으면 자동 발송(하루 10건).
// ctx.videoAutoQuoteConfig는 시험용 덮어쓰기(실제 서버는 넘기지 않는다).
function attachVideoEditQuote(quote, request, ctx = {}) {
  let priced = null;
  let video = null;
  try { video = require('./video-edit-quote'); priced = video.videoEditQuote(request); } catch (_) { priced = null; }
  if (!priced) return;
  Object.assign(quote, {
    amount: priced.amount || 0, regularAmount: priced.amount || 0, originalAmount: priced.amount || 0,
    savedAmount: 0, totalSavedAmount: 0, discountRate: 0, marketAdjustmentRate: 0, discountLabel: '',
    label: priced.label, days: priced.days || '', message: priced.message, includedRevisions: priced.revisions,
    quoteMessageId: priced.quoteMessageId, quoteMessageVersion: priced.quoteMessageVersion,
    pricing: { table: 'video-edit-2026-09-24', type: 'video_edit', units: priced.minutes, unit: '분', options: priced.options, scopeCheck: priced.scopeCheck },
    videoEdit: { serviceId: priced.serviceId, amount: priced.amount, days: priced.days, scopeCheck: priced.scopeCheck, manualSendOnly: true },
    autoSend: false, manualReview: true
  });
  const now = ctx.now || Date.now();
  const alreadyCounted = (Array.isArray(ctx.state?.videoEditAutoQuotes) ? ctx.state.videoEditAutoQuotes : []).some(item => item.requestId === ctx.requestId);
  const decision = video.autoQuoteDecision(request, priced, { ...(ctx.videoAutoQuoteConfig || {}), sentToday: alreadyCounted ? 0 : videoAutoQuotesToday(ctx.state, now) });
  quote.videoEdit.autoDecision = decision.reason;
  if (decision.storyboard) quote.videoEdit.storyboard = true;
  if (!decision.send) {
    if (decision.reason !== 'switch_off') quote.reason = `${quote.reason || ''} · 영상 편집 자동 견적 안 함(${decision.reason}) — 준희 확인`.replace(/^ · /, '');
    return;
  }
  // 9/25 준희 "다 필요할 듯": 견적 문구 A/B 시험. 요청 번호로 반반 나눠(같은 요청은 늘 같은 판) 통계 byQuoteVersion으로 비교
  const variant = video.abVariant(ctx.requestId);
  const version = `${video.DEFINITION?.autoQuote?.messageVersion || 'auto-v1'}${variant === 'B' ? '-B' : ''}`;
  // 9/24 지시 25: 끝이 열린 길이는 상한 금액·3~4일로(계산값 대신)
  if (decision.override) Object.assign(quote, { amount: decision.override.amount, regularAmount: decision.override.amount, originalAmount: decision.override.amount, days: decision.override.days });
  if (decision.excludedMixed) quote.videoEdit.excludedMixed = true;
  Object.assign(quote, {
    serviceId: 'video_edit',
    message: video.autoQuoteMessage(request, priced, decision, { variant }),
    quoteMessageId: `video_edit.quote.${version}`, quoteMessageVersion: version, messageId: `video_edit.quote.${version}`, messageVersion: version,
    autoSend: true, manualReview: false, reason: null, unsupportedService: null,
    autoRule: { ruleId: 'video_edit_auto', action: 'quote', category: '영상 편집' }
  });
  quote.videoEdit.manualSendOnly = false;
  if (ctx.state && ctx.requestId && !alreadyCounted) {
    const log = Array.isArray(ctx.state.videoEditAutoQuotes) ? ctx.state.videoEditAutoQuotes : [];
    ctx.state.videoEditAutoQuotes = [{ at: new Date(now).toISOString(), requestId: ctx.requestId, amount: priced.amount, minutes: priced.minutes }, ...log].slice(0, 500);
  }
}

function applyDocumentPrice(quote, priced, extra = {}) {
  Object.assign(quote, {
    amount: priced.amount, regularAmount: priced.amount, originalAmount: priced.amount,
    savedAmount: 0, totalSavedAmount: 0, discountRate: 0, marketAdjustmentRate: 0, discountLabel: '',
    label: priced.label, days: priced.days, basicScope: priced.basicScope, message: priced.message,
    pricing: { table: 'document-2026-09-21', type: priced.type, units: priced.units, unit: priced.unit, ...extra }
  });
}

/**
 * ctx: { body, request, quote, requestedServiceId, existingLead, state, requestId, now, supportedServiceIds, sampleAmount }
 * 반환: { action, ruleId } — quote를 제자리에서 바꾼다.
 */
// 9/24 지시 27(decisions 7-13): 숨고 문서·교정·PPT 자동 견적 멈춤. 서비스 정의 파일의 soomgoAutoQuote가 false면
// 자동 발송 대신 "보내지 않음 + 삭제 안 함"(사람 확인 알림도 만들지 않음 — 하루 요약 건수만). 키가 없으면 true(예전처럼 발송).
const SOOMGO_PAUSE_CODES = { document_writing: 'doc_soomgo_paused', presentation: 'ppt_soomgo_paused' };
function soomgoAutoQuoteEnabled(serviceId) {
  try {
    const def = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'services', `${serviceId}.json`), 'utf8'));
    return def.soomgoAutoQuote !== false;
  } catch (_) { return true; }
}
const PAUSE_ENABLED = Object.fromEntries(Object.keys(SOOMGO_PAUSE_CODES).map(id => [id, soomgoAutoQuoteEnabled(id)]));
// 시험 전용: 지시 27 이전 동작(스위치 켜짐)을 확인하는 시험이 한 프로세스 안에서만 값을 바꾼다. 서버는 부르지 않는다.
function setPauseConfigForTest(config = {}) { Object.assign(PAUSE_ENABLED, config); return { ...PAUSE_ENABLED }; }
function applySoomgoServicePause(quote, config = PAUSE_ENABLED) {
  const code = SOOMGO_PAUSE_CODES[quote?.serviceId];
  if (!code || quote.autoSend !== true || config[quote.serviceId] !== false) return false;
  Object.assign(quote, {
    autoSend: false, manualReview: false, deleteRequest: false,
    reason: quote.serviceId === 'presentation' ? '숨고 PPT 자동 견적 멈춤(decisions 7-13) · 보내지 않고 삭제도 안 함' : '숨고 문서·교정 자동 견적 멈춤(decisions 7-13) · 보내지 않고 삭제도 안 함',
    unsupportedService: code,
    autoRule: { ruleId: code, action: 'paused', previous: quote.autoRule || null }
  });
  return true;
}
// 오늘(한국 시간) 멈춤으로 보내지 않은 요청 수 — 알림방 하루 요약 1줄용
function pausedSummary(state, now = Date.now()) {
  const today = seoulDay(now);
  const counts = { document_writing: 0, presentation: 0 };
  for (const lead of Array.isArray(state?.soomgoLeads) ? state.soomgoLeads : []) {
    const id = lead?.quote?.autoRule?.ruleId;
    if (seoulDay(lead.createdAt) !== today) continue;
    if (id === 'doc_soomgo_paused') counts.document_writing += 1;
    if (id === 'ppt_soomgo_paused') counts.presentation += 1;
  }
  const total = counts.document_writing + counts.presentation;
  return { day: today, counts, total, enabled: { ...PAUSE_ENABLED }, line: total ? `숨고 자동 견적 멈춤(7-13): 오늘 문서·교정 ${counts.document_writing}건 · PPT ${counts.presentation}건 보내지 않음(삭제 안 함)` : '' };
}

function applySoomgoAutoRules(ctx) {
  const result = applySoomgoAutoRulesInner(ctx);
  // ctx.soomgoPauseConfig는 시험용 덮어쓰기(실제 서버는 넘기지 않는다)
  if (ctx?.quote && applySoomgoServicePause(ctx.quote, ctx.soomgoPauseConfig || PAUSE_ENABLED)) return { action: 'paused', ruleId: ctx.quote.autoRule.ruleId };
  return result;
}

function applySoomgoAutoRulesInner(ctx) {
  if (!RULES) return { action: 'none', ruleId: null };
  const { request, quote } = ctx;
  ctx.now = ctx.now || Date.now();
  const docRules = pricingTable.DOCUMENT_RULES || {};
  const categoryName = request.soomgoCategory || null;
  const categoryServiceId = request.serviceClassification?.source === 'soomgo_category' ? request.serviceId : null;
  const unmappedCategory = Boolean(categoryName && !categoryServiceId);

  // 1) 판매하지 않는 카테고리·자소서·학술·증빙 위조·영어 번역: 삭제
  for (const rule of RULES.deleteRules || []) {
    if (Array.isArray(rule.onlyServiceIds) && !rule.onlyServiceIds.includes(quote.serviceId)) continue;
    let hit = false;
    if (rule.when === 'unmappedCategory') hit = unmappedCategory;
    else if (rule.when === 'serviceId') hit = (rule.serviceIds || []).includes(quote.serviceId);
    else if (rule.when === 'flag') hit = Boolean(request[rule.flag] || quote[rule.flag]);
    else if (rule.when === 'text') hit = new RegExp(rule.pattern, 'i').test(fieldText(request, rule.fields || ['text']));
    // 2026-09-24 준희: 영상 편집처럼 reviewCategories에 적힌 미판매 카테고리는 지우지 않고 기록·사람 확인으로 둔다(견적 안 보냄).
    // unsupportedService를 채워 Claude 견적 판단 대상에서도 빠진다.
    if (hit && rule.when === 'unmappedCategory' && Array.isArray(rule.reviewCategories) && rule.reviewCategories.includes(categoryName)) {
      markRetain(quote, rule.reviewReason || '미판매 카테고리 · 삭제하지 않고 사람 확인', { unsupportedService: 'unsold_category_review', autoRule: { ruleId: 'unsold_category_review', action: 'retain_review', category: categoryName } });
      // 2026-09-24 지시 16(decisions 7-4): 영상 편집은 견적값을 계산해 붙인다 — 준희 알림·수동 발송용. autoSend는 false 그대로.
      if (categoryName === '영상 편집') attachVideoEditQuote(quote, request, ctx);
      if (quote.autoRule?.ruleId === 'video_edit_auto') return { action: 'quote', ruleId: 'video_edit_auto' };
      return { action: 'retain_review', ruleId: 'unsold_category_review' };
    }
    if (hit) return { action: requestDelete(ctx, rule.id, rule.reason), ruleId: rule.id };
  }

  // 2) 외국어 교정: 영어만 자동 견적, 그 외 삭제
  if (request.foreignLanguage && quote.serviceId === (RULES.foreignProofreading?.serviceId || 'document_writing')) {
    const fp = docRules.foreignProofreading;
    const english = fp && new RegExp(fp.languages || '영어', 'i').test(`${request.foreignLanguage.language || ''} ${request.foreignLanguage.language === '원문 표기로 추정' ? [request.volume, request.format, request.topic, request.notes].filter(Boolean).join(' ') : ''}`);
    if (!english) return { action: requestDelete(ctx, 'foreign_other_language', RULES.foreignProofreading?.otherLanguageReason || '영어 외 외국어 교정 삭제'), ruleId: 'foreign_other_language' };
    const pages = Math.max(1, Number(request.pages || 1));
    if (pages > Number(fp.deleteAbovePages || 100)) return { action: requestDelete(ctx, 'large_document', RULES.largeDocument?.deleteReason), ruleId: 'large_document' };
    const priced = pricingTable.englishProofreadingQuote(request);
    applyDocumentPrice(quote, priced, { language: 'english' });
    Object.assign(quote, { autoSend: true, manualReview: false, reason: null, foreignLanguage: request.foreignLanguage.language, autoRule: { ruleId: 'english_proofreading', action: 'quote' } });
    if (typeof ctx.sampleAmount === 'function') quote.sampleAmount = ctx.sampleAmount(priced.amount);
    return { action: 'quote', ruleId: 'english_proofreading' };
  }

  // 3) 문서 100쪽 초과: 삭제 (40~100쪽은 가격표의 40쪽 초과 단가로 자동 견적)
  if (quote.serviceId === (RULES.largeDocument?.serviceId || 'document_writing') && quote.pricing?.unit === '쪽') {
    const limit = Number(docRules.largeDocument?.deleteAbovePages || 100);
    if (Number(request.pages || 0) > limit) return { action: requestDelete(ctx, 'large_document', RULES.largeDocument?.deleteReason), ruleId: 'large_document' };
  }

  // 4) 서비스 불일치: 카테고리가 있으면 카테고리 기준 견적, 없으면 삭제
  const requested = ctx.requestedServiceId;
  if (requested && quote.serviceId && requested !== quote.serviceId) {
    if (categoryServiceId && categoryServiceId === quote.serviceId) {
      quote.autoRule = { ruleId: 'service_mismatch', action: 'quote_by_category', requestedServiceId: requested };
    } else {
      return { action: requestDelete(ctx, 'service_mismatch', RULES.serviceMismatch?.deleteReason), ruleId: 'service_mismatch' };
    }
  }

  // 5) 분류 불가: 한 번 다시 조회하고, 두 번째에도 못 하면 삭제
  const supported = Array.isArray(ctx.supportedServiceIds) ? ctx.supportedServiceIds : null;
  const unclassified = !quote.serviceId || (supported && !supported.includes(quote.serviceId));
  if (unclassified) {
    const attempts = Number(ctx.existingLead?.classifyAttempts || 0) + 1;
    if (ctx.existingLead) ctx.existingLead.classifyAttempts = attempts;
    ctx.classifyAttempts = attempts;
    if (attempts <= Number(RULES.unclassified?.retries ?? 1)) {
      markRetain(quote, RULES.unclassified?.retryReason || '분류 불가 · 재조회', { autoRule: { ruleId: 'unclassified', action: 'retry', attempts } });
      return { action: 'retry', ruleId: 'unclassified' };
    }
    return { action: requestDelete(ctx, 'unclassified', RULES.unclassified?.deleteReason), ruleId: 'unclassified' };
  }
  return { action: 'none', ruleId: null };
}

module.exports = { RULES, applySoomgoAutoRules, applySoomgoServicePause, pausedSummary, setPauseConfigForTest, SOOMGO_PAUSE_CODES, deletesToday, seoulDay };
