'use strict';
// 지시 12 수정안의 시험 구현(샌드박스 전용). PC 서버 파일은 고치지 않는다.
const pricing = require('../../../server/pricing-table.js');

const fieldsOf = p => [p.purpose, p.usePurpose, p.topic, p.scope, p.notes, p.volume].filter(Boolean).join(' ');

// 1) 그림·도표를 새로 만드는 시각 제작: 내용 유지 여부와 상관없이 범위 확인
const VISUAL_MAKE = /인포\s*그래픽|포스터|카드\s*뉴스|도식|다이어그램|일러스트|배너|전단지?|리플렛|브로슈어|로고|썸네일/;
// 2) '디자인'이 작업 요청으로 쓰인 경우(주제어로 쓰인 '디자인 트렌드' 등은 제외)
const DESIGN_TASK = /디자인\s*(?:해|작업|부탁|요청|의뢰|필요|만|좀|을|를|으로|$)|(?:보기\s*좋게|예쁘게|깔끔하게|세련되게)\s*(?:디자인|꾸며)/;
// 3) 이미 있는 문서를 다루는 요청
const EXISTING_DOC = /기존|이미\s*(?:있는|작성|만든|만들어)|작성된|완성된|만들어\s*둔|초안|원본|가지고\s*있는/;
// 4) 내용은 그대로 둔다는 말
const KEEP_CONTENT = /내용\s*(?:은|을|이)?\s*(?:그대로|유지|수정\s*없이|손대지|건드리지)|내용은\s*다\s*(?:되어|돼)|(?:양식|서식|디자인|레이아웃|편집|모양)\s*만/;
// 5) 지금 서식 정리 정규식(pricing-table.js:43) 그대로
const CURRENT_FORMAT = /양식|서식|편집|레이아웃|디자인만|깔끔하게|다듬|정리만|내용은\s*다\s*(?:되어|돼)/;

function proposedWorkType(parsed = {}) {
  const service = String(parsed.purpose || '');
  const detail = [parsed.purpose, parsed.topic, parsed.scope, parsed.notes, parsed.volume].filter(Boolean).join(' ');
  if (/속기|타이핑|녹취/.test(service) || /녹취\s*록|녹음\s*(?:파일)?\s*(?:을|를)?\s*(?:문서|텍스트|타이핑)/.test(detail)) return { type: 'stenography' };
  if (/교정|교열|윤문/.test(service) || /교정|교열|윤문|맞춤법|첨삭/.test(detail)) return { type: 'proofreading' };
  if (VISUAL_MAKE.test(detail)) return { type: 'scope_check', kind: 'visual_design' };
  const designTask = DESIGN_TASK.test(detail) || /디자인/.test(service);
  const existing = EXISTING_DOC.test(detail);
  const keep = KEEP_CONTENT.test(detail);
  if (designTask || (existing && /보기\s*좋게|예쁘게|꾸며/.test(detail))) {
    return keep ? { type: 'formatting' } : { type: 'scope_check', kind: existing ? 'existing_doc_redesign' : 'design_unclear' };
  }
  if (CURRENT_FORMAT.test(detail)) return { type: 'formatting' };
  return { type: 'writing' };
}

// 학생 단서가 있을 때만 학교 과제. '과제' 앞에 연구·기업·정부 등이 붙으면 학생 단서가 아니다.
const STUDENT_CUE = /학교\s*과제|수업|레포트|리포트|교양|교수님|조별|팀플|수행\s*평가|대학생|학부생|대학(?:교)?\s*(?:과제|레포트|리포트|수업|강의)|기말|중간\s*고사/;
const NON_STUDENT_TASK = /(?:연구|기업|회사|정부|국책|국가|용역|사업|기관|지원)\s*과제/g;
function proposedIsSchoolAssignment(parsed = {}) {
  const fields = [parsed.usePurpose, parsed.purpose, parsed.topic, parsed.notes, parsed.scope].filter(Boolean).join(' ');
  if (STUDENT_CUE.test(fields)) return true;
  return /과제/.test(fields.replace(NON_STUDENT_TASK, ' '));
}

const QUESTIONS = {
  visual_design: '원하시는 게 글과 표를 보기 좋게 정리하는 것인지, 그림·도표를 새로 그리는 디자인 작업인지 여쭤봐도 될까요?',
  existing_doc_redesign: '가지고 계신 문서의 내용은 그대로 두고 제목·문단·표 모양만 정리해 드리면 될까요?',
  design_unclear: '원하시는 게 글과 표를 보기 좋게 정리하는 것인지, 그림·도표를 새로 그리는 디자인 작업인지 여쭤봐도 될까요?'
};

function proposedQuote(parsed = {}) {
  const decided = proposedWorkType(parsed);
  const school = proposedIsSchoolAssignment(parsed);
  if (decided.type === 'scope_check') {
    return { type: 'scope_check', kind: decided.kind, amount: null, days: null, revisions: null, schoolAssignment: school, autoSend: false, manualReview: true, question: QUESTIONS[decided.kind] };
  }
  const q = pricing.documentQuote(parsed, { type: decided.type });
  const revisions = decided.type === 'stenography' ? pricing.DOCUMENT_REVISIONS : (school ? pricing.SCHOOL_REVISIONS : pricing.DOCUMENT_REVISIONS);
  return { type: q.type, amount: q.amount, days: q.days, revisions, schoolAssignment: decided.type === 'stenography' ? false : school };
}

module.exports = { proposedWorkType, proposedIsSchoolAssignment, proposedQuote, QUESTIONS };
