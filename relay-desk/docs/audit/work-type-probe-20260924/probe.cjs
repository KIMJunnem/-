'use strict';
// 합성 입력만 쓴다(실제 고객 원문 아님). 외부 호출 없음.
let net = 0; global.fetch = async () => { net += 1; throw new Error('off'); };
const pricing = require('../../../server/pricing-table.js');
const P = require('./work-type-proposal.cjs');

const D = '문서/글 작성';
const cases = [
  // M03 4건(M03-pricing-probe.cjs와 같은 입력)
  { id: 'M1', note: 'M03 인포그래픽', purpose: '인포그래픽 디자인', topic: '기관 연구과제의 간행물 인포그래픽 디자인', volume: 'A4 기준 1', pages: 1 },
  { id: 'M2', note: 'M03 기존 보고서 디자인', purpose: '기술문서', topic: '기존 보고서를 좀더 보기 좋게 디자인', volume: 'A4 기준 16', pages: 16 },
  { id: 'M3', note: 'M03 내용 유지+레이아웃', purpose: '기술문서', topic: '기존 보고서의 내용은 유지하고 레이아웃 편집', volume: 'A4 기준 16', pages: 16 },
  { id: 'M4', note: 'M03 글 작성 대조', purpose: '브랜드 소개글', topic: '제공 자료로 소개글 작성', volume: 'A4 기준 1', pages: 1 },
  // 디자인·시각 제작
  { id: 'V1', note: '카드뉴스', purpose: D, topic: '매장 홍보용 카드뉴스 5장 제작', volume: '5장', pages: 5 },
  { id: 'V2', note: '포스터', purpose: D, topic: '행사 안내 포스터 1장 디자인', volume: 'A4 기준 1', pages: 1 },
  { id: 'V3', note: '도식', purpose: D, topic: '업무 흐름을 도식으로 그려 주세요', volume: 'A4 기준 2', pages: 2 },
  { id: 'V4', note: '보고서 안 인포그래픽', purpose: D, topic: '사업 보고서 작성, 인포그래픽 2개 포함', volume: 'A4 기준 5', pages: 5 },
  // 기존 문서 → 서식 정리 경계
  { id: 'F1', note: '기존+내용 그대로+디자인', purpose: D, topic: '기존 보고서 내용은 그대로 두고 보기 좋게 디자인해 주세요', volume: 'A4 기준 16', pages: 16 },
  { id: 'F2', note: '작성된 제안서 깔끔하게', purpose: D, topic: '이미 작성된 제안서를 깔끔하게 정리', volume: 'A4 기준 10', pages: 10 },
  { id: 'F3', note: '내용 다 됨+디자인만', purpose: D, topic: '회사 소개서 내용은 다 되어있고 디자인만 부탁드려요', volume: 'A4 기준 8', pages: 8 },
  { id: 'F4', note: '원고 유지+양식 편집', purpose: D, topic: '발표 원고 내용 유지, 한글 양식에 맞춰 편집', volume: 'A4 기준 6', pages: 6 },
  { id: 'F5', note: '기존 문서 예쁘게(내용 유지 불명)', purpose: D, topic: '가지고 있는 안내문을 예쁘게 바꿔 주세요', volume: 'A4 기준 3', pages: 3 },
  { id: 'F6', note: '교정+보기 좋게', purpose: D, topic: '기존 보고서 맞춤법 교정하고 보기 좋게', volume: 'A4 기준 10', pages: 10 },
  // 디자인이 주제어일 뿐인 글 작성
  { id: 'W1', note: '디자인 트렌드 보고서 작성', purpose: D, topic: '디자인 트렌드 분석 보고서 작성', volume: 'A4 기준 5', pages: 5 },
  { id: 'W2', note: '포스터 주제 강의 원고(보수적 판정)', purpose: D, topic: '포스터 제작 방법 강의 원고 작성', volume: 'A4 기준 3', pages: 3 },
  // 학교 과제 경계
  { id: 'S1', note: '학교 과제 레포트', purpose: D, usePurpose: '학교 과제', topic: '광고 시장의 한계 레포트', volume: 'A4 기준 3', pages: 3 },
  { id: 'S2', note: '기타: 과제(수업)', purpose: D, usePurpose: '기타: 과제', topic: '경영학 수업 과제 정리', volume: 'A4 기준 4', pages: 4 },
  { id: 'S3', note: '수행평가', purpose: D, usePurpose: '기타: 수행평가', topic: '환경 문제 보고서', volume: 'A4 기준 2', pages: 2 },
  { id: 'S4', note: '대학교 교양 수업', purpose: D, usePurpose: '학교 과제', topic: '대학교 교양 수업 리포트', volume: 'A4 기준 5', pages: 5 },
  { id: 'N1', note: '정부 과제', purpose: D, usePurpose: '회사 업무', topic: '정부 과제 사업계획서 작성', volume: 'A4 기준 10', pages: 10 },
  { id: 'N2', note: '기업 과제', purpose: D, usePurpose: '회사 업무', topic: '기업 과제 결과 보고서 작성', volume: 'A4 기준 6', pages: 6 },
  { id: 'N3', note: '연구과제 교정', purpose: D, usePurpose: '기타: 연구과제', topic: '연구과제 최종보고서 교정', volume: 'A4 기준 12', pages: 12 },
  { id: 'N4', note: '국책 연구 과제(띄어씀)', purpose: D, usePurpose: '회사 업무', topic: '국책 연구 과제 중간보고서 작성', volume: 'A4 기준 8', pages: 8 },
  { id: 'R1', note: '회사 시장 리포트(남는 문제)', purpose: D, usePurpose: '회사 업무', topic: '시장 분석 리포트 작성', volume: 'A4 기준 5', pages: 5 },
  // 대조
  { id: 'C1', note: '녹취 30분', purpose: '속기(타이핑)', topic: '회의 녹취', volume: '30분' }
];

const rows = cases.map(c => {
  const input = { ...c }; delete input.id; delete input.note;
  const now = pricing.documentQuote(input);
  const next = P.proposedQuote(input);
  const nowRev = now.type === 'stenography' ? pricing.DOCUMENT_REVISIONS : now.includedRevisions;
  const nowView = { type: now.type, amount: now.amount, days: now.days, revisions: nowRev, school: Boolean(now.schoolAssignment) };
  const nextView = { type: next.type, kind: next.kind || null, amount: next.amount, days: next.days, revisions: next.revisions, school: Boolean(next.schoolAssignment) };
  const change = [];
  if (nowView.type !== nextView.type) change.push(`${nowView.type}→${nextView.type}`);
  if (nowView.school !== nextView.school) change.push(nowView.school ? '학교 과제 해제' : '학교 과제 지정');
  if (nextView.type !== 'scope_check' && nowView.type === nextView.type && nowView.amount !== nextView.amount) change.push('금액 변동(설계 오류)');
  return { id: c.id, note: c.note, now: nowView, next: nextView, change };
});

const w = n => n == null ? '—' : `${n.toLocaleString('ko-KR')}원`;
for (const r of rows) {
  console.log(`| ${r.id} | ${r.note} | ${r.now.type} · ${w(r.now.amount)} · ${r.now.days} · 수정 ${r.now.revisions}회${r.now.school ? ' · 학교' : ''} | ${r.next.type === 'scope_check' ? `범위 확인(${r.next.kind}) · 금액 없음 · 자동 발송 안 함${r.next.school ? ' · 학교' : ''}` : `${r.next.type} · ${w(r.next.amount)} · ${r.next.days} · 수정 ${r.next.revisions}회${r.next.school ? ' · 학교' : ''}`} | ${r.change.join(', ') || '같음'} |`);
}
const count = f => rows.filter(f).length;
const summary = {
  total: rows.length,
  changed: count(r => r.change.length > 0),
  toScopeCheck: count(r => r.next.type === 'scope_check' && r.now.type !== 'scope_check'),
  toFormatting: count(r => r.next.type === 'formatting' && r.now.type !== 'formatting'),
  schoolReleased: count(r => r.now.school && !r.next.school),
  schoolAdded: count(r => !r.now.school && r.next.school),
  otherTypeChange: count(r => r.now.type !== r.next.type && !['scope_check', 'formatting'].includes(r.next.type)),
  priceBugs: count(r => r.change.includes('금액 변동(설계 오류)')),
  netCalls: net
};
console.log(JSON.stringify(summary));
require('node:fs').writeFileSync(__dirname + '/probe-results.json', JSON.stringify({ syntheticInputs: true, summary, rows }, null, 2));
