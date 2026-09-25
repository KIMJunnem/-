'use strict';

// 개발방 지시 25 (2026-09-24, 준희 "견적 앵간하면 너네가 보내"): 견적 설명 말투(준희 예시와 글자 그대로) + 영상 편집 자동 견적 넓히기.
// 가격표(7-4)·하루 10건 상한 그대로. 합성 입력만, 외부 호출 없음.
const assert = require('node:assert/strict');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const R = require('../server/relay-server');
const rules = require('../server/soomgo-auto-rules');
const registry = require('../server/service-registry');
const supported = registry.listServices({ channel: 'soomgo' }).map(service => service.id);
const mk = (id, len, extra = '', field = '상업 영상') => ({ requestId: id, volume: len, text: `요청 상세\n고객 정보\n견적 보낸 고수 2명\n30분 전\n영상 편집\n\n서비스 분야\n${field}\n원본 길이\n${len}\n희망 길이\n5분 이내\n${extra}\n고객 정보\n신고하기\n` });
const run = (input, state = {}) => {
  const { parsed, quote } = R.buildSoomgoQuote(input);
  const result = rules.applySoomgoAutoRules({ body: input, request: parsed, quote, requestedServiceId: null, existingLead: null, state, requestId: input.requestId, supportedServiceIds: supported, sampleAmount: a => a, videoAutoQuoteConfig: { enabled: true } });
  return { result, quote };
};
// 0) 준희 예시와 글자 그대로(상업 영상 · 원본 5분 이내)
{
  // 9/25 A/B: A판(요청 번호 V25-EXA)은 준희 예시 그대로, B판(V25-EX)은 끝에 날짜 한 줄만 더
  const { quote } = run(mk('V25-EXA', '5분 이내'));
  assert.equal(quote.autoSend, true);
  assert.equal(quote.message, '안녕하세요, 상업 영상 원본 5분 이내면 필요 없는 부분 정리하고 자막까지 넣어서 69,000원에 해 드릴 수 있습니다. 영상 받고 1~2일 안에 MP4로 보내드리고, 수정은 2회까지 가능합니다!!');
  assert.equal(quote.quoteMessageVersion, 'auto-v2');
  const b = run(mk('V25-EX', '5분 이내')).quote;
  assert.equal(b.message, `${quote.message} 원하시는 완성 날짜만 알려주시면 바로 일정 잡아드릴 수 있습니다!`);
  assert.equal(b.quoteMessageVersion, 'auto-v2-B');
  assert.match(quote.quoteMessageVersion, /^auto-v2(?:-B)?$/, '문구가 바뀌어 버전을 올림(9/25 A/B)');
}
// 1) 45분 → 7-4 계산값(129,000 + 3×15,000 = 174,000), 작업 기간 3일
{
  const { quote } = run(mk('V25-45', '45분'));
  assert.equal(quote.autoSend, true); assert.equal(quote.amount, 174000); assert.equal(quote.days, '3일');
  assert.match(quote.message, /영상 받고 3일 안에 MP4로 보내드리고, 수정은 2회까지 가능합니다!!(?: 원하시는 완성 날짜만 알려주시면 바로 일정 잡아드릴 수 있습니다!)?$/);
}
// 2) 컷·자막 + 모션그래픽 섞임 → 발송, 제외 문장 한 줄 / 모션그래픽만 → 알림
{
  const mixed = run(mk('V25-MIX', '5분 이내', '편집 요소\n컷 편집, 자막, 모션그래픽'));
  assert.equal(mixed.quote.autoSend, true); assert.equal(mixed.quote.amount, 69000);
  assert.match(mixed.quote.message, /움직이는 그래픽\(모션그래픽\)·3D·더빙은 제가 하지 않는 작업이라 빼고, 컷 편집과 자막으로 해 드릴 수 있습니다\./);
  const only = run(mk('V25-ONLY', '5분 이내', '요청 사항\n모션그래픽 인트로만 만들어 주세요'));
  assert.equal(only.quote.autoSend, false); assert.equal(only.quote.videoEdit.autoDecision, 'excluded_work');
  const visit = run(mk('V25-VISIT', '5분 이내', '요청 사항\n현장 촬영 부탁드려요'));
  assert.equal(visit.quote.autoSend, false, '촬영·방문은 지금처럼 알림');
}
// 3) "1시간 이상" → 상한 249,000원·3~4일 + 일정 문장 / "3시간 이상" → 알림 / 길이 없음 → 알림
{
  const open = run(mk('V25-OPEN', '1시간 이상'));
  assert.equal(open.quote.autoSend, true); assert.equal(open.quote.amount, 249000); assert.equal(open.quote.days, '3~4일');
  assert.match(open.quote.message, /원본 길이 확인하고 일정은 다시 말씀드릴 수 있습니다\. 영상 받고 3~4일 안에 MP4로 보내드리고, 수정은 2회까지 가능합니다!!(?: 원하시는 완성 날짜만 알려주시면 바로 일정 잡아드릴 수 있습니다!)?$/);
  assert.ok(!/\?/.test(open.quote.message), '질문으로 끝내지 않음');
  const long = run(mk('V25-3H', '3시간 이상'));
  assert.equal(long.quote.autoSend, false); assert.equal(long.quote.videoEdit.autoDecision, 'length_open_ended');
  const none = run(mk('V25-NONE', ''));
  assert.equal(none.quote.autoSend, true); assert.equal(none.quote.videoEdit.autoDecision, 'ok'); // 9/25: 길이 모름은 시작가 + 자료 보고 확정
}
// 4) 하루 상한(9/25부터 30건)
{
  const now = Date.now();
  const state = { videoEditAutoQuotes: Array.from({ length: 30 }, (_, i) => ({ at: new Date(now).toISOString(), requestId: `D${i}` })) };
  const capped = run(mk('V25-CAP', '45분'), state);
  assert.equal(capped.quote.autoSend, false); assert.equal(capped.quote.videoEdit.autoDecision, 'daily_cap');
}
// 5) 말투: 번역·스토리보드 줄도 "~습니다", 숨고페이·질문 없음, "~드릴게요/~괜찮아요/~있어요" 없음(견적 설명·고친 자동 문구)
{
  const { quote } = run(mk('V25-TR', '10분', '요청 사항\n영어 인터뷰 번역 자막, 스토리보드 있어요'));
  assert.match(quote.message, /이 금액에 들어 있습니다\./);
  assert.match(quote.message, /세부 구성은 스토리보드 보고 확정하겠습니다\. 영상 받고/, '스토리보드 줄은 수정 문장 앞');
  assert.doesNotMatch(quote.message, /숨고페이|\?|드릴게요|괜찮아요|있어요/);
  const sq = R.buildSoomgoQuote({ requestId: 'V25-SUB', purpose: '자막 제작', volume: '10분', topic: '한국어 강의 영상 자막', format: 'SRT' }).quote;
  for (const msg of ['내일까지 되나요?', '얼마예요?', '어떤 형식으로 받나요?', '샘플 볼 수 있나요?', '경력이 어떻게 되세요?', '전화 통화 가능할까요?']) {
    const reply = R.applyChatReplyPolicy({ message: msg, quote: sq }, R.soomgoReply({ message: msg, quote: sq }));
    assert.doesNotMatch(String(reply.text || ''), /드릴게요|괜찮아요|있어요/, `${msg}: 말투`);
  }
}
assert.equal(netCalls, 0, '외부 호출 없음');
console.log('video-auto-quote-25: PASS');
