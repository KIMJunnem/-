'use strict';
// 9/25 숨고 고객 여정 시뮬레이션에서 찾은 버그 수정 + 준희 결정(안부 멘트 끔·전액 결제·자료는 클라우드 링크/메일·쇼츠 묶음 할인·상한 넘은 요청 추가).
// 외부 호출 없음: 서버 복사본은 API 주소를 막고 키도 가짜다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let apiCalls = 0;
const realFetch = global.fetch;
global.fetch = async () => { apiCalls += 1; throw new Error('network_disabled_in_test'); };
const ROOT = path.join(__dirname, '..');
const R = require('../server/relay-server.js');
const V = require('../server/video-edit-quote');
const rules = require('../server/soomgo-auto-rules');
const { createAstraRoomBridge } = require('../server/astra-room-bridge');
const { checkHonorific } = require('../server/honorific-guard');
const won = n => `${Number(n).toLocaleString('ko-KR')}원`;

const videoQuote = { serviceId: 'video_edit', amount: 89000, days: '2~3일', basicScope: '', extraScope: '', message: '안녕하세요, 결혼식 식전영상 보내주실 사진·영상 자료를 보고 정확한 금액을 확정해 드리려고 합니다. 기본 구성 기준으로 89,000원부터 해 드릴 수 있습니다. 자료 받고 2~3일 안에 MP4로 보내드리고, 수정은 2회까지 가능합니다!!' };
const quoteLine = `[내 답변] ${videoQuote.message}`;
const ask = (message, conversationText, quote = videoQuote) => {
  const body = { conversationId: '90001', message, conversationText: `${conversationText}\n[고객] ${message}`, quote, quoteSent: true };
  return R.applyChatReplyPolicy(body, R.soomgoReply(body));
};

// 1) 영상 견적은 "좋아요 진행할게요"로 고용 요청(문서용 접수 양식 아님)
for (const m of ['좋아요 진행할게요', '네 진행할게요', '네 그럼 진행할게요']) {
  const r = ask(m, quoteLine);
  assert.equal(r.templateKey, 'hire_ready', m);
  assert.equal(r.hireRequest, true, m);
}
assert.notEqual(ask('좋아요 진행할게요 토요일까지 가능해요?', quoteLine).templateKey, 'quote_intent_intake_form', '영상 견적에 문서용 접수 양식 금지');
// 문서 견적은 예전처럼 "수정은 2회까지"도 조건으로 인정
assert.equal(ask('네 진행할게요', '[내 답변] 견적 21,000원, 당일~1일, A4 2쪽 기준, 수정은 2회까지 가능합니다', { serviceId: 'document_writing', amount: 21000, days: '당일~1일' }).templateKey, 'hire_ready');

// 2) 할인 합의 금액은 모든 고용 경로에 남는다
const discounted = `${quoteLine}\n[고객] 조금 깎아주실 수 있나요?\n[내 답변] 처음이시니 76,000원에 해 드릴 수 있습니다. 76,000원으로 보내드릴까요?`;
for (const m of ['네', '좋아요']) {
  const r = ask(m, discounted);
  assert.equal(r.hireRequest, true, m);
  assert.equal(r.agreedAmount, 76000, m);
}
assert.equal(ask('진행할게요', discounted).agreedAmount, 76000);
assert.equal(ask('네', `${quoteLine}\n[내 답변] 76,000원으로 고용 요청 보내드려도 될까요?`).agreedAmount, 76000, 'hire_consent_yes');
assert.equal(ask('네 진행할게요', quoteLine).agreedAmount, undefined, '할인 없으면 합의 금액 없음');
const hireSource = fs.readFileSync(path.join(ROOT, 'server', 'relay-server.js'), 'utf8');
assert.match(hireSource, /orderAmount: Number\(quote\.amount \|\| 0\)/, '주문 금액 = 합의 금액');

// 3) 채팅방 견적 카드가 서버 견적(기간·서비스)을 덮어쓰지 않는다
{
  const lead = { requestId: 'r1', conversationId: '90002', quote: { ...videoQuote, videoEdit: { materialsBased: 'photo' } }, quoteEvidence: { status: 'sent' } };
  const body = R.contextualizeSoomgoReplyBody({ soomgoLeads: [lead], soomgoReplies: [], soomgoWorkflows: [] }, { conversationId: '90002', message: '안녕하세요', quote: { conversationId: '90002', amount: 89000 } });
  assert.equal(body.quote.days, '2~3일');
  assert.equal(body.quote.serviceId, 'video_edit');
  assert.equal(body.quote.conversationId, '90002', '카드에만 있는 칸은 채움');
  const merged = R.mergeSoomgoCardQuote({ amount: 70000, conversationId: 'c' }, { amount: 89000, days: '2~3일' });
  assert.equal(merged.amount, 89000); assert.equal(merged.cardAmount, 70000);
  assert.deepEqual(R.mergeSoomgoCardQuote({ amount: 5 }, null), { amount: 5 });
  assert.match(R.soomgoChatFactsText({ quote: body.quote }), /89,000원은 시작가\("부터"\)/);
}

// 4) 쇼츠는 개당 단가 × 개수, 자료를 한 번에 주면 묶음 할인(2~4개 10%, 5개 이상 15% — services/video_edit.json)
{
  const rates = V.DEFINITION.pricing.shorts.bundle.rates;
  assert.deepEqual(rates.map(r => [r.minCount, r.maxCount, r.rate]), [[2, 4, 0.1], [5, undefined, 0.15]]);
  const five = { topic: '릴스 쇼츠 30초짜리 5개 만들어주세요', text: '릴스 쇼츠 30초짜리 5개 만들어주세요' };
  // 9/25 준희 첫 거래 할인(정책 introPromo.shorts)이 켜져 있어도 정가·묶음 계산은 그대로 — 여기서는 첫 거래 할인을 끄고(opts.introPromo=null) 본다. 켠 상태는 tests/revision-policy-0925.cjs
  const NO_PROMO = { introPromo: null };
  const p = V.videoEditQuote(five, NO_PROMO);
  assert.equal(p.amount, 195000);
  assert.deepEqual({ ...p.shorts }, { count: 5, unitAmount: 39000, fullAmount: 195000, bundleRate: 0.15, bundleAmount: 166000 });
  const msg = V.autoQuoteMessage(five, p, V.autoQuoteDecision(five, p, { enabled: true, sentToday: 0 }));
  assert.match(msg, /개당 39,000원 × 5개로 195,000원/);
  assert.match(msg, /자료를 한 번에 주시면 5개 묶음으로 15% 할인해 드립니다/);
  assert.doesNotMatch(msg, /166,000원/, '할인가 숫자는 견적 문구에 쓰지 않음(채팅 할인으로 셈해지지 않게)');
  assert.ok(checkHonorific(msg).ok, msg);
  assert.equal(V.videoEditQuote({ topic: '유튜브 쇼츠 3편' }, NO_PROMO).shorts.bundleRate, 0.1);
  assert.equal(V.videoEditQuote({ topic: '5개 쇼츠 부탁' }, NO_PROMO).shorts.count, 5);
  assert.equal(V.videoEditQuote({ topic: '쇼츠 1개' }, NO_PROMO).amount, 39000);
  assert.equal(V.videoEditQuote({ topic: '쇼츠 1개' }, NO_PROMO).shorts, undefined);
  assert.equal(V.videoEditQuote({ topic: '쇼츠 25개' }, NO_PROMO).scopeCheck, 'shorts_too_many');
  assert.equal(V.videoEditQuote({ topic: '쇼츠 7개' }, NO_PROMO).amount, 273000, '상한 249,000원은 원본 길이 셈에만(쇼츠는 개당)');
  // 금액 검사 상한(견적의 150%)이 합계 기준이라 195,000원 답이 막히지 않는다
  const range = { quote: 195000, min: 166000, max: 292000 };
  assert.equal(R.validSoomgoAiReply('5개면 195,000원입니다.', '견적 금액은 195,000원입니다.', { requireNumbers: false, amountRange: range }), true);
  // 채팅 가격 답은 지금 정책(첫 거래 할인 켜짐): 첫 거래가가 묶음 할인보다 싸서 첫 거래가 하나만
  const chat = R.applyChatReplyPolicy({ message: '릴스 쇼츠 5개면 얼마예요?' }, { autoSend: true, text: 'x' });
  assert.match(chat.text, /1편 39,000원인데, 첫 거래라 1편 29,000원씩 5편 145,000원/);
  assert.doesNotMatch(chat.text, /15% 할인/, '묶음 할인과 겹치지 않음');
  const facts = R.soomgoChatFactsText({ quote: { serviceId: 'video_edit', amount: 195000, videoEdit: { shorts: p.shorts } } });
  assert.match(facts, /개당 39,000원 × 5개 = 195,000원, 자료를 한 번에 주면 묶음 15% 할인가 166,000원/);
}

// 5) 존댓말 검사는 고객에게 실제로 나갈 글만
assert.equal(R.honorificCheckApplies({ autoSend: true, text: '네 알겠어' }), true);
assert.equal(R.honorificCheckApplies({ autoSend: false, pendingRoom: true, humanViaClaude: true, text: '(자동 규칙이 보류함: AI 사용 질문) 부풀리지 않는다.' }), false);
assert.equal(R.honorificCheckApplies({ supervisor: 'payment', text: '약속하지 않는다.' }), false);
assert.equal(R.honorificCheckApplies({ autoSend: false, manualReview: true, text: '초안이다.' }), false);
{
  const out = R.supervisorReply({ conversationId: '90003', message: '환불 가능한가요?', quote: videoQuote }, { autoSend: false, manualReview: true, forbiddenTopic: 'payment', reason: '금지 주제' }, { policy: {}, enqueue: () => ({ autoSend: false, pendingRoom: true, text: '(자동 규칙이 보류함) 약속하지 않는다.' }) });
  assert.equal(out.supervisor, 'payment');
  assert.equal(R.honorificCheckApplies(out), false, 'Claude 지시문은 존댓말 검사 대상 아님');
}

// 6) 납품 뒤 "감사합니다 잘 받았어요"는 최종 확인
for (const m of ['감사합니다 잘 받았어요', '잘 받았습니다', '확인했어요 좋네요', '마음에 들어요', '네 확인했습니다']) assert.equal(R.isWorkflowCompletion(m), true, m);
for (const m of ['잘 받았어요 근데 자막 수정 부탁드려요', '잘 받았는데 언제 결제하나요?', '감사합니다', '아직 다 못 봤어요']) assert.equal(R.isWorkflowCompletion(m), false, m);

// 7) 원본 길이 칸이 없으면 희망 길이를 원본 길이로 읽지 않는다(요청봇 0.4.27 + 서버 방어)
{
  const src = fs.readFileSync(path.join(ROOT, 'soomgo-bot-extension', 'content-v3.js'), 'utf8');
  const sourceVolume = eval(src.match(/const sourceVolume = (text => .*);/)[1]); // eslint-disable-line no-eval
  assert.equal(sourceVolume('서비스 분야\n결혼식 식전영상\n희망 길이\n3분 이내\n편집 요소'), '');
  assert.equal(sourceVolume('희망 영상 길이\n3분\n'), '');
  assert.equal(sourceVolume('원본 길이\n5분 이내\n희망 길이\n1분'), '5분 이내');
  assert.equal(sourceVolume('작업 분량\nA4 3쪽'), 'A4 3쪽');
  const oldBot = { text: '요청 상세\n영상 편집\n서비스 분야\n결혼식 식전영상\n희망 길이\n3분 이내\n의뢰/희망사항\n식전영상 만들어 주세요. 사진 50장\n', volume: '3분 이내', topic: '식전영상 만들어 주세요. 사진 50장' };
  const priced = V.videoEditQuote(oldBot);
  assert.equal(priced.amount, 89000, '옛 요청봇이 희망 길이를 넣어도 자료 기준 89,000원부터');
  assert.equal(priced.materialsBased, 'photo');
  assert.equal(V.videoEditQuote({ text: '원본 길이\n5분 이내\n희망 길이\n3분 이내\n', volume: '5분 이내', topic: '유튜브' }).amount, 69000);
}

// 8) Claude [사실]: 넓은 범위 + 자료 기준 시작가 + AI 질문 문장 모순 없음
{
  const facts = R.soomgoChatFactsText({});
  assert.match(facts, /식전·성장\(돌잔치\) 사진 영상, 쇼츠·릴스, 행사·강의 영상 편집/);
  assert.match(facts, /촬영·3D·모션그래픽은 하지 않음/);
  assert.match(facts, /89,000원부터\(2~3일\)/);
  assert.match(facts, /69,000원부터\(1~2일\)/);
  assert.doesNotMatch(facts, /AI 사용 여부 질문은 여기로 오지 않는다/);
}

// 9) 하루 상한(30건)을 넘긴 영상 요청: 점수가 높으면 추가(따로 셈), 낮으면 준희 알림, 견적 판단이 있으면 판단에 맡김
{
  const today = new Date().toISOString();
  const cap = Array.from({ length: 30 }, (_, i) => ({ at: today, requestId: `cap${i}` }));
  const high = '요청 상세\n고객 정보\n견적 보낸 고수 1명\n10분 전\n영상 편집\n\n서비스 분야\n강의 영상\n원본 길이\n5분 이내\n의뢰/희망사항\n강의 영상 컷편집 자막\n완료 희망일\n10월 3일\n고객 정보\n';
  const low = '요청 상세\n고객 정보\n견적 보낸 고수 5명\n2일 전\n영상 편집\n\n서비스 분야\n기타\n원본 길이\n5분 이내\n의뢰/희망사항\n영상 컷편집\n완료 희망일\n협의 가능\n고객 정보\n';
  const run = (text, state, extra = {}) => {
    const { parsed, quote } = R.buildSoomgoQuote({ requestId: extra.requestId || 'x', text, volume: '5분 이내', topic: '영상 컷편집 자막' });
    rules.applySoomgoAutoRules({ body: {}, request: parsed, quote, requestedServiceId: null, existingLead: null, state, requestId: extra.requestId || 'x', now: Date.now(), supportedServiceIds: ['subtitle'], sampleAmount: () => 0, capExtrasConfig: { enabled: true, maxPerDay: 1, minScore: 4 }, ...extra });
    return quote;
  };
  assert.deepEqual(rules.capExtraScore(R.buildSoomgoQuote({ text: high, volume: '5分' }).parsed, { minutes: 5 }, V).signals.sort(), ['clear_deadline', 'few_rivals', 'recent', 'sample_link', 'source_length']);
  let state = { videoEditAutoQuotes: [...cap] };
  const lowQ = run(low, state, { requestId: 'low1' });
  assert.equal(lowQ.autoSend, false, '점수 낮으면 보내지 않음');
  assert.equal(lowQ.videoEdit.autoDecision, 'daily_cap');
  const judged = run(high, state, { requestId: 'judge1', judgeAvailable: true });
  assert.equal(judged.autoSend, false, '견적 판단이 있으면 점수로 보내지 않음');
  const highQ = run(high, state, { requestId: 'high1' });
  assert.equal(highQ.autoSend, true, '점수 높으면 추가 발송');
  assert.equal(highQ.videoEdit.capExtra.sent, true);
  assert.equal(highQ.videoEdit.autoDecision, 'daily_cap_extra');
  assert.equal(state.videoEditAutoQuotes.length, 30, '하루 30건 기록은 그대로');
  assert.deepEqual(state.videoEditCapExtras.map(item => item.requestId), ['high1'], '추가분은 따로 셈');
  assert.equal(run(high, state, { requestId: 'high2' }).autoSend, false, '추가 한도(maxPerDay) 넘으면 보내지 않음');
  assert.equal(run(high, state, { requestId: 'high1' }).autoSend, true, '같은 요청을 다시 열어도 그대로');
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));
  assert.deepEqual({ ...policy.dailyCapExtras, _note: undefined }, { _note: undefined, enabled: true, maxPerDay: 10, minScore: 4, recentHours: 48 });
}

// 10) 새 답이 바로 나가면(고용 요청 포함) 같은 방의 옛 대기 답은 내보내지 않는다
{
  assert.equal(R.supersedesOlderRoomReplies({ autoSend: true, text: '감사합니다.', hireRequest: true }), true);
  assert.equal(R.supersedesOlderRoomReplies({ autoSend: false, pendingRoom: true, text: '지시' }), false);
  assert.equal(R.supersedesOlderRoomReplies({ autoSend: false, pendingRoom: true, scheduledReply: { releaseAt: 'x' }, text: '예약' }), true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-0925-bridge-'));
  const bridge = createAstraRoomBridge({ dataFile: path.join(dir, 'data.json'), configFile: path.join(dir, 'config.json') });
  const add = (key, conversationId, messageId) => bridge.enqueue({ eventType: 'customer_message', caseId: conversationId, idempotencyKey: key, payload: { conversationId, messageId } }).event;
  const pending = add('p', '777', 'm1');
  const ready = add('r', '777', 'm2');
  bridge.complete(ready.eventId, '[MODE:CUSTOMER_REPLY]\n[DECISION:SEND]\n[REPLY]\n네, 확인해 보겠습니다.');
  const working = add('w', '777', 'm3');
  bridge.claim(working.eventId, 'claude-fallback');
  const current = add('c', '777', 'm9');
  const other = add('o', '888', 'm1');
  const affected = bridge.supersedeConversation('777', 'hire_request_sent', { exceptMessageId: 'm9' });
  assert.deepEqual(affected.sort(), [pending.eventId, ready.eventId, working.eventId].sort());
  assert.equal(bridge.get(pending.eventId).deliveryStatus, 'skipped');
  assert.equal(bridge.get(ready.eventId).deliveryStatus, 'skipped');
  bridge.complete(working.eventId, '[MODE:CUSTOMER_REPLY]\n[DECISION:SEND]\n[REPLY]\n할인은 어렵습니다.');
  assert.equal(bridge.get(working.eventId).deliveryStatus, 'skipped', '처리 중이던 옛 답도 완료 뒤 내보내지 않음');
  assert.equal(bridge.get(current.eventId).status, 'pending', '지금 메시지는 그대로');
  assert.equal(bridge.get(other.eventId).status, 'pending', '다른 방은 그대로');
  assert.deepEqual(bridge.outbox({ conversationId: '777' }), []);
  fs.rmSync(dir, { recursive: true, force: true });
}

// 11) 고용 뒤 안내에 "고용 확정 감사합니다"가 한 번만 + 발행본 0.4.27·하루 30건
{
  const r = R.soomgoReply({ conversationId: '90004', message: '잘 부탁드립니다', conversationText: '[고객] 잘 부탁드립니다', quote: videoQuote, hiredConversation: true, workflowStage: 'awaiting_first_result' });
  assert.equal(r.templateKey, 'post_hire_chat');
  assert.equal((r.text.match(/고용 확정 감사합니다/g) || []).length, 1, r.text);
  const dl = path.join(ROOT, 'dist', 'downloads');
  const manifest = file => JSON.parse(fs.readFileSync(path.join(dl, file), 'utf8')).version;
  assert.equal(manifest('relay-desk-soomgo-bot/manifest.json'), JSON.parse(fs.readFileSync(path.join(ROOT, 'soomgo-bot-extension', 'manifest.json'), 'utf8')).version);
  assert.equal(manifest('relay-desk-soomgo-bot/manifest.json'), '0.4.27');
  assert.equal(manifest('relay-desk-soomgo-chat-bot/manifest.json'), '0.3.26');
  const published = fs.readFileSync(path.join(dl, 'relay-desk-soomgo-bot', 'content-v3.js'), 'utf8');
  assert.equal(published.replace(/\r\n/g, '\n'), fs.readFileSync(path.join(ROOT, 'soomgo-bot-extension', 'content-v3.js'), 'utf8').replace(/\r\n/g, '\n'), '발행본 = 소스(줄바꿈 차이는 무시)');
  assert.match(published, /하루 최대 30건/);
  assert.match(fs.readFileSync(path.join(dl, 'BOT-LATEST.txt'), 'utf8'), /숨고 요청 봇: 0\.4\.27[\s\S]*숨고 채팅 봇: 0\.3\.26/);
}

// C) 견적 읽음 안부 멘트는 기본 꺼짐(정책 스위치), 무응답 후속은 호출하는 곳이 없음
{
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));
  assert.equal(policy.quoteReadFollowup.enabled, false);
  assert.equal(R.quoteReadFollowupEnabled(), false);
  const off = R.soomgoQuoteReadFollowupReply({ soomgoLeads: [], soomgoWorkflows: [] }, { conversationId: '90005', quoteReadFollowup: true, quoteReadEvidence: true, quote: { serviceId: 'video_edit', amount: 69000 }, request: { topic: '돌잔치 영상' } });
  assert.equal(off.templateKey, 'quote_read_followup_off');
  assert.equal(off.skip, true);
  const on = R.soomgoQuoteReadFollowupReply({ soomgoLeads: [], soomgoWorkflows: [] }, { conversationId: '90005', quoteReadFollowup: true, quoteReadEvidence: true, quote: { serviceId: 'video_edit', amount: 69000 }, request: { topic: '돌잔치 영상' } }, { policy: { quoteReadFollowup: { enabled: true } } });
  assert.equal(on.autoSend, true, '다시 켜면 예전처럼');
  const chat = fs.readFileSync(path.join(ROOT, 'soomgo-chat-bot', 'chat-content.js'), 'utf8');
  assert.equal((chat.match(/processPendingFollowup/g) || []).length, 1, '무응답 후속(processPendingFollowup)은 정의만 있고 부르는 곳이 없다');
}

// 결제: 모든 서비스 전액 한 번이 기본(paymentSplit.enabled=false), 켜면 예전 분할
{
  const wf = { quote: { serviceId: 'subtitle', amount: 89000 } };
  let plan = R.workflowPaymentPlan(wf);
  assert.equal(plan.split, false); assert.equal(plan.requestAmount, 89000); assert.equal(plan.label, '전액 선결제');
  assert.equal(R.workflowPaymentPlan({ quote: { serviceId: 'video_edit', amount: 249000 } }).split, false);
  R.setPaymentSplitForTest(true);
  plan = R.workflowPaymentPlan(wf);
  assert.equal(plan.split, true); assert.equal(plan.depositAmount + plan.balanceAmount, 89000); assert.equal(plan.label, '착수금 결제');
  R.setPaymentSplitForTest(null);
  assert.equal(R.workflowPaymentPlan(wf).split, false);
}

// 자료 받는 방법: 클라우드 링크 + 정책 contact.materialsEmail(코드에 주소 없음)
{
  const line = R.videoEditMaterialsLine({ contact: { materialsEmail: 'files-test@example.org' } });
  assert.match(line, /구글 드라이브/); assert.match(line, /메일\(files-test@example\.org\)/);
  assert.doesNotMatch(R.videoEditMaterialsLine({ contact: { materialsEmail: '' } }), /@|메일/);
  assert.doesNotMatch(R.videoEditMaterialsLine({ contact: { materialsEmail: 'not an email' } }), /@/);
  assert.ok(checkHonorific(line).ok);
  assert.doesNotMatch(R.videoEditMaterialsLine.toString(), /@[a-z]/i, '자료 안내 메일 주소는 정책 파일에만');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'soomgo-chat-bot', 'chat-content.js'), 'utf8'), /[A-Za-z0-9._%+-]+@gmail\.com/);
  assert.match(R.soomgoWorkflowStatusReply({ stage: 'awaiting_first_result', quote: { serviceId: 'video_edit', days: '2~3일' } }), /구글 드라이브 같은 클라우드/);
  assert.doesNotMatch(R.soomgoWorkflowStatusReply({ stage: 'awaiting_first_result', quote: { serviceId: 'subtitle', days: '1일' } }), /구글 드라이브/);
}

// 강의·인터뷰 요청은 강의 샘플(준희 "강의 샘플 01")
{
  for (const text of ['강의 영상 컷편집', '인터뷰 영상 자막 편집']) assert.equal(V.videoType({ text }), 'lecture', text);
  assert.equal(V.DEFINITION.quoteCopy.sampleUrls.lecture, 'https://youtu.be/yrc4mKqd_uA');
  const req = { text: '강의 영상 컷편집', volume: '10분 이내' };
  const p = V.videoEditQuote(req);
  assert.match(V.autoQuoteMessage(req, p, V.autoQuoteDecision(req, p, { enabled: true, sentToday: 0 })), /작업 예시 영상: https:\/\/youtu\.be\/yrc4mKqd_uA$/);
}
assert.equal(apiCalls, 0);
console.log('sim-fixes-0925 단위 검사 통과');

// ── 서버 복사본으로 끝까지: 견적 → 할인 합의 → 고용 → 작업·주문 금액, 전액 결제, 자료 안내, 안부 멘트 끔, 상한 재조회, 최종 확인 ──
function copyDir(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    if (skip && skip(src, entry)) continue;
    if (entry.isDirectory()) copyDir(src, path.join(to, entry.name), skip);
    else if (entry.isFile()) fs.copyFileSync(src, path.join(to, entry.name));
  }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  global.fetch = realFetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-0925-'));
  copyDir(path.join(ROOT, 'server'), path.join(dir, 'server'), (src, entry) => entry.isDirectory() && ['data', 'storage'].includes(entry.name) && path.dirname(src) === path.join(ROOT, 'server'));
  copyDir(path.join(ROOT, 'services'), path.join(dir, 'services'));
  copyDir(path.join(ROOT, 'docs'), path.join(dir, 'docs'));
  fs.mkdirSync(path.join(dir, 'server', 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'server', 'storage'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server', 'data', 'astra-scheduler-paused'), 'test');
  // 시험용 정책: 견적 판단 끔(호출 없음), 자료 메일은 임의 주소
  const policyFile = path.join(dir, 'server', 'config', 'astra-relay-operating-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  policy.quoteJudge.enabled = false;
  policy.contact.materialsEmail = 'materials-e2e@example.net';
  // 새벽(0~7시) 요청 안부는 revision-policy-0925에서 따로 본다. 여기서는 시험 시각과 상관없이 "낮 요청은 안부 없음"을 본다
  if (policy.quoteReadFollowup.nightRequests) policy.quoteReadFollowup.nightRequests.enabled = false;
  fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2));
  const today = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'server', 'data', 'state.json'), JSON.stringify({ soomgoLeads: [], soomgoReplies: [], promptPosts: [], videoEditAutoQuotes: Array.from({ length: 30 }, (_, i) => ({ at: today, requestId: `seed${i}` })) }));
  const log = path.join(dir, 'api-calls.log');
  fs.writeFileSync(path.join(dir, 'preload.cjs'), `const fs=require('fs');const o=global.fetch;global.fetch=async(u,x)=>{const s=String(u&&u.url||u);if(!/^https?:\\/\\/(127\\.0\\.0\\.1|localhost)/.test(s)){fs.appendFileSync(${JSON.stringify(log)},s+'\\n');throw new Error('network_blocked');}return o(u,x);};`);
  const port = 19100 + Math.floor(Math.random() * 300);
  const env = { ...process.env, RELAY_PORT: String(port) };
  delete env.ANTHROPIC_API_KEY; delete env.OPENAI_API_KEY; delete env.TYPESAFE_API_KEY;
  const child = spawn(process.execPath, ['--require', path.join(dir, 'preload.cjs'), path.join(dir, 'server', 'relay-server.js')], { cwd: dir, env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const post = async (p, body) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-bot': 'soomgo-extension' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const get = async p => (await fetch(`${base}${p}`)).json();
  const stateFile = path.join(dir, 'server', 'data', 'state.json');
  try {
    for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (_) {} await sleep(250); }
    // 하루 상한(30건 기록)이 찬 상태: 점수 낮은 요청은 보내지 않고, 다음 날 다시 볼 수 있게 skipRevisit false
    const lowText = '요청 상세\n고객 정보\n견적 보낸 고수 5명\n2일 전\n영상 편집\n\n서비스 분야\n기타\n원본 길이\n5분 이내\n의뢰/희망사항\n영상 컷편집\n완료 희망일\n협의 가능\n고객 정보\n';
    const lowQ = await post('/api/soomgo/quote', { requestId: 'aaaaaaaaaaaaaaaaaaaa0001', text: lowText, topic: '영상 컷편집', volume: '5분 이내', displayLabel: '기타' });
    assert.equal(lowQ.status, 200);
    assert.equal(lowQ.body.quote.autoSend, false);
    assert.equal(lowQ.body.quote.videoEdit.autoDecision, 'daily_cap');
    assert.equal(lowQ.body.skipRevisit, false, '상한으로 못 보낸 요청은 영구히 건너뛰지 않음');
    // 점수 높은 식전영상 요청은 추가 발송(따로 셈)
    const text = '요청 상세\n고객 정보\n견적 보낸 고수 1명\n10분 전\n영상 편집\n\n서비스 분야\n결혼식 식전영상\n희망 길이\n3분 이내\n의뢰/희망사항\n결혼식 식전영상 만들어 주세요. 사진 50장 정도랑 짧은 영상 클립 몇 개 있어요.\n완료 희망일\n10월 10일\n고객 정보\n';
    const requestId = 'aaaaaaaaaaaaaaaaaaaa0002';
    const q = await post('/api/soomgo/quote', { requestId, text, topic: '결혼식 식전영상 만들어 주세요. 사진 50장 정도랑 짧은 영상 클립 몇 개 있어요.', volume: '', displayLabel: '결혼식 식전영상', sourceUrl: `https://soomgo.com/requests/received/${requestId}` });
    assert.equal(q.body.quote.autoSend, true, JSON.stringify(q.body.quote.videoEdit));
    assert.equal(q.body.quote.amount, 89000);
    assert.equal(q.body.quote.videoEdit.capExtra.sent, true);
    let st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(st.videoEditAutoQuotes.length, 30);
    assert.deepEqual(st.videoEditCapExtras.map(item => item.requestId), [requestId]);
    const funnel = await get('/api/soomgo/revenue-funnel');
    const conv = '91000001';
    const sent = await post('/api/soomgo/quote-result', { requestId, status: 'sent', at: new Date().toISOString(), url: `https://soomgo.com/pro/chats/${conv}`, note: '숨고 화면의 발송 성공 표시' });
    assert.equal(sent.status, 200);
    if (funnel.funnel) assert.equal(funnel.funnel.videoEditCapExtras.total, 1);
    // 안부 멘트 꺼짐
    const followup = await post('/api/soomgo/reply', { conversationId: conv, messageId: 'qr1', message: '고객님이 견적을 읽었습니다', quoteReadFollowup: true, quoteReadEvidence: true, quote: { conversationId: conv, amount: 89000 } });
    assert.equal(followup.body.reply.autoSend, false);
    assert.notEqual(followup.body.reply.scheduledFollowup ? 'scheduled' : '', 'scheduled', '안부 멘트 예약 안 함');
    // 카드 견적(금액만) + 할인 합의 → 고용 요청에 합의 금액
    const lines = [`[내 답변] ${q.body.quote.message}`, '[고객] 조금 깎아주실 수 있나요?', '[내 답변] 처음이시니 76,000원에 해 드릴 수 있습니다. 76,000원으로 보내드릴까요?', '[고객] 네'];
    const yes = await post('/api/soomgo/reply', { conversationId: conv, messageId: 'y1', message: '네', conversationText: lines.join('\n'), quote: { conversationId: conv, amount: 89000 } });
    assert.equal(yes.body.reply.hireRequest, true, JSON.stringify(yes.body.reply));
    assert.equal(yes.body.reply.agreedAmount, 76000);
    const hire = await post('/api/soomgo/hire', { requestId, conversationId: conv, quote: { conversationId: conv, amount: 89000 }, orderType: 'full', hireConfirmed: true, hireEvidence: { confirmed: true, source: 'Soomgo 고용 확정 표시', at: new Date().toISOString(), note: 'test' } });
    assert.equal(hire.status, 200, JSON.stringify(hire.body));
    st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const wf = st.soomgoWorkflows.find(item => item.conversationId === conv);
    assert.equal(wf.quote.amount, 76000);
    assert.equal(wf.quote.agreedFromAmount, 89000);
    assert.equal(wf.order.orderAmount, 76000, '주문 금액도 합의 금액');
    assert.equal(wf.order.fullAmount, 89000);
    assert.equal(wf.paymentPlan.split, false, '전액 한 번 결제');
    assert.equal(wf.paymentAmount, 76000);
    // 영상 업무도 채팅봇의 업무 조회가 된다(요청 글에 서비스 단서가 없어도 견적의 서비스 ID로)
    const wfList = await fetch(`${base}/api/soomgo/workflow?conversationId=${conv}`, { headers: { 'x-relay-bot': 'soomgo-extension' } });
    assert.equal(wfList.status, 200);
    assert.equal((await wfList.json()).workflows[0].quote.amount, 76000);
    // 영상 편집 고용 인사: 클라우드 링크 + 정책의 메일 주소
    const greet = await post('/api/soomgo/message-text', { id: 'common.hire_greeting.v1', values: { days: '2~3일' }, serviceId: 'video_edit' });
    assert.match(greet.body.text, /구글 드라이브 같은 클라우드/);
    assert.match(greet.body.text, /메일\(materials-e2e@example\.net\)/);
    const plainGreet = await post('/api/soomgo/message-text', { id: 'common.hire_greeting.v1', values: { days: '1일' } });
    assert.doesNotMatch(plainGreet.body.text, /구글 드라이브/);
    // 최종 확인 단계에서 "감사합니다 잘 받았어요" → 결제 요청 단계
    st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    Object.assign(st.soomgoWorkflows.find(item => item.conversationId === conv), { stage: 'awaiting_completion_confirmation' });
    fs.writeFileSync(stateFile, JSON.stringify(st));
    const done = await post('/api/soomgo/reply', { conversationId: conv, messageId: 'd1', message: '감사합니다 잘 받았어요', conversationText: '[고객] 감사합니다 잘 받았어요', hiredConversation: true });
    assert.equal(done.body.reply.paymentReady, true, JSON.stringify(done.body.reply));
    assert.match(done.body.reply.text, /총액 76,000원은 전액/);
    assert.doesNotMatch(done.body.reply.text, /착수금|잔금/);
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    assert.equal(calls.length, 0, `외부 호출 0회 (${calls.join(',')})`);
    console.log('sim-fixes-0925: PASS');
  } finally {
    child.kill();
    await sleep(200);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
