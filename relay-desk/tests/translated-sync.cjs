'use strict';

// 번역 자막 두 단계 싱크 검사(가짜 Jev·가짜 시각 맞춤): 내용 밀림 구간·사람 확인 기준·비용 상한·이름 가림·수정안만. 실제 Jev 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const ts = require('../server/transcribe/translated-sync');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsync-'));
const stamp = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, x = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')},${String(r).padStart(3, '0')}`; };
const N = 40;
// 11~20번: 한국어가 다음 블록 말을 담음(한 칸 앞섬). 30~32번: 셋 다 안 맞음. 5번에 이름.
const koOf = k => (k >= 11 && k <= 20 ? `문장 ${k + 1}번` : k >= 30 && k <= 32 ? '엉뚱한 말' : `문장 ${k}번`) + (k === 5 ? ' Sylvie' : '');
const srtPath = path.join(tmp, 'ko.srt');
fs.writeFileSync(srtPath, Array.from({ length: N }, (_, i) => `${i + 1}\n${stamp(i * 4)} --> ${stamp(i * 4 + 3)}\n${koOf(i + 1)}`).join('\n\n') + '\n');
const trPath = path.join(tmp, 'fr.json');
fs.writeFileSync(trPath, JSON.stringify({ segments: Array.from({ length: N }, (_, i) => ({ start: i * 4, end: i * 4 + 3, text: `phrase ${i + 1}`, words: [{ start: i * 4, end: i * 4 + 1.5, word: 'phrase' }, { start: i * 4 + 1.5, end: i * 4 + 3, word: `${i + 1}` }] })) }));
const sent = [];
const fakeJev = async ({ state }) => { sent.push(state); const k = (/문장 (\d+)번/.exec(state.srt_block) || [])[1]; const f = (/phrase (\d+)/.exec(state.transcript) || [])[1]; return { answers: { same_content: { noul: k && k === f ? 0.9 : 0.05 } }, usage: { input_tokens: 350 } }; };
const spends = [];
const deps = { getKey: () => 'k', callJev: fakeJev, limitStatus: () => ({ capReached: false, remainingTokens: 1e9 }), recordSpend: (d, rec) => spends.push(rec), limits: { usdPerMillionInputTokens: 0.042, krwPerUsd: 1500 }, dataDir: tmp };
const timingImpl = { analyzeFiles: () => ({ ok: true, type: 'ok', medianDeviationSeconds: 0, windows: [{ fromBlock: 1, matchScore: 0.6 }], matchScore: { minValue: 0.6 } }) };

(async () => {
  try {
    const r = await ts.run({ srtPath, transcriptPath: trPath, deps, timingImpl, outDir: path.join(tmp, 'out') });
    assert.equal(r.ok, true); assert.equal(r.status, 'reference', '참고용');
    assert.equal(r.timing.type, 'ok');
    assert.equal(r.jev.status, 'done'); assert.equal(r.jev.calls, N * 3 - 2);
    assert.equal(r.verdict, 'content_shift', JSON.stringify(r.segments));
    assert.equal(r.segments.length, 1);
    assert.deepEqual([r.segments[0].direction, r.segments[0].fromBlock, r.segments[0].toBlock], ['early', 11, 20]);
    assert.equal(r.suggestionCount, 10); assert.equal(r.suggestions[0].action, 'move_back_one');
    assert.ok(!JSON.stringify(r).includes('문장'), '응답에 글자 없음');
    for (const s of sent) { assert.deepEqual(Object.keys(s).sort(), ['srt_block', 'transcript']); assert.ok(!/Sylvie/.test(JSON.stringify(s))); assert.ok(!JSON.stringify(s).includes(tmp)); }
    assert.ok(fs.existsSync(r.savedPath)); assert.equal(spends.length, 1);
    // 셋 다 안 맞음이 30% 넘으면 사람 확인
    const bad = await ts.run({ srtPath, transcriptPath: trPath, deps: { ...deps, callJev: async () => ({ answers: { same_content: { noul: 0.05 } }, usage: { input_tokens: 350 } }) }, timingImpl });
    assert.equal(bad.verdict, 'manual_review');
    // 비용 상한: 호출 수·원화가 넘을 것 같으면 부르지 않음, 도중에 넘으면 멈춤
    const before = sent.length;
    let r2 = await ts.run({ srtPath, transcriptPath: trPath, deps, timingImpl, limits: { maxCalls: 50 } });
    assert.equal(r2.jev.status, 'skipped'); assert.match(r2.jev.reason, /over_max_calls/);
    r2 = await ts.run({ srtPath, transcriptPath: trPath, deps, timingImpl, limits: { maxKrw: 0.001 } });
    assert.equal(r2.jev.status, 'skipped'); assert.match(r2.jev.reason, /over_max_krw/);
    assert.equal(sent.length, before, '상한에 걸리면 호출 0');
    r2 = await ts.run({ srtPath, transcriptPath: trPath, deps: { ...deps, callJev: async a => { sent.push(a.state); return { answers: { same_content: { noul: 0.9 } }, usage: { input_tokens: 5e6 } }; } }, timingImpl, concurrency: 1 });
    assert.equal(r2.jev.status, 'stopped'); assert.equal(r2.jev.reason, 'max_krw_reached'); assert.equal(r2.jev.calls, 1);
    r2 = await ts.run({ srtPath, transcriptPath: trPath, deps: { ...deps, getKey: () => '' }, timingImpl });
    assert.equal(r2.jev.reason, 'no_key');
    // 사전 비용 추정(지시 3): 정책 파일의 건당 실측 토큰(367)으로. 33분 건 크기(389블록 → 1,165호출)에서 25~30원
    const policy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));
    const perCall = policy.jevSimulation.translatedSyncTokensPerCall;
    assert.equal(perCall, 367, '설정값');
    assert.ok(!/\b367\b/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'transcribe', 'translated-sync.js'), 'utf8').replace(/\/\/.*$/gm, '')), '코드에 숫자를 박지 않음');
    const M = 389;
    const bigSrt = path.join(tmp, 'big.srt'), bigTr = path.join(tmp, 'big.json');
    fs.writeFileSync(bigSrt, Array.from({ length: M }, (_, i) => `${i + 1}\n${stamp(i * 5)} --> ${stamp(i * 5 + 4)}\n한국어 자막 문장 ${i + 1}번입니다`).join('\n\n') + '\n');
    fs.writeFileSync(bigTr, JSON.stringify({ segments: Array.from({ length: M }, (_, i) => ({ start: i * 5, end: i * 5 + 4, text: `phrase ${i + 1}`, words: [{ start: i * 5, end: i * 5 + 2, word: 'phrase' }, { start: i * 5 + 2, end: i * 5 + 4, word: `${i + 1}` }] })) }));
    let bigCalls = 0;
    const big = await ts.run({ srtPath: bigSrt, transcriptPath: bigTr, deps: { ...deps, callJev: async () => { bigCalls += 1; return { answers: { same_content: { noul: 0.9 } }, usage: { input_tokens: 367 } }; } }, timingImpl });
    assert.equal(big.planned, M * 3 - 2);
    assert.equal(big.estimateMethod, 'per_call:367');
    assert.equal(big.estimateTokens, (M * 3 - 2) * 367);
    assert.ok(big.estimateKrw >= 25 && big.estimateKrw <= 30, `추정 ${big.estimateKrw}원`);
    assert.equal(big.jev.status, 'done'); assert.equal(bigCalls, M * 3 - 2);
    assert.ok(Math.abs(big.jev.krw - big.estimateKrw) < 0.5, `추정 ${big.estimateKrw} vs 가짜 실측 ${big.jev.krw}`);
    // 테스트용 덮어쓰기(limits.tokensPerCall)도 받는다
    const small = await ts.run({ srtPath: bigSrt, transcriptPath: bigTr, deps: { ...deps, getKey: () => '' }, timingImpl, limits: { tokensPerCall: 100 } });
    assert.equal(small.estimateTokens, (M * 3 - 2) * 100);
    // 기본 상한 값과 서버 경로(로컬 전용·전용 헤더)
    assert.equal(ts.LIMITS.maxCalls, 1500); assert.equal(ts.LIMITS.maxKrw, 50);
    const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
    const i = server.indexOf("pathname === '/api/admin/translated-sync-check'"); assert.ok(i > 0);
    const block = server.slice(i, i + 700); assert.match(block, /if \(!local\)/); assert.match(block, /'jev-manual'/);
    assert.ok(!/translatedSyncCheck/.test(server.slice(0, i)), '납품 흐름에 자동으로 붙이지 않음');
    assert.equal(netCalls, 0);
    console.log('translated-sync: PASS');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
