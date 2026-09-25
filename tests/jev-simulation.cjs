'use strict';

// Jev 내부 시뮬레이션: 상한·가림 처리·오류 중단·요약·기록 불변 검사(가짜 fetch, 외부 호출 0회).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const sim = require('../server/jev-simulation');
const { jevSimulationLimits } = require('../server/operating-policy');
const L = jevSimulationLimits();
const { buildSoomgoQuote } = require('../server/relay-server');
const autoRules = require('../server/soomgo-auto-rules');
// 9/24 지시 27: 이 시험은 숨고 문서·교정·PPT 자동 견적이 켜져 있을 때의 규칙을 본다(멈춤은 tests/soomgo-pause-27.cjs).
autoRules.setPauseConfigForTest({ document_writing: true, presentation: true });
const registry = require('../server/service-registry');
const { soomgoReplyGuard } = require('../server/reply-guards');

const deps = { buildSoomgoQuote, applyAutoRules: autoRules.applySoomgoAutoRules, supportedServiceIds: registry.listServices({ channel: 'soomgo' }).map(s => s.id), replyGuard: soomgoReplyGuard };
const mk = (id, category, body, extra = {}) => ({ id: `LEAD-${id}`, requestId: id, request: { customerName: '홍길순', text: `요청 상세\n고객 정보\n견적 보낸 고수 2명\n${category}\n\n${body}\n연락처 010-1234-5678 hong@example.com\n고객 정보\n신고하기\n\n홍길순\n` }, quote: { message: 'A4 5쪽 교정·교열 금액은 26,000원입니다.', amount: 26000, serviceId: 'document_writing' }, ...extra });
const state = {
  soomgoLeads: [
    mk('R1', '교정/교열', '희망 서비스\n교정교열\n작성 언어\n한국어\n작업 분량\nA4 5쪽', { conversationId: 'CONV-1', quoteEvidence: { status: 'sent', customerReplied: true, version: 'v1' } }),
    mk('R2', '영상 편집', '유튜브 영상 컷 편집 부탁드립니다 10분'),
    mk('R3', '문서/글 작성', '작성 주제\n자기소개서 작성 부탁드립니다', { quoteEvidence: { status: 'sent', version: 'v1' } }),
    mk('TEST-R4', '교정/교열', '작업 분량\nA4 3쪽')
  ],
  soomgoReplies: [
    { id: 'C1', conversationId: 'CONV-1', incoming: '좀 더 싸게 안될까요?', reply: { templateKey: 'guard_price_negotiation', autoSend: true, text: '금액은 요청서 기준으로 안내드린 26,000원입니다. 홍길순 님, 담당자가 확인 후 답드리겠습니다.' }, replyEvidence: { status: 'sent', customerReplied: false } },
    { id: 'C2', incoming: '언제까지 가능해요?', reply: { templateKey: 'auto_deadline_10', autoSend: true } }
  ]
};
const before = JSON.stringify(state);

// 항목 구성: 합성(TEST) 기록 제외, 이름·전화·이메일 가림
const classifyItems = sim.buildItems(state, 'classify', deps);
assert.equal(classifyItems.length, 3, 'TEST 기록 제외');
for (const item of classifyItems) {
  const text = JSON.stringify(item.state);
  assert.ok(!/홍길순|010-1234-5678|hong@example\.com/.test(text), `가림 처리: ${item.key}`);
}
// 9/24 준희: 영상 편집은 삭제하지 않고 기록·사람 확인
assert.equal(classifyItems.find(i => i.key === 'R2').compare.rule.action, 'quote'); // 9/25: 길이 모름 영상도 시작가 견적
assert.equal(classifyItems.find(i => i.key === 'R1').compare.rule.action, 'quote');
assert.equal(sim.buildItems(state, 'quote_copy', deps).length, 2);
assert.equal(sim.buildItems(state, 'chat_intent', deps).find(i => i.key === 'C1').compare.rule.intent, 'price_negotiation');
// 봇 답장 출처(bot_replies): 답장 본문이 있는 기록만, 고객 메시지·봇 답장 짝, 발송 여부
const botReplyItems = sim.buildItems(state, 'bot_reply', deps);
assert.equal(botReplyItems.length, 1, '답장 본문 없는 C2 제외');
assert.equal(botReplyItems[0].key, 'C1');
assert.ok(botReplyItems[0].state.bot_reply.includes('26,000원'));
assert.equal(botReplyItems[0].compare.outcome.sent, true);
assert.equal(botReplyItems[0].compare.rule.intent, 'price_negotiation');
assert.equal(sim.CUSTOM_SOURCES.bot_replies, 'bot_reply');
assert.ok(sim.validateCustomExperiment({ id: 'x', source: 'bot_replies', filter: { sent: 'maybe' }, questions: { q: { type: 'noul', instructions: 'a', criteria: { true: 't', false: 'f' } } } }).some(e => /filter\.sent/.test(e)));

// 가짜 Jev
const sent = [];
const fakeFetch = async (url, options) => {
  const body = JSON.parse(options.body);
  sent.push({ url, auth: options.headers.authorization, body });
  const answers = {};
  for (const [q, spec] of Object.entries(body.questions)) {
    if (spec.type === 'choice') answers[q] = { type: 'choice', choice: q === 'action' ? 'quote' : q === 'intent' ? 'price_negotiation' : Object.keys(spec.criteria)[0], confidence: 0.8 };
    if (spec.type === 'noul') answers[q] = { type: 'noul', noul: 0.7 };
    if (spec.type === 'score') answers[q] = { type: 'score', score: 1.5, confidence: 0.7 };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'jev-test', answers, usage: { input_tokens: 500 } }) };
};
const wait = async id => { for (let i = 0; i < 200 && sim.activeRuns.has(id); i += 1) await new Promise(r => setTimeout(r, 20)); };
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevsim-'));
  try {
    // 키 없으면 시작 안 함
    assert.throws(() => sim.startSimulation({ dataDir, limits: L, state, deps, getKey: () => '', fetchImpl: fakeFetch }), /jev_key_missing/);
    // 정상 실행
    const started = sim.startSimulation({ dataDir, limits: L, state, deps, getKey: () => 'sk-test-key-000000000000', fetchImpl: fakeFetch, maxCalls: 1000 });
    await wait(started.id);
    const run = sim.readRun(dataDir, started.id);
    assert.equal(run.status, 'completed');
    assert.equal(run.cost.calls, 3 + 2 + 2 + 1 + 2, '분류3·채팅2·문구2·지금문구1·예측2');
    assert.equal(run.summary.quote_copy_paired.pairs, 1, '같은 요청의 예전·지금 문구 짝 비교');
    assert.ok(sent.every(call => call.url === sim.JEV_URL && call.auth === 'Bearer sk-test-key-000000000000'));
    assert.ok(!fs.readFileSync(path.join(dataDir, 'jev-sim', `${started.id}.json`), 'utf8').includes('sk-test-key'), '결과 파일에 키 없음');
    assert.ok(!JSON.stringify(sent.map(c => c.body)).match(/홍길순|010-1234-5678/), '보낸 내용에 개인정보 없음');
    assert.equal(run.summary.classify.actionAgreement, Number((2 / 3).toFixed(3)), '규칙과 2/3 일치(R1·R2 quote, 9/25부터 길이 모름 영상도 견적)');
    assert.equal(run.summary.chat_intent.intentAgreement, 0.5);
    assert.ok(run.summary.reply_prediction.caution, '표본 적음 경고');
    assert.equal(JSON.stringify(state), before, '원본 기록 불변');
    // 한도: 정책 파일 값(하루 입력 토큰 1,000,000 · 1회 10,000건). 코드에는 값이 없다.
    assert.equal(L.dailyBudgetKrw, 10000); assert.equal(L.runMaxCalls, 10000); assert.equal(L.timezone, 'Asia/Seoul');
    assert.equal(L.dailyInputTokens, Math.floor(10000 / L.krwPerUsd / L.usdPerMillionInputTokens * 1e6), '토큰 한도 = 금액 ÷ 환율 ÷ 단가');
    assert.ok(Math.round(L.dailyInputTokens * L.usdPerMillionInputTokens / 1e6 * L.krwPerUsd) <= 10000, '환산 금액이 10,000원을 넘지 않음');
    assert.equal(sim.DAILY_MAX_CALLS, undefined, '하루 호출 수 상한 상수 제거');
    assert.throws(() => sim.startSimulation({ dataDir, state, deps, getKey: () => 'k'.repeat(20), fetchImpl: fakeFetch }), /jev_limits_missing/, '한도 없이는 시작 안 함');
    const small = sim.startSimulation({ dataDir, limits: L, state, deps, getKey: () => 'k'.repeat(20), fetchImpl: fakeFetch, maxCalls: 2 });
    assert.equal(small.planned, 2); await wait(small.id);
    assert.equal(sim.callsToday(dataDir), 12);
    assert.equal(sim.tokensToday(dataDir), 12 * 500, '오늘 토큰 = 실제 usage 합');
    const status = sim.limitStatus(dataDir, L);
    assert.equal(status.remainingTokens, L.dailyInputTokens - 6000); assert.equal(status.dailyBudgetKrw, 10000); assert.ok(status.remainingKrw <= 10000 && status.spentKrwToday >= 0); assert.equal(status.capReached, false);
    // 초기화 시각: 한국 시간 다음 0시 (UTC 15:00)
    assert.equal(sim.nextKstMidnight(Date.parse('2026-09-22T14:59:00Z')), '2026-09-22T15:00:00.000Z');
    assert.equal(sim.nextKstMidnight(Date.parse('2026-09-22T15:00:00Z')), '2026-09-23T15:00:00.000Z');
    assert.equal(sim.kstDay(Date.parse('2026-09-22T15:00:00Z')), '2026-09-23');
    // 하루 한도 도달: 시작 거절
    const fake = { id: 'JEVSIM-FULL', day: sim.kstDay(), cost: { calls: 1, inputTokens: L.dailyInputTokens - 6000 } };
    fs.writeFileSync(path.join(dataDir, 'jev-sim', 'JEVSIM-FULL.json'), JSON.stringify(fake));
    assert.equal(sim.limitStatus(dataDir, L).capReached, true);
    assert.throws(() => sim.startSimulation({ dataDir, limits: L, state, deps, getKey: () => 'k'.repeat(20), fetchImpl: fakeFetch }), /jev_daily_token_cap_reached/);
    // 실행 중 한도 도달: 남은 1,200토큰 → 500토큰 호출 2번 뒤 멈춤(동시 4개여도 넘지 않음)
    fake.cost.inputTokens = L.dailyInputTokens - 6000 - 1200;
    fs.writeFileSync(path.join(dataDir, 'jev-sim', 'JEVSIM-FULL.json'), JSON.stringify(fake));
    let capCalls = 0;
    const tinyEstimateFetch = async (url, options) => { capCalls += 1; return fakeFetch(url, options); };
    const capped = sim.startSimulation({ dataDir, limits: L, state: { soomgoLeads: [], soomgoReplies: [] }, deps, getKey: () => 'k'.repeat(20), fetchImpl: tinyEstimateFetch, custom: [{ id: 'cap_probe', source: 'edit_pairs', questions: { x: { type: 'noul', instructions: 'a', criteria: { true: 't', false: 'f' } } } }] });
    await wait(capped.id);
    const cappedRun = sim.readRun(dataDir, capped.id);
    assert.equal(cappedRun.stopReason, 'daily_token_cap'); assert.equal(cappedRun.status, 'stopped');
    assert.ok(cappedRun.cost.inputTokens <= 1200, `한도를 넘지 않음 (${cappedRun.cost.inputTokens})`);
    assert.ok(capCalls < 12, `남은 호출 중단 (${capCalls}/12)`);
    assert.ok(cappedRun.skippedByDailyCap > 0);
    fs.rmSync(path.join(dataDir, 'jev-sim', 'JEVSIM-FULL.json'));
    fs.rmSync(path.join(dataDir, 'jev-sim', `${capped.id}.json`));
    // 사용자 실험(JSON 설계): 잘못된 설계는 호출 전에 거절, 올바른 설계는 해당 출처만 돌림
    assert.throws(() => sim.startSimulation({ dataDir, limits: L, state, deps, getKey: () => 'k'.repeat(20), fetchImpl: fakeFetch, custom: [{ id: 'Bad Id', source: 'nowhere', questions: {} }] }), /custom_experiment_invalid/);
    const customDef = { id: 'chat_money', label: '돈 얘기 여부', source: 'chat', questions: {
      money: { type: 'noul', instructions: 'Is the customer talking about money?', criteria: { true: 'yes', false: 'no' } },
      kind: { type: 'choice', instructions: 'What kind?', criteria: { price: 'price', other: 'other' } }
    } };
    const custom = sim.startSimulation({ dataDir, limits: L, state, deps, getKey: () => 'k'.repeat(20), fetchImpl: fakeFetch, custom: [customDef] });
    assert.deepEqual(Object.keys(custom.available), ['custom:chat_money']);
    await wait(custom.id);
    const customRun = sim.readRun(dataDir, custom.id);
    const cs = customRun.summary['custom:chat_money'];
    assert.equal(cs.items, 2); assert.equal(cs.questions.money.trueRate, 1); assert.equal(cs.questions.kind.distribution.price, 2);
    assert.ok(cs.questions.kind.byRule.price_negotiation, '규칙 판정과 교차표');
    assert.ok(customRun.customDefinitions['custom:chat_money'].questions.money, '설계가 결과 파일에 남음');
    // 봇 답장 출처 실험: 짝(message, bot_reply)이 Jev에 가고, 예시에 두 쪽이 같이 보이며, 개인정보는 없다
    sent.length = 0;
    const botDef = { id: 'reply_check', label: '답장 검수', source: 'bot_replies', filter: { sent: 'sent' }, questions: {
      answers_question: { type: 'noul', instructions: 'Does bot_reply answer message?', criteria: { true: 'yes', false: 'no' } }
    } };
    const botRun0 = sim.startSimulation({ dataDir, limits: L, state, deps, getKey: () => 'k'.repeat(20), fetchImpl: fakeFetch, custom: [botDef] });
    assert.deepEqual(botRun0.available, { 'custom:reply_check': 1 });
    await wait(botRun0.id);
    const botRun = sim.readRun(dataDir, botRun0.id);
    const bs = botRun.summary['custom:reply_check'];
    assert.equal(bs.items, 1); assert.equal(bs.questions.answers_question.trueRate, 1);
    assert.ok(bs.questions.answers_question.examples[0].text.includes('⇒'), '예시에 고객 메시지 ⇒ 봇 답장');
    assert.ok(sent[0].body.state.bot_reply && sent[0].body.state.message, '짝이 Jev에 전달됨');
    assert.ok(!JSON.stringify(sent.map(c => c.body)).includes('홍길순'), '봇 답장 속 고객 이름 가림');
    // repeats: 같은 항목을 N번 물어 항목별로 합친다(호출 = 항목 × N)
    const repDef = { id: 'chat_repeat', label: '반복', source: 'chat', repeats: 3, questions: { money: { type: 'noul', instructions: 'Is the customer talking about money?', criteria: { true: 'yes', false: 'no' } } } };
    const rep = sim.startSimulation({ dataDir, state, deps, getKey: () => 'k'.repeat(20), fetchImpl: fakeFetch, limits: L, custom: [repDef] });
    assert.equal(rep.available['custom:chat_repeat'], 6, '2항목 × 3회');
    await wait(rep.id);
    const repRun = sim.readRun(dataDir, rep.id);
    const rs = repRun.summary['custom:chat_repeat'];
    assert.equal(repRun.cost.calls, 6);
    assert.equal(rs.repeatStats.itemsAggregated, 2);
    assert.equal(rs.repeatStats.meanAgreement, 1, '가짜 Jev는 항상 같은 답');
    assert.equal(rs.questions.money.answered, 2, '집계 후 항목 수');
    assert.ok(sim.validateCustomExperiment({ ...repDef, repeats: 5000 }).some(e => /repeats/.test(e)), 'repeats 상한');
    // 키 오류(401)면 바로 멈춤
    let calls401 = 0;
    const bad = sim.startSimulation({ dataDir, limits: L, state, deps, getKey: () => 'k'.repeat(20), concurrency: 1, fetchImpl: async () => { calls401 += 1; return { ok: false, status: 401, text: async () => '{"error":{"message":"bad key"}}' }; } });
    await wait(bad.id);
    const badRun = sim.readRun(dataDir, bad.id);
    assert.equal(badRun.status, 'stopped'); assert.equal(calls401, 1, '401 한 번에 중단');
    console.log('jev-simulation: PASS');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
