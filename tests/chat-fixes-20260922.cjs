'use strict';

// 2026-09-22 고객 답장 점검에서 나온 오답 회귀 검사(…8811·…8839·…3346·…1234·…1904·…0768).
const assert = require('node:assert/strict');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { soomgoReply, isSoomgoSystemMessage, isSoomgoEmergencySignal, buildSoomgoQuote } = require('../server/relay-server');
const autoRules = require('../server/soomgo-auto-rules');
const registry = require('../server/service-registry');
const reply = message => soomgoReply({ conversationId: '235000970', message });

// 4) 수정 비용 질문에 '범위 추가 금액'으로 답하지 않는다
const rev = reply('수정 1회밖에 안되고 2회부터는 추가요금이 붙는건가요??? 얼마가 붙나요???');
assert.equal(rev.templateKey, 'revision_fee_info');
assert.match(rev.text, /자막은 수정 2회, 문서는 수정 3회.*1회 10,000원/);
assert.ok(!/이대로 진행할까요/.test(rev.text));
assert.ok(!/기본 0원/.test(reply('수정 몇 번까지 무료인가요? 추가 수정은 얼마예요?').text));
// 5) 기다려 달라는 말에는 짧게 받는다(질문은 제외)
for (const m of ['아직 초안이 안나와서', '좀 기다려야 할거 같아요..']) {
  const r = reply(m);
  assert.equal(r.templateKey, 'guard_customer_waiting', m); assert.equal(r.text, '네, 준비되시면 편하게 보내주세요.');
}
assert.notEqual(reply('기다려야 하나요?').templateKey, 'guard_customer_waiting');
// 6) 도면·CAD·물량 산출: 채팅은 정중히 불가, 요청은 자동 삭제. '가능합니다'로 단정하지 않는다
assert.equal(reply('기계설비 덕트 물량 오토캐드로 물량 산출 가능하신지요?').templateKey, 'guard_unsupported_cad');
assert.ok(!/진행 가능합니다/.test(reply('이거 가능하신가요?').text));
const cad = { requestId: 'CAD1', text: '요청 상세\n문서/글 작성\n\n작성 주제\n기계설비 덕트 물량 오토캐드로 물량 산출\n작업 분량\nA4 3쪽\n' };
const built = buildSoomgoQuote(cad);
assert.equal(autoRules.applySoomgoAutoRules({ body: cad, request: built.parsed, quote: built.quote, state: {}, requestId: 'CAD1', supportedServiceIds: registry.listServices({ channel: 'soomgo' }).map(s => s.id) }).ruleId, 'cad_quantity');
// 7) 숨고 앱 안내문은 시스템 알림
assert.equal(isSoomgoSystemMessage('날짜를 클릭하면 요청서 정보를 캘린더에 자동으로 입력해 드려요. *앱에서만 지원되는 기능입니다. 오전 6:13'), true);
// 8) 대화 이력·첨부 오류만으로는 비상 판정하지 않는다. 고객이 봇 오류를 직접 말하면 비상
assert.equal(isSoomgoEmergencySignal({ message: '견적이 어떻게 되나요?', conversationText: '[고객] 파일 전송이 안 돼요' }, { reason: '첨부 판독 꺼짐', manualReview: true }), false);
assert.equal(isSoomgoEmergencySignal({ message: '0921 미팅 자료.hwp', attachmentError: 'cors_blocked' }, {}), false);
assert.equal(isSoomgoEmergencySignal({ message: '채팅봇이 이상해요 계속 같은 말 반복해요' }, {}), true);
console.log('chat-fixes-20260922: PASS');
