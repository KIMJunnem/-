'use strict';

// 시각만으로 맞추기(2026-09-23 준희 승인). 번역 자막처럼 글자를 대조할 수 없는 건에 쓴다.
// 자막 글자는 보지 않는다. 말소리가 있는 구간과 자막이 떠 있는 구간만 비교한다.
//   1) 말소리 있음/없음, 자막 있음/없음을 50밀리초 칸으로 만든다
//   2) 자막을 구간(기본 180초)으로 나누고, 구간마다 "몇 초 당겨야 말소리와 가장 잘 겹치는가"를 찾는다
//   3) 구간별 값을 모아 일정하게 밀림(offset)인지, 중간부터 점점 밀림(drift_gradual)인지 가른다
//   4) 보정한 뒤 다시 재서 ok인지 본다
// 말이 촘촘하면 조금 틀려도 비슷하게 겹친다. 그래서 구간마다 "이만큼은 구분 못 한다"는 폭도 같이 낸다.
// 유료 API·외부 호출 없음. 자막 파일은 시각만 읽는다.

const fs = require('node:fs');
const { spawn } = require('node:child_process');

const DEFAULTS = {
  noiseDb: -33,               // 이보다 조용하면 말이 없는 것으로 본다(FFmpeg silencedetect)
  minSilenceSeconds: 0.35,    // 이만큼 이어지는 조용함만 "쉼"으로 센다
  stepSeconds: 0.05,          // 시간 칸 크기
  mergeGapSeconds: 0.2,       // 이보다 짧게 끊긴 말은 이어진 것으로 본다
  windowSeconds: 180,         // 구간 길이
  minBlocksPerWindow: 8,
  searchSeconds: 15,          // 당겨 보는 범위(±)
  uncertaintyMargin: 0.01,    // 겹침 점수가 이만큼 안이면 구분 못 하는 것으로 본다
  okDeviationSeconds: 0.5,    // 구간 값이 이 안이면 맞는 것으로 본다
  driftMinTotalSeconds: 1.0   // 처음·끝 차이가 이보다 작으면 밀림으로 보지 않는다
};

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const r3 = value => Number(Number(value).toFixed(3));

// 전사(JSON) → 말소리 구간 [[시작, 끝], ...]
function speechIntervals(transcript, mergeGapSeconds = DEFAULTS.mergeGapSeconds) {
  const segments = Array.isArray(transcript) ? transcript : transcript?.segments || [];
  const spans = [];
  for (const segment of segments) {
    const words = Array.isArray(segment.words) && segment.words.length ? segment.words : [{ start: segment.start, end: segment.end }];
    for (const word of words) {
      const a = Number(word.start), b = Number(word.end ?? word.start);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
      const last = spans[spans.length - 1];
      if (last && a - last[1] <= mergeGapSeconds) last[1] = Math.max(last[1], b);
      else spans.push([a, b]);
    }
  }
  return spans;
}

// 진짜 소리에서 말/쉼 구간 뽑기(FFmpeg silencedetect). 소리를 밖으로 보내지 않는다.
function speechFromAudio({ audioPath, ffmpegPath, noiseDb = DEFAULTS.noiseDb, minSilenceSeconds = DEFAULTS.minSilenceSeconds, spawnImpl = spawn, timeoutMinutes = 30 }) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg_unavailable'));
    const args = ['-hide_banner', '-nostats', '-i', audioPath, '-vn', '-af', `silencedetect=n=${noiseDb}dB:d=${minSilenceSeconds}`, '-f', 'null', '-'];
    const child = spawnImpl(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} }, timeoutMinutes * 60000);
    child.on('error', error => { clearTimeout(timer); reject(Object.assign(new Error('ffmpeg_unavailable'), { cause: error })); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffmpeg_failed_${code}: ${stderr.slice(-400)}`));
      const duration = (/Duration: (\d+):(\d+):(\d+\.?\d*)/.exec(stderr) || []).slice(1).map(Number);
      const total = duration.length === 3 ? duration[0] * 3600 + duration[1] * 60 + duration[2] : null;
      const silences = [];
      const re = /silence_start: (-?[\d.]+)|silence_end: (-?[\d.]+)/g;
      let match, open = null;
      while ((match = re.exec(stderr))) {
        if (match[1] !== undefined) open = Number(match[1]);
        else if (open !== null) { silences.push([open, Number(match[2])]); open = null; }
      }
      if (open !== null && total !== null) silences.push([open, total]);
      const spans = [];
      let cursor = 0;
      for (const [a, b] of silences) { if (a > cursor) spans.push([Math.max(0, cursor), a]); cursor = Math.max(cursor, b); }
      if (total !== null && cursor < total) spans.push([cursor, total]);
      resolve({ spans: spans.filter(([a, b]) => b - a > 0.05), durationSeconds: total, silences: silences.length, source: 'audio_silencedetect' });
    });
  });
}

function timeline(intervals, to, step) {
  const n = Math.max(1, Math.ceil(to / step));
  const arr = new Float32Array(n);
  for (const [a, b] of intervals) {
    const i0 = Math.max(0, Math.floor(a / step));
    const i1 = Math.min(n, Math.ceil(b / step));
    for (let i = i0; i < i1; i += 1) arr[i] = 1;
  }
  return arr;
}

// 자막 칸을 lag만큼 옮겨 말소리 칸과 겹치는 정도(평균 뺀 상관계수)
function correlation(subs, speech, offset, length, lag) {
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0, count = 0;
  for (let i = 0; i < length; i += 1) {
    const si = offset + i, ti = si + lag;
    if (si < 0 || si >= subs.length || ti < 0 || ti >= speech.length) continue;
    const x = subs[si], y = speech[ti];
    sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y; count += 1;
  }
  if (count < 20) return -1;
  const cov = sxy - (sx * sy) / count;
  const vx = sxx - (sx * sx) / count, vy = syy - (sy * sy) / count;
  if (vx <= 0 || vy <= 0) return -1;
  return cov / Math.sqrt(vx * vy);
}

function bestDelta(subs, speech, offset, length, config) {
  const step = config.stepSeconds;
  const maxLag = Math.round(config.searchSeconds / step);
  // 점수가 같으면 덜 옮기는 쪽을 고른다(되풀이되는 말에서 엉뚱한 배수로 맞추지 않게)
  let best = { lag: 0, score: correlation(subs, speech, offset, length, 0) };
  for (let step2 = 1; step2 <= maxLag; step2 += 1) {
    for (const lag of [-step2, step2]) {
      const score = correlation(subs, speech, offset, length, lag);
      if (score > best.score) best = { lag, score };
    }
  }
  let lo = best.lag, hi = best.lag;
  for (let lag = best.lag - 1; lag >= -maxLag; lag -= 1) { if (correlation(subs, speech, offset, length, lag) < best.score - config.uncertaintyMargin) break; lo = lag; }
  for (let lag = best.lag + 1; lag <= maxLag; lag += 1) { if (correlation(subs, speech, offset, length, lag) < best.score - config.uncertaintyMargin) break; hi = lag; }
  // 자막이 말보다 늦으면 양수(자막을 그만큼 당겨야 맞는다)
  return { delta: r3(-best.lag * step), score: r3(best.score), uncertaintySeconds: r3(((hi - lo) / 2) * step) };
}

function buildWindows(blocks, config) {
  const windows = [];
  let current = [];
  let edge = (blocks[0]?.start ?? 0) + config.windowSeconds;
  for (const block of blocks) {
    if (block.start > edge && current.length >= config.minBlocksPerWindow) { windows.push(current); current = []; edge = block.start + config.windowSeconds; }
    current.push(block);
  }
  if (current.length) {
    if (current.length < config.minBlocksPerWindow && windows.length) windows[windows.length - 1].push(...current);
    else windows.push(current);
  }
  return windows;
}

function measure(blocks, transcript, config) {
  const step = config.stepSeconds;
  const spans = speechIntervals(transcript, config.mergeGapSeconds);
  if (!spans.length || !blocks.length) return [];
  const to = Math.max(spans[spans.length - 1][1], blocks[blocks.length - 1].end) + config.searchSeconds + 1;
  const speech = timeline(spans, to, step);
  const subs = timeline(blocks.map(block => [Math.max(0, block.start), Math.max(0, block.end)]), to, step);
  return buildWindows(blocks, config).map(group => {
    const a = Math.max(0, group[0].start), b = group[group.length - 1].end;
    const offset = Math.floor(a / step);
    const length = Math.max(1, Math.ceil((b - a) / step));
    const fit = bestDelta(subs, speech, offset, length, config);
    return {
      fromBlock: group[0].number, toBlock: group[group.length - 1].number,
      fromSeconds: r3(a), centerSeconds: r3((a + b) / 2), blocks: group.length,
      deviationSeconds: fit.delta, matchScore: fit.score, uncertaintySeconds: fit.uncertaintySeconds
    };
  });
}

function fitHinge(points) {
  let best = null;
  for (let k = 1; k < points.length - 1; k += 1) {
    const tau = points[k].centerSeconds;
    let n = points.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of points) { const x = Math.max(0, p.centerSeconds - tau); sx += x; sy += p.deviationSeconds; sxx += x * x; sxy += x * p.deviationSeconds; }
    const den = n * sxx - sx * sx;
    if (!den) continue;
    const slope = (n * sxy - sx * sy) / den, intercept = (sy - slope * sx) / n;
    let sse = 0; for (const p of points) { const res = p.deviationSeconds - (intercept + slope * Math.max(0, p.centerSeconds - tau)); sse += res * res; }
    if (!best || sse < best.sse) best = { k, tau, intercept, slope, sse };
  }
  return best;
}

function classify(points, config) {
  if (!points.length) return { type: 'irregular' };
  const values = points.map(p => p.deviationSeconds);
  const center = median(values);
  // 구간끼리 흔들리는 폭이 허용치의 두 배 안이면 "고르게 맞는다"로 본다
  const flat = Math.max(...values) - Math.min(...values) <= 2 * config.okDeviationSeconds;
  if (flat && Math.abs(center) <= config.okDeviationSeconds) return { type: 'ok', medianDeviationSeconds: r3(center) };
  if (flat) return { type: 'offset', medianDeviationSeconds: r3(center), correction: { kind: 'offset', shiftSeconds: r3(-center) } };
  const hinge = fitHinge(points);
  if (!hinge) return { type: 'irregular', medianDeviationSeconds: r3(center) };
  const last = points[points.length - 1];
  const total = hinge.slope * Math.max(0, last.centerSeconds - hinge.tau);
  if (Math.abs(total) < config.driftMinTotalSeconds) return { type: 'irregular', medianDeviationSeconds: r3(center) };
  return {
    type: 'drift_gradual',
    driftStartWindow: { fromBlock: points[hinge.k].fromBlock, fromSeconds: points[hinge.k].fromSeconds, centerSeconds: points[hinge.k].centerSeconds },
    offsetBeforeSeconds: r3(hinge.intercept),
    driftPerMinuteSeconds: r3(hinge.slope * 60),
    totalDriftSeconds: r3(total),
    correction: { kind: 'hinge', tauSeconds: r3(hinge.tau), offsetSeconds: r3(hinge.intercept), slope: Number(hinge.slope.toFixed(6)), formula: '자막 s < τ+a 이면 s−a, 아니면 (s−a+b·τ)/(1+b)' }
  };
}

function applyCorrection(blocks, correction) {
  if (!correction) return blocks;
  const fix = seconds => {
    if (correction.kind === 'offset') return seconds + correction.shiftSeconds;
    const { tauSeconds: tau, offsetSeconds: a, slope: b } = correction;
    return seconds < tau + a ? seconds - a : (seconds - a + b * tau) / (1 + b);
  };
  return blocks.map(block => ({ ...block, start: fix(block.start), end: fix(block.end) }));
}

// 정확도 자가시험: 알려진 만큼 밀어 보고 되찾는지 본다
function selfTest(blocks, transcript, config, shifts = [0.5, 1, 2, 5]) {
  return shifts.map(shift => {
    const moved = blocks.map(block => ({ ...block, start: block.start + shift, end: block.end + shift }));
    const found = median(measure(moved, transcript, config).map(p => p.deviationSeconds));
    return { shiftSeconds: shift, recoveredSeconds: r3(found), errorSeconds: r3(found - shift) };
  });
}

// 블록별 표(2026-09-23 준희 요청): 자막 시작과 가장 가까운 말소리 시작(쉼 뒤 첫 말)·그 차이.
function blockTable(blocks, spans, fromSeconds, toSeconds, extraOnsets = null) {
  const onsets = spans.map(([a]) => a).sort((x, y) => x - y);
  const nearest = (list, t) => { let best = null; for (const v of list) { if (best === null || Math.abs(v - t) < Math.abs(best - t)) best = v; if (v > t + 30) break; } return best; };
  return blocks.filter(b => b.start >= fromSeconds && b.start <= toSeconds).map(b => {
    const on = nearest(onsets, b.start);
    const row = { block: b.number, start: r3(b.start), end: r3(b.end), speechOnset: on == null ? null : r3(on), diff: on == null ? null : r3(b.start - on) };
    if (extraOnsets) { const w = nearest(extraOnsets, b.start); row.transcriptSegmentStart = w == null ? null : r3(w); row.diffTranscript = w == null ? null : r3(b.start - w); }
    return row;
  });
}

// 밀림 자가시험: 실제 자막에 "언제부터 얼마나" 밀린 상태를 일부러 만들어 찾아내는지 본다
function driftTest(blocks, transcript, config, specs = []) {
  const last = blocks[blocks.length - 1].end;
  return specs.map(spec => {
    const from = Number(spec.fromSeconds), total = Number(spec.totalSeconds);
    const span = Math.max(1, last - from);
    const moved = blocks.map(block => {
      const add = block.start < from ? 0 : ((block.start - from) * total) / span;
      return { ...block, start: block.start + add, end: block.end + add };
    });
    const r = analyzeBlocks(moved, transcript, config);
    const trueBlock = (blocks.find(block => block.start >= from) || blocks[blocks.length - 1]).number;
    return {
      fromSeconds: r3(from), totalSeconds: r3(total), trueStartBlock: trueBlock,
      type: r.type,
      foundStartSeconds: r.driftStartWindow ? r.driftStartWindow.fromSeconds : null,
      foundStartBlock: r.driftStartWindow ? r.driftStartWindow.fromBlock : null,
      startErrorSeconds: r.driftStartWindow ? r3(r.driftStartWindow.fromSeconds - from) : null,
      totalFoundSeconds: r.totalDriftSeconds ?? null,
      recheck: r.recheck ? r.recheck.type : null,
      maxAfterFixSeconds: r.recheck ? r.recheck.maxWindowDeviationSeconds : null
    };
  });
}

function analyzeBlocks(blocks, transcript, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const spans = speechIntervals(transcript, config.mergeGapSeconds);
  if (spans.length < 10 || blocks.length < 4) return { ok: false, error: 'not_enough_points', speechSpans: spans.length, blocks: blocks.length };
  const points = measure(blocks, transcript, config);
  const verdict = classify(points, config);
  const out = { ok: true, method: 'timing_only', blocks: blocks.length, speechSpans: spans.length, windows: points, ...verdict };
  const gaps = []; for (let i = 1; i < spans.length; i += 1) gaps.push(spans[i][0] - spans[i - 1][1]);
  const lengths = spans.map(([a, b]) => b - a);
  const span = spans[spans.length - 1][1] - spans[0][0];
  out.speech = { medianSpanSeconds: r3(median(lengths)), medianGapSeconds: r3(median(gaps)), speechRatio: r3(lengths.reduce((x, y) => x + y, 0) / (span || 1)) };
  out.uncertainty = { medianSeconds: r3(median(points.map(p => p.uncertaintySeconds))), maxSeconds: r3(Math.max(...points.map(p => p.uncertaintySeconds))) };
  out.matchScore = { medianValue: r3(median(points.map(p => p.matchScore))), minValue: r3(Math.min(...points.map(p => p.matchScore))) };
  if (verdict.correction) {
    const again = measure(applyCorrection(blocks, verdict.correction), transcript, config);
    const recheck = classify(again, config);
    out.recheck = { type: recheck.type, medianDeviationSeconds: recheck.medianDeviationSeconds ?? null, maxWindowDeviationSeconds: r3(Math.max(...again.map(p => Math.abs(p.deviationSeconds)))) };
  }
  return out;
}

function readBlocks(srtPath, parseImpl) {
  const parse = parseImpl || require('../../checks/_srt').parse;
  const parsed = parse({ path: srtPath });
  if (parsed.error) return { error: `srt_parse:${parsed.error}` };
  return { blocks: parsed.blocks.map(block => ({ number: block.number, start: block.start / 1000, end: block.end / 1000 })) };
}

// 소리에서 뽑은 말 구간으로 맞추기(권장). transcript로도 되지만 전사 단어 시각은 쉼이 잘 안 드러난다.
async function analyzeAudio({ srtPath, audioPath, ffmpegPath, options = {}, parseImpl = null, selfTestShifts = null, driftSpecs = null, tableRange = null, tableTranscriptPath = null, spawnImpl }) {
  const read = readBlocks(srtPath, parseImpl);
  if (read.error) return { ok: false, error: read.error };
  const config = { ...DEFAULTS, ...options };
  const speech = await speechFromAudio({ audioPath, ffmpegPath, noiseDb: config.noiseDb, minSilenceSeconds: config.minSilenceSeconds, spawnImpl });
  const source = { segments: speech.spans.map(([a, b]) => ({ start: a, end: b, words: [{ start: a, end: b }] })) };
  const result = analyzeBlocks(read.blocks, source, options);
  if (result.ok) {
    result.speechSource = 'audio_silencedetect';
    result.audioDurationSeconds = speech.durationSeconds;
    if (selfTestShifts) result.selfTest = selfTest(read.blocks, source, config, selfTestShifts);
    if (driftSpecs && driftSpecs.length) result.driftTest = driftTest(read.blocks, source, options, driftSpecs);
    if (tableRange) {
      let extra = null;
      if (tableTranscriptPath) { try { extra = (JSON.parse(fs.readFileSync(tableTranscriptPath, 'utf8')).segments || []).map(x => Number(x.start)).filter(Number.isFinite).sort((a, b) => a - b); } catch (_) { extra = null; } }
      result.blockTable = blockTable(read.blocks, speech.spans, Number(tableRange.fromSeconds), Number(tableRange.toSeconds), extra);
    }
  }
  return result;
}

function analyzeFiles({ srtPath, transcriptPath, options = {}, parseImpl = null, selfTestShifts = null }) {
  const read = readBlocks(srtPath, parseImpl);
  if (read.error) return { ok: false, error: read.error };
  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const result = analyzeBlocks(read.blocks, transcript, options);
  if (result.ok) {
    result.speechSource = 'transcript_words';
    if (selfTestShifts) result.selfTest = selfTest(read.blocks, transcript, { ...DEFAULTS, ...options }, selfTestShifts);
  }
  return result;
}

module.exports = { DEFAULTS, median, driftTest, blockTable, speechFromAudio, readBlocks, analyzeAudio, speechIntervals, timeline, measure, classify, applyCorrection, analyzeBlocks, analyzeFiles, selfTest };
