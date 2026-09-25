// 넓은 낱말(자료·파일·진행·페이지)이 구체적인 문의(파일 형식·보안·
// 비대면·목차)를 가려 동문서답하던 문제와, 영문 학위·학술 대필 요청이
// 한글 규칙을 통과하던 문제를 고정한다. API 키 없이 결정형 답변만으로
// 확인한다.
const assert = require('node:assert/strict');
const { soomgoReply } = require('../server/relay-server.js');

const quote = { amount: 29000, days: '당일~1일', basicScope: 'A4 5쪽·수정 1회' };
let index = 0;
const ask = (message, history = '') => soomgoReply({
  conversationId: `INTENT-${Date.now()}-${index += 1}`,
  message,
  conversationText: history,
  quote
});

const routing = [
  { name: '파일 형식 문의가 자료 안내에 가려지지 않는다', message: '완성본은 워드하고 PDF 두 파일로 받을 수 있나요?', expect: /워드/, also: /PDF/ },
  { name: '보안 문의가 자료 안내에 가려지지 않는다', message: '회사 내부자료라 외부 유출이 걱정되는데 비밀 보장되나요?', expect: /비밀|보안/ },
  { name: '비대면 문의가 진행 절차 안내에 가려지지 않는다', message: '통화 없이 온라인 채팅으로만 진행 가능한가요?', expect: /온라인|비대면|채팅/ },
  { name: '목차·요약 문의가 분량 안내에 가려지지 않는다', message: '첫 페이지에 목차하고 핵심 요약도 넣어줄 수 있나요?', expect: /목차|요약/ },
  { name: '자료조사 문의가 자료 안내에 가려지지 않는다', message: '참고자료 자료조사도 해주시나요?', expect: /자료조사|조사/ },
  { name: '수정 횟수 문의는 그대로 유지된다', message: '기본 수정은 몇 번까지 가능한가요?', expect: /1회|한 번/ },
  { name: '분량 문의는 그대로 유지된다', message: '최대 몇 페이지까지 작업할 수 있나요?', expect: /페이지|분량|쪽/ },
  { name: '가격 문의는 그대로 유지된다', message: '이 작업 가격이 얼마인가요?', expect: /29,000원/ }
];

for (const item of routing) {
  const reply = ask(item.message, '[고객 요청] 회사 소개문 A4 5쪽 교정');
  assert.equal(reply.autoSend, true, `${item.name}: 자동 답변이 아닙니다 (${reply.templateKey})`);
  assert.match(reply.text || '', item.expect, item.name);
  if (item.also) assert.match(reply.text || '', item.also, item.name);
  console.log(`[PASS] ${item.name}`);
}

const academic = [
  { name: '영문 학위 논문 대필은 자동 답변하지 않는다', message: 'Please write my master thesis from scratch.', blocked: true },
  { name: '영문 학위논문(dissertation) 대필은 자동 답변하지 않는다', message: 'Can you write my dissertation chapter?', blocked: true },
  { name: '한글 문장 속 영문 thesis도 차단한다', message: '제 thesis 좀 대신 써주세요', blocked: true },
  { name: '학술지 원고는 자동 답변하지 않는다', message: 'I need help with my journal manuscript', blocked: true },
  { name: '한글 학위 논문 대필은 계속 차단한다', message: '석사 학위 논문을 처음부터 대신 작성해주세요.', blocked: true },
  { name: '학교 과제 레포트는 계속 접수한다', message: '대학교 과제 레포트를 처음부터 대신 써주세요.', blocked: false },
  { name: '영문 term paper 교정은 접수한다', message: 'Can you proofread my term paper?', blocked: false },
  { name: '회사 보고서 작성은 접수한다', message: 'Please write a report about our sales', blocked: false }
];

for (const item of academic) {
  const reply = ask(item.message);
  const isBlocked = Boolean(reply.manualReview && reply.templateKey === 'manual_academic');
  assert.equal(isBlocked, item.blocked, `${item.name}: templateKey=${reply.templateKey} manual=${reply.manualReview}`);
  console.log(`[PASS] ${item.name}`);
}

console.log(`${routing.length + academic.length} intent routing and academic policy checks passed.`);
