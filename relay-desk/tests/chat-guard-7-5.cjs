'use strict';

// 채팅 답장 안전 수정 (2026-09-24 개발방 지시 17, decisions 7-5 — "켜기"는 준희가 chatbot-on.bat로 직접).
// 합성 대화만. 실제 숨고 발송·유료 API 호출 없음(Claude는 가짜 함수).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const R = require('../server/relay-server');
const fb = require('../server/customer-room-fallback');
const root = path.join(__dirname, '..');

// 0) 스위치는 준희가 chatbot-on/off.bat로 정한다(9/24 지시 24). 실제 값은 세 스위치가 함께 움직였는지만 보고,
//    안전장치(금지 주제·한도·금액 차단)는 아래에서 켜짐 설정으로 확인한다. 금지 주제·금액 차단은 스위치와 상관없이 늘 적용된다.
const policy = JSON.parse(fs.readFileSync(path.join(root, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));
const realOn = policy.soomgoChat.sendEnabled;
assert.equal(typeof realOn, 'boolean');
assert.equal(policy.customerRoomFallback.enabled, realOn);
assert.equal(policy.customerRoomFallback.claudeEnabled, realOn);
assert.equal(policy.customerRoomFallback.dailyMaxCalls, 40);
assert.equal(policy.customerRoomFallback.monthlyBudgetKrw, 15000);
assert.equal(policy.customerRoomFallback.model, 'claude-opus-5-5');

// 1) 합성 대화 → 결정형 답 + 정책 보정 → 자동 답/Claude 대상/준희 알림
const sq = { serviceId: 'subtitle', label: '자막 제작', amount: 49000, regularAmount: 49000, days: '당일~1일', includedRevisions: 2 };
const vq = { serviceId: null, label: '영상 편집', amount: 69000, days: '1~2일', includedRevisions: 2, pricing: { type: 'video_edit' } };
const decide = (message, quote, n) => {
  const body = { conversationId: String(235990100 + n), message, quote };
  const reply = R.applyChatReplyPolicy(body, R.soomgoReply(body));
  return { reply, ai: R.shouldUseSoomgoAiReply(reply) };
};
const cases = [
  ['가격 질문', '얼마예요?', sq, 'auto'],
  ['일정 질문', '언제까지 받을 수 있나요?', sq, 'auto'],
  ['영상편집 10분(견적 있음)', '10분짜리 영상 컷편집이랑 자막 얼마예요?', vq, 'auto', /69,000원/],
  ['영상편집 10분(견적 없음)', '10분짜리 영상 편집 가격이 궁금해요', null, 'auto', /69,000원/],
  ['영상편집 길이 모름', '영상 편집도 되나요? 가격이 궁금해요', null, 'auto', /영상 길이를 알려주시면/],
  ['환불 요청', '환불해 주세요', sq, 'attention'],
  ['첫 인사', '안녕하세요', sq, 'auto'],
  ['AI 질문', '혹시 AI로 만드시는 건가요?', sq, 'attention'],
  // 9/25 지시 32: 흥정·결제 진행은 챗봇이(자세한 확인은 tests/chat-payment-32.cjs). 계좌(숨고 밖 거래)는 그대로 준희
  ['가격 흥정', '좀 더 싸게 안될까요?', sq, 'auto'],
  ['결제 문의', '숨고페이로 결제하면 되나요?', sq, 'auto'],
  ['계좌 거래', '계좌로 바로 보내도 될까요?', sq, 'attention'],
  ['파일 요청', '완성본 보내주세요', sq, 'attention']
];
cases.forEach(([name, message, quote, want, textPattern], n) => {
  const { reply, ai } = decide(message, quote, n);
  if (want === 'attention') {
    assert.equal(reply.autoSend, false, `${name}: 자동 답장 없음`);
    assert.equal(reply.manualReview, true, `${name}: 준희 알림`);
    assert.equal(ai, false, `${name}: Claude에 보내지 않음`);
  } else {
    assert.equal(reply.autoSend, true, `${name}: 자동 답 대상`);
    assert.ok(!reply.forbiddenTopic, name);
  }
  if (textPattern) assert.match(reply.text, textPattern, `${name} 문구`);
});

// 2) 말투 지시(준희 지정)와 영상 편집 줄이 프롬프트에 들어간다
const prompt = R.buildSoomgoAiReplyPrompt({ message: '얼마예요?', quote: sq }, { text: '견적 금액은 49,000원입니다.' });
// 지시 23(9/24)에서 말투 줄을 docs/tone-human-newcomer.md 코드블록으로 바꿈 → 자세한 확인은 tests/tone-human-newcomer.cjs
// 지시 29(교체, 9/24 밤): 말투 규칙 블록 대신 "붙여넣기" 틀 — 자세한 확인은 tests/chat-paste-29-30.cjs
assert.ok(!prompt.includes(R.SOOMGO_TONE_HUMAN_NEWCOMER), '말투 규칙 블록 없음');
assert.match(prompt, /이 고객한테 뭐라고 보내\?/);
assert.match(prompt, /영상 편집/);

// 3) 서버 계산 외 금액 차단: 초안에 없는 원 단위 금액이 있으면 불합격
assert.equal(R.validSoomgoAiReply('견적은 49,000원이고 당일~1일이면 됩니다.', '견적 금액은 49,000원입니다. 예상 작업 기간은 당일~1일입니다.'), true);
assert.equal(R.validSoomgoAiReply('견적은 49,000원이고 급하면 59,000원입니다.', '견적 금액은 49,000원입니다. 예상 작업 기간은 당일~1일입니다.'), false);

// 4) 한도: 하루 40건·월 15,000원에 닿으면 Claude도 정해진 문구도 보내지 않고 멈춤 + 알림
(async () => {
  const on = { customerRoomFallback: { ...policy.customerRoomFallback, enabled: true, claudeEnabled: true } };
  const now = Date.parse('2026-09-24T07:00:00Z');
  const day = fb.kstDay(now);
  const mk = (nCalls, krwEach, sameDay) => ({ customerRoomFallbackLog: Array.from({ length: nCalls }, (_, i) => ({ day: sameDay ? day : `2026-09-${String(1 + (i % 20)).padStart(2, '0')}`, called: true, krw: krwEach })) });
  assert.equal(fb.capStatus(mk(40, 10, true), on, now).reason, 'daily_call_cap');
  assert.equal(fb.capStatus(mk(300, 50, false), on, now).reason, 'monthly_budget_cap');
  assert.equal(fb.capStatus(mk(3, 50, true), on, now).capped, false);
  const off = { customerRoomFallback: { ...policy.customerRoomFallback, enabled: false, claudeEnabled: false } };
  assert.equal(fb.capStatus(mk(300, 50, false), off, now).capped, false, '꺼짐 설정: 한도 알림 대상 아님');
  assert.equal(fb.capStatus(mk(300, 50, false), on, now).capped, true, '켜짐 설정: 한도 알림 대상');
  // 서버 알림은 실제 정책을 읽는다: 켜져 있으면 한도 알림이 뜨고, 꺼져 있으면 뜨지 않는다
  const alerts = R.computeRelayAlerts({ ...mk(300, 50, false), botStatus: {} });
  assert.equal(alerts.some(a => a.code === 'customer_reply_cap'), realOn, realOn ? '실제 켜짐: 한도 알림' : '실제 꺼짐: 한도 알림 없음');
  let claudeCalls = 0; const completed = [];
  const event = { eventId: 'AR-CAP', eventType: 'customer_message', status: 'pending', createdAt: new Date(now - 120000).toISOString(), payload: { conversationId: '235999001', replyPrompt: 'p', deterministicReply: { text: '견적 금액은 49,000원입니다.', autoSend: true } } };
  await fb.tick({ now: () => now, readPolicy: () => on, bridge: { list: () => [event], claim: () => ({ duplicate: false }), complete: (id, text) => completed.push(text), fail: () => {} }, readState: () => mk(300, 50, false), writeState: () => {}, runClaude: async () => { claudeCalls += 1; return { text: 'x' }; }, hasKey: () => true, cleanText: t => t, validReply: () => true });
  assert.equal(claudeCalls, 0, '월 한도: Claude 호출 없음');
  assert.match(completed[0], /\[DECISION:ESCALATE\]/, '월 한도: 정해진 문구도 안 보냄');
  assert.match(completed[0], /monthly_budget_cap/);
  // 켜졌을 때 모델 이름이 그대로 넘어간다
  assert.equal(fb.readConfig(on).model, 'claude-opus-5-5');
  assert.equal(fb.readConfig(on).monthlyBudgetKrw, 15000);
  assert.equal(netCalls, 0, '외부 호출 없음');
  console.log('chat-guard-7-5: PASS');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
