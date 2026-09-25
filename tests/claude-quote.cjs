'use strict';

// Claude(Fable 5.1) 견적 판단·자동 발송(2026-09-22). 가짜 호출만, 실제 API 호출 0회.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const cq = require('../server/claude-quote');
const { buildSoomgoQuote } = require('../server/relay-server');
const autoRules = require('../server/soomgo-auto-rules');
// 9/24 지시 27: 이 시험은 숨고 문서·교정·PPT 자동 견적이 켜져 있을 때의 규칙을 본다(멈춤은 tests/soomgo-pause-27.cjs).
autoRules.setPauseConfigForTest({ document_writing: true, presentation: true });
const registry = require('../server/service-registry');
const policyFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));

// 0) 정책 파일: 준희가 정한 한도
// 2026-09-22 준희 결정: 충전 전까지 꺼 둠(enabled:false). 아래 논리 검사는 켠 복사본으로 한다.
assert.deepEqual({ enabled: policyFile.claudeQuote.enabled, calls: policyFile.claudeQuote.dailyMaxCalls, krw: policyFile.claudeQuote.dailyBudgetKrw }, { enabled: false, calls: 30, krw: 6000 });
const policy = { claudeQuote: { ...policyFile.claudeQuote, enabled: true } };

let calls = [];
let reply = null;
const fakeClaude = async (prompt, opts) => { calls.push({ prompt, opts }); if (reply instanceof Error) throw reply; return { provider: 'Claude', model: 'claude-fable-5-1', text: typeof reply === 'string' ? reply : JSON.stringify(reply), usage: { input_tokens: 4000, output_tokens: 300 } }; };
const deps = (over = {}) => ({
  runClaude: fakeClaude, hasKey: () => true, buildSoomgoQuote, applyAutoRules: autoRules.applySoomgoAutoRules,
  listServices: o => registry.listServices(o), supportedServiceIds: () => registry.listServices({ channel: 'soomgo' }).map(s => s.id),
  readPolicy: () => policy, model: 'claude-fable-5-1', ...over
});
const hold = { serviceId: null, autoSend: false, manualReview: true, reason: '분류 불가' };
const request = { customerName: '김고객', text: '요청 상세\n고객 정보\n견적 보낸 고수 1명\n기타\n\n대학원 수업 발표문 교정 부탁드립니다. A4 5쪽 분량이고 010-1234-5678, kim@example.com 으로 연락주세요\n고객 정보\n신고하기\n\n김고객\n\n2024년 가입' };
const good = amount => ({
  serviceId: 'document_writing', params: { workType: 'proofreading', pages: 5 }, action: 'quote', memo: '가정: 기존 원고 교정', reason: '',
  text: `대학원 수업 발표문 A4 5쪽을 교정해 드리는 작업으로 확인했습니다. 맞춤법과 띄어쓰기를 고치고, 읽기 어색한 문장은 뜻이 바뀌지 않게 다듬어 드립니다. 고친 곳은 워드 변경 내용으로 표시해 드려서 하나씩 확인하실 수 있습니다.\n견적 ${amount.toLocaleString('ko-KR')}원 · 당일~1일 안에 납품 · 수정 3회 포함\n숨고페이 안전결제로 진행되고, 받아보시고 확인하신 뒤에 거래 확정하시면 됩니다. 분량이 늘어나면 작업 전에 먼저 알려드리고 동의하신 뒤에만 진행합니다.\n발표문이 이미 완성된 상태이고 다듬는 작업만 필요하신 게 맞을까요`
});
const run = async (over = {}, snapshot = {}) => cq.attempt({ requestId: 'REQ-1', request, quote: { ...hold }, snapshot, deps: deps(over) });

(async () => {
  // 1) 대상: 사람 확인만. 규칙이 견적·삭제·제공 불가로 정한 건은 제외
  assert.equal(cq.eligible({ autoSend: false, manualReview: true }), true);
  assert.equal(cq.eligible({ autoSend: true }), false);
  assert.equal(cq.eligible({ autoSend: false, deleteRequest: true }), false);
  assert.equal(cq.eligible({ autoSend: false, unsupportedService: 'resume_self_intro' }), false);

  // 2) 통과: 금액은 서버 계산(교정 5쪽 = 26,000원), 문구는 Claude 것, messageId claude.quote.v1
  const expected = buildSoomgoQuote({ requestId: 'X', purpose: '교정/교열', volume: 'A4 5쪽', topic: '교정교열', text: '교정/교열\nA4 5쪽\n교정교열' }).quote.amount;
  assert.equal(expected, 26000);
  let t = good(expected); t.text = t.text + '?'; reply = t; calls = [];
  const ok = await run();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.maxTokens, 700);
  assert.equal(ok.log.passed, true, JSON.stringify(ok.log.failures));
  assert.equal(ok.patch.amount, 26000); assert.equal(ok.patch.autoSend, true); assert.equal(ok.patch.manualReview, false);
  assert.equal(ok.patch.quoteMessageId, 'claude.quote.v1'); assert.equal(ok.patch.message, t.text.trim());
  assert.equal(ok.log.inputTokens, 4000); assert.equal(ok.log.krw, cq.costKrw(cq.readConfig(policy), 4000, 300));
  assert.ok(ok.log.krw > 0 && ok.log.krw < 100, `1건 비용 ${ok.log.krw}원`);
  // 프롬프트: 스킬 본문 + 서비스 정의 + 요청서(이름·연락처 제거)
  assert.ok(calls[0].prompt.includes('숨고 견적 문구 (Swan)'));
  assert.ok(calls[0].prompt.includes('"includedRevisions"'));
  assert.ok(calls[0].prompt.includes('대학원 수업 발표문'));
  assert.ok(!/김고객|010-1234-5678|kim@example\.com/.test(calls[0].prompt), '이름·연락처 제거');

  // 3) 검사 6개: 하나라도 실패하면 patch 없음(사람 확인 유지), 재시도 없음
  const fail = async (mutate, key) => { const o = good(expected); o.text += '?'; mutate(o); reply = o; calls = []; const r = await run(); assert.equal(calls.length, 1, `${key} 재시도 없음`); assert.equal(r.patch, undefined, key); assert.equal(r.log.passed, false, key); assert.ok(r.log.failures.some(f => f.startsWith(key)), `${key}: ${r.log.failures}`); return r; };
  await fail(o => { o.text = o.text.replace('26,000원', '25,000원'); }, 'amount');
  await fail(o => { o.text = o.text.replace('26,000원', '26,000원(부가세 2,600원 별도)'); }, 'amount');
  await fail(o => { o.params = { workType: 'proofreading', pages: 9 }; }, 'amount');
  await fail(o => { o.text += ' 괜찮으실까요?'; }, 'question');
  await fail(o => { o.text = '교정 확인했습니다. 견적 26,000원 · 당일~1일. 진행할까요?'; }, 'length');
  await fail(o => { o.text = o.text.replace('확인했습니다.', '최고의 품질로 확인했습니다.'); }, 'forbidden');
  await fail(o => { o.text = o.text.replace('확인했습니다.', '확인했습니다!!'); }, 'forbidden');
  await fail(o => { o.text = o.text.replace('확인했습니다.', '확인했습니다 😊'); }, 'forbidden');
  await fail(o => { o.text = o.text.replace('확인했습니다.', '리뷰가 없어 할인해 확인했습니다.'); }, 'forbidden');
  await fail(o => { o.serviceId = 'translation_en'; }, 'service');
  await fail(o => { o.action = 'hold'; o.reason = '분량 불명'; }, 'action');
  reply = 'JSON이 아닌 답'; calls = [];
  assert.deepEqual((await run()).log.failures, ['json_parse']);
  reply = new Error('claude_529_overloaded'); calls = [];
  const err = await run(); assert.equal(err.patch, undefined); assert.deepEqual(err.log.failures, ['call_failed']); assert.equal(calls.length, 1);

  // 4) 꺼짐·키 없음 → 호출 0회, 기존 흐름
  calls = [];
  assert.equal(await run({ readPolicy: () => ({ claudeQuote: { ...policy.claudeQuote, enabled: false } }) }), null);
  assert.equal(await run({ hasKey: () => false }), null);
  assert.equal(await run({ readPolicy: () => ({}) }), null);
  assert.equal(calls.length, 0);

  // 5) 하루 한도: 30건 또는 하루 예산을 넘기면 호출하지 않고 기록만
  const today = cq.kstDay();
  calls = [];
  const full = await run({}, { claudeQuoteLog: Array.from({ length: 30 }, (_, i) => ({ day: today, called: true, krw: 1, requestId: `R${i}` })) });
  assert.equal(full.log.skipped, 'daily_max_calls'); assert.equal(calls.length, 0);
  const broke = await run({}, { claudeQuoteLog: [{ day: today, called: true, krw: policyFile.claudeQuote.dailyBudgetKrw - 10, requestId: 'R' }] });
  assert.equal(broke.log.skipped, 'daily_budget_krw'); assert.equal(calls.length, 0);
  const yesterdayOnly = await run({}, { claudeQuoteLog: Array.from({ length: 30 }, () => ({ day: '2000-01-01', called: true, krw: 999 })) });
  assert.equal(yesterdayOnly.log.skipped, undefined, '어제 기록은 오늘 한도에 안 들어감');

  // 6) params → 기존 가격 계산(자막 번역·삽입, PPT)
  const price = (id, p) => cq.priceFromParams(id, p, deps(), 'P').amount;
  assert.equal(price('subtitle', { minutes: 10 }), 49000);
  assert.equal(price('subtitle', { minutes: 10, translated: true }), 59000);
  assert.equal(price('subtitle', { minutes: 33, burnIn: true }), 204000); // 9/23 준희: 30분 초과 5분마다 10,000원(이전 214,000)
  assert.equal(price('presentation', { slides: 13 }), 63000);
  assert.equal(price('document_writing', { workType: 'writing', pages: 5 }), 48000);
  assert.ok(cq.priceFromParams('document_writing', { workType: 'proofreading' }, deps(), 'P').error);

  // 7) 발송 결과·하루 요약
  const state = {};
  cq.appendLog(state, { ...ok.log });
  cq.appendLog(state, { day: ok.log.day, called: true, passed: false, failures: ['question:2개'], krw: 60 });
  cq.appendLog(state, { day: ok.log.day, called: false, skipped: 'daily_max_calls' });
  assert.equal(cq.recordSendResult(state, 'REQ-1', 'sent', 'now'), true);
  const summary = cq.dailySummary(state, ok.log.day);
  assert.deepEqual({ calls: summary.calls, passed: summary.passed, failed: summary.failed, sent: summary.sent, skipped: summary.skippedByLimit }, { calls: 2, passed: 1, failed: 1, sent: 1, skipped: 1 });
  assert.equal(summary.failureReasons.question, 1);

  // 8) 서버 연결: 견적 경로·발송 결과·알림 요약·Claude 호출 상한
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
  assert.match(server, /claudeAttempt = await claudeQuote\.attempt\(/);
  assert.match(server, /if \(claudeAttempt\?\.patch && !existing && claudeQuote\.eligible\(quote\)\) Object\.assign\(quote, claudeAttempt\.patch\);/);
  assert.match(server, /claudeQuote\.recordSendResult\(current, requestId, resultStatus, evidence\.at\)/);
  assert.match(server, /claudeQuote: \{ today: claudeQuote\.dailySummary\(current\)/);
  assert.match(server, /max_tokens: maxTokens/);
  console.log(JSON.stringify({ perCallKrw: ok.log.krw, promptChars: [...calls.length ? '' : ''].length }, null, 0));
  console.log('claude-quote: PASS');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
