// 접수 폼: 숨고 요청서에서 확인된 항목은 묻지 않고, 고객이 번호·자연어·
// 부분 응답 중 어느 방식으로 답해도 읽어야 한다. 폼을 보낸 적 없는 대화는
// 기존 흐름 그대로여야 한다.
const assert = require('node:assert/strict');
const {
  soomgoReply,
  buildIntakeForm,
  parseIntakeReply,
  intakeFromParsedRequest
} = require('../server/relay-server.js');

const quote = { amount: 29000, days: '당일~1일' };
let checks = 0;
const ok = name => { checks += 1; console.log(`[PASS] ${name}`); };

let seq = 0;
const answer = (message, form) => soomgoReply({
  conversationId: `INTAKE-${Date.now()}-${seq += 1}`,
  message,
  conversationText: `[내 답변] ${form}`,
  quote
});

// 1) 요청서가 비어 있으면 4가지를 모두 묻는다.
{
  const form = buildIntakeForm({}, { label: '보고서' });
  assert.equal(form.asked.length, 4, `빈 요청서인데 ${form.asked.length}개만 물었습니다.`);
  for (const label of ['용도', '분량', '마감', '자료']) assert.match(form.text, new RegExp(label));
  assert.match(form.text, /예\) 1-1/, '답변 예시가 없습니다.');
  ok('요청서에 정보가 없으면 4가지를 번호로 묻는다');
}

// 2) 요청서에 이미 적힌 항목은 묻지 않고 확인만 한다.
{
  const parsed = { purpose: '보고서', pages: 3, volume: 'A4 3장', deadline: '내일', text: '회사 업무용 보고서' };
  const known = intakeFromParsedRequest(parsed);
  assert.equal(known.volume, 'A4 3~5쪽');
  assert.equal(known.deadline, '내일');
  assert.equal(known.purpose, '회사·업무');
  const form = buildIntakeForm(parsed, { label: '보고서' });
  assert.deepEqual(form.asked, ['materials'], `묻는 항목이 ${form.asked.join(',')}입니다.`);
  assert.match(form.text, /요청서에서 .*확인했습니다/);
  assert.doesNotMatch(form.text, /\d\.\s*분량/, '이미 적힌 분량을 다시 물었습니다.');
  ok('요청서에 적힌 항목은 확인만 하고 빠진 항목만 묻는다');
}

// 3) 참고자료 안내가 항상 붙는다 (큰 파일은 메일)
{
  const form = buildIntakeForm({}, { label: '보고서' });
  assert.match(form.text, /이미지나 영상/, '참고자료 안내가 없습니다.');
  assert.match(form.text, /pd960723@gmail\.com/, '대용량 파일 메일 안내가 없습니다.');
  assert.match(form.text, /용량이 커서 첨부되지 않는 파일만/, '메일을 조건부가 아닌 기본 연락처처럼 안내했습니다.');
  ok('참고 이미지·영상 안내와 대용량 파일 메일 안내가 포함된다');
}

// 4) 번호 답변을 읽는다 (①②③, 1-2, 숫자 나열)
{
  const asked = ['purpose', 'volume', 'deadline', 'materials'];
  const byPair = parseIntakeReply('1-2, 2-2, 3-2, 4-1', asked);
  assert.equal(byPair.purpose, '학교 과제');
  assert.equal(byPair.volume, 'A4 3~5쪽');
  assert.equal(byPair.deadline, '내일');
  assert.equal(byPair.materials, '고객 자료 제공');

  const byCircled = parseIntakeReply('1-①, 2-③', ['purpose', 'volume']);
  assert.equal(byCircled.purpose, '회사·업무');
  assert.equal(byCircled.volume, 'A4 6쪽 이상');

  const bySequence = parseIntakeReply('2 2 3 1', asked);
  assert.equal(bySequence.purpose, '학교 과제');
  assert.equal(bySequence.deadline, '3일 이내');
  ok('번호 답변을 세 가지 표기(1-2 / ① / 숫자 나열)로 읽는다');
}

// 5) 자연어로 답해도 읽는다
{
  const natural = parseIntakeReply('학교 과제고요 A4 2장이요 내일까지 되나요? 자료는 제가 드릴게요', ['purpose', 'volume', 'deadline', 'materials']);
  assert.equal(natural.purpose, '학교 과제');
  assert.equal(natural.volume, 'A4 1~2쪽');
  assert.equal(natural.deadline, '내일');
  assert.equal(natural.materials, '고객 자료 제공');
  ok('번호 없이 자연어로 답해도 네 항목을 읽는다');
}

// 6) 전부 채워지면 되묻지 않고 확정 안내로 넘어간다.
{
  const form = buildIntakeForm({}, { label: '보고서' }).text;
  const reply = answer('1-1, 2-2, 3-2, 4-1 / 주제: 광고시장의 한계', form);
  assert.equal(reply.templateKey, 'intake_complete', `templateKey=${reply.templateKey}`);
  assert.equal(reply.autoSend, true);
  assert.match(reply.text, /29,000원/);
  assert.match(reply.text, /고용 요청/);
  ok('네 항목이 모두 채워지면 견적·진행 안내로 바로 넘어간다');
}

// 7) 일부만 답하면 폼 전체가 아니라 빠진 항목 하나만 다시 묻는다.
{
  const form = buildIntakeForm({}, { label: '보고서' }).text;
  const reply = answer('1-2, 2-2', form);
  assert.equal(reply.templateKey, 'intake_followup', `templateKey=${reply.templateKey}`);
  assert.match(reply.text, /마감/, '빠진 항목을 묻지 않았습니다.');
  assert.doesNotMatch(reply.text, /\d\.\s*용도/, '폼 전체를 다시 보냈습니다.');
  assert.match(reply.text, /확인했습니다/, '이미 받은 답을 확인해주지 않았습니다.');
  ok('일부만 답하면 빠진 항목 하나만 다시 묻는다');
}

// 8) 자료조사를 고르면 추가금 안내가 함께 나간다.
{
  const form = buildIntakeForm({}, { label: '보고서' }).text;
  const reply = answer('1-1, 2-1, 3-3, 4-2', form);
  assert.equal(reply.templateKey, 'intake_complete');
  assert.match(reply.text, /자료조사는 추가 옵션/, '자료조사 추가금 안내가 없습니다.');
  ok('자료조사를 고르면 추가금 사전 안내가 함께 나간다');
}

// 9) 폼을 보낸 적 없는 대화는 기존 흐름 그대로다.
{
  const before = soomgoReply({ conversationId: 'NO-FORM-1', message: '오늘까지 되나요?', conversationText: '[고객] 표준 레포트 2장', quote });
  assert.equal(before.templateKey, 'deadline_commitment', `기존 흐름이 바뀌었습니다: ${before.templateKey}`);
  const price = soomgoReply({ conversationId: 'NO-FORM-2', message: '가격이 얼마인가요?', conversationText: '[고객 요청] 교정', quote });
  assert.match(price.templateKey, /^auto_price/, `기존 흐름이 바뀌었습니다: ${price.templateKey}`);
  ok('폼을 보내지 않은 대화는 기존 응답 흐름을 그대로 유지한다');
}

// 10) 폼 대화여도 금지 요청은 계속 차단한다.
{
  const form = buildIntakeForm({}, { label: '보고서' }).text;
  const thesis = answer('1-2, 2-3, 3-4, 4-1 인데 석사 학위 논문입니다', form);
  assert.equal(thesis.manualReview, true, '폼 흐름이 논문 차단을 우회했습니다.');
  assert.equal(thesis.templateKey, 'manual_academic');
  const school = answer('1-2, 2-2, 3-2, 4-1 대학교 과제 레포트예요', form);
  assert.equal(school.manualReview, false, '학교 과제가 차단되었습니다.');
  ok('폼 흐름에서도 논문은 차단되고 학교 과제는 접수된다');
}

console.log(`${checks} intake form checks passed.`);
