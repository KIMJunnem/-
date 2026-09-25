'use strict';

// 자막 검사 기준 교체(2026-09-22): 글자 폭 가중치, 최대 노출 시간, 말소리 누락 구간
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { weightedLength } = require('../checks/_srt');
const lineLength = require('../checks/srt_line_length');
const cps = require('../checks/srt_cps');
const maxDuration = require('../checks/srt_max_duration');
const coverage = require('../checks/srt_coverage');
const service = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'services', 'subtitle.json'), 'utf8'));
const params = service.checkParams;
const ctx = extra => ({ checkParams: params, ...extra });
const one = (text, start = '00:00:00,000', end = '00:00:03,000') => ({ text: `1\n${start} --> ${end}\n${text}\n` });

// 1) 글자 폭: 전각 1, 반각 0.5 (값은 checkParams에서 읽음)
assert.equal(params.charWeightFullWidth, 1);
assert.equal(params.charWeightHalfWidth, 0.5);
assert.equal(weightedLength('가나다', params), 3);
assert.equal(weightedLength('abc 12', params), 3);
assert.equal(weightedLength('안녕 AI', params), 3.5);
assert.equal(weightedLength('abcd', { charWeightFullWidth: 1, charWeightHalfWidth: 1 }), 4, '가중치는 인자 값을 따른다');
// 한 줄 20: 한글 20자는 통과, 21자는 실패, 영문 40자는 통과(20), 41자는 실패(20.5)
assert.equal(lineLength(one('가'.repeat(20)), ctx()).passed, true);
assert.equal(lineLength(one('가'.repeat(21)), ctx()).passed, false);
assert.equal(lineLength(one('a'.repeat(40)), ctx()).passed, true);
assert.equal(lineLength(one('a'.repeat(41)), ctx()).passed, false);
// 초당 15: 1초에 한글 15자 통과·16자 실패, 영문 30자 통과·31자 실패
assert.equal(cps(one('가'.repeat(15), '00:00:00,000', '00:00:01,000'), ctx()).passed, true);
assert.equal(cps(one('가'.repeat(16), '00:00:00,000', '00:00:01,000'), ctx()).passed, false);
assert.equal(cps(one('a'.repeat(30), '00:00:00,000', '00:00:01,000'), ctx()).passed, true);
assert.equal(cps(one('a'.repeat(31), '00:00:00,000', '00:00:01,000'), ctx()).passed, false);

// 2) 최대 노출 7.0초
assert.equal(params.maxDurationSeconds, 7);
assert.equal(maxDuration(one('일곱 초', '00:00:00,000', '00:00:07,000'), ctx()).passed, true);
assert.equal(maxDuration(one('칠 초 넘음', '00:00:00,000', '00:00:07,001'), ctx()).passed, false);

// 3) 말소리 누락 구간: 5.0초 초과면 실패, 2.0초 미만 말소리는 무시, 전사 없으면 manual_review
const subs = { text: '1\n00:00:00,000 --> 00:00:04,000\n처음 부분 대사\n\n2\n00:00:20,000 --> 00:00:24,000\n마지막 부분 대사\n' };
const speech = segments => ({ segments: segments.map(([start, end, text]) => ({ start, end, text })) });
const covered = coverage(subs, ctx({ independentTranscript: speech([[0, 4, '처음'], [20, 24, '마지막']]) }));
assert.equal(covered.passed, true);
const gap6 = coverage(subs, ctx({ independentTranscript: speech([[0, 4, '처음'], [8, 14, '빠진 말'], [20, 24, '마지막']]) }));
assert.equal(gap6.passed, false); assert.equal(gap6.longestUncoveredSeconds, 6);
const gap5 = coverage(subs, ctx({ independentTranscript: speech([[0, 4, '처음'], [8, 13, '빠진 말'], [20, 24, '마지막']]) }));
assert.equal(gap5.passed, true, '5.0초 이하는 통과');
const shortSpeech = coverage(subs, ctx({ independentTranscript: speech([[0, 4, '처음'], [10, 11.9, '음'], [20, 24, '마지막']]) }));
assert.equal(shortSpeech.passed, true, '2.0초 미만 말소리는 무시');
const noTranscript = coverage(subs, ctx());
assert.equal(noTranscript.status, 'manual_review'); assert.equal(noTranscript.id, 'coverage_manual_review_required');

// 4) 서비스 정의: 새 검사가 blocking으로 등록되어 있고 provisional 유지
const checks = Object.fromEntries(service.qualityChecks.map(item => [item.id, item.blocking]));
assert.equal(checks.srt_max_duration, true);
assert.equal(checks.srt_coverage, true);
assert.equal(params.provisional, true);

console.log(JSON.stringify({ gap6, gap5: { passed: gap5.passed, longest: gap5.longestUncoveredSeconds }, shortSpeech: shortSpeech.passed, noTranscript: noTranscript.status }, null, 2));
console.log('subtitle-checks-v2: PASS');
