'use strict';
// 9/26 준희 결정: 릴스·쇼츠 첫 거래 할인(29,000원, 리뷰 5개면 끝, 묶음 할인과 겹치지 않음, 채팅 할인 1회 쓴 것으로),
// 일반 편집 견적 뒤 릴스 가격 질문, 견적의 분류 이름 두 개 붙음 고침, "자세히 알려주실수록" 한 줄, 준희 실제 말투(짧게·목적 하나).
// 외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let apiCalls = 0;
global.fetch = async () => { apiCalls += 1; throw new Error('network_disabled_in_test'); };
const ROOT = path.join(__dirname, '..');
const R = require('../server/relay-server');
const V = require('../server/video-edit-quote');
const t = require('../server/chat-timing');
const fb = require('../server/customer-room-fallback');
const rules = require('../server/soomgo-auto-rules');
const registry = require('../server/service-registry');
const { checkHonorific } = require('../server/honorific-guard');
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));
const video = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', 'video_edit.json'), 'utf8'));
const hon = text => assert.ok(checkHonorific(text).ok, text);

// 1) 첫 거래 할인: 정책 값, 정가는 그대로, 리뷰 5개면 끝
{
  assert.deepEqual({ ...policy.introPromo.shorts, _note: undefined }, { _note: undefined, enabled: true, price: 29000, endAfterReviews: 5, reviewsCount: 0 });
  assert.equal(video.pricing.shorts.saleAmount, 39000, '정가 그대로');
  assert.deepEqual(V.introPromoShorts(), { price: 29000, reviewsCount: 0, endAfterReviews: 5 });
  assert.equal(V.introPromoShorts({ introPromo: { enabled: true, price: 29000, endAfterReviews: 5, reviewsCount: 5 } }), null, '리뷰 5개면 자동 종료');
  assert.equal(V.introPromoShorts({ introPromo: { enabled: false, price: 29000 } }), null);
  const one = V.videoEditQuote({ topic: '인스타 릴스 1개', text: '인스타 릴스 1개' });
  assert.equal(one.amount, 29000);
  assert.deepEqual(one.introPromo, { count: 1, fullUnitAmount: 39000, unitAmount: 29000, amount: 29000 });
  const ended = V.videoEditQuote({ topic: '인스타 릴스 1개' }, { introPromo: { enabled: true, price: 29000, endAfterReviews: 5, reviewsCount: 7 } });
  assert.equal(ended.amount, 39000); assert.equal(ended.introPromo, undefined);
  // 묶음 할인과 겹치지 않음: 29,000 × 5 = 145,000 < 39,000 × 5 × 0.85 = 166,000 → 첫 거래가 하나만
  const five = V.videoEditQuote({ topic: '릴스 5개 만들어 주세요' });
  assert.equal(five.amount, 145000); assert.equal(five.shorts.bundleRate, 0, '묶음 할인 안 겹침');
  // 첫 거래가가 더 비싸지는 경우(가상: 38,000원)엔 묶음 할인 쪽
  const pricey = V.videoEditQuote({ topic: '릴스 5개 만들어 주세요' }, { introPromo: { enabled: true, price: 38000 } });
  assert.equal(pricey.amount, 195000); assert.equal(pricey.shorts.bundleRate, 0.15); assert.equal(pricey.introPromo, undefined);
  // 자동 견적 문구
  const req = { topic: '카페 홍보 릴스 1개', text: '서비스 분야\n릴스\n의뢰/희망사항\n카페 홍보 릴스 1개\n' };
  const p = V.videoEditQuote(req);
  const msg = V.autoQuoteMessage(req, p, V.autoQuoteDecision(req, p, { enabled: true, sentToday: 0 }));
  assert.match(msg, /^안녕하세요, 릴스\(1분 이내 세로 영상\)는 1편 39,000원인데, 첫 거래라 29,000원에 자막까지 넣어서 해 드릴게요\./);
  assert.doesNotMatch(msg, /묶음|%/);
  hon(msg);
  // 요청봇 경로(자동 규칙): 견적에 첫 거래 할인 표시가 남는다
  const input = { requestId: 'PR1', text: '요청 상세\n견적 보낸 고수 1명\n10분 전\n영상 편집\n\n서비스 분야\n쇼츠/릴스\n원본 길이\n5분 이내\n의뢰/희망사항\n카페 홍보 릴스 1개\n완료 희망일\n10월 3일\n', volume: '5분 이내', topic: '카페 홍보 릴스 1개' };
  const { parsed, quote } = R.buildSoomgoQuote(input);
  rules.applySoomgoAutoRules({ body: input, request: parsed, quote, requestedServiceId: null, existingLead: null, state: {}, requestId: 'PR1', supportedServiceIds: registry.listServices({ channel: 'soomgo' }).map(s => s.id), sampleAmount: a => a, videoAutoQuoteConfig: { enabled: true } });
  assert.equal(quote.amount, 29000); assert.equal(quote.introPromo.unitAmount, 29000); assert.equal(quote.videoEdit.introPromo.amount, 29000);
  // 채팅 가격 답·[사실]
  const chat = R.applyChatReplyPolicy({ message: '릴스 하나 얼마예요?' }, { autoSend: true, text: 'x' });
  assert.equal(chat.text, '릴스(1분 이내 세로 영상)는 1편 39,000원인데, 첫 거래라 29,000원에 해 드릴게요. 수정 2회가 포함돼요.'); hon(chat.text);
  const facts = R.soomgoChatFactsText({});
  assert.match(facts, /첫 거래 할인으로 1편 29,000원/);
  assert.match(facts, /첫 거래가와 묶음 할인은 겹치지 않고/);
  // 첫 거래 할인이 나간 방은 채팅 할인 1회를 쓴 것
  const range = R.soomgoChatFactsText({ quote: { amount: 29000, introPromo: { count: 1 } } });
  assert.match(range, /이미 29,000원으로 한 번 낮췄다\. 더 낮추지 않는다/);
  assert.doesNotMatch(range, /한 번만, 최저/);
  const byText = R.soomgoChatFactsText({ quote: { amount: 29000 }, conversationText: '[내 답변] 릴스는 1편 39,000원인데, 첫 거래라 29,000원에 해 드릴게요.' });
  assert.match(byText, /이미 29,000원으로 한 번 낮췄다/, '카드 금액만 있어도 우리 말의 "첫 거래라"로');
}

// 2) 일반 편집으로 견적이 나간 방에서 "릴스도 69,000원인가요?"
{
  const quote = { serviceId: 'video_edit', amount: 69000, pricing: { type: 'video_edit', units: 5 }, videoEdit: { amount: 69000 }, message: '안녕하세요, 원본 5분 이내면 필요 없는 부분 정리하고 자막까지 넣어서 69,000원에 해 드릴 수 있습니다.' };
  const r = R.applyChatReplyPolicy({ conversationId: '91', message: '릴스도 69,000원인가요?', quote }, { autoSend: true, text: 'x' });
  assert.equal(r.templateKey, 'video_edit_shorts_price');
  assert.equal(r.text, `앞서 안내드린 69,000원은 일반 영상 편집(원본 5분 이내) 기준이에요. 릴스처럼 1분 이내 세로 영상은 원래 1편 39,000원인데, 첫 거래라 29,000원에 해 드릴게요. 쇼츠 예시 영상: ${video.quoteCopy.sampleUrls.shorts}`);
  hon(r.text);
  // 이미 쇼츠 견적인 방은 그대로
  assert.notEqual(R.applyChatReplyPolicy({ message: '릴스 얼마예요?', quote: { ...quote, amount: 29000, introPromo: { count: 1 } } }, { autoSend: true, text: 'x' }).templateKey, 'video_edit_shorts_price');
}

// 3) 견적 문구에 분류 이름이 두 개 붙지 않는다("상업 영상 개인 영상")
{
  const mk = field => ({ requestId: 'W1', volume: '5분 이내', text: `요청 상세\n영상 편집\n\n서비스 분야\n${field}\n원본 길이\n5분 이내\n` });
  const say = input => { const p = V.videoEditQuote(input); return V.autoQuoteMessage(input, p, V.autoQuoteDecision(input, p, { enabled: true, sentToday: 0 })); };
  assert.match(say(mk('상업 영상 개인 영상')), /^안녕하세요, 원본 5분 이내면/);
  assert.match(say(mk('상업 영상, 개인 영상')), /^안녕하세요, 원본 5분 이내면/);
  assert.match(say(mk('상업 영상')), /^안녕하세요, 상업 영상 원본 5분 이내면/, '하나면 그대로(준희 예시)');
}

// 4) "자세히 알려주실수록" 한 줄: 견적 끝(샘플 링크 앞), 고용 뒤 자료 요청, [사실] — 두 번 반복하지 않음
{
  assert.equal(video.quoteCopy.detailLine, '원하시는 느낌이나 참고 영상, 넣고 싶은 문구를 자세히 알려주실수록 더 딱 맞게 만들어 드려요!');
  hon(video.quoteCopy.detailLine); hon(video.quoteCopy.materialsDetailLine);
  const req = { text: '서비스 분야\n강의\n', volume: '10분 이내' };
  const p = V.videoEditQuote(req);
  const msg = V.autoQuoteMessage(req, p, V.autoQuoteDecision(req, p, { enabled: true, sentToday: 0 }));
  assert.match(msg, /자세히 알려주실수록 더 딱 맞게 만들어 드려요! 작업 예시 영상: https:\/\/youtu\.be\/yrc4mKqd_uA$/);
  assert.equal((msg.match(/자세히/g) || []).length, 1);
  const greet = R.videoEditMaterialsLine({ contact: { materialsEmail: 'm@example.org' } }, { detail: true });
  assert.match(greet, /메일\(m@example\.org\)로 보내주세요\. 원하시는 분위기나 참고 영상, 꼭 넣을 장면·문구도 자세히 적어주실수록/);
  assert.doesNotMatch(R.soomgoWorkflowStatusReply({ stage: 'awaiting_first_result', quote: { serviceId: 'video_edit', days: '2~3일' } }), /자세히/, '상태 안내에는 반복하지 않음');
  assert.match(R.soomgoChatFactsText({}), /자세히 알려주실수록 더 딱 맞게 만들 수 있다는 점을 자연스럽게 한 번 안내/);
}

// 5) 준희 실제 말투: verified-lines(Claude [준희 문장])·존댓말 검사·AI 티 점검·길이 상한
{
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'verified-lines.md'), 'utf8');
  const block = (doc.replace(/\r/g, '').match(/```\n([\s\S]*?)\n```/) || [])[1];
  for (const line of ['준희 실제 말투(9/26 릴스 고객', '네 가능해요! 오늘 새벽 3시 전까지 맞춰 드릴게요 😊', '앗 메일함 확인해 보니 아직 영상이 안 들어왔어요 😢', '14번 파일이 빠진거같아요! 보내주시면 추가해서 제작하겠습니다 :)', '한 메시지에 목적 하나. 1~3줄']) assert.ok(block.includes(line), line);
  assert.doesNotMatch(doc, /@[a-z0-9-]+\.[a-z]/i, '문서에 메일 주소 없음');
  assert.doesNotMatch(block, /"~드릴게요", "견적 보셨군요"는 쓰지 않는다/, '옛 금지(드릴게요) 풀림');
  const prompt = R.buildSoomgoAiReplyPrompt({ conversationId: '1', message: '릴스 가능해요?' }, { text: 'x' });
  assert.ok(prompt.includes(block), 'Claude 답장 지침에 들어감');
  for (const text of ['원하시는 느낌, 참고 릴스, 꼭 넣을 문구·자막도 같이 적어주시면 좋습니당', '14번 파일이 빠진거같아요! 보내주시면 추가해서 제작하겠습니다 :)', '영상 잘 받았어요! 지금부터 바로 작업 시작할게요 😊', '숨고페이로 29,000원 요청드릴게요. 작업 완료 후에 결제가 확정되니 걱정 안 하셔도 돼요!', '앗 메일함 확인해 보니 아직 영상이 안 들어왔어요 😢']) {
    hon(text);
    assert.equal(t.aiTellCheck(text), '', text);
  }
  assert.equal(t.aiTellCheck('확인하겠습니다. 바로 진행하겠습니다.'), 'tone_rule');
  assert.deepEqual([policy.customerRoomFallback.maxReplyChars, policy.customerRoomFallback.maxReplyLines], [180, 4]);
  const cfg = fb.readConfig(policy);
  assert.deepEqual([cfg.maxReplyChars, cfg.maxReplyLines], [180, 4]);
  // 고정 문구도 짧게: 고용 인사 v3, 고용 뒤 상태 안내에 "제작 큐" 같은 내부 말 없음
  const greeting = require('../server/message-registry').getMessage('common.hire_greeting.v1');
  assert.equal(greeting.version, 'v3'); hon(greeting.text);
  const status = R.soomgoWorkflowStatusReply({ stage: 'awaiting_first_result', quote: { serviceId: 'subtitle', days: '1일' } });
  assert.doesNotMatch(status, /제작 큐|피드백 반영 후|순서대로 전달하겠습니다/); hon(status);
}

// 6) 채팅봇 확장은 바꾸지 않았다(발행본 = 소스, 버전 그대로)
{
  const dl = path.join(ROOT, 'dist', 'downloads');
  const normalizeEol = value => String(value).replace(/\r\n/g, '\n');
  assert.equal(normalizeEol(fs.readFileSync(path.join(dl, 'relay-desk-soomgo-chat-bot', 'chat-content.js'), 'utf8')), normalizeEol(fs.readFileSync(path.join(ROOT, 'soomgo-chat-bot', 'chat-content.js'), 'utf8')), '발행본과 소스 내용이 줄바꿈 차이 외에는 같음');
}
assert.equal(apiCalls, 0);
console.log('promo-tone-0926: PASS');
