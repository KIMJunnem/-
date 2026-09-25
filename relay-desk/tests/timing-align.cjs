'use strict';

// 시각만으로 맞추기: 말/쉼 구간(가짜 FFmpeg 출력 포함)과 자막 시각만으로 일정 밀림·중간부터 점점 밀림을 가른다.
// 글자를 보지 않는다는 것, 보정 후 재검사, 구분 못 하는 폭까지 확인한다. 외부 호출 없음.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const align = require('../server/transcribe/timing-align');

// 말 2.2초 + 쉼 0.8초를 되풀이하는 30분짜리 강연(말 시작마다 자막 한 블록)
// 되풀이되지 않게 말 길이·쉼 길이를 조금씩 바꾼다(실제 말처럼)
let seed = 3; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const spans = [];
for (let t = 5; t < 1800;) { const talk = 1.2 + rnd() * 3.5, pause = 0.4 + rnd() * 1.2; spans.push([Number(t.toFixed(2)), Number((t + talk).toFixed(2))]); t += talk + pause; }
const transcript = { segments: spans.map(([a, b]) => ({ start: a, end: b, words: [{ start: a, end: b }] })) };
const blocksOf = shift => spans.map(([a, b], i) => ({ number: i + 1, start: a + shift(a), end: b + shift(a) }));

// 1) 딱 맞음
let r = align.analyzeBlocks(blocksOf(() => 0), transcript, {});
assert.equal(r.ok, true); assert.equal(r.type, 'ok', JSON.stringify(r.windows));
assert.ok(Math.abs(r.medianDeviationSeconds) <= 0.1);
assert.ok(r.uncertainty.medianSeconds <= 0.5, `구분 폭 ${r.uncertainty.medianSeconds}`);

// 2) 전 구간 1.2초 늦음 → offset, 보정 후 ok
r = align.analyzeBlocks(blocksOf(() => 1.2), transcript, {});
assert.equal(r.type, 'offset'); assert.ok(Math.abs(r.medianDeviationSeconds - 1.2) <= 0.15, `${r.medianDeviationSeconds}`);
assert.ok(Math.abs(r.correction.shiftSeconds + 1.2) <= 0.15);
assert.equal(r.recheck.type, 'ok', JSON.stringify(r.recheck));

// 3) 900초부터 점점 밀려 끝에서 9초 → 시작 지점 지목, 보정 후 ok
const rate = 9 / 900;
r = align.analyzeBlocks(blocksOf(t => (t < 900 ? 0 : (t - 900) * rate)), transcript, {});
assert.equal(r.type, 'drift_gradual', JSON.stringify(r));
assert.ok(Math.abs(r.driftStartWindow.centerSeconds - 900) <= 200, `밀림 시작 ${r.driftStartWindow.centerSeconds}`);
assert.ok(Math.abs(r.driftPerMinuteSeconds - rate * 60) <= 0.2, `분당 ${r.driftPerMinuteSeconds}`);
assert.ok(r.totalDriftSeconds > 7 && r.totalDriftSeconds < 11, `끝 밀림 ${r.totalDriftSeconds}`);
assert.equal(r.recheck.type, 'ok', JSON.stringify(r.recheck));
assert.ok(r.recheck.maxWindowDeviationSeconds <= 0.6);

// 4) 자가시험: 알려진 만큼 밀면 그만큼 되찾는다
for (const item of align.selfTest(blocksOf(() => 0), transcript, align.DEFAULTS, [0.5, 2, 5])) {
  assert.ok(Math.abs(item.errorSeconds) <= 0.2, `${item.shiftSeconds}초 자가시험 오차 ${item.errorSeconds}`);
}

// 4-1) 밀림 자가시험: 900초부터 9초 밀리게 만들면 그 근처를 지목한다
const dt = align.driftTest(blocksOf(() => 0), transcript, {}, [{ fromSeconds: 900, totalSeconds: 9 }])[0];
assert.equal(dt.type, 'drift_gradual', JSON.stringify(dt));
assert.ok(Math.abs(dt.startErrorSeconds) <= 200, `밀림 시작 오차 ${dt.startErrorSeconds}`);
assert.equal(dt.recheck, 'ok', JSON.stringify(dt));

// 5) 글자는 쓰지 않는다: 블록에 글자가 아예 없어도 같은 결과
const noText = align.analyzeBlocks(blocksOf(() => 1.2), transcript, {});
assert.equal(noText.type, 'offset');

// 6) 진짜 소리에서 말/쉼 뽑기: FFmpeg silencedetect 출력 읽기
const fakeFfmpeg = (cmd, args) => {
  const child = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  assert.ok(args.includes('-af') && args[args.indexOf('-af') + 1].startsWith('silencedetect='), '무음 검출 필터');
  assert.ok(args.includes('-vn'));
  setTimeout(() => {
    child.stderr.emit('data', '  Duration: 00:00:20.00, start: 0.000000, bitrate: 128 kb/s\n');
    child.stderr.emit('data', '[silencedetect @ 0x1] silence_start: 5.5\n[silencedetect @ 0x1] silence_end: 7.25 | silence_duration: 1.75\n');
    child.stderr.emit('data', '[silencedetect @ 0x1] silence_start: 15\n');
    child.emit('close', 0);
  }, 5);
  return child;
};
align.speechFromAudio({ audioPath: 'a.wav', ffmpegPath: 'ffmpeg', spawnImpl: fakeFfmpeg }).then(speech => {
  assert.deepEqual(speech.spans, [[0, 5.5], [7.25, 15]]);
  assert.equal(speech.durationSeconds, 20);
  assert.equal(netCalls, 0);
  console.log('timing-align: PASS');
}).catch(error => { console.error(error); process.exit(1); });
