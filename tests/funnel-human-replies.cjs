// 2026-09-23: 깔때기 답장 수는 고객이 직접 쓴 말만 센다(자동 알림·테스트·나감·우리 문구 되돌아옴 제외).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isHumanSoomgoCustomerReply: human } = require('../server/relay-server.js');
const real = '235864997';
// 제외
for (const incoming of [
  '고객님이 견적을 읽었습니다',
  '답변을 빨리 받고 싶다면 채팅을 보내보세요 🗣️ 메시지를 입력하세요.',
  '거래가 성사됐다면, 고용을 요청해 주세요 고용 횟수와 고객 리뷰를 모두 챙길 수 있어요.',
  '숨고페이 안전결제 잊지 않으셨죠? 😉 메시지를 입력하세요.',
  '숨고페이 고객에게 거래 확정을 요청했어요 9월 18일 (금) 오후 8:59까지',
  '홍길동 님이 채팅방을 나갔습니다.',
  '안녕하세요. 자기소개서 요청 확인했습니다. 【견적 금액】 원가 50,000원',
  '오후 2:08',
  ''
]) assert.equal(human({ conversationId: real, incoming }), false, incoming);
// 테스트 대화(숫자 대화 번호가 아님)
assert.equal(human({ conversationId: 'TEST-RESEARCH', incoming: '자료조사는 안하세요?' }), false);
assert.equal(human({ conversationId: 'SIM-NEW-1789843224809-1', incoming: '좋아요 진행해주세요' }), false);
assert.equal(human({ conversationId: '', incoming: '가격이 얼마예요?' }), false);
// 포함(실제 고객 말)
for (const incoming of ['내일 연락드리겠습니다!', '장당39000원인가요?', '견적 금액이 얼마예요?', '# 미팅 자료 (2).hwp 336 KB 오후 4:30', '네'])
  assert.equal(human({ conversationId: real, incoming }), true, incoming);
// 깔때기 코드가 이 판정을 쓰고, 견적은 발송 확인된 것만 센다
const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
const start = src.indexOf("pathname === '/api/soomgo/revenue-funnel'");
const block = src.slice(start, start + 6000);
// 9/24 지시 30: 우리 문구가 되읽힌 것도 빼려고 방별 우리 문구 앞부분(ourHeads)을 같이 넘긴다
assert.match(block, /replies\.filter\(item => isHumanSoomgoCustomerReply\(item(?:, ourHeads)?\)\)/);
assert.match(block, /item\.quoteEvidence\?\.status === 'sent'/);
assert.doesNotMatch(block, /\/견적\.\*\(발송\|완료\)\//, "'견적 계산 완료'를 발송으로 세던 규칙은 없어야 한다");
assert.match(block, /quotedLeads\.has\(lead\)/, '서비스별 견적 수는 대화 번호가 아니라 요청 단위로');
assert.match(block, /humanConversations: humanConversationIds\.size/);
console.log('funnel-human-replies: PASS');
