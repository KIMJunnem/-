'use strict';

// 2026-09-22: 숨고 시스템 알림은 답장하지 않는다(system_notice) + 시뮬레이션 표본에서 시험 메시지(같은 본문 3회 이상) 제외
const assert = require('node:assert/strict');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { soomgoReplyGuard } = require('../server/reply-guards');
const { soomgoReply } = require('../server/relay-server');
const sim = require('../server/jev-simulation');
const reply = message => soomgoReply({ conversationId: '235999997', message });

// 1) 실제 기록에 있던 알림 원문: 모두 system_notice, 자동 답장 없음
const notices = [
  '거래가 성사됐다면, 고용을 요청해 주세요\n\n고용 횟수와 고객 리뷰를 모두 챙길 수 있어요.',
  '숨고 알리미\n고객이 숨고페이 5,000원 쿠폰을 받았어요.\n쿠폰 이름: 신규 가입 고수 쿠폰 이벤트\n할인 금액: 5,000원',
  '숨고 알리미\n미접속 견적 보상\n고객이 48시간 동안 견적을 읽지 않아서 견적 발송에 사용된 1490캐시를 보너스 캐시로 보상해드렸습니다.\n\n오후 9:58',
  '숨고페이\n고객에게 거래 확정을\n요청했어요\n9월 18일 (금) 오후 8:59까지 고객이 거래 확정을 안하면 자동으로 거래 확정이 한 번 더 요청돼요.',
  '숨고페이\n서비스를 진행해 주세요\n서비스를 진행하고 고객님께 거래확정을 요청해보세요.',
  '숨고페이 안전결제 잊지 않으셨죠? 😉\n\n메시지를 입력하세요.',
  '숨고 알리미\n휴대폰 번호 또는\n계좌번호를 받으셨나요?\n직접 거래는 사기나 피싱 위험이 있을 수 있어요.',
  '숨고 알리미\n고용이 확정됐어요\n9월 17일 (목) 오후 5:36분까지\n취소를 요청할 수 있어요.'
];
for (const m of notices) {
  const r = reply(m);
  assert.equal(r.templateKey, 'system_notice', m);
  assert.equal(r.intent, 'system_notice', m);
  assert.equal(r.autoSend, false, m);
  assert.equal(r.skip, true, m);
  assert.equal(r.text || '', '', m);
}
// 요청사항 추가 알림: 답장은 없고 사람 확인
const added = reply('숨고 알리미\n고객이 요청사항을 추가했습니다.\n\n워드 문서 한글로 편집.\n\n확인하기');
assert.equal(added.templateKey, 'system_notice'); assert.equal(added.autoSend, false); assert.equal(added.manualReview, true);

// 2) 고객이 직접 쓴 말은 알림이 아니다
for (const m of ['숨고페이로 결제했어요', '숨고페이 결제 완료했습니다 확인 부탁드려요', '숨고 알리미 떴는데 이거 뭐예요?', '거래 확정은 언제 하면 되나요?']) {
  assert.notEqual(soomgoReplyGuard(m)?.templateKey, 'system_notice', m);
}

// 3) 시뮬레이션 표본: 같은 본문 3회 이상은 제외, 2회까지는 유지(공백 차이는 같은 본문)
const records = [
  { incoming: '이 작업 가격이 얼마인가요?' }, { incoming: '이 작업  가격이 얼마인가요?' }, { incoming: '이 작업 가격이 얼마인가요?\n' },
  { incoming: '내일까지 가능해요?' }, { incoming: '내일까지 가능해요?' },
  { incoming: '자막 10분짜리 부탁드려요' }
];
const kept = sim.dropRepeated(records, r => r.incoming).map(r => r.incoming.trim());
assert.equal(sim.REPEATED_TEXT_MIN, 3);
assert.deepEqual(kept, ['내일까지 가능해요?', '내일까지 가능해요?', '자막 10분짜리 부탁드려요']);
const deps = { replyGuard: soomgoReplyGuard };
const items = sim.buildItems({ soomgoReplies: [...records.map((r, i) => ({ id: `R${i}`, ...r })), { id: 'N1', incoming: notices[0] }] }, 'chat_intent', deps);
assert.equal(items.length, 4);
assert.equal(items.find(item => item.key === 'N1').compare.rule.intent, 'system_notice');

console.log('system-notice-guard: PASS');
process.exit(0);
