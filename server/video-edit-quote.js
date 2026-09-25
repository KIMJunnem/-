'use strict';

// 영상 편집 견적 계산 (2026-09-24 개발방 지시 16, decisions.md 7-4 준희 승인).
// 가격·범위·문장의 원본은 services/video_edit.json이다. 이 모듈은 계산만 한다.
// 자동 발송 없음: 숨고 자동 규칙(soomgo-auto-rules)이 영상 편집 요청을 retain_review(autoSend false)로 두고,
// 여기서 만든 값은 준희 알림·수동 발송용으로만 붙인다. 외부 호출 없음.

const fs = require('node:fs');
const path = require('node:path');
const { quoteRequestIntro } = require('./pricing-table');

const DEFINITION_PATH = path.join(__dirname, '..', 'services', 'video_edit.json');

function loadDefinition() {
  try { return JSON.parse(fs.readFileSync(DEFINITION_PATH, 'utf8')); } catch (_) { return null; }
}
const DEFINITION = loadDefinition();

// 요청서 본문은 앞부분만 본다. 숨고 상세 화면 아래쪽의 '최근 작성한 견적' 예시·다른 카드 글자로 오판하지 않게 자른다(제브 시뮬레이션 9/21 교훈).
const requestHead = (parsed = {}) => String(parsed.text || '').split(/최근\s*작성한\s*견적|자세히\s*보기|견적\s*보낸\s*고수\s*목록/)[0].slice(0, 1500);
const fieldText = (parsed = {}) => [parsed.purpose, parsed.topic, parsed.volume, parsed.scope, parsed.notes, parsed.format, requestHead(parsed)].filter(Boolean).join(' ');

// 원본 길이(분). 요청서 칸(분량·주제·범위·메모)만 본다. 없으면 null(추정하지 않는다).
// 9/24 지시 24: "1시간 30분"은 더해서 90분, "30분~1시간"·"1~2시간"처럼 구간이면 최댓값(60분·120분).
// 숨고 폼의 '원본 길이' 답(예: "5분 이내", "2시간 이내")은 volume에 들어온다 — 값이 있으면 그 칸만 본다('희망 길이'와 섞지 않게).
const DURATION = /(\d+(?:\.\d+)?)\s*시간(?:\s*(\d+(?:\.\d+)?)\s*분)?|(\d+(?:\.\d+)?)\s*분/g;
function durations(text) {
  return [...String(text || '').matchAll(DURATION)].map(m => Math.round(m[1] !== undefined ? Number(m[1]) * 60 + Number(m[2] || 0) : Number(m[3]))).filter(n => n > 0);
}
function sourceMinutes(parsed = {}) {
  const own = durations(parsed.volume);
  const list = own.length ? own : durations([parsed.topic, parsed.scope, parsed.notes].filter(Boolean).join(' '));
  return list.length ? Math.max(...list) : null;
}
// "1시간 이상"처럼 끝이 열린 길이(최댓값을 알 수 없음)
function sourceLengthOpenEnded(parsed = {}) {
  const text = durations(parsed.volume).length ? parsed.volume : [parsed.topic, parsed.scope, parsed.notes].filter(Boolean).join(' ');
  return /\d\s*(?:시간|분)\s*(?:이상|초과|넘)/.test(String(text || ''));
}
// 끝이 열린 길이의 아래 끝(분). "1시간 이상" → 60
function openEndedLowerMinutes(parsed = {}) {
  const text = durations(parsed.volume).length ? parsed.volume : [parsed.topic, parsed.scope, parsed.notes].filter(Boolean).join(' ');
  const m = String(text || '').match(/((?:\d+(?:\.\d+)?\s*시간(?:\s*\d+\s*분)?)|(?:\d+(?:\.\d+)?\s*분))\s*(?:이상|초과|넘)/);
  return m ? (durations(m[1])[0] || null) : null;
}

function fee(id) { return (DEFINITION?.pricing?.additionalFees || []).find(item => item.id === id) || null; }
const round1000 = value => Math.round(Number(value || 0) / 1000) * 1000;

function detectOptions(parsed = {}) {
  const text = fieldText(parsed);
  const has = id => { const pattern = fee(id)?.match; return Boolean(pattern && new RegExp(pattern, 'i').test(text)); };
  const translationExcluded = /번역\s*(?:제외|불필요)|번역은\s*필요\s*없/.test(text);
  return {
    shorts: new RegExp(DEFINITION?.pricing?.shorts?.match || '(?!)', 'i').test(text),
    translation: has('translation') && !translationExcluded,
    bgm: has('bgm'),
    color: has('color')
  };
}

// 반환: { serviceId, label, amount|null, days|null, revisions, minutes, options, scopeCheck|null, message, quoteMessageId, quoteMessageVersion }
function videoEditQuote(parsed = {}) {
  const def = DEFINITION;
  if (!def) return null;
  const minutes = sourceMinutes(parsed);
  const options = detectOptions(parsed);
  const revisions = Number(def.includedRevisions || 2);
  const copy = def.quoteCopy || {};
  const intro = quoteRequestIntro(parsed, def.label);
  const base = { serviceId: def.id, label: def.label, revisions, minutes, options, quoteMessageId: `${def.id}.quote.${def.quoteMessageVersion}`, quoteMessageVersion: def.quoteMessageVersion };

  let amount = null; let days = null; let scopeCheck = null; let workLine = copy.workLine;
  const shorts = def.pricing.shorts;
  if (options.shorts) {
    if (minutes !== null && minutes > Number(shorts.maxSourceMinutes)) scopeCheck = 'shorts_long_source';
    else { amount = Number(shorts.saleAmount); days = shorts.days; workLine = copy.shortsWorkLine; }
  } else if (minutes === null) {
    // 9/25 준희: 식전영상처럼 원본 길이로 정해지지 않는 요청은 "자료 보고 확정"으로 시작가를 보낸다.
    const materials = def.pricing.materials;
    if (materials) {
      const photo = new RegExp(materials.photoMatch || '(?!)', 'i').test(fieldText(parsed));
      amount = Number(photo ? materials.photoAmount : materials.generalAmount);
      days = photo ? materials.photoDays : materials.generalDays;
      base.materialsBased = photo ? 'photo' : 'general';
    } else {
      scopeCheck = 'length_unknown';
    }
  } else {
    const rule = def.pricing.packages.find(item => (item.when.minutesLte === undefined || minutes <= item.when.minutesLte) && (item.when.minutesGt === undefined || minutes > item.when.minutesGt));
    amount = Number(rule.saleAmount) + (rule.unit ? Math.ceil((minutes - Number(rule.when.minutesGt)) / Number(rule.unit.sizeMinutes)) * Number(rule.unit.saleAmount) : 0);
    days = rule.days || null;
  }
  if (amount !== null && !base.materialsBased) {
    if (options.translation) amount = round1000(amount * (1 + Number(fee('translation').rate)));
    if (options.bgm) amount += Number(fee('bgm').amount);
    if (options.color) amount += Number(fee('color').amount);
    // 금액 상한(decisions 7-4, 준희 9/24): 원본이 길어도·옵션을 더해도 cap.saleAmount를 넘기지 않는다. 원본 cap.fromMinutes분 이상은 납기도 cap.days.
    const cap = def.pricing.cap;
    if (cap && Number(cap.saleAmount) > 0) {
      if (amount > Number(cap.saleAmount)) amount = Number(cap.saleAmount);
      if (!options.shorts && minutes !== null && minutes >= Number(cap.fromMinutes)) days = cap.days || days;
    }
  }

  if (scopeCheck) {
    const question = scopeCheck === 'length_unknown' ? copy.questionLengthUnknown : copy.questionShortsLongSource;
    return { ...base, amount: null, days: null, scopeCheck, message: [intro, copy.workLine, copy.safeLine, copy.experienceLine, question].filter(Boolean).join('\n') };
  }
  const won = amount.toLocaleString('ko-KR');
  const dayText = days ? `작업 기간 ${days}` : copy.daysLater;
  const priceLine = base.materialsBased ? `견적 ${won}원부터(자료를 보고 최종 금액 확정) · ${dayText} · 수정 ${revisions}회 포함` : `견적 ${won}원 · ${dayText} · 수정 ${revisions}회 포함`;
  const lines = [intro, workLine, options.translation ? copy.translationLine : null, priceLine, copy.safeLine, copy.experienceLine, copy.questionKnown];
  return { ...base, amount, days, scopeCheck: null, message: lines.filter(Boolean).join('\n') };
}

// ── 규칙 기반 자동 견적(9/24 지시 24, decisions 7-10 · 지시 19 전 임시판) ──
// 스위치: services/video_edit.json autoQuote.enabled(기본 false, video-quote-on/off.bat). 판단만 한다 — 발송은 요청봇.
const EXCLUDED_WORK = /모션\s*그래픽|모션그래픽|3\s*D|3차원|더빙|성우|애니메이션\s*제작/i;
// 9/24 지시 25: 안 하는 작업이 다른 편집(컷·자막·음악 등)과 섞여 있으면 다른 편집만으로 보낸다
const BASIC_WORK = /컷|자막|자르|잘라|음악|bgm|배경\s*음|색\s*(?:보정|맞추|맞춰)|밝기|편집점|불필요|이어\s*붙|합치|편집\s*(?:요소|내용)\s*\n\s*(?:컷|자막)/i;
const OPEN_ENDED_MIN = 60; // "1시간 이상"부터(감독 지시 25: 아래 끝 70분~2시간 → 상한, 시험에 "1시간 이상 → 249,000")
const OPEN_ENDED_MAX = 120;
const VISIT_WORK = /방문|대면|출장|현장\s*촬영|촬영\s*(?:해|부탁|요청|필요|까지)|직접\s*와/;
const STORYBOARD = /스토리\s*보드|콘티/;
function customerWords(parsed = {}) {
  const head = requestHead(parsed);
  const field = head.match(/서비스\s*분야\s*\n\s*([^\n]{2,20})/)?.[1]?.trim();
  if (field && !/상관없|기타/.test(field)) return field;
  const topic = String(parsed.topic || '').trim();
  if (topic && topic.length <= 20 && !/^영상\s*편집$/.test(topic)) return topic.replace(/\s*(?:편집|요청|문의)\s*$/, '');
  return '';
}
// 반환: { send: bool, reason: 코드, storyboard: bool }
function autoQuoteDecision(parsed = {}, priced = null, config = {}) {
  const def = DEFINITION || {};
  const cfg = { ...(def.autoQuote || {}), ...config };
  const head = requestHead(parsed);
  const storyboard = STORYBOARD.test(head);
  if (cfg.enabled !== true) return { send: false, reason: 'switch_off', storyboard };
  if (!priced || !priced.amount) return { send: false, reason: priced?.scopeCheck || 'no_amount', storyboard };
  let openEnded = false; let override = null;
  if (sourceLengthOpenEnded(parsed)) {
    // 9/24 지시 25: "1시간 이상"·"2시간 이상"처럼 아래 끝이 1~2시간이면 상한 금액·3~4일로 보낸다. 더 길면 알림
    const lower = openEndedLowerMinutes(parsed);
    const cap = def.pricing?.cap || {};
    if (!lower || lower < OPEN_ENDED_MIN || lower > OPEN_ENDED_MAX || priced.options?.shorts) return { send: false, reason: 'length_open_ended', storyboard };
    openEnded = true; override = { amount: Number(cap.saleAmount), days: cap.days };
  }
  if (!(override?.days || priced.days)) return { send: false, reason: 'days_unknown', storyboard };
  const basicHead = head.replace(/영상\s*편집/g, '');
  const excluded = EXCLUDED_WORK.test(head);
  if (excluded && !BASIC_WORK.test(basicHead)) return { send: false, reason: 'excluded_work', storyboard };
  if (VISIT_WORK.test(head) || /방문|대면/.test(String(parsed.scope || ''))) return { send: false, reason: 'visit_or_shoot', storyboard };
  if (Number(cfg.sentToday || 0) >= Number(cfg.dailyMaxSends || 10)) return { send: false, reason: 'daily_cap', storyboard };
  return { send: true, reason: 'ok', storyboard, excludedMixed: excluded, openEnded, override };
}
// 견적 설명(9/24 지시 25, 준희 지정 예시와 같은 모양): "안녕하세요, 상업 영상 원본 5분 이내면 필요 없는 부분 정리하고 자막까지 넣어서
// 69,000원에 해 드릴 수 있습니다. 영상 받고 1~2일 안에 MP4로 보내드리고, 수정은 2회까지 가능합니다!!" 숨고페이 문장·질문 없음. 금액은 하나만.
function autoQuoteMessage(parsed = {}, priced = {}, decision = {}) {
  const def = DEFINITION || {};
  const amount = decision.override?.amount || priced.amount;
  const days = decision.override?.days || priced.days;
  const won = `${Number(amount).toLocaleString('ko-KR')}원`;
  const said = customerWords(parsed);
  const who = said ? `${said} ` : '';
  const lines = [];
  if (priced.options?.shorts) lines.push(`안녕하세요, ${who}영상으로 1분 이내 쇼츠 1개 만들어서 자막까지 넣는 건 ${won}에 해 드릴 수 있습니다.`);
  else if (priced.materialsBased) {
    // 9/25 준희: 길이로 못 정하는 요청(식전영상 등)은 자료를 보고 확정한다고 말하고 시작가만 알린다.
    lines.push(`안녕하세요, ${who}보내주실 사진·영상 자료를 보고 정확한 금액을 확정해 드리려고 합니다. 기본 구성 기준으로 ${won}부터 해 드릴 수 있습니다.`);
  } else {
    // 고객이 고른 원본 길이 답("5분 이내", "2시간 이내")을 그대로 되짚는다. 없으면 계산에 쓴 분.
    const own = String(parsed.volume || '').trim();
    const length = own && own.length <= 20 && durations(own).length ? own : `${priced.minutes}분`;
    lines.push(`안녕하세요, ${who}원본 ${length}${/이내$|이하$/.test(length) ? '면' : ' 기준으로'} 필요 없는 부분 정리하고 자막까지 넣어서 ${won}에 해 드릴 수 있습니다.`);
  }
  if (decision.excludedMixed) lines.push('움직이는 그래픽(모션그래픽)·3D·더빙은 제가 하지 않는 작업이라 빼고, 컷 편집과 자막으로 해 드릴 수 있습니다.');
  if (priced.options?.translation) lines.push('외국어로 말하는 부분을 한국어 자막으로 옮기는 것도 이 금액에 들어 있습니다.');
  if (decision.storyboard) lines.push('금액은 이대로 두고, 세부 구성은 스토리보드 보고 확정하겠습니다.');
  if (decision.openEnded) lines.push('원본 길이 확인하고 일정은 다시 말씀드릴 수 있습니다.');
  lines.push(`${priced.materialsBased ? '자료 받고' : '영상 받고'} ${days} 안에 MP4로 보내드리고, 수정은 ${priced.revisions || def.includedRevisions || 2}회까지 가능합니다!!`);
  return lines.join(' ');
}

module.exports = { videoEditQuote, sourceMinutes, sourceLengthOpenEnded, openEndedLowerMinutes, detectOptions, autoQuoteDecision, autoQuoteMessage, customerWords, DEFINITION, DEFINITION_PATH };
