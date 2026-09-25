'use strict';

// Jev(TypeSafe AI) 내부 시뮬레이션 (2026-09-21 준희 승인: 호출 상한 1,000건).
// - 과거 기록(숨고 요청·견적·채팅)을 Jev에 넣어 판정을 받고, 지금 규칙·실제 결과와 비교만 한다.
// - 봇 동작, 리드, 견적, 발송에는 아무 영향이 없다. 결과는 server/data/jev-sim/에 파일로만 남는다.
// - 고객 이름·회사·연락처는 보내지 않는다(이메일·전화번호·키 모양 문자열은 가린다).
// - 한도(2026-09-22 준희 지시): 하루 금액 기준(정책 파일 jevSimulation.dailyBudgetKrw → 토큰 한도로 환산), 1회 실행 호출 상한
//   (jevSimulation.runMaxCalls). 값은 정책 파일에만 있고 호출하는 쪽이 limits로 넘긴다. 없으면 시작하지 않는다.
//   하루는 한국 시간 0시 기준. 한도에 닿으면 남은 호출을 멈추고 stopReason=daily_token_cap을 남긴다.
// - 품질 실험 출처(subtitle_pairs 등)는 tests/의 시험·합성 데이터만 쓴다(jev-quality-data.js).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const PRICE_USD_PER_MTOK = 0.042;
const jevQuality = require('./jev-quality-data');
const PRESETS_FILE = path.join(__dirname, 'config', 'jev-quality-experiments.json');
const SYNTHETIC = /(SAFETY|TEST|DEMO|SIMULATION)/i;

function redact(value, max = 3000) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[이메일]')
    .replace(/(?:01[016789]|070|02|0[3-6][1-5])[-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[전화번호]')
    .replace(/\b(?:sk|pk|ghp|AIza|Bearer)[-_A-Za-z0-9.]{8,}\b/gi, '[인증정보]')
    .replace(/https?:\/\/\S+/g, '[링크]')
    .slice(0, max);
}

// 요청 원문에서 고객 이름 블록(두 번째 '고객 정보' 뒤)을 잘라낸다.
function requestTextForJev(request = {}) {
  let text = String(request.text || '');
  const name = String(request.customerName || '').trim();
  if (name) text = text.split(name).join('[고객]');
  for (const field of ['company', 'role']) {
    const value = String(request[field] || '').trim();
    if (value.length >= 2) text = text.split(value).join('[비공개]');
  }
  return redact(text);
}

const SERVICE_CRITERIA = {
  subtitle: 'Subtitle creation for a video (자막 제작). Timing/sync of subtitles.',
  document_writing: 'General document work: writing, formatting, proofreading(교정/교열), stenography/typing a recording(속기·녹취).',
  presentation: 'Turning a provided manuscript/report into PPT slides.',
  translation_en: 'Translating a document between English and Korean (not proofreading).',
  not_sold: 'Anything else: video editing, design, logo, data crawling, statistics, business plan, resume/self-introduction writing, academic thesis.'
};

const EXPERIMENTS = {
  // A. 요청 분류: Jev 판정 vs 지금 규칙 판정 vs 실제 결과(발송·고용)
  classify: {
    label: '요청 분류 비교',
    questions: {
      service: { type: 'choice', instructions: 'A Korean freelancer marketplace (Soomgo) request is in state.request. Which service does the customer actually want? Use the category line if present.', criteria: SERVICE_CRITERIA },
      action: { type: 'choice', instructions: 'The seller sells only subtitles, general documents (writing/formatting/Korean proofreading/English proofreading/stenography), and PPT conversion. It does NOT do resume/self-introduction writing, academic theses, forged documents, English translation, non-English foreign proofreading, or documents over 100 pages. What should the seller do?', criteria: { quote: 'Send an automatic price quote: the request is clearly within the sold services.', delete: 'Delete the request: clearly not sold or not allowed.', human_review: 'A person should look: ambiguous, missing key info, or risky.' } },
      delete_reason: { type: 'choice', instructions: 'If this request should NOT be quoted, what is the main reason? If it should be quoted, choose none.', criteria: { none: 'It can be quoted.', resume_self_intro: 'Resume / self-introduction (자기소개서·이력서) writing.', academic: 'Academic thesis / dissertation / journal paper.', forgery: 'Forged or fake documents, making certificates or receipts.', unsold_category: 'A service category the seller does not sell (video editing, design, data, business plan, etc.).', foreign_language: 'Proofreading in a foreign language other than English, or translation.', too_large: 'Over 100 pages.', unclear: 'Cannot tell what is requested.' } }
    }
  },
  // B. 채팅 의도: Jev 판정 vs 지금 보강 규칙·템플릿 판정
  chat_intent: {
    label: '채팅 의도 판정',
    questions: {
      intent: { type: 'choice', instructions: 'A customer sent this chat message (Korean) to a freelancer on Soomgo. What is the customer mainly doing?', criteria: { price_negotiation: 'Asking for a discount or lower price, saying it is expensive.', frustrated: 'Complaining about slow answers, pressing, angry.', hire_intent: 'Agreeing to proceed, hiring, saying they will pay.', question_price: 'Asking how much it costs.', question_deadline: 'Asking when it can be done or how long it takes.', question_process: 'Asking how the work proceeds, format, revisions, materials.', file_notice: 'Sending or talking about files, photos, links.', left_or_other_pro: 'Leaving the chat or saying they chose another pro.', spam: 'Advertising or spam.', other: 'Greeting, thanks, or anything else.' } },
      needs_human: { type: 'noul', instructions: 'Should a human answer this message instead of an automatic reply?', criteria: { true: 'A human should answer (money decision, complaint, unusual request).', false: 'An automatic reply is fine.' } }
    }
  },
  // C. 견적 문구 검수: 나간 견적 문구가 요청을 제대로 되짚었는지
  quote_copy: {
    label: '견적 문구 검수',
    questions: {
      restates_request: { type: 'score', instructions: 'state.request is the customer request, state.quote_message is the quote the seller sent. How specifically does the quote restate what the customer asked (quantity, format, purpose, in the customer\'s own words)?', criteria: [ { summary: 'generic', signals: ['could be sent to anyone', 'no quantity or format from the request'] }, { summary: 'partly specific', signals: ['mentions one concrete detail from the request'] }, { summary: 'specific', signals: ['restates quantity, format and purpose from the request'] } ] },
      sincere: { type: 'score', instructions: 'Would a careful 40-50 year old customer, worried the seller will do a sloppy job, find this quote sincere and trustworthy?', criteria: [ { summary: 'looks like a template or sales copy', signals: ['vague', 'overly smooth', 'many conditions'] }, { summary: 'neutral', signals: ['clear but plain'] }, { summary: 'sincere', signals: ['specific to the request', 'clear price and scope', 'safe payment', 'one relevant question'] } ] },
      clear_price_scope: { type: 'noul', instructions: 'Does the quote state one clear price and what is included?', criteria: { true: 'One clear price and scope.', false: 'Price or scope is unclear or there are many numbers.' } },
      asks_useful_question: { type: 'noul', instructions: 'Does the quote ask one useful question about something missing from the request that could change the price?', criteria: { true: 'Yes, one useful question.', false: 'No question, or only generic questions.' } }
    }
  },
  // C'. 같은 요청에 지금(v2) 문구를 만들어 같은 기준으로 검수 — 예전 문구와 짝지어 비교
  quote_copy_current: {
    label: '지금 견적 문구 검수(v2)',
    questions: null // quote_copy와 같은 질문을 쓴다(아래에서 채움)
  },
  // D. 답장 예측: 나간 견적에 고객이 답장·고용할지
  reply_prediction: {
    label: '답장 예측',
    questions: {
      will_reply: { type: 'noul', instructions: 'Given the customer request (state.request) and the quote sent (state.quote_message, amount state.amount_krw), will this customer reply to the seller?', criteria: { true: 'The customer will likely reply.', false: 'The customer will likely not reply.' } },
      will_hire: { type: 'noul', instructions: 'Will this customer hire this seller?', criteria: { true: 'Likely to hire.', false: 'Unlikely to hire.' } }
    }
  }
};

EXPERIMENTS.quote_copy_current.questions = EXPERIMENTS.quote_copy.questions;

function estimateTokens(payload) {
  // 한글이 섞인 JSON은 대략 2자당 1토큰으로 넉넉히 잡는다.
  return Math.ceil(JSON.stringify(payload).length / 2);
}

function ruleServiceBucket(serviceId, action) {
  if (action === 'delete' && !serviceId) return 'not_sold';
  return ['subtitle', 'document_writing', 'presentation', 'translation_en'].includes(serviceId) ? serviceId : 'not_sold';
}

function ruleIntentFromReply(templateKey = '', guardKey = '') {
  const key = String(guardKey || templateKey || '');
  if (/system_notice/.test(key)) return 'system_notice';
  if (/price_negotiation|flexible_price/.test(key)) return 'price_negotiation';
  if (/frustrated/.test(key)) return 'frustrated';
  if (/hire_ready|confirm_hire|ask_hire_consent|manual_hired|sample_order_ready/.test(key)) return 'hire_intent';
  if (/customer_left|hired_other/.test(key)) return 'left_or_other_pro';
  if (/spam/.test(key)) return 'spam';
  if (/attachment|large_file|link_/.test(key)) return 'file_notice';
  if (/auto_price|self_intro_price|additional_fee|research_addon|scope_expansion|manual_billing/.test(key)) return 'question_price';
  if (/deadline|start_date/.test(key)) return 'question_deadline';
  if (/process|format|revision|materials|pages|tone|table_image|summary|confidentiality|delivery|language|intake/.test(key)) return 'question_process';
  return 'other';
}

// 시험 메시지 제외(2026-09-22 준희 지시): 같은 본문(공백 무시)이 표본에 3회 이상 나오면 시험 입력으로 보고 모두 뺀다.
const REPEATED_TEXT_MIN = 3;
function sameBody(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function dropRepeated(records, textOf, min = REPEATED_TEXT_MIN) {
  const counts = new Map();
  for (const record of records) { const body = sameBody(textOf(record)); counts.set(body, (counts.get(body) || 0) + 1); }
  return records.filter(record => (counts.get(sameBody(textOf(record))) || 0) < min);
}

// 기록에서 실험별 항목을 만든다. deps: { buildSoomgoQuote, applyAutoRules, supportedServiceIds, replyGuard }
function buildItems(state, experiment, deps) {
  const leads = (Array.isArray(state.soomgoLeads) ? state.soomgoLeads : []).filter(lead => !SYNTHETIC.test([lead.id, lead.requestId, lead.conversationId, lead.taskId].filter(Boolean).join('|')));
  if (experiment === 'classify') {
    return dropRepeated(leads.filter(lead => String(lead.request?.text || '').replace(/\s+/g, '').length >= 40), lead => lead.request.text).map(lead => {
      let rule = { serviceId: null, action: 'error', ruleId: null };
      try {
        const input = { requestId: `JEVSIM-${lead.requestId}`, text: lead.request.text };
        const { parsed, quote } = deps.buildSoomgoQuote(input);
        const result = deps.applyAutoRules({ body: input, request: parsed, quote, requestedServiceId: null, existingLead: null, state: {}, requestId: input.requestId, supportedServiceIds: deps.supportedServiceIds });
        const action = quote.deleteRequest ? 'delete' : quote.autoSend ? 'quote' : 'human_review';
        rule = { serviceId: quote.serviceId || null, action, ruleId: result.ruleId, amount: quote.amount || null };
      } catch (error) { rule.error = error.message; }
      return {
        key: lead.requestId,
        state: { request: requestTextForJev(lead.request) },
        compare: { rule, outcome: { quoteSent: lead.quoteEvidence?.status === 'sent', customerReplied: Boolean(lead.quoteEvidence?.customerReplied), hired: Boolean(lead.taskId) } }
      };
    });
  }
  if (experiment === 'quote_copy' || experiment === 'reply_prediction') {
    return leads.filter(lead => lead.quoteEvidence?.status === 'sent' && String(lead.quote?.message || '').length > 20 && String(lead.request?.text || '').length >= 40).map(lead => ({
      key: lead.requestId,
      state: { request: requestTextForJev(lead.request), quote_message: redact(lead.quote.message, 2000), amount_krw: Number(lead.quote.amount || 0), service: lead.quote.serviceId || null },
      compare: { quoteVersion: lead.quoteEvidence?.version || null, outcome: { customerReplied: Boolean(lead.quoteEvidence?.customerReplied), hired: Boolean(lead.taskId) } }
    }));
  }
  if (experiment === 'quote_copy_current') {
    return leads.filter(lead => lead.quoteEvidence?.status === 'sent' && String(lead.request?.text || '').length >= 40).map(lead => {
      try {
        const input = { requestId: `JEVSIM-${lead.requestId}`, text: lead.request.text };
        const { parsed, quote } = deps.buildSoomgoQuote(input);
        deps.applyAutoRules({ body: input, request: parsed, quote, requestedServiceId: null, existingLead: null, state: {}, requestId: input.requestId, supportedServiceIds: deps.supportedServiceIds });
        if (!quote.autoSend || quote.deleteRequest || !String(quote.message || '').trim()) return null;
        return {
          key: lead.requestId,
          state: { request: requestTextForJev(lead.request), quote_message: redact(quote.message, 2000), amount_krw: Number(quote.amount || 0), service: quote.serviceId || null },
          compare: { quoteVersion: String(quote.quoteMessageVersion || 'v1'), current: true, outcome: { customerReplied: Boolean(lead.quoteEvidence?.customerReplied), hired: Boolean(lead.taskId) } }
        };
      } catch (_) { return null; }
    }).filter(Boolean);
  }
  // 봇 답장 검수(2026-09-22): 고객 메시지와 봇이 만든 답장을 짝으로 넣는다. 답장 본문이 없는 기록(수동 처리·차단)은 뺀다.
  if (experiment === 'bot_reply') {
    const replies = (Array.isArray(state.soomgoReplies) ? state.soomgoReplies : []).filter(record => !SYNTHETIC.test([record.id, record.conversationId].filter(Boolean).join('|')));
    const usable = replies.filter(record => typeof record.incoming === 'string' && record.incoming.trim().length >= 2 && String(record.reply?.text || '').trim().length >= 5);
    // 같은 대화의 요청 기록에서 고객 이름을 찾아 답장·메시지에서 가린다.
    const nameByConversation = new Map();
    for (const lead of leads) { const name = String(lead.request?.customerName || '').trim(); if (lead.conversationId && name.length >= 2) nameByConversation.set(String(lead.conversationId), name); }
    const strip = (text, name) => (name ? String(text || '').split(name).join('[고객]') : String(text || ''));
    return dropRepeated(usable, record => record.incoming).map(record => {
      const guard = (() => { try { return deps.replyGuard(record.incoming) || null; } catch (_) { return null; } })();
      const templateKey = record.reply?.templateKey || '';
      const evidence = record.replyEvidence || null;
      const name = nameByConversation.get(String(record.conversationId || '')) || '';
      return {
        key: String(record.id || record.messageId),
        state: { message: redact(strip(record.incoming, name), 1500), bot_reply: redact(strip(record.reply.text, name), 1500) },
        compare: {
          rule: { templateKey, intent: ruleIntentFromReply(templateKey, guard?.key || guard?.templateKey), needsHuman: Boolean(record.reply?.manualReview || record.reply?.autoSend === false), aiGenerated: Boolean(record.reply?.aiGenerated) },
          outcome: { sent: evidence?.status === 'sent', customerReplied: Boolean(evidence?.customerReplied) }
        }
      };
    });
  }
  if (experiment === 'chat_intent') {
    const replies = (Array.isArray(state.soomgoReplies) ? state.soomgoReplies : []).filter(record => !SYNTHETIC.test([record.id, record.conversationId].filter(Boolean).join('|')));
    return dropRepeated(replies.filter(record => typeof record.incoming === 'string' && record.incoming.trim().length >= 2), record => record.incoming).map(record => {
      const guard = (() => { try { return deps.replyGuard(record.incoming) || null; } catch (_) { return null; } })();
      const templateKey = record.reply?.templateKey || '';
      return {
        key: String(record.id || record.messageId),
        state: { message: redact(record.incoming, 1500) },
        compare: { rule: { templateKey, guardKey: guard?.key || guard?.templateKey || null, intent: ruleIntentFromReply(templateKey, guard?.key || guard?.templateKey), needsHuman: Boolean(record.reply?.manualReview || record.reply?.autoSend === false) } }
      };
    });
  }
  return [];
}

async function callJev({ key, questions, state, fetchImpl, timeoutMs = 15000 }) {
  const response = await fetchImpl(JEV_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) {}
  if (!response.ok) {
    const error = new Error(`jev_http_${response.status}`);
    error.status = response.status;
    error.detail = String(body?.error?.message || body?.detail || body?.message || '').slice(0, 300);
    throw error;
  }
  return body || {};
}

function answerValue(answer = {}) {
  if (!answer || typeof answer !== 'object') return null;
  if (answer.type === 'choice' || 'choice' in answer) return { value: answer.choice, confidence: answer.confidence ?? null };
  if (answer.type === 'noul' || 'noul' in answer) return { value: Number(answer.noul), confidence: null };
  if (answer.type === 'score' || 'score' in answer) return { value: Number(answer.score), confidence: answer.confidence ?? null, legend: answer.legend || null };
  return { value: null };
}

function summarize(experiment, results) {
  const ok = results.filter(item => item.jev);
  const summary = { items: results.length, answered: ok.length, errors: results.length - ok.length };
  if (experiment === 'classify') {
    const serviceAgree = ok.filter(item => item.jev.service?.value === ruleServiceBucket(item.compare.rule.serviceId, item.compare.rule.action)).length;
    const actionAgree = ok.filter(item => item.jev.action?.value === item.compare.rule.action).length;
    const confusion = {};
    for (const item of ok) {
      const cell = `규칙:${item.compare.rule.action} → 제브:${item.jev.action?.value}`;
      confusion[cell] = (confusion[cell] || 0) + 1;
    }
    const lowConfidence = ok.filter(item => Number(item.jev.action?.confidence ?? 1) < 0.6).length;
    summary.serviceAgreement = ok.length ? Number((serviceAgree / ok.length).toFixed(3)) : null;
    summary.actionAgreement = ok.length ? Number((actionAgree / ok.length).toFixed(3)) : null;
    summary.actionConfusion = confusion;
    summary.jevLowConfidence = lowConfidence;
    summary.disagreements = ok.filter(item => item.jev.action?.value !== item.compare.rule.action).slice(0, 40).map(item => ({ requestId: item.key, rule: item.compare.rule, jev: { service: item.jev.service?.value, action: item.jev.action?.value, reason: item.jev.delete_reason?.value, confidence: item.jev.action?.confidence }, outcome: item.compare.outcome }));
    const sentAndJevDelete = ok.filter(item => item.compare.outcome.quoteSent && item.jev.action?.value === 'delete');
    summary.jevWouldDeleteButQuoteWasSent = sentAndJevDelete.length;
    summary.jevWouldDeleteButHired = sentAndJevDelete.filter(item => item.compare.outcome.hired).length;
  }
  if (experiment === 'chat_intent') {
    const agree = ok.filter(item => item.jev.intent?.value === item.compare.rule.intent).length;
    const humanAgree = ok.filter(item => (Number(item.jev.needs_human?.value) >= 0.5) === item.compare.rule.needsHuman).length;
    const confusion = {};
    for (const item of ok) { const cell = `규칙:${item.compare.rule.intent} → 제브:${item.jev.intent?.value}`; confusion[cell] = (confusion[cell] || 0) + 1; }
    summary.intentAgreement = ok.length ? Number((agree / ok.length).toFixed(3)) : null;
    summary.needsHumanAgreement = ok.length ? Number((humanAgree / ok.length).toFixed(3)) : null;
    summary.intentConfusion = confusion;
    summary.disagreementSamples = ok.filter(item => item.jev.intent?.value !== item.compare.rule.intent).slice(0, 40).map(item => ({ id: item.key, message: item.state.message.slice(0, 120), rule: item.compare.rule, jev: item.jev.intent }));
  }
  if (experiment === 'quote_copy' || experiment === 'quote_copy_current') {
    const mean = key => { const values = ok.map(item => Number(item.jev[key]?.value)).filter(Number.isFinite); return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)) : null; };
    const rate = key => { const values = ok.map(item => Number(item.jev[key]?.value)).filter(Number.isFinite); return values.length ? Number((values.filter(v => v >= 0.5).length / values.length).toFixed(3)) : null; };
    summary.meanRestatesRequest = mean('restates_request');
    summary.meanSincere = mean('sincere');
    summary.clearPriceScopeRate = rate('clear_price_scope');
    summary.asksUsefulQuestionRate = rate('asks_useful_question');
    const byVersion = {};
    for (const item of ok) { const v = item.compare.quoteVersion || 'unknown'; (byVersion[v] = byVersion[v] || []).push(Number(item.jev.sincere?.value)); }
    summary.sincereByQuoteVersion = Object.fromEntries(Object.entries(byVersion).map(([v, list]) => [v, { n: list.length, mean: Number((list.filter(Number.isFinite).reduce((a, b) => a + b, 0) / Math.max(1, list.filter(Number.isFinite).length)).toFixed(3)) }]));
    const repliedScores = ok.filter(item => item.compare.outcome.customerReplied || item.compare.outcome.hired).map(item => Number(item.jev.sincere?.value)).filter(Number.isFinite);
    summary.sincereOfRepliedOrHired = { n: repliedScores.length, mean: repliedScores.length ? Number((repliedScores.reduce((a, b) => a + b, 0) / repliedScores.length).toFixed(3)) : null };
    summary.lowestSincere = [...ok].sort((a, b) => Number(a.jev.sincere?.value) - Number(b.jev.sincere?.value)).slice(0, 10).map(item => ({ requestId: item.key, sincere: item.jev.sincere?.value, restates: item.jev.restates_request?.value, quote: item.state.quote_message.slice(0, 200) }));
  }
  if (experiment === 'reply_prediction') {
    const positives = ok.filter(item => item.compare.outcome.customerReplied || item.compare.outcome.hired);
    const negatives = ok.filter(item => !(item.compare.outcome.customerReplied || item.compare.outcome.hired));
    const mean = list => list.length ? Number((list.reduce((a, item) => a + Number(item.jev.will_reply?.value || 0), 0) / list.length).toFixed(3)) : null;
    summary.positives = positives.length;
    summary.negatives = negatives.length;
    summary.meanWillReplyForPositives = mean(positives);
    summary.meanWillReplyForNegatives = mean(negatives);
    // 순위 기반(AUC): 답장·고용 건이 무답 건보다 높은 점수를 받을 확률
    let wins = 0, pairs = 0;
    for (const p of positives) for (const n of negatives) { pairs += 1; const a = Number(p.jev.will_reply?.value || 0), b = Number(n.jev.will_reply?.value || 0); wins += a > b ? 1 : a === b ? 0.5 : 0; }
    summary.auc = pairs ? Number((wins / pairs).toFixed(3)) : null;
    summary.caution = positives.length < 20 ? `답장·고용 기록이 ${positives.length}건뿐이라 통계로 판단할 수 없습니다(참고용).` : null;
  }
  return summary;
}


// ── 사용자 실험(페이블 등이 설계한 JSON) ──────────────────────────────
// 데이터는 아래 다섯 가지 출처에서만 고르고(가림 처리된 같은 항목), 질문만 새로 정의한다.
// bot_replies(2026-09-22 추가): 고객 메시지(message)와 봇 답장(bot_reply) 짝. 답장이 질문에 맞게 나갔는지 검수용.
// 품질 실험 출처(2026-09-22): 운영 기록이 아니라 tests/의 시험·합성 데이터. 정답(gold)이 붙은 항목은 판정과 비교한다.
const QUALITY_SOURCE_PREFIX = 'quality:';
const CUSTOM_SOURCES = { requests: 'classify', sent_quotes: 'quote_copy', current_quotes: 'quote_copy_current', chat: 'chat_intent', bot_replies: 'bot_reply', ...Object.fromEntries(Object.keys(jevQuality.QUALITY_SOURCES).map(name => [name, QUALITY_SOURCE_PREFIX + name])) };
const CUSTOM_LIMITS = { maxQuestions: 8, maxChoiceOptions: 30, maxInstructionChars: 1500, maxExperiments: 5, maxRepeats: 1000 };

function validateCustomExperiment(def = {}, { runMaxCalls = null } = {}) {
  const errors = [];
  const id = String(def.id || '');
  if (!/^[a-z0-9_]{2,40}$/.test(id)) errors.push('id: 영문 소문자·숫자·밑줄 2~40자');
  if (!CUSTOM_SOURCES[def.source]) errors.push(`source: ${Object.keys(CUSTOM_SOURCES).join(' | ')} 중 하나`);
  const questions = def.questions && typeof def.questions === 'object' ? def.questions : {};
  const names = Object.keys(questions);
  if (!names.length || names.length > CUSTOM_LIMITS.maxQuestions) errors.push(`questions: 1~${CUSTOM_LIMITS.maxQuestions}개`);
  for (const name of names) {
    const q = questions[name] || {};
    if (!/^[a-z0-9_]{1,40}$/.test(name)) errors.push(`${name}: 질문 이름은 영문 소문자·숫자·밑줄`);
    if (typeof q.instructions !== 'string' || !q.instructions.trim() || q.instructions.length > CUSTOM_LIMITS.maxInstructionChars) errors.push(`${name}.instructions: 1~${CUSTOM_LIMITS.maxInstructionChars}자 문자열`);
    if (q.type === 'choice') {
      const keys = Object.keys(q.criteria || {});
      if (keys.length < 2 || keys.length > CUSTOM_LIMITS.maxChoiceOptions) errors.push(`${name}.criteria: 선택지 2~${CUSTOM_LIMITS.maxChoiceOptions}개`);
    } else if (q.type === 'noul') {
      if (!q.criteria || typeof q.criteria.true !== 'string' || typeof q.criteria.false !== 'string') errors.push(`${name}.criteria: {true, false} 설명 필요`);
    } else if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10 || q.criteria.some(level => typeof level?.summary !== 'string')) errors.push(`${name}.criteria: [{summary, signals}] 2~10단계`);
    } else errors.push(`${name}.type: choice | noul | score`);
  }
  const filter = def.filter && typeof def.filter === 'object' ? def.filter : {};
  if (filter.service && !['subtitle', 'document_writing', 'presentation', 'translation_en', 'none'].includes(filter.service)) errors.push('filter.service: subtitle | document_writing | presentation | translation_en | none');
  if (filter.ruleAction && !['quote', 'delete', 'human_review'].includes(filter.ruleAction)) errors.push('filter.ruleAction: quote | delete | human_review');
  if (filter.sent && !['sent', 'not_sent'].includes(filter.sent)) errors.push('filter.sent: sent | not_sent (bot_replies 전용)');
  if (filter.autoSent != null && typeof filter.autoSent !== 'boolean') errors.push('filter.autoSent: true | false (bot_replies 전용)');
  // sampleLimit은 '최대 몇 항목'이다. 1회 실행 상한(runMaxCalls)보다 커도 받는다 — 실제 호출은 시작할 때 데이터 수와 상한으로 잘린다(skippedByCap). 2026-09-22 준희 지시.
  if (def.sampleLimit != null && !(Number.isInteger(Number(def.sampleLimit)) && Number(def.sampleLimit) >= 1)) errors.push('sampleLimit: 1 이상 정수');
  // repeats(2026-09-22): 같은 항목을 N번 물어 흔들림을 잰다. 호출 수 = 항목 수 × repeats. 상한 1,000.
  if (def.repeats != null && !(Number.isInteger(Number(def.repeats)) && Number(def.repeats) >= 1 && Number(def.repeats) <= CUSTOM_LIMITS.maxRepeats)) errors.push(`repeats: 1~${CUSTOM_LIMITS.maxRepeats} 정수`);
  return errors;
}

function customItems(state, def, deps) {
  if (String(CUSTOM_SOURCES[def.source]).startsWith(QUALITY_SOURCE_PREFIX)) {
    // 시험·합성 데이터만. 운영 기록(state)은 읽지 않는다. 정답 있는 항목이 앞에 온다.
    const items = jevQuality.qualityItems(def.source, Object.keys(def.questions || {}));
    return items.slice(0, Number(def.sampleLimit) || items.length);
  }
  let items = buildItems(state, CUSTOM_SOURCES[def.source], deps);
  const f = def.filter || {};
  const serviceOf = item => item.compare?.rule?.serviceId || item.state?.service || 'none';
  if (f.service) items = items.filter(item => serviceOf(item) === f.service || (f.service === 'none' && !serviceOf(item)));
  if (f.ruleAction) items = items.filter(item => item.compare?.rule?.action === f.ruleAction);
  if (f.outcome === 'replied_or_hired') items = items.filter(item => item.compare?.outcome?.customerReplied || item.compare?.outcome?.hired);
  if (f.outcome === 'no_reply') items = items.filter(item => item.compare?.outcome && !item.compare.outcome.customerReplied && !item.compare.outcome.hired);
  if (f.sent === 'sent') items = items.filter(item => item.compare?.outcome?.sent === true);
  if (f.sent === 'not_sent') items = items.filter(item => item.compare?.outcome && item.compare.outcome.sent !== true);
  if (typeof f.autoSent === 'boolean') items = items.filter(item => item.compare?.rule && (item.compare.rule.needsHuman === false) === f.autoSent);
  return items.slice(0, Number(def.sampleLimit) || items.length);
}

// 정답 비교(품질 실험): 예/아니오 질문만. 판정 = 값 ≥ 0.5. 확신도 = |값 − 0.5| × 2 (0~1).
// 확신도 구간별 정답률을 보면 "확신 높을 때는 맞는지"를 알 수 있다.
const CONFIDENCE_BINS = [[0, 0.4, '낮음 0~0.4'], [0.4, 0.8, '중간 0.4~0.8'], [0.8, 1.0001, '높음 0.8~1']];
function goldComparison(name, q, answers) {
  if (q.type !== 'noul') return null;
  const rows = answers.map(({ item, a }) => ({ item, v: Number(a.value), gold: item.compare?.gold?.[name] })).filter(r => typeof r.gold === 'boolean' && Number.isFinite(r.v));
  if (!rows.length) return null;
  const confusion = { tp: 0, fp: 0, tn: 0, fn: 0 };
  const bins = CONFIDENCE_BINS.map(([lo, hi, label]) => ({ label, lo, hi, n: 0, correct: 0 }));
  const misses = [];
  for (const r of rows) {
    const predicted = r.v >= 0.5;
    const correct = predicted === r.gold;
    confusion[predicted ? (r.gold ? 'tp' : 'fp') : (r.gold ? 'fn' : 'tn')] += 1;
    const confidence = Math.abs(r.v - 0.5) * 2;
    const bin = bins.find(b => confidence >= b.lo && confidence < b.hi);
    if (bin) { bin.n += 1; if (correct) bin.correct += 1; }
    if (!correct) misses.push({ key: r.item.key, gold: r.gold, value: r.v, confidence: Number(confidence.toFixed(3)), note: r.item.compare?.gold?.note || null });
  }
  const ratio = (a, b) => b ? Number((a / b).toFixed(3)) : null;
  return {
    labeled: rows.length,
    accuracy: ratio(confusion.tp + confusion.tn, rows.length),
    confusion,
    precision: ratio(confusion.tp, confusion.tp + confusion.fp),
    recall: ratio(confusion.tp, confusion.tp + confusion.fn),
    byConfidence: bins.map(b => ({ range: b.label, n: b.n, accuracy: ratio(b.correct, b.n) })),
    misses: misses.sort((a, b) => b.confidence - a.confidence).slice(0, 15)
  };
}

// 반복 실행(repeats > 1) 집계: 항목별로 예/아니오·점수는 평균, 선택형은 최빈값. agreement = 최빈 답 비율(0~1).
function aggregateRepeats(def, ok) {
  const byKey = new Map();
  for (const entry of ok) { if (!byKey.has(entry.key)) byKey.set(entry.key, []); byKey.get(entry.key).push(entry); }
  const aggregated = [];
  const stability = [];
  for (const [key, list] of byKey) {
    const first = list[0];
    const jev = {};
    let minAgreement = 1;
    for (const [name, q] of Object.entries(def.questions)) {
      const answers = list.map(e => e.jev?.[name]).filter(a => a && a.value !== null && a.value !== undefined);
      if (!answers.length) { jev[name] = { value: null }; continue; }
      if (q.type === 'choice') {
        const counts = {};
        for (const a of answers) counts[a.value] = (counts[a.value] || 0) + 1;
        const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        const agreement = n / answers.length;
        minAgreement = Math.min(minAgreement, agreement);
        jev[name] = { value: top, confidence: Number(agreement.toFixed(3)), votes: counts, n: answers.length };
      } else {
        const values = answers.map(a => Number(a.value)).filter(Number.isFinite);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
        const agreement = q.type === 'noul' ? Math.max(values.filter(v => v >= 0.5).length, values.filter(v => v < 0.5).length) / values.length : null;
        if (agreement != null) minAgreement = Math.min(minAgreement, agreement);
        jev[name] = { value: Number(mean.toFixed(3)), confidence: agreement != null ? Number(agreement.toFixed(3)) : null, sd: Number(sd.toFixed(3)), n: values.length };
      }
    }
    aggregated.push({ key, state: first.state, compare: first.compare, jev, reps: list.length });
    stability.push({ key, reps: list.length, minAgreement: Number(minAgreement.toFixed(3)) });
  }
  const meanAgreement = stability.length ? Number((stability.reduce((a, s) => a + s.minAgreement, 0) / stability.length).toFixed(3)) : null;
  return { aggregated, repeatStats: { repeats: def.repeats, calls: ok.length, itemsAggregated: aggregated.length, meanAgreement, unstable: stability.filter(s => s.minAgreement < 0.8).sort((a, b) => a.minAgreement - b.minAgreement).slice(0, 15) } };
}

function summarizeCustom(def, results) {
  let ok = results.filter(item => item.jev);
  const summary = { label: def.label || def.id, source: def.source, items: results.length, answered: ok.length, errors: results.length - ok.length, questions: {} };
  if ((def.repeats || 1) > 1) {
    const { aggregated, repeatStats } = aggregateRepeats(def, ok);
    ok = aggregated;
    summary.repeatStats = repeatStats;
    summary.note = `같은 항목을 ${def.repeats}번 물어 항목별로 합쳤습니다(예/아니오·점수는 평균, 선택형은 최빈값). confidence 칸은 답이 일치한 비율입니다.`;
  }
  const groupOf = item => item.compare?.rule?.action || item.compare?.rule?.intent || null;
  const outcomeOf = item => item.compare?.outcome ? (item.compare.outcome.customerReplied || item.compare.outcome.hired ? 'replied_or_hired' : 'no_reply') : null;
  for (const [name, q] of Object.entries(def.questions)) {
    const answers = ok.map(item => ({ item, a: item.jev[name] })).filter(x => x.a && x.a.value !== null && x.a.value !== undefined);
    const out = { type: q.type, answered: answers.length };
    if (q.type === 'choice') {
      out.distribution = {};
      out.byRule = {};
      out.byOutcome = {};
      for (const { item, a } of answers) {
        out.distribution[a.value] = (out.distribution[a.value] || 0) + 1;
        const g = groupOf(item); if (g) { out.byRule[g] = out.byRule[g] || {}; out.byRule[g][a.value] = (out.byRule[g][a.value] || 0) + 1; }
        const o = outcomeOf(item); if (o) { out.byOutcome[o] = out.byOutcome[o] || {}; out.byOutcome[o][a.value] = (out.byOutcome[o][a.value] || 0) + 1; }
      }
      const conf = answers.map(x => Number(x.a.confidence)).filter(Number.isFinite);
      out.meanConfidence = conf.length ? Number((conf.reduce((a, b) => a + b, 0) / conf.length).toFixed(3)) : null;
      out.lowConfidence = conf.filter(c => c < 0.6).length;
    } else {
      const values = answers.map(x => Number(x.a.value)).filter(Number.isFinite);
      const mean = list => list.length ? Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(3)) : null;
      out.mean = mean(values);
      if (q.type === 'noul') out.trueRate = values.length ? Number((values.filter(v => v >= 0.5).length / values.length).toFixed(3)) : null;
      out.byOutcome = {};
      out.byRule = {};
      for (const key of ['replied_or_hired', 'no_reply']) { const v = answers.filter(x => outcomeOf(x.item) === key).map(x => Number(x.a.value)).filter(Number.isFinite); if (v.length) out.byOutcome[key] = { n: v.length, mean: mean(v) }; }
      const groups = [...new Set(answers.map(x => groupOf(x.item)).filter(Boolean))];
      for (const g of groups) { const v = answers.filter(x => groupOf(x.item) === g).map(x => Number(x.a.value)).filter(Number.isFinite); out.byRule[g] = { n: v.length, mean: mean(v) }; }
    }
    // 판단이 약한 예시: 선택형은 확신 낮은 순, 점수·예아니오는 가장 낮은 값 순. 가림 처리된 글 앞부분만 보인다.
    const sorted = [...answers].sort((x, y) => q.type === 'choice' ? Number(x.a.confidence ?? 1) - Number(y.a.confidence ?? 1) : Number(x.a.value) - Number(y.a.value));
    out.examples = sorted.slice(0, 8).map(({ item, a }) => {
      const head = String(item.state.message || item.state.quote_message || item.state.request || item.state.srt_block || item.state.claim || item.state.original || '').replace(/\s+/g, ' ').slice(0, 140);
      const text = item.state.bot_reply ? `${head} ⇒ ${String(item.state.bot_reply).replace(/\s+/g, ' ').slice(0, 140)}` : head;
      return { key: item.key, answer: a.value, confidence: a.confidence ?? null, rule: groupOf(item), outcome: outcomeOf(item), text };
    });
    const gold = goldComparison(name, q, answers);
    if (gold) out.gold = gold;
    summary.questions[name] = out;
  }
  const small = ok.filter(item => outcomeOf(item) === 'replied_or_hired').length;
  if (ok.some(item => outcomeOf(item))) summary.caution = small < 20 ? `답장·고용 기록이 ${small}건뿐이라 결과 기준 비교는 참고용입니다.` : null;
  return summary;
}

function simDir(dataDir) { return path.join(dataDir, 'jev-sim'); }

function callsToday(dataDir, now = Date.now()) {
  const dir = simDir(dataDir);
  if (!fs.existsSync(dir)) return 0;
  const today = kstDay(now);
  let total = 0;
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
    try { const run = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); if (String(run.day) === today) total += Number(run.cost?.calls || 0); } catch (_) {}
  }
  return total;
}

// 한국 시간(Asia/Seoul, UTC+9, 서머타임 없음) 기준 날짜와 다음 0시.
const KST_OFFSET_MS = 9 * 3600 * 1000;
function kstDay(now = Date.now()) { return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10); }
function nextKstMidnight(now = Date.now()) {
  const d = new Date(now + KST_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - KST_OFFSET_MS).toISOString();
}

function tokensToday(dataDir, now = Date.now()) {
  const dir = simDir(dataDir);
  if (!fs.existsSync(dir)) return 0;
  const today = kstDay(now);
  let total = 0;
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
    try { const run = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); if (String(run.day) === today) total += Number(run.cost?.inputTokens || 0); } catch (_) {}
  }
  return total;
}

function assertLimits(limits) {
  const daily = Number(limits?.dailyInputTokens);
  const runMax = Number(limits?.runMaxCalls);
  if (!(daily > 0) || !(runMax > 0)) { const error = new Error('jev_limits_missing'); error.status = 500; throw error; }
  const price = Number(limits.usdPerMillionInputTokens) > 0 ? Number(limits.usdPerMillionInputTokens) : PRICE_USD_PER_MTOK;
  const krwPerUsd = Number(limits.krwPerUsd) > 0 ? Number(limits.krwPerUsd) : null;
  return { dailyInputTokens: daily, runMaxCalls: runMax, price, krwPerUsd, dailyBudgetKrw: Number(limits.dailyBudgetKrw) || null };
}

function limitStatus(dataDir, limits, now = Date.now()) {
  const { dailyInputTokens, runMaxCalls, price, krwPerUsd, dailyBudgetKrw } = assertLimits(limits);
  const used = tokensToday(dataDir, now);
  const krw = tokens => krwPerUsd ? Math.round(tokens * price / 1e6 * krwPerUsd) : null;
  return { day: kstDay(now), timezone: 'Asia/Seoul', dailyBudgetKrw, krwPerUsd, spentKrwToday: krw(used), remainingKrw: dailyBudgetKrw != null && krwPerUsd ? Math.max(0, dailyBudgetKrw - krw(used)) : null, dailyInputTokens, tokensToday: used, remainingTokens: Math.max(0, dailyInputTokens - used), capReached: used >= dailyInputTokens, runMaxCalls, resetsAt: nextKstMidnight(now), usdPerMillionInputTokens: price };
}

// 품질 실험 등록 목록(실행하지 않음). 서버 설정 파일에서 읽고, 설계 검사를 통과한 것만 돌려준다.
function readPresets({ runMaxCalls = null } = {}) {
  if (!fs.existsSync(PRESETS_FILE)) return { tag: null, experiments: [] };
  const raw = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
  const experiments = (Array.isArray(raw.experiments) ? raw.experiments : []).map(def => ({ ...def, tag: raw.tag, operational: false, problems: validateCustomExperiment(def, { runMaxCalls }) }));
  return { tag: raw.tag || null, note: raw.note || null, experiments };
}

function listRuns(dataDir) {
  const dir = simDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => file.endsWith('.json')).map(name => {
    try { const run = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); return { id: run.id, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, experiments: run.experiments, cost: run.cost }; } catch (_) { return null; }
  }).filter(Boolean).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

function readRun(dataDir, id) {
  const file = path.join(simDir(dataDir), `${String(id).replace(/[^A-Za-z0-9_-]/g, '')}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

const activeRuns = new Set();

// 시뮬레이션 시작. 즉시 run 요약을 돌려주고, 호출은 뒤에서 진행한다.
function startSimulation({ dataDir, state, deps, getKey, fetchImpl = global.fetch, custom = [], experiments = custom.length ? [] : Object.keys(EXPERIMENTS), limits, maxCalls, concurrency = 4, now = Date.now(), resumeFrom = null }) {
  const { dailyInputTokens, runMaxCalls, price, krwPerUsd } = assertLimits(limits);
  // 이어 돌리기(2026-09-22 준희 지시): 서버 재시작 등으로 끊긴 실행을 이어서 돈다.
  // 끊긴 실행의 실험·설계를 그대로 쓰고, 이미 답을 받은 항목(같은 실험·key·rep)은 다시 호출하지 않는다.
  let previous = null;
  if (resumeFrom) {
    previous = readRun(dataDir, resumeFrom);
    if (!previous) { const error = new Error('jev_resume_run_not_found'); error.status = 404; throw error; }
    if (previous.status === 'completed') { const error = new Error('jev_resume_run_already_completed'); error.status = 409; throw error; }
    if (previous.resumedBy) { const error = new Error('jev_resume_run_already_resumed'); error.status = 409; error.detail = { resumedBy: previous.resumedBy }; throw error; }
    custom = Object.entries(previous.customDefinitions || {}).map(([name, def]) => ({ ...def, id: def.id || name.replace(/^custom:/, '') }));
    experiments = (previous.experiments || []).filter(name => !String(name).startsWith('custom:'));
  }
  const key = String(getKey() || '').trim();
  if (!key) { const error = new Error('jev_key_missing'); error.status = 412; throw error; }
  if (activeRuns.size) { const error = new Error('jev_simulation_running'); error.status = 409; throw error; }
  const customDefs = {};
  if (!Array.isArray(custom)) custom = [];
  if (custom.length > CUSTOM_LIMITS.maxExperiments) { const error = new Error(`custom_experiments_max_${CUSTOM_LIMITS.maxExperiments}`); error.status = 400; throw error; }
  for (const def of custom) {
    const problems = validateCustomExperiment(def, { runMaxCalls });
    if (problems.length) { const error = new Error('custom_experiment_invalid'); error.status = 400; error.detail = { id: def?.id || null, problems }; throw error; }
    customDefs[`custom:${def.id}`] = { label: String(def.label || def.id).slice(0, 80), source: def.source, filter: def.filter || {}, sampleLimit: def.sampleLimit || null, repeats: Math.max(1, Number(def.repeats) || 1), id: def.id, questions: def.questions, custom: true };
  }
  const defs = { ...EXPERIMENTS, ...customDefs };
  const chosen = [...experiments.filter(name => EXPERIMENTS[name]), ...Object.keys(customDefs)];
  if (!chosen.length) { const error = new Error('no_valid_experiment'); error.status = 400; throw error; }
  const tokensBefore = tokensToday(dataDir, now);
  const remainingTokens = dailyInputTokens - tokensBefore;
  if (remainingTokens <= 0) { const error = new Error('jev_daily_token_cap_reached'); error.status = 429; error.detail = { tokensToday: tokensBefore, dailyInputTokens, resetsAt: nextKstMidnight(now) }; throw error; }
  const budget = Math.max(1, Math.min(runMaxCalls, Number(maxCalls) || runMaxCalls));
  const queue = [];
  const counts = {};
  for (const name of chosen) {
    const items = customDefs[name] ? customItems(state, customDefs[name], deps) : buildItems(state, name, deps);
    const repeats = customDefs[name]?.repeats || 1;
    counts[name] = items.length * repeats;
    // repeats > 1이면 같은 항목을 rep 번호만 바꿔 여러 번 넣는다. 한 항목의 반복이 몰리지 않게 회차 순으로 섞는다.
    for (let rep = 0; rep < repeats; rep += 1) for (const item of items) queue.push({ experiment: name, ...item, rep });
  }
  const doneKey = (experiment, key, rep) => `${experiment}|${key}|${rep ?? 0}`;
  const carried = {};
  const done = new Set();
  if (previous) {
    for (const [name, entries] of Object.entries(previous.results || {})) {
      for (const entry of entries) {
        if (!entry || entry.error || !entry.jev) continue;
        const k = doneKey(name, entry.key, entry.rep);
        if (done.has(k)) continue;
        done.add(k);
        (carried[name] = carried[name] || []).push(entry);
      }
    }
  }
  const remainingQueue = previous ? queue.filter(item => !done.has(doneKey(item.experiment, item.key, item.rep))) : queue;
  const planned = remainingQueue.slice(0, budget);
  const id = `JEVSIM-${new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const run = {
    id, status: 'running', day: kstDay(now), startedAt: new Date(now).toISOString(), finishedAt: null,
    experiments: chosen, customDefinitions: Object.fromEntries(Object.entries(customDefs).map(([k, v]) => [k, { label: v.label, source: v.source, filter: v.filter, sampleLimit: v.sampleLimit, repeats: v.repeats || 1, questions: v.questions }])), available: counts, planned: planned.length, skippedByCap: queue.length - planned.length,
    limits: { maxCalls: budget, runMaxCalls, dailyInputTokens, tokensTodayBefore: tokensBefore, remainingTokensAtStart: remainingTokens, resetsAt: nextKstMidnight(now) },
    cost: { calls: 0, inputTokens: 0, usd: 0 }, stopReason: null, results: carried, summary: {},
    ...(previous ? { resumedFrom: previous.id, carriedOver: done.size, previousCost: previous.cost || null } : {})
  };
  fs.mkdirSync(simDir(dataDir), { recursive: true });
  const file = path.join(simDir(dataDir), `${id}.json`);
  const save = () => fs.writeFileSync(file, JSON.stringify(run, null, 2));
  save();
  if (previous) {
    // 끊긴 실행은 '중단됨'으로 바꾸고 어디서 이어졌는지 남긴다(결과는 새 실행에 옮겨 담았다).
    previous.status = 'interrupted';
    previous.stopReason = previous.stopReason || 'server_restart_or_crash';
    previous.resumedBy = id;
    try { fs.writeFileSync(path.join(simDir(dataDir), `${previous.id}.json`), JSON.stringify(previous, null, 2)); } catch (_) {}
  }
  activeRuns.add(id);
  (async () => {
    let index = 0;
    let stop = false;
    let consecutiveErrors = 0;
    // 하루 토큰 한도: 응답 전인 호출마다 max(추정치, 지금까지 본 1회 최대 사용량)을 미리 잡아 두고,
    // 잡아 둔 양까지 합쳐 남은 토큰을 넘으면 새 호출을 하지 않는다. 첫 호출은 혼자 보내 실제 사용량을 먼저 본다.
    let inFlight = 0;
    let maxSeen = 0;
    const worker = async (single = false) => {
      while (!stop && index < planned.length) {
        const item = planned[index];
        const questions = defs[item.experiment].questions;
        const reserve = Math.max(estimateTokens({ state: item.state, questions }), maxSeen);
        if (run.cost.inputTokens + inFlight + reserve > remainingTokens) { stop = true; run.stopReason = run.stopReason || 'daily_token_cap'; break; }
        index += 1;
        const estimate = reserve;
        inFlight += estimate;
        run.cost.calls += 1;
        const entry = { key: item.key, state: item.state, compare: item.compare, ...(item.rep != null && defs[item.experiment].repeats > 1 ? { rep: item.rep } : {}) };
        try {
          const body = await callJev({ key, questions, state: item.state, fetchImpl }).finally(() => { inFlight -= estimate; });
          const tokens = Number(body.usage?.input_tokens || estimate);
          maxSeen = Math.max(maxSeen, tokens);
          run.cost.inputTokens += tokens;
          entry.jev = Object.fromEntries(Object.keys(questions).map(q => [q, answerValue(body.answers?.[q] || body[q])]));
          entry.model = body.model || null;
          consecutiveErrors = 0;
        } catch (error) {
          run.cost.inputTokens += estimate;
          entry.error = { message: error.message, status: error.status || null, detail: error.detail || null };
          consecutiveErrors += 1;
          // 키 오류·검증 오류가 반복되면 호출을 멈춘다(돈·시간 낭비 방지).
          if ([401, 403].includes(error.status) || consecutiveErrors >= 5) { stop = true; run.stopReason = `stopped_after_errors:${error.message}`; }
          if (error.status === 429 || error.status === 529) await new Promise(resolve => setTimeout(resolve, 3000));
        }
        run.cost.usd = Number((run.cost.inputTokens * price / 1e6).toFixed(6));
        if (krwPerUsd) run.cost.krw = Math.round(run.cost.usd * krwPerUsd);
        (run.results[item.experiment] = run.results[item.experiment] || []).push(entry);
        if (run.cost.calls % 20 === 0) save();
        if (single) break;
      }
    };
    try {
      await worker(true);
      await Promise.all(Array.from({ length: Math.max(1, Math.min(8, concurrency)) }, () => worker()));
      for (const name of chosen) run.summary[name] = customDefs[name] ? summarizeCustom(customDefs[name], run.results[name] || []) : summarize(name, run.results[name] || []);
      // 같은 요청의 예전 문구와 지금 문구 점수를 짝지어 비교한다.
      if (run.results.quote_copy && run.results.quote_copy_current) {
        const old = new Map(run.results.quote_copy.filter(item => item.jev).map(item => [item.key, item.jev]));
        const pairs = run.results.quote_copy_current.filter(item => item.jev && old.has(item.key)).map(item => ({ key: item.key, before: old.get(item.key), after: item.jev }));
        const avg = (list, pick) => { const v = list.map(pick).filter(Number.isFinite); return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)) : null; };
        run.summary.quote_copy_paired = {
          pairs: pairs.length,
          sincere: { before: avg(pairs, p => Number(p.before.sincere?.value)), after: avg(pairs, p => Number(p.after.sincere?.value)) },
          restatesRequest: { before: avg(pairs, p => Number(p.before.restates_request?.value)), after: avg(pairs, p => Number(p.after.restates_request?.value)) },
          clearPriceScope: { before: avg(pairs, p => Number(p.before.clear_price_scope?.value >= 0.5)), after: avg(pairs, p => Number(p.after.clear_price_scope?.value >= 0.5)) },
          asksUsefulQuestion: { before: avg(pairs, p => Number(p.before.asks_useful_question?.value >= 0.5)), after: avg(pairs, p => Number(p.after.asks_useful_question?.value >= 0.5)) },
          improved: pairs.filter(p => Number(p.after.sincere?.value) > Number(p.before.sincere?.value)).length,
          worse: pairs.filter(p => Number(p.after.sincere?.value) < Number(p.before.sincere?.value)).length
        };
      }
      run.status = run.stopReason && (run.stopReason.startsWith('stopped_after_errors') || run.stopReason === 'daily_token_cap') ? 'stopped' : 'completed';
      run.skippedByDailyCap = run.stopReason === 'daily_token_cap' ? planned.length - run.cost.calls : 0;
    } catch (error) {
      run.status = 'failed';
      run.stopReason = run.stopReason || error.message;
    } finally {
      run.finishedAt = new Date().toISOString();
      save();
      activeRuns.delete(id);
    }
  })();
  return { id, status: run.status, planned: run.planned, available: counts, skippedByCap: run.skippedByCap, limits: run.limits, ...(previous ? { resumedFrom: previous.id, carriedOver: done.size } : {}) };
}

module.exports = { callJev, dropRepeated, REPEATED_TEXT_MIN, CUSTOM_SOURCES, CUSTOM_LIMITS, QUALITY_SOURCE_PREFIX, PRESETS_FILE, validateCustomExperiment, summarizeCustom, goldComparison, customItems, EXPERIMENTS, JEV_URL, PRICE_USD_PER_MTOK, tokensToday, limitStatus, readPresets, kstDay, nextKstMidnight, buildItems, summarize, startSimulation, listRuns, readRun, callsToday, requestTextForJev, redact, ruleIntentFromReply, activeRuns };
