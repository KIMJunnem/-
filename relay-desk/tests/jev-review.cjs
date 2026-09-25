'use strict';

// Jev 납품 검수 1단계(번역 자막 내용 대조): 가짜 fetch만, 실제 호출 0회.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const review = require('../server/jev-review');
const sim = require('../server/jev-simulation');
const { jevReviewPolicy, jevSimulationLimits } = require('../server/operating-policy');
const root = path.join(__dirname, '..');

const ts = ms => { const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, x = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`; };
const srt = blocks => blocks.map((b, i) => `${i + 1}\n${ts(b.start)} --> ${ts(b.start + 1500)}\n${b.text}`).join('\n\n') + '\n';
const policyOn = (extra = {}) => ({ jevReview: { enabled: true, blockOnFlags: false, maxCallsPerDelivery: 800, flagThreshold: 0.5, services: { subtitle: ['translated_sync'] }, ...extra } });
const L = jevSimulationLimits();
const subtitleParams = JSON.parse(fs.readFileSync(path.join(root, 'services', 'subtitle.json'), 'utf8')).checkParams;

// 가짜 Jev: state.transcript 안의 "#값" 을 noul로 돌려준다(없으면 0.9)
function fakeJev() {
  const seen = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    seen.push(body);
    const m = String(body.state.transcript).match(/#(\d(?:\.\d+)?)/);
    return { ok: true, status: 200, text: async () => JSON.stringify({ answers: { same_content: { type: 'noul', noul: m ? Number(m[1]) : 0.9 } }, usage: { input_tokens: 100 } }) };
  };
  return { fetchImpl, seen };
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevrev-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jevrev-f-'));
  try {
    const write = (name, text) => { const p = path.join(tmp, name); fs.writeFileSync(p, text); return p; };
    const base = { serviceId: 'subtitle', checkParams: subtitleParams, limits: L, dataDir, getKey: () => 'k'.repeat(20) };

    // 0) 정책 파일: 기본 꺼짐, 요구 값
    const pol = jevReviewPolicy();
    assert.equal(pol.enabled, false); assert.equal(pol.blockOnFlags, false); assert.equal(pol.maxCallsPerDelivery, 800); assert.equal(pol.flagThreshold, 0.5);
    assert.deepEqual(pol.services, { subtitle: ['translated_sync'] });
    assert.equal(subtitleParams.syncInheritedStartToleranceSeconds, 0.05);

    // 1) 짝짓기 ±0.05초 안/밖(경계 50ms 포함, 51ms 제외)
    const ko = srt([{ start: 1000, text: '안녕하세요' }, { start: 3050, text: '두 번째' }, { start: 5051, text: '세 번째' }, { start: 7000, text: '네 번째' }]);
    const en = srt([{ start: 1000, text: 'Hello' }, { start: 3000, text: 'Second' }, { start: 5000, text: 'Third' }, { start: 6960, text: 'Fourth' }]);
    const { parse } = require('../checks/_srt');
    const paired = review.pairBlocks(parse({ text: ko }).blocks, parse({ text: en }).blocks, 0.05);
    assert.deepEqual(paired.pairs.map(p => p.index), [1, 2, 4], '0ms·50ms·40ms는 짝, 51ms는 짝 아님');
    assert.deepEqual(paired.unpaired.map(p => p.index), [3]);
    assert.equal(paired.pairs[1].source, 'Second');

    // 2) flagged 경계: 0.49는 flagged, 0.5는 아님
    let f = fakeJev();
    const koFile = write('ko.srt', srt([{ start: 1000, text: '가' }, { start: 3000, text: '나' }, { start: 5000, text: '다' }]));
    const enFile = write('en.srt', srt([{ start: 1000, text: 'A #0.49' }, { start: 3000, text: 'B #0.5' }, { start: 5000, text: 'C #0.95' }]));
    let r = await review.reviewDeliverable({ ...base, files: [{ name: 'ko.srt', path: koFile }], context: { translated: true, sourceLanguageSrt: enFile }, policy: policyOn(), fetchImpl: f.fetchImpl });
    assert.equal(r.status, 'done'); assert.equal(r.calls, 3); assert.equal(r.tokens, 300);
    assert.deepEqual(r.flagged.map(x => x.index), [1]);
    assert.deepEqual(Object.keys(f.seen[0].state), ['srt_block', 'transcript']); assert.deepEqual(Object.keys(f.seen[0].questions), ['same_content']);
    assert.equal(r.krw, Math.round(300 * L.usdPerMillionInputTokens / 1e6 * L.krwPerUsd * 100) / 100);
    for (const k of ['status', 'reason', 'calls', 'tokens', 'krw', 'items', 'flagged', 'checkedAt']) assert.ok(k in r, k);
    // 쓴 토큰은 같은 하루 주머니(tokensToday)에 잡힌다
    assert.equal(sim.tokensToday(dataDir), 300); assert.equal(sim.callsToday(dataDir), 3);

    // 3) 키 없음 → skipped, 호출 0
    f = fakeJev();
    r = await review.reviewDeliverable({ ...base, getKey: () => '', files: [{ name: 'ko.srt', path: koFile }], context: { translated: true, sourceLanguageSrt: enFile }, policy: policyOn(), fetchImpl: f.fetchImpl });
    assert.equal(r.status, 'skipped'); assert.equal(r.reason, 'no_key'); assert.equal(f.seen.length, 0);

    // 4) 예산 부족 → skipped, 호출 0 (오늘 쓴 토큰을 한도 가까이 채운 기록)
    const fullDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevrev-full-'));
    fs.mkdirSync(path.join(fullDir, 'jev-sim'));
    fs.writeFileSync(path.join(fullDir, 'jev-sim', 'JEVSIM-full.json'), JSON.stringify({ id: 'JEVSIM-full', day: sim.kstDay(), status: 'completed', cost: { calls: 1, inputTokens: L.dailyInputTokens - 10 } }));
    f = fakeJev();
    r = await review.reviewDeliverable({ ...base, dataDir: fullDir, files: [{ name: 'ko.srt', path: koFile }], context: { translated: true, sourceLanguageSrt: enFile }, policy: policyOn(), fetchImpl: f.fetchImpl });
    assert.equal(r.status, 'skipped'); assert.equal(r.reason, 'daily_budget'); assert.equal(f.seen.length, 0);
    fs.rmSync(fullDir, { recursive: true, force: true });

    // 5) enabled:false → 호출 0, schedule은 아무것도 안 함(상태 쓰기 0)
    f = fakeJev();
    r = await review.reviewDeliverable({ ...base, files: [{ name: 'ko.srt', path: koFile }], context: { translated: true, sourceLanguageSrt: enFile }, policy: { jevReview: { enabled: false } }, fetchImpl: f.fetchImpl });
    assert.equal(r.status, 'skipped'); assert.equal(r.reason, 'disabled'); assert.equal(f.seen.length, 0);
    let writes = 0;
    assert.equal(review.schedule({ workflowId: 'W1', serviceId: 'subtitle', files: [], context: {}, checkParams: {}, deps: { readPolicy: () => ({ jevReview: { enabled: false } }), readState: () => ({}), writeState: () => { writes += 1; } } }), null);
    await new Promise(res => setTimeout(res, 20)); assert.equal(writes, 0);

    // 6) 한국어 자막(번역 아님) → skipped('not_translated')
    f = fakeJev();
    r = await review.reviewDeliverable({ ...base, files: [{ name: 'ko.srt', path: koFile }], context: { translated: false, sourceLanguageSrt: null }, policy: policyOn(), fetchImpl: f.fetchImpl });
    assert.equal(r.status, 'skipped'); assert.equal(r.reason, 'not_translated'); assert.equal(f.seen.length, 0);
    // 번역인데 원어 SRT 없음 / 설정에 없는 서비스
    r = await review.reviewDeliverable({ ...base, files: [{ name: 'ko.srt', path: koFile }], context: { translated: true }, policy: policyOn(), fetchImpl: f.fetchImpl });
    assert.equal(r.reason, 'source_srt_missing');
    r = await review.reviewDeliverable({ ...base, serviceId: 'document_writing', files: [], context: { translated: true, sourceLanguageSrt: enFile }, policy: policyOn(), fetchImpl: f.fetchImpl });
    assert.equal(r.reason, 'service_not_configured');

    // 7) 400블록: 호출 수 = 짝 수 (7블록마다 하나는 0.2초 어긋나 짝 없음)
    const koBig = []; const enBig = [];
    for (let i = 0; i < 400; i += 1) { const s = 1000 + i * 2000; koBig.push({ start: s, text: `한국어 ${i}` }); enBig.push({ start: i % 7 === 3 ? s + 200 : s + (i % 3) * 10, text: `line ${i}` }); }
    const koBigFile = write('big-ko.srt', srt(koBig)); const enBigFile = write('big-en.srt', srt(enBig));
    const expectedPairs = enBig.filter((_, i) => i % 7 !== 3).length;
    f = fakeJev();
    r = await review.reviewDeliverable({ ...base, files: [{ name: 'big-ko.srt', path: koBigFile }], context: { translated: true, sourceLanguageSrt: enBigFile }, policy: policyOn(), fetchImpl: f.fetchImpl });
    assert.equal(r.pairs, expectedPairs); assert.equal(r.calls, expectedPairs); assert.equal(f.seen.length, expectedPairs);
    assert.equal(r.unpaired.length, 400 - expectedPairs); assert.equal(r.items.length, expectedPairs); assert.equal(r.skippedByCap, 0);
    // 1납품 상한
    f = fakeJev();
    r = await review.reviewDeliverable({ ...base, files: [{ name: 'big-ko.srt', path: koBigFile }], context: { translated: true, sourceLanguageSrt: enBigFile }, policy: policyOn({ maxCallsPerDelivery: 100 }), fetchImpl: f.fetchImpl });
    assert.equal(r.calls, 100); assert.equal(r.skippedByCap, expectedPairs - 100);

    // 8) 인증 오류 → skipped, 흐름 계속(예외 던지지 않음)
    const authFail = async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"bad key"}}' });
    r = await review.reviewDeliverable({ ...base, files: [{ name: 'ko.srt', path: koFile }], context: { translated: true, sourceLanguageSrt: enFile }, policy: policyOn(), fetchImpl: authFail });
    assert.equal(r.status, 'skipped'); assert.match(r.reason, /^jev_auth:401/);

    // 9) schedule: 켜져 있으면 다음 틱에 돌고, 상태를 새로 읽어 해당 워크플로에만 기록 + 로그
    f = fakeJev();
    let state = { soomgoWorkflows: [{ id: 'W1', manualFinalReview: { status: 'pending' } }, { id: 'W2' }] };
    let saved = null;
    const task = review.schedule({ workflowId: 'W1', serviceId: 'subtitle', files: [{ name: 'ko.srt', path: koFile }], context: { translated: true, sourceLanguageSrt: enFile }, checkParams: subtitleParams, deps: { readPolicy: () => policyOn(), limits: () => L, dataDir, getKey: () => 'k'.repeat(20), fetchImpl: f.fetchImpl, readState: () => JSON.parse(JSON.stringify(state)), writeState: next => { saved = next; } } });
    assert.equal(saved, null, '부른 자리에서는 아무것도 쓰지 않음(비동기)');
    await task;
    assert.equal(saved.soomgoWorkflows[0].jevReview.status, 'done'); assert.equal(saved.soomgoWorkflows[0].jevReview.flagged.length, 1);
    assert.equal(saved.soomgoWorkflows[1].jevReview, undefined);
    assert.equal(saved.jevReviewLog[0].workflowId, 'W1'); assert.equal(saved.jevReviewLog[0].flaggedCount, 1);
    assert.deepEqual(review.attentionFlags(saved).map(x => [x.workflowId, x.flagged]), [['W1', 1]]);
    // 납품을 막지 않는다: 결과가 배송 관련 값을 건드리지 않음
    assert.deepEqual(Object.keys(saved.soomgoWorkflows[0]).sort(), ['id', 'jevReview', 'manualFinalReview']);

    // 10) 서버 연결: 호출 1곳(queueManualFinalReview 바로 뒤), attention 1줄, 가짜 fetch 외 네트워크 0
    const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
    assert.equal((server.match(/jevReview\.schedule\(/g) || []).length, 1);
    assert.match(server, /queueManualFinalReview\(workflow, resultPost, now\);\r?\n\s*\/\/ Jev 납품 검수[^\n]*\r?\n\s*jevReview\.schedule\(/);
    assert.match(server, /jevReviewFlags: jevReview\.attentionFlags\(current\)/);
    for (const locked of ['server/quality-runner.js', 'checks/sync_drift.js']) assert.ok(!/jev-review|jevReview/.test(fs.readFileSync(path.join(root, locked), 'utf8')), `${locked} 미변경`);
    assert.equal(netCalls, 0);
    console.log('jev-review: PASS');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
