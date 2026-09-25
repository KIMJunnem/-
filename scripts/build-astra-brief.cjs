'use strict';

// Astra 운영 기준 만들기 (2026-09-23 개발방 지시 9).
// 원본은 services/*.json과 서버 견적 함수다. 이 스크립트는 그 값을 읽고 계산만 해서 docs/astra-brief.md를 만든다.
// 수동 가격표를 따로 두지 않는다(decisions.md 7-1). 외부 호출·유료 API·고객 발송 없음. 서버 코드는 부르기만 하고 고치지 않는다.
// 사용: node scripts/build-astra-brief.cjs          → docs/astra-brief.md 쓰기
//       node scripts/build-astra-brief.cjs --stdout → 화면에만 출력

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'astra-brief.md');
const SERVICE_FILES = ['subtitle', 'document_writing', 'presentation', 'translation_en', 'video_edit'];

// 대표 요청. 금액·기간·수정 횟수는 모두 서버 견적 함수(buildSoomgoQuote / pricing-table)로 계산한다.
const CASES = [
  { id: 'sub-5', service: 'subtitle', label: '한국어 영상 5분', body: { purpose: '자막 제작', volume: '5분', topic: '한국어 강의 영상 자막', format: 'SRT' } },
  { id: 'sub-10', service: 'subtitle', label: '한국어 영상 10분', body: { purpose: '자막 제작', volume: '10분', topic: '한국어 강의 영상 자막', format: 'SRT' } },
  { id: 'sub-30', service: 'subtitle', label: '한국어 영상 30분', body: { purpose: '자막 제작', volume: '30분', topic: '한국어 세미나 영상 자막', format: 'SRT' } },
  { id: 'sub-33', service: 'subtitle', label: '한국어 영상 33분', body: { purpose: '자막 제작', volume: '33분', topic: '한국어 강연 영상 자막', format: 'SRT' } },
  { id: 'sub-45', service: 'subtitle', label: '한국어 영상 45분', body: { purpose: '자막 제작', volume: '45분', topic: '한국어 강연 영상 자막', format: 'SRT' } },
  { id: 'sub-tr-10', service: 'subtitle', label: '번역 자막 10분(외국어 영상 → 한국어 자막)', body: { purpose: '자막 제작', volume: '10분', topic: '영어 강의 영상 한국어 번역 자막', format: 'SRT' } },
  { id: 'sub-burn-10', service: 'subtitle', label: '자막 + 영상에 입히기 10분', body: { purpose: '자막 제작', volume: '10분', topic: '한국어 홍보 영상 자막 삽입', format: 'MP4' } },
  { id: 'sub-tr-burn-10', service: 'subtitle', label: '번역 자막 + 영상에 입히기 10분', body: { purpose: '자막 제작', volume: '10분', topic: '영어 영상 한국어 번역 자막 삽입', format: 'MP4' } },
  { id: 'doc-1', service: 'document_writing', label: '문서 작성 A4 1쪽', body: { purpose: '문서/글 작성', volume: 'A4 1쪽', topic: '회사 소개문 작성' } },
  { id: 'doc-3', service: 'document_writing', label: '문서 작성 A4 3쪽', body: { purpose: '문서/글 작성', volume: 'A4 3쪽', topic: '사업 안내문 작성' } },
  { id: 'doc-6', service: 'document_writing', label: '문서 작성 A4 6쪽', body: { purpose: '문서/글 작성', volume: 'A4 6쪽', topic: '행사 결과 보고 정리' } },
  { id: 'fmt-10', service: 'document_writing', label: '양식·편집 정리 A4 10쪽', body: { purpose: '문서/글 작성', volume: 'A4 10쪽', topic: '내용은 다 되어 있고 양식만 정리' } },
  { id: 'proof-4', service: 'document_writing', label: '교정·교열 A4 4쪽', body: { purpose: '교정/교열', volume: 'A4 4쪽', topic: '원고 맞춤법 교정' } },
  { id: 'proof-8', service: 'document_writing', label: '교정·교열 A4 8쪽', body: { purpose: '교정/교열', volume: 'A4 8쪽', topic: '원고 맞춤법 교정' } },
  { id: 'proof-en-4', service: 'document_writing', label: '영문 교정 A4 4쪽', english: true, body: { purpose: '교정/교열', volume: 'A4 4쪽', topic: '영문 원고 교정' } },
  { id: 'steno-10', service: 'document_writing', label: '녹취 타이핑(속기) 10분', body: { purpose: '속기(타이핑)', volume: '10분', topic: '회의 녹음 타이핑' } },
  { id: 'steno-20', service: 'document_writing', label: '녹취 타이핑(속기) 20분', body: { purpose: '속기(타이핑)', volume: '20분', topic: '회의 녹음 타이핑' } },
  { id: 'ppt-5', service: 'presentation', label: 'PPT 5장', body: { purpose: 'PPT 제작', volume: '5장', topic: '사업 계획 발표자료', format: 'PPTX' } },
  { id: 'ppt-7', service: 'presentation', label: 'PPT 7장', body: { purpose: 'PPT 제작', volume: '7장', topic: '분기 실적 보고 발표자료', format: 'PPTX' } },
  { id: 'ppt-12', service: 'presentation', label: 'PPT 12장', body: { purpose: 'PPT 제작', volume: '12장', topic: '교육 자료 발표자료', format: 'PPTX' } },
  // 2026-09-24 지시 16: 영상 편집(decisions 7-4). 계산은 server/video-edit-quote.js — 자동 발송 없음, 수동 견적용
  { id: 'vid-10', service: 'video_edit', label: '영상 편집 원본 10분', body: { purpose: '영상 편집', volume: '10분', topic: '강의 영상 컷편집·자막' } },
  { id: 'vid-30', service: 'video_edit', label: '영상 편집 원본 30분', body: { purpose: '영상 편집', volume: '30분', topic: '인터뷰 영상 컷편집·자막' } },
  { id: 'vid-45', service: 'video_edit', label: '영상 편집 원본 45분', body: { purpose: '영상 편집', volume: '45분', topic: '강연 영상 컷편집·자막' } },
  { id: 'vid-90', service: 'video_edit', label: '영상 편집 원본 90분(상한)', body: { purpose: '영상 편집', volume: '90분', topic: '세미나 영상 컷편집·자막' } },
  { id: 'vid-shorts', service: 'video_edit', label: '쇼츠 1개(결과 1분 이내·원본 10분 이내)', body: { purpose: '영상 편집', volume: '8분', topic: '유튜브 쇼츠 1개' } },
  { id: 'vid-tr-10', service: 'video_edit', label: '영상 편집 + 번역 자막 원본 10분', body: { purpose: '영상 편집', volume: '10분', topic: '영어 인터뷰 영상 번역 자막 편집' } }
];

function fileInfo(rel) {
  const full = path.join(ROOT, rel);
  const bytes = fs.readFileSync(full);
  return { rel, sha12: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12), mtime: fs.statSync(full).mtime, json: rel.endsWith('.json') ? JSON.parse(bytes.toString('utf8')) : null, text: bytes.toString('utf8') };
}

function kst(date) {
  const d = new Date(date.getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' KST';
}

const won = n => `${Number(n).toLocaleString('ko-KR')}원`;

// 서버 견적 함수. relay-server.js는 require.main이 아니면 서버를 띄우지 않는다. 기록(상태 파일)을 남기지 않는 계산 경로만 쓴다.
function loadQuoteFunctions() {
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('network_disabled_in_astra_brief'); };
  const { buildSoomgoQuote } = require(path.join(ROOT, 'server', 'relay-server.js'));
  const pricingTable = require(path.join(ROOT, 'server', 'pricing-table.js'));
  const videoEdit = require(path.join(ROOT, 'server', 'video-edit-quote.js'));
  return { buildSoomgoQuote, pricingTable, videoEdit, restore: () => { global.fetch = realFetch; } };
}

function computeCases(fns) {
  return CASES.map(c => {
    if (c.service === 'video_edit') {
      const q = fns.videoEdit.videoEditQuote(c.body);
      return { ...c, serviceId: q.serviceId, amount: q.amount, days: q.days || '영상 받아 본 뒤 날짜로', revisions: q.revisions, version: `${q.quoteMessageVersion} 수동 문구 · 자동 견적은 ${fns.videoEdit.DEFINITION?.autoQuote?.messageVersion || 'auto'}` };
    }
    if (c.english) {
      const q = fns.pricingTable.englishProofreadingQuote({ ...c.body, pages: Number(c.body.volume.match(/\d+/)[0]) });
      return { ...c, serviceId: 'document_writing', amount: q.amount, days: q.days, revisions: q.includedRevisions, version: '(영문 교정 — 숨고는 자동 규칙 확인 후 발송)' };
    }
    const { quote } = fns.buildSoomgoQuote(c.body);
    const revisionLine = String(quote.message || '').match(/수정\s*(\d+)\s*회/);
    return { ...c, serviceId: quote.serviceId, amount: quote.amount, days: quote.days, revisions: Number(quote.includedRevisions || (revisionLine && revisionLine[1]) || 0), version: quote.quoteMessageVersion };
  });
}

// decisions.md 1절 표에서 판매하지 않는 항목을 뽑는다(읽기만).
function notSoldFromDecisions(text) {
  const section = (text.split(/\n## /).find(part => part.startsWith('1. 서비스 범위')) || '');
  const items = [];
  for (const line of section.split('\n')) {
    const cells = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cells.length >= 2 && !/^-+$/.test(cells[0]) && cells[0] !== '서비스') {
      if (/하지 않음|판매 안 함|받지 않음/.test(cells[1]) && !/^판매 중|^주력|^\*\*판매함/.test(cells[1])) items.push(cells[0].replace(/\(translation_en\)/, '').trim());
      const inner = cells[1].match(/([^.]+?)(?:은|는) 받지 않음/);
      if (inner && /^판매 중/.test(cells[1])) items.push(inner[1].trim());
    }
    const outOfScope = line.match(/^- .*?(외국어 자막 납품)은 범위 밖/);
    if (outOfScope) items.push('외국어 자막 납품(한국어 외 언어로 된 자막)');
  }
  return [...new Set(items)];
}

// 문서 작업 기간 구간: 가격표 함수에 1~120쪽(속기는 1~180분)을 넣어 값이 바뀌는 지점을 찾는다. 규칙을 손으로 옮겨 적지 않는다.
function docDayRanges(pricingTable) {
  const ranges = (type, max, unit, make) => {
    const out = []; let start = 1; let cur = pricingTable.documentQuote(make(1), { type }).days;
    for (let n = 2; n <= max + 1; n += 1) {
      const d = n <= max ? pricingTable.documentQuote(make(n), { type }).days : null;
      if (d !== cur) { out.push(n > max ? `${start}${unit} 이상 ${cur}` : `${start}${n - 1 > start ? `~${n - 1}` : ''}${unit} ${cur}`); start = n; cur = d; }
    }
    return out.join(', ');
  };
  const pages = n => ({ pages: n, volume: `A4 ${n}쪽` });
  return [
    `작성·교정 ${ranges('writing', 120, '쪽', pages)}`,
    `양식 정리 ${ranges('formatting', 120, '쪽', pages)}`,
    `속기 ${ranges('stenography', 180, '분', n => ({ volume: `${n}분` }))}`
  ].join(' / ');
}

function fee(def, id) { return (def.pricing?.additionalFees || []).find(f => f.id === id) || null; }

function buildBrief({ now = new Date() } = {}) {
  const files = Object.fromEntries(SERVICE_FILES.map(id => [id, fileInfo(`services/${id}.json`)]));
  const decisions = fileInfo('docs/decisions.md');
  const fns = loadQuoteFunctions();
  let cases;
  try { cases = computeCases(fns); } finally { fns.restore(); }
  const byId = Object.fromEntries(cases.map(c => [c.id, c]));
  const sub = files.subtitle.json; const doc = files.document_writing.json; const ppt = files.presentation.json; const tr = files.translation_en.json;
  const notSold = notSoldFromDecisions(decisions.text);
  if (tr.channels && !Object.values(tr.channels).some(Boolean) && !notSold.some(s => /문서 번역/.test(s))) notSold.push('문서 번역');
  const lines = [];
  const push = (...xs) => lines.push(...xs);

  push('# Astra 운영 기준 (생성물)', '');
  push('> **이 파일은 생성물 — 직접 고치지 말 것.** 값을 바꾸려면 services/*.json을 준희 승인으로 고친 뒤 `node scripts/build-astra-brief.cjs`로 다시 만든다.');
  push(`> 생성 시각: ${kst(now)} · 만든 것: scripts/build-astra-brief.cjs · 금액·기간·수정 횟수는 서버 견적 함수(buildSoomgoQuote, server/pricing-table.js) 계산값`);
  push('> 원본 파일:');
  for (const id of SERVICE_FILES) {
    const f = files[id];
    push(`> - ${f.rel} · quoteMessageVersion ${f.json.quoteMessageVersion || '없음'} · 수정 ${kst(f.mtime)} · sha256 ${f.sha12}`);
  }
  push(`> - ${decisions.rel} (1·2·3·7-1절 읽기만) · 수정 ${kst(decisions.mtime)} · sha256 ${decisions.sha12}`);
  push('');

  push('## 쓰는 법 (내부 규칙)', '');
  push('- 금액·납기·수정 횟수는 Relay Desk가 고객에게 보낸 견적 값만 쓴다. 이 표에 없는 새 숫자를 만들지 않는다(decisions.md 6절).');
  push('- 이 표와 실제 보낸 견적이 다르면 보낸 견적을 따르고, 차이를 준희 확인으로 올린다.');
  push('- 결제·환불·취소·분쟁은 답하지 않고 준희 확인으로 넘긴다(decisions.md 6절).');
  push('- 모든 납품은 준희 승인 뒤에만 나간다(finalGrade.mode = manual). 결제 확인 전에는 최종 파일을 보내지 않는다.');
  push('- 금액은 하나만, 납기는 날짜로, 확인 질문은 하나만. 가격을 내린 이유나 정상가는 말하지 않는다(decisions.md 7절).');
  push('');

  // 자막
  const burn = fee(sub, 'burn_in'); const trf = fee(sub, 'translation'); const subRev = fee(sub, 'revision');
  const over = (sub.pricing.packages || []).find(p => p.unit);
  push(`## ${sub.label} (\`${sub.id}\`)`, '');
  push(`- 판매: 숨고 ${sub.channels.soomgo ? '판매' : '안 함'} · 크몽 ${sub.channels.kmong ? '판매' : '안 함'} · 파이버 ${sub.channels.fiverr?.enabled ? '판매(답장은 초안만, 발송은 준희 직접)' : '안 함'}`);
  push('- 번역 자막(외국어 영상 → 한국어 자막)도 이 서비스로 판매한다. 납품 자막은 한국어만.');
  push('');
  push('### 고객에게 말하는 값 (고객 안내용)', '');
  push('| 대표 요청 | 금액 | 작업 기간 | 수정 | 견적 문구 버전 |', '|---|---|---|---|---|');
  for (const c of cases.filter(x => x.service === 'subtitle')) push(`| ${c.label} | ${won(c.amount)} | ${c.days} | ${c.revisions}회 | ${c.version} |`);
  push('');
  push(`- 30분을 넘으면 5분마다 ${won(over.unit.saleAmount)}씩 더한다.`);
  push(`- 번역 자막: 자막 금액의 ${Math.round(trf.rate * 100)}%를 더하고 천 원 단위로 반올림한다.`);
  push(`- 영상에 자막 입히기(MP4): 5분마다 ${won(burn.amount)} (번역 가산 뒤에 더함).`);
  push(`- 기본 수정 ${sub.includedRevisions}회, 그다음부터 1회 ${won(subRev.amount)}.`);
  push(`- 납품 형식: ${sub.deliverFormats.map(s => s.toUpperCase()).join('·')} (영상에 입히기를 고른 경우만 MP4 추가).`);
  push(`- 작업 기간: ${(sub.leadDaysRules.find(r => r.default) || {}).value} (영상 길이와 상관없음).`);
  const fill = t => String(t || '').replace(/^기본 포함 범위:\s*/, '').replace(/\{\{minutes\}\}/g, 'N').replace(/\{\{revisionCount\}\}/g, sub.includedRevisions);
  push(`- 포함 범위(services/subtitle.json scope 그대로): ${fill(sub.scope)}`);
  if (sub.scopeTranslated) push(`- 포함 범위, 번역 자막일 때(scopeTranslated 그대로): ${fill(sub.scopeTranslated)}`);
  push('');
  if (sub.channels.fiverr?.enabled) {
    const fv = sub.channels.fiverr;
    push('### 파이버 (USD, 고객 안내용)', '');
    push(fv.packages.map(p => `${p.when.minutesLte}분 이하 $${p.amountUsd}(${p.deliveryDays}일)`).join(' / ') + ` · 수정 ${fv.includedRevisions}회. 30분 초과·MP4 입히기·영어·프랑스어 외 원어는 맞춤 견적(금액은 준희).`);
    push('');
  }
  push('### 접수 질문', '');
  for (const q of sub.intakeQuestions) push(`- ${q}`);
  push('');

  // 문서
  const docRev = fee(doc, 'revision'); const research = fee(doc, 'research'); const wt = doc.pricing.workTypes; const large = doc.pricing.largeDocument;
  push(`## ${doc.label} (\`${doc.id}\`)`, '');
  push(`- 판매: 숨고 ${doc.channels.soomgo ? '판매' : '안 함'} · 크몽 ${doc.channels.kmong ? '판매' : '안 함'} · 학교 과제 레포트 받음`);
  const scriptCat = (doc.soomgoCategories || []).find(c => /대본/.test(c.name));
  if (scriptCat) push('- 대본·시나리오: 판매하지만 자동 견적 없음. 금액은 준희가 정한다.');
  push('');
  push('### 고객에게 말하는 값 (고객 안내용)', '');
  push('| 대표 요청 | 금액 | 작업 기간 | 수정 | 견적 문구 버전 |', '|---|---|---|---|---|');
  for (const c of cases.filter(x => x.service === 'document_writing')) push(`| ${c.label} | ${won(c.amount)} | ${c.days} | ${c.revisions}회 | ${c.version} |`);
  push('');
  push(`- 문서 작성: ${won(wt.writing.base)}에 ${wt.writing.includedPages}쪽 포함, 그다음 쪽마다 ${won(wt.writing.perPage)}. 자료 조사가 필요하면 ${won(research.amount)} 추가.`);
  push(`- 양식·편집 정리(내용 유지): ${won(wt.formatting.base)}에 ${wt.formatting.includedPages}쪽 포함, 그다음 쪽마다 ${won(wt.formatting.perPage)}.`);
  push(`- 교정·교열·윤문: ${won(wt.proofreading.base)}에 ${wt.proofreading.includedPages}쪽 포함, 그다음 쪽마다 ${won(wt.proofreading.perPage)}. 영문 교정: ${won(doc.pricing.foreignProofreading.base)}에 ${doc.pricing.foreignProofreading.includedPages}쪽 포함, 쪽마다 ${won(doc.pricing.foreignProofreading.perPage)}.`);
  push(`- 녹취 타이핑(속기): ${won(wt.stenography.base)}에 ${wt.stenography.includedMinutes}분 포함, 그다음 1분마다 ${won(wt.stenography.perMinute)}. 속기사무소 도장·인증은 해드리지 못한다.`);
  push(`- ${large.minPages}쪽을 넘는 부분은 쪽마다 ${won(large.perPageAbove)}(작성·교정). ${large.deleteAbovePages}쪽 초과는 받지 않는다.`);
  push(`- 기본 수정 ${doc.includedRevisions}회(학교 과제는 ${doc.schoolAssignmentRevisions}회), 그다음부터 1회 ${won(docRev.amount)}.`);
  push(`- 납품 형식: ${doc.deliverFormats.map(s => s.toUpperCase()).join('·')}`);
  push(`- 작업 기간(서버 계산, 분량마다 다름): ${docDayRanges(fns.pricingTable)}`);
  push('- 포함 범위: 보내주신 자료 중심으로 작업. 별도 자료 조사는 포함하지 않는다.');
  push('');
  push('### 접수 질문', '');
  for (const q of doc.intakeQuestions) push(`- ${q}`);
  push('');

  // PPT
  const pptRev = fee(ppt, 'revision'); const pptResearch = fee(ppt, 'research'); const extra3 = fee(ppt, 'extra_3_slides');
  push(`## ${ppt.label} (\`${ppt.id}\`)`, '');
  push(`- 판매: 숨고 ${ppt.channels.soomgo ? '판매' : '안 함'} · 크몽 ${ppt.channels.kmong ? '판매' : '안 함'}`);
  push('');
  push('### 고객에게 말하는 값 (고객 안내용)', '');
  push('| 대표 요청 | 금액 | 작업 기간 | 수정 | 견적 문구 버전 |', '|---|---|---|---|---|');
  for (const c of cases.filter(x => x.service === 'presentation')) push(`| ${c.label} | ${won(c.amount)} | ${c.days} | ${c.revisions}회 | ${c.version} |`);
  push('');
  push(`- 7장까지 ${won(byId['ppt-7'].amount)}, 그다음 3장마다 ${won(extra3.saleAmount)}.`);
  push(`- 자료 없이 내용 조사부터 필요하면 ${won(pptResearch.amount)} 추가.`);
  push(`- 기본 수정 ${ppt.includedRevisions}회, 그다음부터 1회 ${won(pptRev.amount)}.`);
  push(`- 납품 형식: ${ppt.deliverFormats.map(s => s.toUpperCase()).join('·')} (원본 파일 제공)`);
  push(`- 작업 기간: ${ppt.leadDaysRules.filter(r => r.when?.pagesGte).map(r => `${r.when.pagesGte}장 이상 ${r.value}`).join(', ')}, 그 밖에는 ${(ppt.leadDaysRules.find(r => r.default) || {}).value}.`);
  push('- 포함 범위: 받은 원고·보고서 내용을 발표 흐름에 맞게 나누어 PPT로 구성. 복잡한 표·그래프·자료 조사는 범위를 확인한 뒤 안내.');
  push('');
  push('### 접수 질문', '');
  for (const q of ppt.intakeQuestions) push(`- ${q}`);
  push('');

  // 영상 편집 (decisions 7-4, 지시 16)
  const vid = files.video_edit.json; const vfee = id => (vid.pricing.additionalFees || []).find(f => f.id === id);
  const vOver = vid.pricing.packages.find(p => p.unit);
  push(`## ${vid.label} (\`${vid.id}\`)`, '');
  push(`- 판매: 숨고 판매(2026-09-24~). 자동 견적(decisions 7-10, 지시 24): 스위치 autoQuote.enabled가 켜져 있으면(지금 ${vid.autoQuote?.enabled ? '켜짐' : '꺼짐'}) 원본 길이가 있고 작업 기간이 정해진 요청에 하루 ${vid.autoQuote?.dailyMaxSends || 10}건까지 요청봇이 자동 발송. 꺼져 있거나 길이 모름·모션그래픽·3D·더빙·촬영·방문이 섞이면 준희 확인 알림.`);
  push(`- 범위: ${vid.scope}`);
  push(`- 안 하는 것: ${vid.notIncluded.join('·')}`);
  push('');
  push('### 고객에게 말하는 값 (고객 안내용)', '');
  push('| 대표 요청 | 금액 | 작업 기간 | 수정 | 견적 문구 버전 |', '|---|---|---|---|---|');
  for (const c of cases.filter(x => x.service === 'video_edit')) push(`| ${c.label} | ${won(c.amount)} | ${c.days} | ${c.revisions}회 | ${c.version} |`);
  push('');
  push(`- 원본 길이 기준: 10분 이내 ${won(vid.pricing.packages[0].saleAmount)}, 30분 이내 ${won(vid.pricing.packages[1].saleAmount)}, 30분을 넘으면 5분마다 ${won(vOver.unit.saleAmount)}씩 더한다(작업 기간은 영상을 받아 본 뒤 날짜로).`);
  if (vid.pricing.cap) push(`- 금액 상한 ${won(vid.pricing.cap.saleAmount)}: 원본이 길어도, 번역·배경음악·색 옵션을 더해도 넘기지 않는다. 원본 ${vid.pricing.cap.fromMinutes}분 이상은 ${won(vid.pricing.cap.saleAmount)}·작업 기간 ${vid.pricing.cap.days}.`);
  // 9/25 준희: 릴스·쇼츠 첫 거래가(정책 introPromo.shorts, 리뷰 endAfterReviews개 쌓이면 끝). 고객 안내용 칸이라 "할인" 말 없이 첫 거래가로 적는다
  let shortsPromo = null;
  try { shortsPromo = require(path.join(ROOT, 'server', 'video-edit-quote.js')).introPromoShorts(); } catch (_) { shortsPromo = null; }
  push(`- 쇼츠 1개(결과 ${vid.pricing.shorts.resultMaxMinutes}분 이내·원본 ${vid.pricing.shorts.maxSourceMinutes}분 이내): ${won(vid.pricing.shorts.saleAmount)}(${vid.pricing.shorts.days})${shortsPromo ? `, 지금은 첫 거래가 1편 ${won(shortsPromo.price)}(리뷰 ${shortsPromo.endAfterReviews}개가 쌓이면 정가로. 묶음 가격과 겹치지 않고 더 싼 쪽 하나)` : ''}. 원본이 더 길면 금액 없이 범위부터 확인.`);
  // 9/25 준희 수정 방침(services/video_edit.json pricing.revisionFees)
  const rf = vid.pricing.revisionFees;
  if (rf) push(`- 기본 수정 ${vid.includedRevisions}회 뒤 ${vid.includedRevisions + 1}번째 수정부터는 작업 전에 금액을 말하고 동의를 받는다: 가벼운 수정 1회 ${won(rf.light.amount)}(쇼츠 ${won(rf.light.shortsAmount)}), 큰 수정 ${won(rf.big.fromAmount)}부터(쇼츠 ${won(rf.big.shortsFromAmount)}부터, 정확한 금액은 준희 확인). 수정 요청은 모아서 마지막 요청 2시간 뒤 한 번에 반영(마감이 오늘·내일이면 바로).`);
  push(`- 번역 자막(외국어 영상 → 한국어 자막): 금액의 ${Math.round(vfee('translation').rate * 100)}%를 더하고 천 원 단위로 반올림한다.`);
  push(`- 배경음악 넣기·밝기/색 맞추기: 각 ${won(vfee('bgm').amount)} — 고객이 요청할 때만 안내한다(처음부터 나열하지 않음).`);
  push(`- 기본 수정 ${vid.includedRevisions}회. 결과물 ${vid.deliverFormats.map(s => s.toUpperCase()).join('·')}.`);
  push('- 원본 길이를 모르면 금액을 말하지 않고 길이부터 묻는다.');
  push(`- 경험 문장(준희 진술, 그대로만): "${vid.experienceLine}"`);
  push('');
  push('### 접수 질문', '');
  for (const q of vid.intakeQuestions) push(`- ${q}`);
  push('');

  push('## 검증된 샘플', '');
  push('- 자막: 숨고 프로필 포트폴리오 영상 (링크 없음 — 고객에게는 "제 프로필의 포트폴리오 영상"으로만 안내)');
  push('- 문서·PPT: 검증된 공개 샘플 없음. PPT 고객 샘플은 준희가 직접 골라 보낸다.');
  push('');

  push('## 판매 안 함', '');
  for (const s of notSold) push(`- ${/문서 번역/.test(s) ? '판매 안 함(문서 번역)' : s}`);
  push('');
  push('이 목록에 해당하면 견적·금액을 말하지 않고 정중하게 진행하지 않는다고만 답한다. 판단이 애매하면 준희 확인으로 넘긴다.');
  push('');

  push('## 대조용 값 (시험이 읽음)', '');
  push('```json');
  push(JSON.stringify(cases.map(c => ({ id: c.id, amount: c.amount, days: c.days, revisions: c.revisions })), null, 0));
  push('```');
  push('');
  return { markdown: lines.join('\n'), cases, notSold };
}

module.exports = { CASES, buildBrief, computeCases, loadQuoteFunctions, notSoldFromDecisions, OUT };

if (require.main === module) {
  const { markdown } = buildBrief();
  if (process.argv.includes('--stdout')) process.stdout.write(markdown);
  else { fs.writeFileSync(OUT, markdown, 'utf8'); console.log(`wrote ${path.relative(ROOT, OUT)}`); }
  process.exit(0);
}
