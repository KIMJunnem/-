'use strict';

// Jev 내용 대조 한 건(가짜 Jev): 앞·뒤 블록과 비교해 "한 칸 밀림"을 찾는지, 글자만 보내고 이름을 가리는지,
// 키 없음·예산 부족이면 부르지 않는지. 외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const jp = require('../server/transcribe/jev-probe');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jevprobe-'));
const stamp = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, x = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')},${String(r).padStart(3, '0')}`; };
// 20블록, 4초 간격. 6번부터 한국어가 한 칸 늦게(앞 블록 말을) 담는다. 3번에는 이름이 있다.
const N = 20;
const koText = k => (k >= 6 ? `문장 ${k - 1}번 내용` : `문장 ${k}번 내용`) + (k === 3 ? ' Sylvie 선생님' : '');
const srt = Array.from({ length: N }, (_, i) => `${i + 1}\n${stamp(i * 4)} --> ${stamp(i * 4 + 3)}\n${koText(i + 1)}`).join('\n\n') + '\n';
const srtPath = path.join(tmp, 'ko.srt'); fs.writeFileSync(srtPath, srt);
const transcript = { segments: Array.from({ length: N }, (_, i) => ({ start: i * 4, end: i * 4 + 3, text: `phrase ${i + 1} Savare`, words: [{ start: i * 4, end: i * 4 + 1, word: 'phrase' }, { start: i * 4 + 1, end: i * 4 + 2, word: `${i + 1}` }, { start: i * 4 + 2, end: i * 4 + 3, word: 'Savare' }] })) };
const trPath = path.join(tmp, 'fr.json'); fs.writeFileSync(trPath, JSON.stringify(transcript));

const sent = [];
const fakeJev = async ({ key, state }) => {
  sent.push({ key, state });
  const k = (/문장 (\d+)번/.exec(state.srt_block) || [])[1];
  const f = (/phrase (\d+)/.exec(state.transcript) || [])[1];
  return { answers: { same_content: { type: 'noul', noul: k && k === f ? 0.95 : 0.05 } }, usage: { input_tokens: 120 } };
};
const spends = [];
const deps = { getKey: () => 'k', callJev: fakeJev, limitStatus: () => ({ capReached: false, remainingTokens: 1e9 }), recordSpend: (dir, rec) => spends.push(rec), limits: { usdPerMillionInputTokens: 0.042, krwPerUsd: 1500 }, dataDir: tmp };

(async () => {
  try {
    const r = await jp.probe({ srtPath, transcriptPath: trPath, fromSeconds: 0, toSeconds: 76, outDir: path.join(tmp, 'out'), ...deps });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.calls, N * 3 - 2, '블록마다 같은 시각·앞·뒤(양 끝은 하나 빠짐)');
    assert.deepEqual(r.shiftStart, { block: 6, start: 20 }, JSON.stringify(r.rows));
    assert.equal(r.counts.same_time, 5); assert.equal(r.counts.late_one, 15);
    // 글자만: 상태에는 두 칸뿐, 파일명·경로 없음, 이름은 가림
    for (const s of sent) {
      assert.deepEqual(Object.keys(s.state).sort(), ['srt_block', 'transcript']);
      const all = JSON.stringify(s.state);
      assert.ok(!all.includes('ko.srt') && !all.includes('fr.json') && !all.includes(tmp), '파일명·경로 없음');
      assert.ok(!/Sylvie|Savare/i.test(all), '이름 가림');
    }
    assert.ok(sent.some(s => s.state.srt_block.includes('[이름]')));
    // 응답에는 숫자만(글자 없음), 전체 결과는 outDir에만
    assert.ok(!JSON.stringify(r.rows).includes('문장'));
    assert.ok(fs.existsSync(r.savedPath) && r.savedPath.startsWith(path.join(tmp, 'out')));
    assert.equal(spends.length, 1); assert.equal(spends[0].calls, r.calls);
    // 키 없음·예산 부족·호출 수 상한 → 부르지 않음
    const before = sent.length;
    assert.equal((await jp.probe({ srtPath, transcriptPath: trPath, fromSeconds: 0, toSeconds: 76, ...deps, getKey: () => '' })).error, 'no_key');
    assert.equal((await jp.probe({ srtPath, transcriptPath: trPath, fromSeconds: 0, toSeconds: 76, ...deps, limitStatus: () => ({ capReached: false, remainingTokens: 10 }) })).error, 'daily_budget');
    assert.equal((await jp.probe({ srtPath, transcriptPath: trPath, fromSeconds: 0, toSeconds: 76, maxCalls: 10, ...deps })).error, 'too_many_calls');
    assert.equal(sent.length, before);
    // 서버 경로: 로컬 전용·전용 헤더
    const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
    const i = server.indexOf("pathname === '/api/admin/jev-pair-probe'"); assert.ok(i > 0);
    const block = server.slice(i, i + 700); assert.match(block, /if \(!local\)/); assert.match(block, /'jev-manual'/);
    assert.equal(netCalls, 0);
    console.log('jev-probe: PASS');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
