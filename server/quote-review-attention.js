'use strict';

// 견적봇이 '사람 확인 필요(manualReview)'로 건너뛴 숨고 요청을 알림 목록에 올린다(2026-09-21).
// - 같은 requestId는 한 번만 등록한다. 봇이 다시 열면 마지막 확인 시각·고수 수만 갱신한다.
// - 고객 이름·연락처·요청 원문은 저장하지 않는다. 카테고리·서비스·분량·기한 요약만 둔다.
// - 닫는 경로: 담당자(/api/attention/resolve), 발송 확인, 10명 마감, 오래 안 보임(삭제 추정).

const MAX_PROS = 10;
const URGENT_PROS = 8;
const URGENT_AGE_MS = 12 * 60 * 60 * 1000;
const NOT_SEEN_CLOSE_MS = 3 * 60 * 60 * 1000;

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

function prosQuoted(text = '') {
  const match = String(text).match(/견적\s*보낸\s*고수\s*(\d{1,2})\s*명/);
  return match ? Number(match[1]) : null;
}

function deadlineHint(request = {}) {
  if (clean(request.deadline)) return clean(request.deadline).slice(0, 40);
  const line = String(request.text || '').split('\n').map(clean)
    .find(item => /(?:진행하고\s*싶어요|이내|까지|협의|급해요|오늘|내일)/.test(item) && item.length <= 40 && !/고수|가입|신고/.test(item));
  return line || '';
}

// 숨고 요청서의 '예산' 항목(라벨 다음 줄 또는 같은 줄)을 읽는다. 없으면 빈 값.
function budgetHint(request = {}) {
  if (clean(request.budget)) return clean(request.budget).slice(0, 40);
  const lines = String(request.text || '').split('\n').map(clean).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const same = lines[i].match(/^(?:희망\s*)?(?:예산|비용|금액)\s*[:：]?\s*(.+)$/);
    if (same && /\d|협의|미정|상관|없음/.test(same[1])) return same[1].slice(0, 40);
    if (/^(?:희망\s*)?(?:예산|비용|금액)$/.test(lines[i]) && lines[i + 1] && /\d|협의|미정|상관|없음|정하지/.test(lines[i + 1]) && lines[i + 1].length <= 40) return lines[i + 1];
  }
  return '';
}

function summaryFor(request = {}, quote = {}) {
  const parts = [
    quote.label ? `서버 분류: ${quote.label}` : '',
    clean(request.scope) ? `희망: ${clean(request.scope).slice(0, 40)}` : '',
    clean(request.volume) ? `분량: ${clean(request.volume).slice(0, 60)}` : '',
    deadlineHint(request) ? `기한: ${deadlineHint(request)}` : '',
    `예산: ${budgetHint(request) || '미기재'}`
  ].filter(Boolean);
  return parts.join(' · ').slice(0, 260);
}

function list(state) {
  if (!Array.isArray(state.attentionItems)) state.attentionItems = [];
  return state.attentionItems;
}

function findReview(state, requestId) {
  return list(state).find(item => item.type === 'quote_review' && item.requestId === String(requestId || ''));
}

function closeReview(item, { resolution, note = '', by = 'system', at = new Date().toISOString() }) {
  if (!item || item.status !== 'open') return false;
  item.status = 'resolved';
  item.resolution = String(resolution || 'resolved').slice(0, 60);
  item.resolutionNote = String(note || '').slice(0, 200);
  item.resolvedBy = by;
  item.resolvedAt = at;
  return true;
}

// 견적 계산 결과가 사람 확인이면 등록한다. 반환값 changed=true면 state를 저장해야 한다.
function upsertQuoteReview(state, { requestId, request = {}, quote = {}, receivedAt, supported = true, now = new Date() }) {
  if (!requestId || quote.manualReview !== true || quote.deleteRequest === true) return { changed: false };
  const nowIso = now.toISOString();
  const pros = prosQuoted(request.text);
  let item = findReview(state, requestId);
  let created = false;
  if (!item) {
    // 외국어 교정 등 판매 여부 미정 건은 계산가를 보여주지 않는다(금액 미정).
    const amount = supported && !quote.foreignLanguage && Number(quote.amount) > 0 ? Number(quote.amount) : null;
    item = {
      id: `ATTN-Q-${requestId}`,
      type: 'quote_review',
      requestId: String(requestId),
      receivedAt: receivedAt || nowIso,
      category: clean(request.purpose).slice(0, 40) || '미확인',
      summary: summaryFor(request, quote),
      budget: budgetHint(request) || null,
      serviceId: quote.serviceId || null,
      reason: String(quote.reason || '사람 확인 필요').slice(0, 300),
      amount,
      amountLabel: amount ? `${amount.toLocaleString('ko-KR')}원` : '금액 미정',
      prosQuoted: pros,
      prosUrgentAt: null,
      status: 'open',
      createdAt: nowIso,
      lastSeenAt: nowIso,
      seenCount: 1
    };
    list(state).unshift(item);
    state.attentionItems = list(state).slice(0, 500);
    created = true;
  } else {
    item.lastSeenAt = nowIso;
    item.seenCount = Number(item.seenCount || 0) + 1;
    if (pros !== null) item.prosQuoted = pros;
  }
  if (item.prosQuoted !== null && item.prosQuoted >= URGENT_PROS && !item.prosUrgentAt) item.prosUrgentAt = nowIso;
  if (item.prosQuoted !== null && item.prosQuoted >= MAX_PROS) closeReview(item, { resolution: 'quote_closed_10', note: `견적 고수 ${item.prosQuoted}/${MAX_PROS} 마감`, at: nowIso });
  return { changed: true, created, item };
}

// 봇 발송 결과로 닫는다(발송 확인, 10명 마감 팝업).
function closeFromQuoteResult(state, requestId, status, note = '') {
  const item = findReview(state, requestId);
  if (!item || item.status !== 'open') return false;
  if (status === 'sent') return closeReview(item, { resolution: 'quote_sent', note: '숨고 견적 발송 확인' });
  if (/10\s*명|10개/.test(note) && /마감|발송할\s*수\s*없/.test(note)) return closeReview(item, { resolution: 'quote_closed_10', note: '숨고 10명 견적 마감' });
  return false;
}

// 담당자 처리. resolution: manual_quote_sent | skip | other
function resolveReview(state, { requestId, id, resolution, note }) {
  const item = list(state).find(entry => entry.type === 'quote_review' && ((requestId && entry.requestId === String(requestId)) || (id && entry.id === String(id))));
  if (!item) return { ok: false, error: 'attention_item_not_found' };
  if (item.status !== 'open') return { ok: true, alreadyResolved: true, item };
  const allowed = ['manual_quote_sent', 'skip', 'other'];
  closeReview(item, { resolution: allowed.includes(resolution) ? resolution : 'other', note, by: 'owner' });
  return { ok: true, item };
}

// 요청봇이 살아 있는데 3시간 넘게 이 요청을 다시 열지 않았으면 숨고에서 사라진 것으로 본다[추정].
function autoCloseStale(state, { now = new Date(), requestBotAlive = false } = {}) {
  if (!requestBotAlive) return 0;
  let closed = 0;
  for (const item of list(state)) {
    if (item.type !== 'quote_review' || item.status !== 'open') continue;
    const seen = Date.parse(item.lastSeenAt || item.createdAt || '') || 0;
    if (now.getTime() - seen > NOT_SEEN_CLOSE_MS && closeReview(item, { resolution: 'request_gone_suspected', note: '요청봇이 3시간 넘게 이 요청을 보지 못함 · 숨고 목록에서 사라진 것으로 추정', at: now.toISOString() })) closed += 1;
  }
  return closed;
}

function urgency(item, now = new Date()) {
  const reasons = [];
  let urgentAt = null;
  if (item.prosQuoted !== null && item.prosQuoted >= URGENT_PROS) { reasons.push(`견적 고수 ${item.prosQuoted}/${MAX_PROS}`); urgentAt = item.prosUrgentAt; }
  const received = Date.parse(item.receivedAt || item.createdAt || '') || now.getTime();
  if (now.getTime() - received >= URGENT_AGE_MS) {
    reasons.push('접수 후 12시간 경과');
    const ageAt = new Date(received + URGENT_AGE_MS).toISOString();
    if (!urgentAt || ageAt < urgentAt) urgentAt = ageAt;
  }
  return { urgent: reasons.length > 0, urgentReasons: reasons, urgentAt };
}

function attentionView(item, now = new Date()) {
  const u = urgency(item, now);
  return {
    type: 'quote_review', kind: 'quote_review', id: item.id, requestId: item.requestId,
    at: item.createdAt, receivedAt: item.receivedAt, category: item.category, summary: item.summary, budget: item.budget || '미기재',
    pros: item.prosQuoted === null || item.prosQuoted === undefined ? '미확인' : `${item.prosQuoted}/${MAX_PROS}`,
    reason: item.reason, amount: item.amount, amountLabel: item.amountLabel,
    urgent: u.urgent, urgentReasons: u.urgentReasons, urgentAt: u.urgentAt,
    link: /^[A-Za-z0-9_-]{6,}$/.test(item.requestId) ? `https://soomgo.com/requests/received/${item.requestId}` : ''
  };
}

// 알림방용: 새로 등록됐거나 이번 창 안에서 긴급이 된 열린 항목만 items에, 열린 항목 전체는 open에.
function quoteReviewAttention(state, { sinceMs, now = new Date() }) {
  const open = list(state).filter(item => item.type === 'quote_review' && item.status === 'open').map(item => attentionView(item, now));
  const fresh = open.filter(view => (Date.parse(view.at || '') || 0) >= sinceMs || (view.urgentAt && Date.parse(view.urgentAt) >= sinceMs));
  return { fresh, open };
}

module.exports = { prosQuoted, deadlineHint, budgetHint, summaryFor, upsertQuoteReview, closeFromQuoteResult, resolveReview, autoCloseStale, urgency, attentionView, quoteReviewAttention, MAX_PROS, URGENT_PROS };
