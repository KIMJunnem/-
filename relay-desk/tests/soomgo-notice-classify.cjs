'use strict';
// 2026-09-23(감독 지시 2): 숨고 안내 3종이 고객 글로 읽혀 자동답장·결제 확인으로 빠지지 않는다.
// 9/16~9/21 기록에서 실제로 빠졌던 원문(9/22 시스템 알림 규칙 이후 판정 고정용). 외부 호출 없음.
const assert = require('assert');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { soomgoReply, isSoomgoSystemMessage, isHumanSoomgoCustomerReply } = require('../server/relay-server.js');
const quote = { amount: 30000, days: '1~2일', serviceId: 'document_writing' };
const ask = message => soomgoReply({ conversationId: '235999990', message, quote, conversationText: `[고수] 견적 30,000원\n[고객] ${message}` });

const notices = {
  hire: '거래가 성사됐다면, 고용을 요청해 주세요 고용 횟수와 고객 리뷰를 모두 챙길 수 있어요.',
  calendar: '날짜를 클릭하면 요청서 정보를 캘린더에 자동으로 입력해 드려요. *앱에서만 지원되는 기능입니다. 오전 6:13',
  pay: '숨고페이 안전결제 잊지 않으셨죠? 😉 메시지를 입력하세요.'
};
for (const [name, text] of Object.entries(notices)) {
  assert.equal(isSoomgoSystemMessage(text), true, name);
  assert.equal(isHumanSoomgoCustomerReply({ conversationId: '235999990', incoming: text }), false, `${name}: 깔때기 답장 수에서 빠짐`);
  const r = ask(text);
  assert.equal(r.autoSend, false, `${name}: 자동답장 안 함`);
  assert.equal(r.skip, true, `${name}: 건너뜀`);
  assert.notEqual(r.templateKey, 'manual_billing', `${name}: 결제 확인으로 안 빠짐`);
  assert.notEqual(r.templateKey, 'auto_general', name);
  assert.equal(r.text || '', '', `${name}: 보낼 글 없음`);
}
// 대조: 진짜 고객 글은 알림이 아니다
const customer = { hire: '고용 요청 드리면 될까요?', calendar: '캘린더에 일정 넣어두셨나요?', pay: '숨고페이로 결제하면 되나요?' };
for (const [name, text] of Object.entries(customer)) {
  assert.equal(isSoomgoSystemMessage(text), false, name);
  assert.equal(isHumanSoomgoCustomerReply({ conversationId: '235999990', incoming: text }), true, name);
  assert.notEqual(ask(text).skip, true, `${name}: 고객 글은 건너뛰지 않음`);
}
console.log('soomgo-notice-classify: PASS');
process.exit(0);
