'use strict';

// 말소리가 있는데 자막이 없는 구간 검사(2026-09-22 준희 지시).
// 독립 전사 구간 중 coverageMinSpeechSeconds(2.0초) 미만은 무시하고, 자막이 덮지 않는
// 연속 구간이 coverageFailUncoveredSeconds(5.0초)를 넘으면 실패. 전사가 없으면 manual_review.
const { parse } = require('./_srt');
const { transcriptInput, readTranscript } = require('./_transcript');

function merge(intervals) {
  const ordered = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of ordered) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

function stamp(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

module.exports = (deliverable, context = {}) => {
  const input = transcriptInput(context);
  if (!input) return { passed: false, status: 'manual_review', id: 'coverage_manual_review_required', type: 'manual_review_required', detail: '독립 전사 파일이 없어 자막 누락 구간을 자동 검사할 수 없습니다.', location: 'context.independentTranscript' };
  const parsed = parse(deliverable);
  if (parsed.error) return { passed: false, detail: parsed.error, location: 'srt' };
  let transcript;
  try { transcript = readTranscript(input); }
  catch (error) { return { passed: false, status: 'manual_review', id: 'coverage_manual_review_required', detail: error.message, location: 'context.independentTranscript' }; }
  const params = context.checkParams || {};
  const minSpeech = Number(params.coverageMinSpeechSeconds ?? 2) * 1000;
  const failAt = Number(params.coverageFailUncoveredSeconds ?? 5) * 1000;
  const speech = merge(transcript
    .filter(item => Number.isFinite(item.end) && item.end - item.start >= minSpeech)
    .map(item => [item.start, item.end]));
  const covered = merge(parsed.blocks.map(block => [block.start, block.end]));
  let longest = { length: 0, start: 0, end: 0 };
  let totalUncovered = 0;
  for (const [a, b] of speech) {
    let cursor = a;
    for (const [c, d] of covered) {
      if (d <= cursor) continue;
      if (c >= b) break;
      if (c > cursor) {
        const gap = c - cursor;
        totalUncovered += gap;
        if (gap > longest.length) longest = { length: gap, start: cursor, end: c };
      }
      cursor = Math.max(cursor, d);
      if (cursor >= b) break;
    }
    if (cursor < b) {
      const gap = b - cursor;
      totalUncovered += gap;
      if (gap > longest.length) longest = { length: gap, start: cursor, end: b };
    }
  }
  const summary = {
    speechSegmentsChecked: speech.length,
    longestUncoveredSeconds: Number((longest.length / 1000).toFixed(3)),
    totalUncoveredSeconds: Number((totalUncovered / 1000).toFixed(3)),
    thresholdSeconds: failAt / 1000
  };
  if (longest.length > failAt) {
    return { passed: false, ...summary, detail: `${stamp(longest.start)}~${stamp(longest.end)} 구간(${summary.longestUncoveredSeconds}초)에 말소리가 있는데 자막이 없습니다.`, location: `time:${(longest.start / 1000).toFixed(3)}` };
  }
  return { passed: true, ...summary };
};
