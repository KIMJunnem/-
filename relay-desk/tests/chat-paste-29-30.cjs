'use strict';

// 개발방 지시 29(교체)·30 (2026-09-24, decisions 7-14): 챗봇을 "감독방 붙여넣기" 방식으로 + 고객 말에는 전부 Claude.
// 합성 입력·가짜 Claude만. 실제 대기열 파일에 쓰지 않는다(enqueue를 가짜로 바꿔 끼움). 외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const R = require('../server/relay-server');
const fb = require('../server/customer-room-fallback');
const t = require('../server/chat-timing');
const { createAstraRoomBridge } = require('../server/astra-room-bridge');
const root = path.join(__dirname, '..');

// 0) 스위치: 실제 값은 boolean이면 된다(켜기·끄기는 bat). bat·스크립트는 그 값만 바꾼다
const policy = JSON.parse(fs.readFileSync(path.join(root, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));
assert.equal(typeof policy.chatReply.templatesForHumanMessages, 'boolean');
for (const mode of ['on', 'off']) {
  const bat = fs.readFileSync(path.join(root, `chat-template-${mode}.bat`), 'utf8');
  assert.match(bat, new RegExp(`node scripts\\\\chat-template-switch\\.cjs ${mode}`));
  assert.doesNotMatch(bat, /chatbot-switch|sendEnabled|claudeEnabled/, '채팅봇 발송·Claude 스위치는 안 건드림');
}
assert.equal(policy.customerRoomFallback.dailyMaxCalls, 40, '하루 한도 그대로');
assert.equal(policy.customerRoomFallback.monthlyBudgetKrw, 15000, '월 한도 그대로');

// 1) 지시 29: 프롬프트 = 짧은 틀 + 네 가지 재료, 말투 문서·영업 기준 블록 없음, 고객 이름 없음
const longHistory = Array.from({ length: 1200 }, (_, i) => `[고객] 예전 메시지 ${i} 영상 문의입니다`).join('\n');
const body = {
  conversationId: '235901001', message: '5분짜리 돌잔치 영상인데 얼마예요?',
  conversationText: `${longHistory}\n[내 답변] 안녕하세요, 돌잔치 영상 건 확인했습니다.\n[고객] 5분짜리 돌잔치 영상인데 얼마예요?`,
  request: { text: '요청 상세\n홍길동 고객님\n영상 편집\n서비스 분야\n개인 영상\n원본 길이\n5분 이내\n고객 정보\n신고하기', customerName: '홍길동', serviceId: null, soomgoCategory: '영상 편집' },
  quote: { serviceId: 'video_edit', amount: 69000, days: '1~2일', message: '안녕하세요, 개인 영상 원본 5분 이내면 ... 69,000원에 해 드릴 수 있습니다.' },
  quoteSent: true
};
const prompt = R.buildSoomgoAiReplyPrompt(body, { text: '견적 금액은 69,000원입니다. 예상 작업 기간은 1~2일입니다.' });
assert.match(prompt, /^준희가 숨고 채팅방 하나를 통째로 붙여 넣고 "이 고객한테 뭐라고 보내\?"라고 물었다/);
assert.match(prompt, /숨고를 막 시작한 1인 작업자 swan으로서 쓴다\. 금액·일정·수정 횟수는 아래 \[사실\]에 있는 값만 쓴다\. 모르거나 우리가 안 하는 일이면 된다고 하지 않는다\./);
for (const section of ['[채팅방 전체]', '[보낸 견적]', '[사실]', '[준희 문장]']) assert.ok(prompt.includes(section), section);
assert.match(prompt, /요청서 원문:\n요청 상세/, '요청서 원문');
assert.match(prompt, /\[내 답변\] 안녕하세요, 돌잔치 영상 건 확인했습니다\./, '대화 전부(우리·고객 구분)');
assert.match(prompt, /\(앞부분 생략\)/, '길면 오래된 것부터 줄임(10개 제한 아님)');
assert.ok((prompt.match(/\[고객\] 예전 메시지/g) || []).length > 10, '10개로 자르지 않음');
assert.match(prompt, /금액 69,000원 · 기간 1~2일/, '보낸 견적');
assert.match(prompt, /원본 10분 이내 69,000원/, '사실: 영상 편집 가격표');
assert.match(prompt, /249,000원/, '사실: 상한');
assert.match(prompt, /안 하는 일: 모션그래픽, 3D, 더빙, 촬영, 방문/, '사실: 안 하는 일');
const verified = (fs.readFileSync(path.join(root, 'docs', 'verified-lines.md'), 'utf8').replace(/\r/g, '').match(/```\n([\s\S]*?)\n```/) || [])[1];
assert.ok(verified && prompt.includes(verified), '준희 문장 = docs/verified-lines.md 코드블록 전체');
assert.ok(!prompt.includes('[말투 — 사람 냄새]') && !prompt.includes(R.SOOMGO_TONE_HUMAN_NEWCOMER), 'tone 문서 블록 없음');
const playbookFirst = fs.readFileSync(path.join(root, 'docs', 'sales-playbook.md'), 'utf8').split('\n')[0].replace(/^#\s*/, '');
assert.ok(!prompt.includes(playbookFirst) && !/플레이북|영업 기준/.test(prompt), 'playbook 블록 없음');
assert.ok(!prompt.includes('홍길동'), '고객 이름은 보내지 않음');

// 2) 지시 30: 고객이 직접 쓴 말 → Claude 대기열(정해진 문구 안 씀) / 못 하는 일·모름 → 준희 알림 / 알림·금지 주제는 그대로
const enqueued = [];
const fakeEnqueue = (b, det) => { enqueued.push({ b, det }); return { autoSend: false, manualReview: true, pendingRoom: true, astraRoomEventId: `AR-FAKE-${enqueued.length}`, reason: 'Astra 고객대응실 답변 대기' }; };
const route = (b, templatesForHumanMessages = false) => {
  const det = R.applyChatReplyPolicy(b, R.soomgoReply(b));
  return { det, reply: R.humanChatViaClaude(b, det, { templatesForHumanMessages, enqueue: fakeEnqueue }) };
};
const videoCtx = { quote: { serviceId: 'video_edit', amount: 69000, days: '1~2일' }, quoteSent: true, request: { soomgoCategory: '영상 편집' } };
// 2-1 급한 사정 설명 → Claude(사정을 읽는 재료가 다 들어감)
{
  const msg = '갑자기 가족 장례가 있어서 일정이 꼬였어요. 영상은 이번 주 안에만 받으면 되는데 가능할까요?';
  const { reply } = route({ conversationId: '235901002', message: msg, conversationText: `[고객] ${msg}`, ...videoCtx });
  assert.equal(reply.pendingRoom, true, '급한 사정 → Claude 대기열'); assert.equal(reply.humanViaClaude, true);
  const last = enqueued[enqueued.length - 1];
  assert.equal(last.det.autoSend, false, 'Claude가 안 되면 정해진 문구로도 안 보냄(알림)');
  assert.match(last.det.factsText, /영상 편집\(지금 숨고에서 받음\)/, '금액 검사 근거로 [사실]도 넘김');
  const p = R.buildSoomgoAiReplyPrompt(last.b, last.det);
  assert.ok(p.includes(msg), '사정 설명 전체가 프롬프트에');
  const fake = '가족분 일로 경황 없으실 텐데 연락 주셔서 감사합니다. 이번 주 안에 받아 보실 수 있게 영상 주시면 1~2일 안에 보내드릴 수 있습니다!';
  assert.equal(t.aiTellCheck(fake, last.b.conversationText), '', '사정을 먼저 짚는 답은 AI 티 점검 통과');
  assert.equal(R.validSoomgoAiReply(fake, `${last.det.text}\n${last.det.factsText}`, { requireNumbers: false }), true, '서버 값 검사 통과(새 금액 없음)');
}
// 2-2 딴 질문(디자인 콘셉트) → 형식 안내 정해진 문구가 아니라 Claude
{
  const { det, reply } = route({ conversationId: '235901003', message: '디자인 콘셉트 몇 개 먼저 볼 수 있을까요?', conversationText: '[고객] 디자인 콘셉트 몇 개 먼저 볼 수 있을까요?', quote: { serviceId: 'presentation', amount: 39000 }, quoteSent: true });
  assert.equal(reply.pendingRoom, true, '이미 견적 보낸 PPT 방 → Claude가 그 질문에 답함');
  assert.equal(reply.templateOff, det.templateKey || '', '꺼 둔 정해진 문구 이름만 남김');
}
// 2-3 못 하는 일(도면 물량) → 알림·미발송
{
  const before = enqueued.length;
  const { reply } = route({ conversationId: '235901004', message: '설계 도면 물량 산출도 해 주시나요?', conversationText: '[고객] 설계 도면 물량 산출도 해 주시나요?', quote: { serviceId: 'document_writing', amount: 30000 }, quoteSent: true });
  assert.equal(reply.autoSend, false); assert.equal(reply.manualReview, true); assert.equal(reply.attention, true, '준희 알림');
  assert.equal(enqueued.length, before, '대기열에 안 넣음 = 안 보냄');
}
// 2-4 파는 서비스인지 모름(견적 없음·카테고리 없음) → 알림
{
  const { reply } = route({ conversationId: '235901005', message: '이거 해 주실 수 있나요?', conversationText: '[고객] 이거 해 주실 수 있나요?' });
  assert.equal(reply.templateKey, 'human_chat_unsupported'); assert.equal(reply.autoSend, false);
}
// 2-5 숨고 알림 문구 → 고객 말 아님(정해진 처리 그대로, 기록도 고객 말로 안 셈)
{
  const notice = '거래가 성사됐다면 일정을 캘린더에 자동으로 입력해 드려요';
  assert.equal(R.isSoomgoSystemMessage(notice), true);
  assert.equal(R.isHumanSoomgoCustomerReply({ conversationId: '235901006', incoming: notice }), false);
  assert.equal(route({ conversationId: '235901006', message: notice, ...videoCtx }).reply, null, '알림은 Claude로 안 보냄');
}
// 2-6 우리가 보낸 견적·답장이 되읽힌 것 → 고객 말 아님
{
  const state = { soomgoReplies: [{ conversationId: '235901007', reply: { text: '안녕하세요, 돌잔치 영상 원본 5분 이내면 필요 없는 부분 정리하고 자막까지 넣어서 69,000원에 해 드릴 수 있습니다.' } }], soomgoLeads: [{ conversationId: '235901007', quote: { message: '안녕하세요, 개인 영상 원본 5분 이내면 필요 없는 부분 정리하고' } }] };
  const heads = R.soomgoOutboundTextHeads(state);
  assert.equal(R.isOurOwnSoomgoText(heads, '235901007', '안녕하세요, 돌잔치 영상 원본 5분 이내면 필요 없는 부분 정리하고 자막까지 넣어서 69,000원에 해 드릴 수 있습니다.'), true);
  assert.equal(R.isHumanSoomgoCustomerReply({ conversationId: '235901007', incoming: '안녕하세요, 개인 영상 원본 5분 이내면 필요 없는 부분 정리하고 자막까지' }, heads), false, '우리 견적 되읽힘');
  assert.equal(R.isHumanSoomgoCustomerReply({ conversationId: '235901007', incoming: '네 5분짜리 영상 보낼게요' }, heads), true, '고객 말은 그대로');
}
// 2-7 금지 주제 → 그대로 준희 알림(Claude로 안 보냄)
for (const msg of ['환불해 주세요', 'AI로 하시는 거예요?', '조금만 깎아 주세요', '결과물 보내 주세요']) {
  const before = enqueued.length;
  const { det, reply } = route({ conversationId: '235901008', message: msg, ...videoCtx });
  assert.equal(det.autoSend, false, `${msg}: 자동 답장 없음`); assert.equal(reply, null, `${msg}: 정해진 알림 흐름 그대로`);
  assert.equal(enqueued.length, before, `${msg}: 대기열에 안 넣음`);
}
// 2-8 스위치 켜짐(예전 방식) → 이 경로 안 탐
assert.equal(route({ conversationId: '235901009', message: '얼마예요?', ...videoCtx }, true).reply, null);

// 3) Claude 흐름(가짜): 고객 말 답이 검사에 걸리면 정해진 문구로 안 보내고 멈춤 · [사실]의 서버 값은 금액 검사 통과
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-2930-'));
  const bridge = createAstraRoomBridge({ dataFile: path.join(tmp, 'b.json'), configFile: path.join(tmp, 'c.json') });
  const facts = R.soomgoChatFactsText({});
  const mk = (conv, answer) => {
    const q = bridge.enqueue({ eventType: 'customer_message', caseId: conv, idempotencyKey: `h:${conv}`, payload: { conversationId: conv, messageId: `M${conv}`, customerMessage: '30분짜리 영상은 얼마예요?', conversationText: '[고객] 30분짜리 영상은 얼마예요?', replyPrompt: 'p', deterministicReply: { text: '견적 금액은 69,000원입니다.', autoSend: false, factsText: facts, requireNumbers: false }, releaseAt: new Date(Date.now() - 1000).toISOString() } });
    return [q.event.eventId, answer];
  };
  const answers = Object.fromEntries([mk('235901020', '원본 30분 이내면 129,000원에 해 드릴 수 있습니다!'), mk('235901021', '원본 30분이면 99,000원에 해 드릴 수 있습니다!')]);
  const pol = { customerRoomFallback: { ...policy.customerRoomFallback, enabled: true, claudeEnabled: true } };
  const out = await fb.tick({ now: () => Date.now(), readPolicy: () => pol, bridge, readState: () => ({}), writeState: () => {}, hasKey: () => true, cleanText: x => x, validReply: R.validSoomgoAiReply,
    runClaude: async () => { const ev = bridge.list({ eventType: 'customer_message', limit: 20 }).find(e => e.status === 'dispatched'); return { text: answers[ev.eventId], usage: {} }; } });
  const res = Object.fromEntries(out.handled.map(h => [h.eventId, h]));
  const ids = Object.keys(answers);
  assert.equal(res[ids[0]].decision, 'SEND', '[사실]의 가격표 값(129,000원)은 통과');
  assert.equal(res[ids[1]].decision, 'ESCALATE', '서버 값에 없는 금액(99,000원) → 멈춤');
  assert.notEqual(res[ids[1]].source, 'deterministic', '정해진 문구로 대신 보내지 않음');
  assert.equal(netCalls, 0, '외부 호출 없음');
  console.log('chat-paste-29-30: PASS');
})().catch(error => { console.error(error); process.exit(1); });
