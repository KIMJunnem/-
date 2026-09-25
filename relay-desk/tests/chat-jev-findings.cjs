'use strict';

// 제브 시뮬레이션(2026-09-21)에서 찾은 채팅 오판 회귀 검사.
const assert = require('node:assert/strict');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { soomgoReply, isSoomgoSystemMessage } = require('../server/relay-server');
const reply = message => soomgoReply({ conversationId: '235000777', message });

// 1) 숨고 시스템 알림에는 답장하지 않는다
for (const notice of ['거래가 성사됐다면, 고용을 요청해 주세요\n\n고용 횟수와 고객 리뷰를 모두 챙길 수 있어요.', '숨고 알리미\n고객이 숨고페이 5,000원 쿠폰을 받았어요.\n쿠폰 이름: 신규 가입 고수 쿠폰 이벤트', '숨고 알리미\n미접속 견적 보상\n보너스 캐시로 보상해드렸습니다.']) {
  assert.equal(isSoomgoSystemMessage(notice), true, notice.slice(0, 20));
  assert.equal(reply(notice).skip, true);
}
// 고객이 직접 쓴 고용 질문은 시스템 알림이 아니다
assert.equal(isSoomgoSystemMessage('고용 요청해도 될까요?'), false);
// 2) 금액을 먼저 묻는 질문은 고용 동의가 아니다
const priceFirst = reply('금액을 먼저 알고 진행하고 싶은데 그건 안되는건가요?');
assert.notEqual(priceFirst.templateKey, 'ask_hire_consent');
assert.match(priceFirst.templateKey, /price/);
// 진행 의사는 그대로 고용 확인으로 간다
assert.equal(reply('네 이대로 진행하고 싶습니다').templateKey, 'ask_hire_consent');
// 3) 금액 확인 질문은 가격 답변으로
for (const m of ['41000원인가요?', '28000원 이라는건가요?']) assert.match(reply(m).templateKey, /price/, m);
// 4) 무료 수정 확인은 수정 정책 답변으로
assert.match(reply('1차 수정까진 무료라면서요').templateKey, /revision_policy/);
console.log('chat-jev-findings: PASS');
