'use strict';

// swan 문서 계열 가격표 (2026-09-21, 사용자 지시: "시세보다 조금 싸게")
// 시세 근거(2026-09-21 조회):
// - 문서 편집·서식 정리: 크몽 10쪽 20,000~30,000원 (쪽당 2,000~3,000원)
// - 교정·교열·윤문: 크몽 A4 1쪽 6,000~15,000원, 숨고 건당 평균 약 12만~20만 원
// - 녹취 속기(속기사무소·도장 포함): 5분 4~6만, 10분 6~8만, 30분 12~14만 원
// - 문서/글 작성: 건당 평균 약 20만 원, 신규 작성 쪽당 1만~2만 원대
// 모든 금액은 숨고 최소 거래금액 15,000원 이상이며, 1,000원 단위로 올림한다.

const MIN_AMOUNT = 15000;

// 가격 숫자의 단일 원본은 services/document_writing.json의 pricing.workTypes다.
// 파일에 값이 없을 때만 아래 기본값을 쓴다.
const DEFAULT_DOCUMENT_TABLE = Object.freeze({
  writing: { label: '문서 작성', base: 21000, includedPages: 2, perPage: 9000 },
  formatting: { label: '문서 양식·편집 정리', base: 15000, includedPages: 5, perPage: 1500 },
  proofreading: { label: '교정·교열·윤문', base: 21000, includedPages: 4, perPage: 5000 },
  stenography: { label: '녹취 타이핑(속기)', base: 21000, includedMinutes: 10, perMinute: 1800 }
});

function loadDocumentTable() {
  try {
    const definition = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'services', 'document_writing.json'), 'utf8'));
    const workTypes = definition?.pricing?.workTypes || {};
    return Object.freeze(Object.fromEntries(Object.entries(DEFAULT_DOCUMENT_TABLE)
      .map(([key, fallback]) => [key, Object.freeze({ ...fallback, ...(workTypes[key] || {}) })])));
  } catch (_) {
    return DEFAULT_DOCUMENT_TABLE;
  }
}
const DOCUMENT_TABLE = loadDocumentTable();

function roundUp1000(value) {
  return Math.max(MIN_AMOUNT, Math.ceil(Number(value || 0) / 1000) * 1000);
}

function documentWorkType(parsed = {}) {
  const service = String(parsed.purpose || '');
  const detail = [parsed.purpose, parsed.topic, parsed.scope, parsed.notes, parsed.volume].filter(Boolean).join(' ');
  if (/속기|타이핑|녹취/.test(service) || /녹취\s*록|녹음\s*(?:파일)?\s*(?:을|를)?\s*(?:문서|텍스트|타이핑)/.test(detail)) return 'stenography';
  if (/교정|교열|윤문/.test(service) || /교정|교열|윤문|맞춤법|첨삭/.test(detail)) return 'proofreading';
  if (/양식|서식|편집|레이아웃|디자인만|깔끔하게|다듬|정리만|내용은\s*다\s*(?:되어|돼)/.test(detail)) return 'formatting';
  return 'writing';
}

function minutesFrom(parsed = {}) {
  const text = [parsed.volume, parsed.topic, parsed.notes].filter(Boolean).join(' ');
  const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*시간/)?.[1] || 0);
  const minutes = Number(text.match(/(\d+(?:\.\d+)?)\s*분/)?.[1] || 0);
  const total = Math.round(hours * 60 + minutes);
  return total > 0 ? total : 10;
}

function documentLeadDays(type, units) {
  if (type === 'stenography') return units <= 30 ? '당일~1일' : units <= 90 ? '1~2일' : '2~3일';
  if (type === 'formatting') return units <= 20 ? '당일~1일' : units <= 60 ? '1~2일' : '2~3일';
  return units <= 5 ? '당일~1일' : units <= 15 ? '1~2일' : '2~3일';
}

// D'(2026-09-21, 사용자 승인 숫자): 40쪽 초과분은 쪽당 3,500원, 100쪽 초과는 자동 삭제.
// 영어 교정은 기본 34,000원(4쪽 포함)·쪽당 8,000원, 40쪽 초과분 쪽당 3,500원.
// 값의 원본은 services/document_writing.json의 pricing.largeDocument / pricing.foreignProofreading.
function loadDocumentRules() {
  try {
    const definition = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'services', 'document_writing.json'), 'utf8'));
    return { largeDocument: definition?.pricing?.largeDocument || null, foreignProofreading: definition?.pricing?.foreignProofreading || null };
  } catch (_) {
    return { largeDocument: null, foreignProofreading: null };
  }
}
const DOCUMENT_RULES = loadDocumentRules();

// 기본 포함 수정 횟수(document_writing.json includedRevisions, 2026-09-22 준희 결정: 문서 3회).
const DOCUMENT_REVISIONS = (() => { try { return Math.max(1, Number(JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'services', 'document_writing.json'), 'utf8')).includedRevisions || 1)); } catch (_) { return 1; } })();

// 학교 과제(2026-09-22 준희 결정): 교수 확인에 따라 자주 바뀌어 기본 수정 2회, 3번째부터 추가 요금.
// 요청서 칸(이용 목적·목적·주제·메모·범위)만 본다. 페이지 전체 글은 보지 않는다(엉뚱한 문구로 오판한 적 있음).
const DOCUMENT_SERVICE = (() => { try { return JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'services', 'document_writing.json'), 'utf8')); } catch (_) { return {}; } })();
const SCHOOL_REVISIONS = Math.max(1, Number(DOCUMENT_SERVICE.schoolAssignmentRevisions || DOCUMENT_REVISIONS));
const REVISION_FEE = Number((DOCUMENT_SERVICE.pricing?.additionalFees || []).find(fee => fee.id === 'revision')?.amount || 0);
function isSchoolAssignment(parsed = {}) {
  const fields = [parsed.usePurpose, parsed.purpose, parsed.topic, parsed.notes, parsed.scope].filter(Boolean).join(' ');
  return /(학교\s*과제|과제|수업|레포트|리포트|교양|교수님|조별|팀플|수행\s*평가)/.test(fields);
}

// 쪽 단위 금액: 기본 포함 쪽 → 쪽당 단가(40쪽까지) → 40쪽 초과분 단가.
function tieredPageAmount(rule, pages, type = '') {
  const large = DOCUMENT_RULES.largeDocument;
  const applies = !Array.isArray(large?.appliesToTypes) || large.appliesToTypes.includes(type);
  const threshold = applies ? Number(large?.minPages || 0) : 0;
  const upTo = threshold > 0 ? Math.min(pages, threshold) : pages;
  let amount = Number(rule.base) + Math.max(0, upTo - Number(rule.includedPages || 0)) * Number(rule.perPage || 0);
  if (threshold > 0 && pages > threshold) amount += (pages - threshold) * Number(large.perPageAbove || rule.perPage || 0);
  return roundUp1000(amount);
}

// 견적 문구 v5(2026-09-21, 준희 지시): '요청서 확인했습니다' → 금액·납기 한 줄 → 숨고페이 안전결제 →
// 범위 약속 → 견적이 달라질 수 있는 확인 질문 하나. 작업 방식처럼 당연한 설명은 넣지 않는다.
function unitKnown(parsed = {}, type) {
  const text = [parsed.volume, parsed.topic, parsed.notes, parsed.scope].filter(Boolean).join(' ');
  if (type === 'stenography') return /(\d+(?:\.\d+)?)\s*(?:시간|분)/.test(text);
  return /(\d+)\s*(?:페이지|장|쪽)|A4\s*(?:기준)?\s*\d+/i.test(text);
}

// 첫 문장은 요청서의 짧은 주제를 그대로 인용한다. 긴 원문·질문은 서비스명으로 대신한다.
function quoteRequestIntro(parsed = {}, label = '') {
  const topic = String(parsed.topic || '').replace(/\s+/g, ' ').trim();
  if (topic && topic.length <= 80 && !/[?？<>]/.test(topic)) {
    return `안녕하세요. 문의 주신 ‘${topic}’ 건으로 연락드립니다.`;
  }
  return `안녕하세요. ${label} 작업으로 문의 주셔서 감사합니다.`;
}

function documentQuote(parsed = {}, options = {}) {
  const type = options.type || documentWorkType(parsed);
  const rule = options.rule || DOCUMENT_TABLE[type];
  const english = options.language === 'english';
  const known = unitKnown(parsed, type);
  const safeLine = '결제는 숨고페이로 진행하고, 결과물을 확인하신 뒤 거래를 확정하시면 됩니다.';
  const scopeLine = '분량이 늘어나면 작업 전에 먼저 여쭤보겠습니다.';
  if (type === 'stenography') {
    const minutes = minutesFrom(parsed);
    const amount = roundUp1000(rule.base + Math.max(0, minutes - rule.includedMinutes) * rule.perMinute);
    const days = documentLeadDays(type, minutes);
    const won = amount.toLocaleString('ko-KR');
    const question = known
      ? '여러 사람이 동시에 말하거나 음질이 좋지 않은 부분이 많으면 미리 알려주세요. 작업 시간이 달라질 수 있습니다.'
      : '녹음 전체 길이가 몇 분인지 알려주시면 금액을 바로 확정해 드리겠습니다.';
    return {
      type, label: rule.label, amount, days, units: minutes, unit: '분',
      basicScope: `기본 포함 범위: 녹음 ${minutes}분을 워드 문서로 타이핑, 수정 ${DOCUMENT_REVISIONS}회입니다. 속기사무소 도장·인증은 포함되지 않습니다.`,
      message: [quoteRequestIntro(parsed, rule.label), `녹음 ${minutes}분을 듣고 내용을 워드 문서로 정리해 드립니다.`, `견적 ${won}원 · 작업 기간 ${days} · 수정 ${DOCUMENT_REVISIONS}회 포함`, '속기사무소 도장이나 인증은 해드리지 못합니다.', safeLine, question].join('\n')
    };
  }
  const pages = Math.max(1, Number(parsed.pages || 1));
  const school = isSchoolAssignment(parsed);
  const revisions = school ? SCHOOL_REVISIONS : DOCUMENT_REVISIONS;
  const schoolLine = school && REVISION_FEE > 0 ? `${revisions + 1}번째 수정부터는 1회 ${REVISION_FEE.toLocaleString('ko-KR')}원입니다.` : null;
  const amount = tieredPageAmount(rule, pages, type);
  const days = documentLeadDays(type, pages);
  const won = amount.toLocaleString('ko-KR');
  const question = !known
    ? '전체 분량이 A4 몇 쪽인지 알려주시면 금액을 바로 확정해 드리겠습니다.'
    : {
      writing: '참고할 자료는 준비되어 있으신가요? 자료 없이 내용 조사부터 필요하시면 알려주세요.',
      formatting: '내용 수정 없이 양식만 정리하면 되는 게 맞을까요?',
      proofreading: '이미 완성된 원고를 다듬는 작업이 맞을까요? 새로 써야 하는 부분이 있으면 알려주세요.'
    }[type];
  const basicScope = {
    writing: `기본 포함 범위: A4 ${pages}쪽 문서 작성, 고객 제공 자료 중심, 수정 ${revisions}회입니다. 별도 자료조사는 제외됩니다.`,
    formatting: `기본 포함 범위: A4 ${pages}쪽 양식·편집 정리(내용 유지), 수정 ${revisions}회입니다.`,
    proofreading: english ? `기본 포함 범위: A4 ${pages}쪽 영문 교정, 수정 ${revisions}회입니다.` : `기본 포함 범위: A4 ${pages}쪽 교정·교열·윤문, 수정 ${revisions}회입니다.`
  }[type];
  return {
    type, label: rule.label, amount, days, units: pages, unit: '쪽', basicScope,
    schoolAssignment: school, includedRevisions: revisions,
    message: [quoteRequestIntro(parsed, rule.label), {
      writing: `${known ? `A4 ${pages}쪽 분량으로` : `현재 견적은 A4 ${pages}쪽 기준이며,`} 보내주실 자료를 바탕으로 글을 정리해 드립니다. 별도 자료조사는 포함되지 않습니다.`,
      formatting: `A4 ${pages}쪽 문서의 내용은 유지하고, 제목·문단·간격 등 서식을 정리해 드립니다.`,
      proofreading: `A4 ${pages}쪽 ${english ? '영문 원고' : '원고'}의 맞춤법과 어색한 표현을 다듬어 드립니다.`
    }[type], `견적 ${won}원 · 작업 기간 ${days} · 수정 ${revisions}회 포함`, safeLine, scopeLine, schoolLine, question].filter(Boolean).join('\n')
  };
}

// 영어 교정 견적(교정 문구 그대로, 단가만 영어 교정 규칙).
function englishProofreadingQuote(parsed = {}) {
  const rule = DOCUMENT_RULES.foreignProofreading;
  if (!rule) return null;
  const base = DOCUMENT_TABLE.proofreading;
  return documentQuote(parsed, { type: 'proofreading', language: 'english', rule: { ...base, label: '영문 교정', base: rule.base, includedPages: rule.includedPages, perPage: rule.perPage } });
}

module.exports = { quoteRequestIntro, SCHOOL_REVISIONS, isSchoolAssignment, DOCUMENT_REVISIONS, DOCUMENT_TABLE, DOCUMENT_RULES, MIN_AMOUNT, documentWorkType, documentQuote, englishProofreadingQuote, tieredPageAmount, roundUp1000 };
