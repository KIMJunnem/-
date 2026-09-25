'use strict';

// 속기사무소 도장 요청 삭제와 비상 판정 오탐·manual 모드 유료 호출 차단 회귀 검사.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let fetchCalls = 0;
global.fetch = async () => { fetchCalls += 1; throw new Error('network_disabled_in_test'); };
const server = require('../server/relay-server');
const { finalGradeMode } = require('../server/operating-policy');

// 1) 속기사무소 도장 판정
const seal = server.isSoomgoStenographySealRequest;
const realOption = '녹음, 속기사무소 도장 (녹취록), 가능한 빨리 진행하고 싶어요, 온라인 진행 원해요, 고수와 상담 시 논의할게요';
assert.equal(seal({ purpose: '속기(타이핑)', volume: realOption }), true, '실제 숨고 선택지');
assert.equal(seal({ purpose: '이력서/자소서 컨설팅', volume: realOption }), true, '서비스 오분류여도 도장 요청은 삭제');
assert.equal(seal({ purpose: '속기(타이핑)', topic: '법원 제출용 녹취록에 직인 필요합니다' }), true, '녹취록 직인');
assert.equal(seal({ purpose: '속기(타이핑)', volume: '통화녹음 6-7분가량(중략가능)' }), false, '일반 속기');
assert.equal(seal({ purpose: '속기(타이핑)', volume: '전체 36분 분량에서 3분 54초 녹취록 작성' }), false, '일반 녹취록');
assert.equal(seal({ purpose: '문서/글 작성', topic: '번역 인증 도장같은것이 필요하고, 공증은 필요없습니다.' }), false, '번역 인증은 이 규칙 대상 아님');
assert.equal(seal({ purpose: '속기(타이핑)', topic: '녹취록 작성, 속기사무소 도장은 필요 없어요' }), false, '도장 불필요 명시');
assert.equal(seal({ purpose: '영상 편집', text: `영상 편집\n자세히 보기\n다른 카드: ${realOption}\n자세히 보기` }), false, '목록 카드가 섞인 text는 판정에 쓰지 않음');
assert.equal(seal({ text: `요청 상세\n속기(타이핑)\n${realOption}\n삭제하기` }), true, '새 봇의 상세 화면 text');

// 2) 견적 경로와 요청 봇 연결
const serverSource = fs.readFileSync(path.join(root, 'server/relay-server.js'), 'utf8');
assert.match(serverSource, /if \(isSoomgoStenographySealRequest\(request\)\) \{[\s\S]{0,400}quote\.deleteRequest = true;/);
const botSource = fs.readFileSync(path.join(root, 'soomgo-bot-extension/content-v3.js'), 'utf8');
// 0.4.15: 삭제 대상도 봇은 삭제하지 않고 승인 대기로 건너뛴다(준희 지시: 삭제는 허락받고)
assert.match(botSource, /if \(quote\.deleteRequest === true\) \{[\s\S]{0,400}삭제 승인 대기\(봇은 삭제하지 않음\)/);
assert.ok(botSource.indexOf('quote.deleteRequest === true') < botSource.indexOf('if (quote.manualReview || quote.autoSend === false)'), '삭제 분기가 일반 건너뜀보다 먼저');

// 3) 비상 판정 오탐
const emergency = server.isSoomgoEmergencySignal;
const ask = { message: '언제까지 가능하신가요?' };
for (const history of ['답변 주시면 안내드리겠습니다', '답장 주시면 바로 안내해 드릴게요', '편하게 답변 남겨주시면 안내', '파일 전송 안내드립니다']) {
  assert.equal(emergency({ ...ask, conversationText: history }, {}), false, `오탐: ${history}`);
}
assert.equal(emergency({ message: '답변이 안 와요' }, {}), true, '실제 미답변 불만');
assert.equal(emergency({ message: '파일 전송 실패했어요' }, {}), true, '전송 실패');
// 2026-09-22: 대화 이력만으로는 비상으로 막지 않는다(이력 때문에 평범한 질문에 답장이 막힌 사례). 지금 메시지가 말할 때만 비상.
assert.equal(emergency({ ...ask, conversationText: '첨부 안 돼요' }, {}), false, '이력만으로는 비상 아님');
assert.equal(emergency({ message: '첨부가 안 돼요' }, {}), true, '지금 메시지의 첨부 실패는 비상');

// 4) manual 모드에서는 비상 경로도 유료 모델 미호출
(async () => {
  assert.equal(finalGradeMode(), 'manual');
  const reply = await server.invokeSoomgoEmergencyAstra({ message: '봇이 고장났어요' }, { autoSend: true });
  assert.equal(fetchCalls, 0, 'manual 모드에서 외부 호출 없음');
  assert.equal(reply.autoSend, false);
  assert.equal(reply.manualReview, true);
  assert.equal(reply.emergencyAstraStatus, 'skipped_manual_mode');
  assert.equal(reply.emergencyAstraAttempted, true, '같은 메시지 재평가 시 반복 처리 방지');
  console.log('stenography-seal-emergency: PASS');
})().catch(error => { console.error(error); process.exit(1); });
