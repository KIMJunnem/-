'use strict';

// 개발방 지시 27 (2026-09-24, decisions 7-13): 숨고 문서·교정·PPT 자동 견적 멈춤(보내지 않음 + 삭제 안 함).
// 영상 편집·자막은 그대로. 합성 입력만, 외부 호출 없음. 가격·문구 변경 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const R = require('../server/relay-server');
const rules = require('../server/soomgo-auto-rules');
const registry = require('../server/service-registry');
const quoteReview = require('../server/quote-review-attention');
const root = path.join(__dirname, '..');
const supported = registry.listServices({ channel: 'soomgo' }).map(service => service.id);

// 0) 스위치 파일·bat
for (const [file, key] of [['document_writing.json', 'doc'], ['presentation.json', 'ppt']]) {
  const def = JSON.parse(fs.readFileSync(path.join(root, 'services', file), 'utf8'));
  assert.equal(typeof def.soomgoAutoQuote, 'boolean', `${file}: soomgoAutoQuote`);
  assert.equal(def.channels.soomgo, true, `${file}: 채팅봇 응대용 숨고 채널은 그대로`);
  assert.equal(def.channels.kmong, true, `${file}: 크몽 그대로`);
  for (const mode of ['on', 'off']) {
    const bat = fs.readFileSync(path.join(root, `${key}-quote-${mode}.bat`), 'utf8');
    assert.match(bat, new RegExp(`node scripts\\\\soomgo-quote-switch\\.cjs ${key} ${mode}`));
    assert.doesNotMatch(bat, /chatbot-switch|video-quote-switch/);
  }
}

const mk = (id, category, body) => ({ requestId: id, text: `요청 상세\n고객 정보\n견적 보낸 고수 2명\n30분 전\n${category}\n\n${body}\n고객 정보\n신고하기\n` });
const run = (input, pause) => {
  const { parsed, quote } = R.buildSoomgoQuote(input);
  const state = {};
  const result = rules.applySoomgoAutoRules({ body: input, request: parsed, quote, requestedServiceId: null, existingLead: null, state, requestId: input.requestId, supportedServiceIds: supported, sampleAmount: a => a, ...(pause ? { soomgoPauseConfig: pause } : {}), videoAutoQuoteConfig: { enabled: true } });
  return { result, quote, parsed, state };
};
const OFF = { document_writing: false, presentation: false };
const ON = { document_writing: true, presentation: true };
const docCases = [
  ['문서/글 작성', mk('P-DOC', '문서/글 작성', '작업 분량\nA4 3쪽\n작성 주제\n사업 안내문 작성'), 'document_writing', 'doc_soomgo_paused'],
  ['교정/교열', mk('P-PROOF', '교정/교열', '작업 분량\nA4 4쪽\n의뢰 내용\n안내문 맞춤법 교정'), 'document_writing', 'doc_soomgo_paused'],
  ['PPT 제작', mk('P-PPT', 'PPT 제작', '작업 분량\n7장\n의뢰 내용\n회사 소개 발표 자료 PPT'), 'presentation', 'ppt_soomgo_paused']
];
for (const [name, input, serviceId, code] of docCases) {
  // 1) 스위치 true(예전): 자동 발송
  const before = run(input, ON);
  assert.equal(before.quote.serviceId, serviceId, `${name}: 서비스`);
  assert.equal(before.quote.autoSend, true, `${name}: 스위치 켜짐이면 예전처럼 발송`);
  const amount = before.quote.amount;
  // 2) 스위치 false: 보내지 않음 + 삭제 안 함 + 건마다 알림 없음
  const after = run(input, OFF);
  assert.equal(after.result.action, 'paused', name);
  assert.equal(after.quote.autoSend, false, `${name}: 보내지 않음`);
  assert.equal(after.quote.deleteRequest, false, `${name}: 삭제 안 함`);
  assert.equal(after.quote.manualReview, false, `${name}: 건마다 준희 확인 알림 없음`);
  assert.equal(after.quote.autoRule.ruleId, code, name);
  assert.equal(after.quote.amount, amount, `${name}: 금액 계산은 그대로(가격 변경 없음)`);
  const state = {};
  assert.equal(quoteReview.upsertQuoteReview(state, { requestId: input.requestId, request: after.parsed, quote: after.quote }).changed, false, `${name}: 알림 목록에 안 올라감`);
  // Claude 견적이 붙어도 멈춤 유지
  const patched = { ...after.quote, autoSend: true };
  assert.equal(rules.applySoomgoServicePause(patched, OFF), true);
  assert.equal(patched.autoSend, false);
}
// 3) 영상 편집·자막은 그대로 발송
{
  const sub = run(mk('P-SUB', '자막', '영상 길이\n10분\n의뢰 내용\n한국어 강의 영상 자막 SRT'), OFF);
  assert.equal(sub.quote.serviceId, 'subtitle');
  assert.equal(sub.quote.autoSend, true, '자막은 그대로 자동 발송');
  const vid = run({ ...mk('P-VID', '영상 편집', '서비스 분야\n개인 영상\n원본 길이\n5분 이내'), volume: '5분 이내' }, OFF);
  assert.equal(vid.quote.autoSend, true, '영상 편집(스위치 켜짐) 그대로 자동 발송');
  assert.equal(vid.quote.amount, 69000);
}
// 4) 하루 요약: 건수만
{
  const now = Date.now();
  const leads = ['doc_soomgo_paused', 'doc_soomgo_paused', 'ppt_soomgo_paused'].map((ruleId, i) => ({ createdAt: new Date(now).toISOString(), requestId: `S${i}`, quote: { autoRule: { ruleId } } }));
  leads.push({ createdAt: new Date(now - 48 * 3600e3).toISOString(), requestId: 'OLD', quote: { autoRule: { ruleId: 'doc_soomgo_paused' } } });
  const summary = rules.pausedSummary({ soomgoLeads: leads }, now);
  assert.deepEqual(summary.counts, { document_writing: 2, presentation: 1 });
  assert.match(summary.line, /문서·교정 2건 · PPT 1건 보내지 않음/);
  assert.equal(rules.pausedSummary({ soomgoLeads: [] }, now).line, '');
}
assert.equal(netCalls, 0, '외부 호출 없음');
console.log('soomgo-pause-27: PASS');
