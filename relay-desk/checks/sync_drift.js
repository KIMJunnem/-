'use strict';

// 싱크 검사 v2 (2026-09-22 준희 지시, checkParams.provisional=true 동안 임시 기준).
// 판정 순서(먼저 걸리는 것이 결과):
//   1) corrupt      : minSyncAnchorChars(6자) 이상 블록 중 매칭률 minSyncMatchRatio(60%) 미만 → manual_review
//   2) drift_linear : 직선 적합 R² ≥ syncLinearMinR2(0.9), 처음·끝 차이 ≥ syncLinearMinTotalSeconds(1.0초) → 배율 보정값
//   3) drift        : 앞 구간 중앙값 대비 maxSyncPairDeviationSeconds(1.0초) 넘는 짝이 syncDriftRunLength(3)개 연속 → 첫 블록 번호·시각
//   4) offset       : 중앙값 절대값 > maxSyncOffsetSeconds(0.5초) → 보정값 = 중앙값 부호 반대
//   5) ok
// 편차(deviation) = 자막 시작 − 전사 시작(초). 자막이 늦으면 +.
// 보정 후 재검사(syncRecheckAfterFix)에서 ok가 아니면 manual_review.
// v3(2026-09-22 T-5 결과 반영): 단어 시각이 있는 전사면 블록 1:1 짝짓기 대신 "단어 흐름에 글자 단위로 맞추기"로 편차를 잰다
//   (고객 자막의 블록 경계가 우리와 달라도 된다). 점이 syncSmoothMinPoints(21)개 이상이면 syncSmoothWindow(7)블록 이동 중앙값으로
//   Whisper 단어 시각 흔들림(1초 안팎)을 누른다. 기존 판정(선형·중간부터·일정)으로 보정해 재검사가 ok가 아니면
//   꺾임 모델(drift_gradual: 어느 블록부터 점점 밀림)을 시도한다.
// syncRequireWordTimestamps: 단어 시각 없는 전사로는 ok여도 자동 통과시키지 않고 manual_review.
// 번역 자막(syncTranslatedTarget=source_language_srt): 원어 SRT(context.sourceLanguageSrt, 내부 파일)로 싱크를 검사하고,
//   납품 한국어 SRT는 블록 시작 시각이 원어 SRT와 syncInheritedStartToleranceSeconds(0.05초) 이내인지만 본다.
const { parse } = require('./_srt');
const { transcriptInput, readTranscript } = require('./_transcript');

function median(values) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function normalized(value) {
  return String(value || '').toLowerCase().normalize('NFKC').replace(/[^0-9a-z가-힣぀-ヿ一-鿿À-ɏ]+/g, '');
}

function grams(text) {
  if (text.length < 2) return new Set(text ? [text] : []);
  return new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)));
}

function similarity(left, right) {
  const a = normalized(left), b = normalized(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const ga = grams(a), gb = grams(b);
  let common = 0;
  for (const item of ga) if (gb.has(item)) common += 1;
  return (2 * common) / (ga.size + gb.size || 1);
}

function round3(value) { return Number(Number(value).toFixed(3)); }

function settings(params = {}) {
  return {
    minSimilarity: Number(params.minSyncSimilarity ?? 0.45),
    minAnchorChars: Number(params.minSyncAnchorChars ?? 6),
    windowMs: Number(params.syncMatchWindowSeconds ?? 30) * 1000,
    minMatchRatio: Number(params.minSyncMatchRatio ?? 0.6),
    maxOffset: Number(params.maxSyncOffsetSeconds ?? 0.5),
    maxPairDeviation: Number(params.maxSyncPairDeviationSeconds ?? 1.0),
    runLength: Math.max(1, Number(params.syncDriftRunLength ?? 3)),
    linearMinTotal: Number(params.syncLinearMinTotalSeconds ?? 1.0),
    linearMinR2: Number(params.syncLinearMinR2 ?? 0.9),
    requireWords: params.syncRequireWordTimestamps === true,
    recheck: params.syncRecheckAfterFix !== false,
    inheritedTolerance: Number(params.syncInheritedStartToleranceSeconds ?? 0.05),
    smoothWindow: Math.max(1, Number(params.syncSmoothWindow ?? 7)),
    smoothMinPoints: Number(params.syncSmoothMinPoints ?? 21),
    alignAheadChars: Number(params.syncAlignAheadChars ?? 500)
  };
}

function segmentStart(segment) {
  return Array.isArray(segment.words) && segment.words.length ? segment.words[0].start : segment.start;
}

function matchBlocks(subtitles, transcript, config) {
  const anchors = subtitles.filter(block => normalized(block.lines.join(' ')).length >= config.minAnchorChars);
  const pairs = [];
  const unmatched = [];
  let cursor = 0;
  for (const subtitle of anchors) {
    let bestIndex = -1, bestScore = 0;
    for (let index = cursor; index < transcript.length; index += 1) {
      const start = segmentStart(transcript[index]);
      if (start < subtitle.start - config.windowMs) continue;
      if (start > subtitle.start + config.windowMs) break;
      const score = similarity(subtitle.lines.join(' '), transcript[index].text);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    }
    if (bestIndex < 0 || bestScore < config.minSimilarity) { unmatched.push(subtitle.number); continue; }
    const transcriptStartMs = segmentStart(transcript[bestIndex]);
    pairs.push({
      block: subtitle.number,
      subtitleStartMs: subtitle.start,
      transcriptStartMs,
      deviationSeconds: round3((subtitle.start - transcriptStartMs) / 1000),
      similarity: round3(bestScore)
    });
    cursor = bestIndex + 1;
  }
  return { anchors: anchors.length, pairs, unmatched };
}

// ─── v3 글자 맞추기: 전사 단어를 글자 흐름(글자마다 시각)으로 펴고, 블록 글자열을 앞에서부터 차례로 찾는다 ───
function charStream(transcript) {
  const chars = [];
  for (const segment of transcript) {
    for (const word of segment.words || []) {
      const text = normalized(word.text);
      const span = Math.max(0, (word.end || word.start) - word.start);
      for (let i = 0; i < text.length; i += 1) chars.push({ c: text[i], t: word.start + (span * i) / Math.max(1, text.length) });
    }
  }
  return chars;
}
function gramCounts(text) {
  const map = new Map();
  for (let i = 0; i < text.length - 1; i += 1) { const g = text.slice(i, i + 2); map.set(g, (map.get(g) || 0) + 1); }
  return map;
}
function diceCounts(ga, total, text) {
  const gb = gramCounts(text);
  let common = 0, nb = 0;
  for (const v of gb.values()) nb += v;
  for (const [g, v] of ga) common += Math.min(v, gb.get(g) || 0);
  return total + nb ? (2 * common) / (total + nb) : 0;
}
function alignBlocks(subtitles, transcript, config) {
  const chars = charStream(transcript);
  const text = chars.map(item => item.c).join('');
  const anchors = subtitles.filter(block => normalized(block.lines.join(' ')).length >= config.minAnchorChars);
  const pairs = [];
  const unmatched = [];
  let cursor = 0;
  for (const subtitle of anchors) {
    const query = normalized(subtitle.lines.join(' '));
    const ga = gramCounts(query);
    let total = 0; for (const v of ga.values()) total += v;
    const from = Math.max(0, cursor - 12), to = Math.min(text.length - query.length, cursor + config.alignAheadChars);
    // 같은 말이 되풀이되면 점수가 같은 자리가 여럿 → 직전 위치에서 멀수록 조금 깎는다(100글자당 0.03). 뒤로는 12글자까지만
    let best = -1, bestScore = 0, bestAdjusted = -Infinity;
    for (let j = from; j <= to; j += 1) {
      if (Math.abs(chars[j].t - subtitle.start) > config.windowMs) continue;
      const score = diceCounts(ga, total, text.slice(j, j + query.length));
      const adjusted = score - 0.0003 * Math.abs(j - cursor);
      if (adjusted > bestAdjusted) { bestAdjusted = adjusted; bestScore = score; best = j; }
    }
    if (best < 0 || bestScore < config.minSimilarity) { unmatched.push(subtitle.number); continue; }
    const transcriptStartMs = chars[best].t;
    pairs.push({ block: subtitle.number, subtitleStartMs: subtitle.start, transcriptStartMs, deviationSeconds: round3((subtitle.start - transcriptStartMs) / 1000), similarity: round3(bestScore) });
    cursor = best + query.length;
  }
  return { anchors: anchors.length, pairs, unmatched, method: 'word_stream' };
}

function smoothPoints(points, config) {
  if (points.length < config.smoothMinPoints || config.smoothWindow <= 1) return { points, smoothed: false };
  const half = Math.floor(config.smoothWindow / 2);
  return { smoothed: true, points: points.map((point, index) => ({ ...point, d: median(points.slice(Math.max(0, index - half), index + half + 1).map(item => item.d)) })) };
}

// 꺾임 모델: 편차 = a + b·max(0, t − τ). τ는 점 위치 중에서 제곱오차가 가장 작은 곳.
function fitHinge(points) {
  let best = null;
  for (let k = 1; k < points.length - 3; k += 1) {
    const tau = points[k].t;
    let n = points.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of points) { const x = Math.max(0, p.t - tau); sx += x; sy += p.d; sxx += x * x; sxy += x * p.d; }
    const den = n * sxx - sx * sx;
    if (!den) continue;
    const b = (n * sxy - sx * sy) / den, a = (sy - b * sx) / n;
    let sse = 0; for (const p of points) { const r = p.d - (a + b * Math.max(0, p.t - tau)); sse += r * r; }
    if (!best || sse < best.sse) best = { k, tau, a, b, sse };
  }
  return best;
}
function hingeVerdict(points) {
  const h = fitHinge(points);
  if (!h || Math.abs(h.b) < 1e-5) return null;
  const start = points[h.k];
  const last = points[points.length - 1];
  return {
    type: 'drift_gradual',
    driftStartBlock: start.block,
    driftStartSeconds: round3(start.subtitleStartMs / 1000),
    offsetBeforeSeconds: round3(h.a),
    driftPerMinuteSeconds: round3(h.b * 60),
    totalDriftSeconds: round3(h.b * Math.max(0, last.t - h.tau)),
    correction: { kind: 'hinge', fromBlock: start.block, tauSeconds: round3(h.tau), offsetSeconds: round3(h.a), slope: Number(h.b.toFixed(6)), formula: '자막 s < τ+a 이면 s−a, 아니면 (s−a+b·τ)/(1+b)' }
  };
}

function linearFit(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i += 1) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  if (sxx === 0) return { slope: 0, intercept: my, r2: 0 };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

// deviations: [{ t: 전사 시각(초), d: 편차(초), block, subtitleStartMs }]
function classify(points, config) {
  const ds = points.map(point => point.d);
  if (points.length >= 3) {
    const fit = linearFit(points.map(point => point.t), ds);
    const first = fit.intercept + fit.slope * points[0].t;
    const last = fit.intercept + fit.slope * points[points.length - 1].t;
    const total = Math.abs(last - first);
    if (fit.r2 >= config.linearMinR2 && total >= config.linearMinTotal) {
      // 자막 = a + (1+b)·전사  →  보정 자막 시각 = (자막 − a) / (1+b)
      const scale = 1 / (1 + fit.slope);
      return {
        type: 'drift_linear',
        r2: round3(fit.r2),
        totalDriftSeconds: round3(last - first),
        driftPerHourSeconds: round3(fit.slope * 3600),
        correction: { kind: 'linear', scale: Number(scale.toFixed(6)), offsetSeconds: round3(-fit.intercept * scale), formula: '보정 시각 = 자막 시각 × scale + offsetSeconds' }
      };
    }
  }
  for (let index = 1; index + config.runLength <= points.length; index += 1) {
    const center = median(ds.slice(0, index));
    const run = ds.slice(index, index + config.runLength);
    if (run.every(value => Math.abs(value - center) > config.maxPairDeviation)) {
      const suffixShift = median(ds.slice(index)) - center;
      return {
        type: 'drift',
        driftStartBlock: points[index].block,
        driftStartSeconds: round3(points[index].subtitleStartMs / 1000),
        correction: { kind: 'shift_from_block', fromBlock: points[index].block, shiftSeconds: round3(-suffixShift) }
      };
    }
  }
  const center = median(ds);
  if (Math.abs(center) > config.maxOffset) {
    return { type: 'offset', medianDeviationSeconds: round3(center), recommendedOffsetSeconds: round3(-center), correction: { kind: 'offset', shiftSeconds: round3(-center) } };
  }
  return { type: 'ok', medianDeviationSeconds: round3(center) };
}

function applyCorrection(points, verdict) {
  const c = verdict.correction;
  return points.map(point => {
    const subtitle = point.subtitleStartMs / 1000;
    let corrected = subtitle;
    if (c.kind === 'linear') corrected = subtitle * c.scale + c.offsetSeconds;
    else if (c.kind === 'offset') corrected = subtitle + c.shiftSeconds;
    else if (c.kind === 'shift_from_block') corrected = point.block >= c.fromBlock ? subtitle + c.shiftSeconds : subtitle;
    else if (c.kind === 'hinge') corrected = subtitle < c.tauSeconds + c.offsetSeconds ? subtitle - c.offsetSeconds : (subtitle - c.offsetSeconds + c.slope * c.tauSeconds) / (1 + c.slope);
    return { ...point, subtitleStartMs: corrected * 1000, d: corrected - point.t };
  });
}

function syncCore(blocks, transcript, config, useWords = false) {
  const matched = useWords ? alignBlocks(blocks, transcript, config) : matchBlocks(blocks, transcript, config);
  const matchRatio = matched.anchors ? round3(matched.pairs.length / matched.anchors) : 0;
  const base = { anchorBlocks: matched.anchors, matchedBlocks: matched.pairs.length, matchRatio, unmatchedBlockNumbers: matched.unmatched, pairs: matched.pairs, matchMethod: matched.method || 'block_pair' };
  if (!matched.anchors || matchRatio < config.minMatchRatio) {
    return { ...base, type: 'corrupt', status: 'manual_review', detail: `독립 전사와 내용이 맞는 자막이 ${Math.round(matchRatio * 100)}%(${matched.pairs.length}/${matched.anchors})로 기준 ${Math.round(config.minMatchRatio * 100)}% 미만이라 사람 확인이 필요합니다.` };
  }
  const raw = matched.pairs.map(pair => ({ t: pair.transcriptStartMs / 1000, d: pair.deviationSeconds, block: pair.block, subtitleStartMs: pair.subtitleStartMs }));
  const { points, smoothed } = smoothPoints(raw, config);
  base.smoothed = smoothed;
  const verdict = classify(points, config);
  if (verdict.type === 'ok' || !config.recheck) return { ...base, ...verdict };
  const again = classify(applyCorrection(points, verdict), config);
  if (again.type === 'ok') return { ...base, ...verdict, recheckAfterFix: 'ok' };
  // 기존 보정으로 안 맞으면 꺾임(중간부터 점점 밀림)을 시도
  const gradual = hingeVerdict(points);
  if (gradual) {
    const gradualAgain = classify(applyCorrection(points, gradual), config);
    if (gradualAgain.type === 'ok') return { ...base, ...gradual, recheckAfterFix: 'ok', firstVerdict: verdict.type };
  }
  return { ...base, ...verdict, recheckAfterFix: again.type, status: 'manual_review' };
}

function detailOf(result) {
  if (result.detail) return result.detail;
  if (result.type === 'drift_linear') return `싱크가 시간에 비례해 점점 밀립니다(처음·끝 ${result.totalDriftSeconds}초, R² ${result.r2}).`;
  if (result.type === 'drift') return `${result.driftStartBlock}번 블록(${result.driftStartSeconds.toFixed(3)}초)부터 싱크 밀림이 유지됩니다.`;
  if (result.type === 'drift_gradual') return `${result.driftStartBlock}번 블록(${result.driftStartSeconds.toFixed(3)}초)부터 싱크가 점점 밀립니다(분당 ${result.driftPerMinuteSeconds}초, 끝에서 약 ${result.totalDriftSeconds}초).`;
  if (result.type === 'offset') return `전 구간에 약 ${result.medianDeviationSeconds.toFixed(3)}초의 일정한 차이가 있습니다(보정 ${result.recommendedOffsetSeconds.toFixed(3)}초).`;
  return '싱크를 확인하지 못했습니다.';
}

function inheritedCheck(target, source, tolerance) {
  if (target.length !== source.length) return { passed: false, detail: `한국어 자막 블록 수(${target.length})가 원어 자막(${source.length})과 다릅니다.`, location: 'srt' };
  for (let index = 0; index < target.length; index += 1) {
    const gap = Math.abs(target[index].start - source[index].start) / 1000;
    if (gap > tolerance) return { passed: false, detail: `${index + 1}번 블록 시작 시각이 원어 자막과 ${gap.toFixed(3)}초 다릅니다(허용 ${tolerance}초).`, location: target[index].location };
  }
  return { passed: true };
}

module.exports = (deliverable, context = {}) => {
  const config = settings(context.checkParams || {});
  const input = transcriptInput(context);
  if (!input) return { passed: false, status: 'manual_review', id: 'sync_manual_review_required', type: 'manual_review_required', detail: '독립 전사 파일이 없어 싱크를 자동 검증할 수 없습니다.', location: 'context.independentTranscript', unmatchedBlocks: null };
  const parsed = parse(deliverable);
  if (parsed.error) return { passed: false, type: 'corrupt', detail: parsed.error, location: 'srt' };
  let transcript;
  try { transcript = readTranscript(input); }
  catch (error) { return { passed: false, status: 'manual_review', type: 'corrupt', detail: error.message, location: 'context.independentTranscript' }; }
  const wordTimestamps = transcript.some(segment => Array.isArray(segment.words) && segment.words.length);

  const translated = context.translated === true || Boolean(context.sourceLanguageSrt);
  let target = parsed.blocks;
  let inherited = null;
  if (translated) {
    if (!context.sourceLanguageSrt) return { passed: false, status: 'manual_review', id: 'sync_source_srt_missing', type: 'manual_review_required', detail: '번역 자막인데 원어 SRT(내부 파일)가 없어 싱크를 검사할 수 없습니다.', location: 'context.sourceLanguageSrt' };
    const source = parse(typeof context.sourceLanguageSrt === 'string' ? { path: context.sourceLanguageSrt } : context.sourceLanguageSrt);
    if (source.error) return { passed: false, status: 'manual_review', type: 'corrupt', detail: `원어 SRT 오류: ${source.error}`, location: 'context.sourceLanguageSrt' };
    inherited = inheritedCheck(parsed.blocks, source.blocks, config.inheritedTolerance);
    target = source.blocks;
  }

  let core = syncCore(target, transcript, config, wordTimestamps);
  // S-1(2026-09-22 준희 결정): 기존 방식(블록 1:1 짝짓기, 단어 시각 없는 전사)의 밀림 판정은 참고용. 납품을 막지 않는다.
  // (단어 시각 없는 전사는 syncRequireWordTimestamps 규칙으로 따로 사람 확인이 된다)
  if (core.matchMethod === 'block_pair' && !['ok', 'corrupt'].includes(core.type)) {
    const advisory = { type: core.type, detail: `[참고·기존 방식] ${detailOf(core)}`, correction: core.correction || null, recheckAfterFix: core.recheckAfterFix || null, driftStartBlock: core.driftStartBlock ?? null };
    const { status: _status, recheckAfterFix: _r, correction: _c, ...rest } = core;
    core = { ...rest, type: 'ok', advisory };
  }
  const result = {
    ...core,
    syncTarget: translated ? 'source_language_srt' : 'deliverable',
    wordTimestamps,
    thresholdSeconds: config.maxOffset
  };
  if (inherited) result.inheritedStart = inherited;

  if (core.type === 'ok' && inherited && !inherited.passed) {
    return { ...result, passed: false, type: 'inherited_mismatch', detail: inherited.detail, location: inherited.location };
  }
  if (core.type === 'ok') {
    if (config.requireWords && !wordTimestamps) {
      return { ...result, passed: false, status: 'manual_review', id: 'sync_word_timestamps_missing', detail: '독립 전사에 단어별 시각이 없어 자동 통과시키지 않습니다. 사람 확인이 필요합니다.', location: 'context.independentTranscript' };
    }
    return { ...result, passed: true };
  }
  return {
    ...result,
    passed: false,
    detail: detailOf(core),
    location: core.type === 'drift' || core.type === 'drift_gradual' ? `block:${core.driftStartBlock}` : 'srt'
  };
};
