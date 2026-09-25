'use strict';

// 개발방 지시 24 (2026-09-24, decisions 7-10): 영상 편집 규칙 기반 자동 견적(스위치 기본 꺼짐) + 틀린 자동 문구 6개.
// 합성 입력만. 실제 숨고 발송·유료 API 호출 없음. 가격 숫자는 7-4 그대로.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const R = require('../server/relay-server');
const rules = require('../server/soomgo-auto-rules');
const registry = require('../server/service-registry');
const video = require('../server/video-edit-quote');
const claudeQuote = require('../server/claude-quote');
const root = path.join(__dirname, '..');
const supported = registry.listServices({ channel: 'soomgo' }).map(service => service.id);

// 0) 스위치: 정의 파일 기본값은 꺼짐, 하루 10건. 켜기·끄기는 bat 두 개가 scripts/video-quote-switch.cjs로만 바꾼다
const def = JSON.parse(fs.readFileSync(path.join(root, 'services', 'video_edit.json'), 'utf8'));
assert.equal(typeof def.autoQuote.enabled, 'boolean');
assert.equal(def.autoQuote.dailyMaxSends, 30);
for (const [bat, mode] of [['video-quote-on.bat', 'on'], ['video-quote-off.bat', 'off']]) {
  const text = fs.readFileSync(path.join(root, bat), 'utf8');
  assert.match(text, new RegExp(`node scripts\\\\video-quote-switch\\.cjs ${mode}`), bat);
  assert.doesNotMatch(text, /chatbot-switch|sendEnabled|claudeEnabled/, `${bat}: 채팅봇 스위치는 건드리지 않음`);
}
assert.match(fs.readFileSync(path.join(root, 'scripts', 'video-quote-switch.cjs'), 'utf8'), /"autoQuote"\\s\*:\\s\*\\\{\\s\*"enabled"/);

// 숨고 요청봇이 보내는 모양(원본 길이 답은 volume 칸)
const mk = (id, len, extra = '', field = '개인 영상') => ({ requestId: id, volume: len, text: `요청 상세\n고객 정보\n견적 보낸 고수 2명\n30분 전\n영상 편집\n\n서비스 분야\n${field}\n원본 길이\n${len}\n희망 길이\n5분 이내\n이용 목적\n고수와 상담 후 결정할게요.\n진행 방식\n온라인으로 진행할게요.\n${extra}\n고객 정보\n신고하기\n` });
const run = (input, { on = true, state = {}, config = {} } = {}) => {
  const { parsed, quote } = R.buildSoomgoQuote(input);
  const result = rules.applySoomgoAutoRules({ body: input, request: parsed, quote, requestedServiceId: null, existingLead: null, state, requestId: input.requestId, supportedServiceIds: supported, sampleAmount: a => a, ...(on ? { videoAutoQuoteConfig: { enabled: true, ...config } } : {}) });
  return { result, quote, parsed, state };
};
const toneOk = (name, message, amount) => {
  assert.doesNotMatch(message, / · |·/, `${name}: 점 나열 없음`);
  assert.doesNotMatch(message, /최선을 다하|고객님의 소중한|전문가가|퀄리티 보장|빠르고 정확하게|문의 주신|~~/, `${name}: 광고 문구 없음`);
  // 9/24 지시 25: 준희 예시 모양 — 질문·숨고페이 문장 없이 "수정은 N회까지 가능합니다!!"로 끝
  assert.equal((message.match(/\?/g) || []).length, 0, `${name}: 질문 없음`);
  assert.match(message, /수정은 2회까지 가능합니다!!(?: 원하시는 완성 날짜만 알려주시면 바로 일정 잡아드릴 수 있습니다!)?$/, `${name}: 끝 문장(B판은 날짜 한 줄 더)`);
  assert.doesNotMatch(message, /드릴게요|괜찮아요|있어요/, `${name}: 말투`);
  assert.equal((message.match(/\d[\d,]*원/g) || []).length, 1, `${name}: 금액은 하나`);
  assert.ok(message.includes(`${amount.toLocaleString('ko-KR')}원`), `${name}: 계산 금액`);
  assert.doesNotMatch(message, /숨고페이/, `${name}: 견적 설명에 숨고페이 문장 없음(지시 25)`);
  assert.match(message, /수정은 2회/, `${name}: 수정 포함`);
  assert.match(message, /개인 영상/, `${name}: 고객 단어 되짚기`);
};

// 1) 자동 발송 대상 3건
for (const [name, len, amount, days] of [['5분', '5분 이내', 69000, '1~2일'], ['30분', '30분 이내', 129000, '2~3일'], ['2시간', '2시간 이내', 249000, '3~4일']]) {
  const { result, quote, state } = run(mk(`VA-${name}`, len));
  assert.equal(result.action, 'quote', `${name}: 자동 견적`);
  assert.equal(quote.autoSend, true, name);
  assert.equal(quote.manualReview, false, name);
  assert.equal(quote.deleteRequest, false, name);
  assert.equal(quote.amount, amount, `${name} 금액(7-4, 상한 249,000원)`);
  assert.equal(quote.days, days, `${name} 기간`);
  assert.equal(quote.serviceId, 'video_edit');
  assert.equal(quote.autoRule.ruleId, 'video_edit_auto');
  assert.match(quote.quoteMessageVersion, /^auto-v2(?:-B)?$/); // 9/25 A/B 시험
  assert.equal(claudeQuote.eligible(quote), false, `${name}: Claude 판단 호출 없음`);
  assert.ok(quote.message.includes(`원본 ${len}`), `${name}: 고객이 고른 길이 되짚기`);
  toneOk(name, quote.message, amount);
  assert.equal(state.videoEditAutoQuotes.length, 1, `${name}: 하루 상한 기록`);
}
// 2) 보내지 않는 경우(준희 알림으로 남음)
for (const [name, input, reason] of [
  ['모션그래픽만', mk('VA-motion', '5분 이내', '요청 사항\n모션그래픽 인트로만 넣어주세요'), 'excluded_work'],
  ['3D', mk('VA-3d', '5분 이내', '요청 사항\n3D 효과'), 'excluded_work'],
  ['더빙', mk('VA-dub', '5분 이내', '요청 사항\n성우 더빙 필요'), 'excluded_work'],
  ['촬영·방문', mk('VA-visit', '5분 이내', '요청 사항\n현장 촬영 부탁드려요'), 'visit_or_shoot'],
  ['끝이 열린 길이(2시간 넘음)', mk('VA-open', '3시간 이상'), 'length_open_ended']
]) {
  const { result, quote, state } = run(input);
  assert.equal(result.action, 'retain_review', `${name}: 보내지 않음`);
  assert.equal(quote.autoSend, false, name);
  assert.equal(quote.manualReview, true, `${name}: 준희 알림`);
  assert.equal(quote.deleteRequest, false, `${name}: 삭제 안 함`);
  assert.equal(quote.videoEdit.autoDecision, reason, name);
  assert.equal((state.videoEditAutoQuotes || []).length, 0, name);
}
// 3) 스토리보드·콘티: 금액 같고 "스토리보드 보고 확정" 한 줄
{
  const { quote } = run(mk('VA-sb', '5분 이내', '요청 사항\n돌영상 스토리보드 있어요'));
  assert.equal(quote.autoSend, true);
  assert.equal(quote.amount, 69000);
  assert.match(quote.message, /스토리보드 보고 확정/);
  assert.equal(quote.videoEdit.storyboard, true);
  toneOk('스토리보드', quote.message, 69000);
}
// 4) 스위치 꺼짐(기본): 지금처럼 사람 확인, 이유 문구도 그대로
{
  const { result, quote } = run(mk('VA-off', '5분 이내'), { on: false, config: {} });
  if (def.autoQuote.enabled === false) {
    assert.equal(result.action, 'retain_review');
    assert.equal(quote.autoSend, false);
    assert.equal(quote.videoEdit.autoDecision, 'switch_off');
    assert.equal(quote.videoEdit.manualSendOnly, true);
  }
  const forcedOff = run(mk('VA-off2', '5분 이내'), { config: { enabled: false } });
  assert.equal(forcedOff.quote.autoSend, false, '꺼짐 설정이면 보내지 않음');
  assert.equal(forcedOff.quote.videoEdit.autoDecision, 'switch_off');
}
// 5) 하루 30건 상한(9/25 준희 "하루 30개까지", 한국 시간 기준, 같은 요청은 한 번만 셈)
{
  const now = Date.now();
  const state = { videoEditAutoQuotes: Array.from({ length: 30 }, (_, i) => ({ at: new Date(now).toISOString(), requestId: `DONE-${i}` })) };
  const capped = run(mk('VA-cap', '5분 이내'), { state });
  assert.equal(capped.quote.autoSend, false, '31번째는 보내지 않음');
  assert.equal(capped.quote.videoEdit.autoDecision, 'daily_cap');
  const again = run(mk('DONE-3', '5분 이내'), { state });
  assert.equal(again.quote.autoSend, true, '이미 센 요청을 다시 열면 상한에 막히지 않음(중복 계산 없음)');
  assert.equal(state.videoEditAutoQuotes.length, 30, '같은 요청은 다시 기록하지 않음');
  const yesterday = { videoEditAutoQuotes: Array.from({ length: 10 }, (_, i) => ({ at: new Date(now - 36 * 3600e3).toISOString(), requestId: `OLD-${i}` })) };
  assert.equal(run(mk('VA-new-day', '5분 이내'), { state: yesterday }).quote.autoSend, true, '날이 바뀌면 다시 30건');
}
// 6) 길이 읽기: 구간은 최댓값, "1시간 30분"은 합
assert.equal(video.sourceMinutes({ volume: '30분~1시간' }), 60);
assert.equal(video.sourceMinutes({ volume: '1~2시간' }), 120);
assert.equal(video.sourceMinutes({ volume: '1시간 30분' }), 90);
assert.equal(video.sourceMinutes({ volume: '2시간 이내', topic: '30분 이내' }), 120, '원본 길이 칸이 있으면 그 칸만');
assert.equal(video.sourceLengthOpenEnded({ volume: '2시간 이상' }), true);

// ── 틀린 자동 문구 고치기 6개 ──
const sq = R.buildSoomgoQuote({ requestId: 'FX-SUB', purpose: '자막 제작', volume: '10분', topic: '한국어 강의 영상 자막', format: 'SRT' }).quote;
const dq = R.buildSoomgoQuote({ requestId: 'FX-DOC', purpose: '문서/글 작성', volume: 'A4 3쪽', topic: '사업 안내문 작성' }).quote;
const reply = (message, quote) => R.applyChatReplyPolicy({ message, quote }, R.soomgoReply({ message, quote }));
// (1) 납기 약속: 서비스별 실제 수정 횟수, 점 나열 없음
{
  const s = reply('내일까지 되나요?', sq); const d = reply('내일까지 되나요?', dq);
  assert.equal(s.templateKey, 'deadline_commitment');
  assert.match(s.text, /수정은 2회까지/); assert.match(d.text, /수정은 3회까지/);
  for (const r of [s, d]) { assert.doesNotMatch(r.text, /수정 1회/); assert.doesNotMatch(r.text, /·/); }
  assert.match(s.text, /SRT/);
}
// (2) 자막 가격: "영상 편집은 하지 않습니다" 없음
assert.doesNotMatch(reply('얼마예요?', sq).text, /영상 편집은 하지 않습니다/);
assert.doesNotMatch(JSON.stringify(registry.getService('subtitle')), /영상 편집은 하지 않습니다/);
// (3) 형식: 자막은 SRT(입히면 MP4), 문서 형식 안내 없음
{
  const r = reply('어떤 형식으로 받나요?', sq);
  assert.match(r.text, /SRT/); assert.match(r.text, /MP4/); assert.doesNotMatch(r.text, /한글|워드|파워포인트|·/);
  assert.doesNotMatch(reply('어떤 형식으로 받나요?', dq).text, /·/);
}
// (4) 샘플: 계산식 없이 금액만
{
  const r = reply('샘플 볼 수 있나요?', sq);
  assert.equal(r.templateKey, 'sample_offer');
  assert.doesNotMatch(r.text, /25%|반올림|완성본 판매가/);
  assert.match(r.text, /\d[\d,]*원/);
}
// (5) 경력 질문: 신규 솔직 문장 / 연락 인사: 어색한 "상담은 숨고 채팅으로 진행하고 있습니다" 없음
{
  const r = reply('경력이 어떻게 되세요?', sq);
  assert.match(r.text, /숨고는 이번에 시작해서 리뷰는 아직 없지만/);
  assert.doesNotMatch(r.text, /고용 요청을 확정해 주시면 진행합니다/);
  assert.match(reply('리뷰가 없네요', sq).text, /리뷰는 아직 없지만/);
  assert.doesNotMatch(reply('안녕하세요 견적 보고 연락드려요', sq).text, /상담은 숨고 채팅으로 진행하고 있습니다/);
  assert.match(reply('전화 통화 가능할까요?', sq).text, /숨고 채팅/);
}
// (6) 챗봇 프롬프트 첫 줄
{
  const prompt = R.buildSoomgoAiReplyPrompt({ message: '얼마예요?', quote: sq }, { text: '견적 금액은 49,000원입니다.' });
  // 지시 29(교체)에서 첫 줄은 "붙여넣기" 틀로 바뀌었다. 1인 작업자 swan 문장은 둘째 줄
  assert.match(prompt, /숨고를 막 시작한 1인 작업자 swan/);
  assert.doesNotMatch(prompt, /문서 작업을 상담하는 한국어 고객 응대 담당자/);
}
// 금지 주제는 그대로 준희 알림
for (const m of ['환불해 주세요', 'AI로 하시는 거예요?']) assert.equal(reply(m, sq).autoSend, false, `${m}: 자동 답장 없음`); // 9/25 지시 32: 흥정은 챗봇이
assert.equal(netCalls, 0, '외부 호출 없음');
console.log('video-auto-quote-24: PASS');
