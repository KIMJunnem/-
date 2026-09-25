'use strict';

// 싱크 검사 v2 샘플(2026-09-22): 정상 / 전 구간 +0.7초 / 중간부터 +1.5초 / 0.1% 선형
// + 내용 불일치(corrupt) / 불규칙(irregular) / 전사 없음(missing) / 번역 자막(원어 SRT 기준)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const syncDrift = require('../checks/sync_drift');
const { runChecks } = require('../server/quality-runner');
const service = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'services', 'subtitle.json'), 'utf8'));
const params = service.checkParams;

const root = path.join(__dirname, 'samples', 'sync');
const cases = ['normal', 'offset', 'drift', 'linear', 'corrupt', 'irregular', 'missing', 'translated'];
for (const name of cases) fs.mkdirSync(path.join(root, name), { recursive: true });

const texts = ['첫 번째 안내입니다', '두 번째 내용입니다', '세 번째 설명입니다', '네 번째 문장입니다', '다섯 번째 구간입니다', '여섯 번째 부분입니다', '일곱 번째 대사입니다', '여덟 번째 마무리입니다'];
const english = ['This is the first notice', 'Here is the second part', 'Now the third explanation', 'The fourth sentence follows', 'Fifth section starts here', 'Sixth part of the talk', 'Seventh line of dialogue', 'Eighth and final wrap up'];

function stamp(seconds) {
  const value = Math.round(seconds * 1000);
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor((value % 3600000) / 60000);
  const secs = Math.floor((value % 60000) / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')},${String(millis).padStart(3,'0')}`;
}
function srt(starts, values) {
  return values.map((text, index) => `${index + 1}\n${stamp(starts[index])} --> ${stamp(starts[index] + 2)}\n${text}`).join('\n\n') + '\n';
}
// 단어별 시각이 있는 전사 JSON(faster-whisper word_timestamps 형식과 같은 모양)
function jsonTranscript(starts, values) {
  return JSON.stringify({ segments: values.map((text, index) => {
    const words = text.split(' ');
    const step = 2 / words.length;
    return { start: starts[index], end: starts[index] + 2, text, words: words.map((word, w) => ({ word, start: Number((starts[index] + w * step).toFixed(3)), end: Number((starts[index] + (w + 1) * step).toFixed(3)) })) };
  }) }, null, 2);
}

const shortStarts = texts.map((_, index) => index * 3);             // 0~21초
const longStarts = Array.from({ length: 12 }, (_, index) => index * 100); // 0~1100초(0.1% 선형용)
const longTexts = Array.from({ length: 12 }, (_, index) => `${index + 1}번째 긴 영상 구간 대사입니다`);

// 자막 시작 = 전사 시작 + 편차  →  전사 시작 = 자막 시작 − 편차
const samples = {
  normal:    { subs: shortStarts, values: texts, transcript: shortStarts.map((v, i) => v - [0.1,-0.1,0.2,-0.2,0.1,-0.1,0.2,0][i]), format: 'json', transcriptValues: texts.map((t, i) => i === 2 ? '세번째 설명입니다' : t) },
  offset:    { subs: shortStarts, values: texts, transcript: shortStarts.map((v, i) => v - 0.7 - [0.05,-0.05,0.1,-0.1,0,0.05,-0.05,0][i]), format: 'json' },
  drift:     { subs: shortStarts, values: texts, transcript: shortStarts.map((v, i) => v - (i < 4 ? [0.1,-0.1,0.1,0][i] : 1.5)), format: 'json' },
  linear:    { subs: longStarts, values: longTexts, transcript: longStarts.map(v => v / 1.001), format: 'json' },
  corrupt:   { subs: shortStarts, values: texts, transcript: shortStarts, format: 'json', transcriptValues: ['날씨가 맑습니다', '점심 메뉴를 고릅니다', '버스를 기다립니다', '책을 펼칩니다', '음악을 틉니다', '창문을 엽니다', '커피를 내립니다', '불을 끕니다'] },
  irregular: { subs: shortStarts.map(v => v + 10), values: texts, transcript: shortStarts.map((v, i) => v + 10 - [4,-2,5,-3,6,-4,3.5,-5][i]), format: 'srt' }
};
for (const [name, sample] of Object.entries(samples)) {
  fs.writeFileSync(path.join(root, name, 'subtitles.srt'), srt(sample.subs, sample.values));
  const values = sample.transcriptValues || sample.values;
  fs.writeFileSync(path.join(root, name, `independent-transcript.${sample.format}`), sample.format === 'json' ? jsonTranscript(sample.transcript, values) : srt(sample.transcript, values));
}
fs.writeFileSync(path.join(root, 'missing', 'subtitles.srt'), srt(shortStarts, texts));
fs.writeFileSync(path.join(root, 'missing', 'case.json'), JSON.stringify({ independentTranscript: null, expected: 'sync_manual_review_required' }, null, 2));
// 번역: 원어(영어) SRT가 전사와 맞고, 납품 한국어 SRT는 원어 SRT 시작 시각을 물려받는다.
fs.writeFileSync(path.join(root, 'translated', 'source-language.srt'), srt(shortStarts, english));
fs.writeFileSync(path.join(root, 'translated', 'subtitles.srt'), srt(shortStarts, texts));
fs.writeFileSync(path.join(root, 'translated', 'subtitles-shifted.srt'), srt(shortStarts.map(v => v + 0.2), texts));
fs.writeFileSync(path.join(root, 'translated', 'independent-transcript.json'), jsonTranscript(shortStarts.map(v => v - 0.1), english));

const file = name => path.join(root, name, 'subtitles.srt');
const transcriptOf = name => path.join(root, name, `independent-transcript.${samples[name]?.format || 'json'}`);
const run = (name, extra = {}) => syncDrift({ path: file(name) }, { checkParams: params, independentTranscript: transcriptOf(name), ...extra });

(async () => {
  const normal = run('normal');
  const offset = run('offset');
  const drift = run('drift');
  const linear = run('linear');
  const corrupt = run('corrupt');
  const irregular = run('irregular');
  const missing = syncDrift({ path: file('missing') }, { checkParams: params });
  const noWords = syncDrift({ path: file('normal') }, { checkParams: params, independentTranscript: { segments: JSON.parse(fs.readFileSync(transcriptOf('normal'), 'utf8')).segments.map(({ words, ...rest }) => rest) } });
  const translatedOk = syncDrift({ path: path.join(root, 'translated', 'subtitles.srt') }, { checkParams: params, translated: true, sourceLanguageSrt: path.join(root, 'translated', 'source-language.srt'), independentTranscript: path.join(root, 'translated', 'independent-transcript.json') });
  const translatedShifted = syncDrift({ path: path.join(root, 'translated', 'subtitles-shifted.srt') }, { checkParams: params, translated: true, sourceLanguageSrt: path.join(root, 'translated', 'source-language.srt'), independentTranscript: path.join(root, 'translated', 'independent-transcript.json') });
  const translatedNoSource = syncDrift({ path: path.join(root, 'translated', 'subtitles.srt') }, { checkParams: params, translated: true, independentTranscript: path.join(root, 'translated', 'independent-transcript.json') });

  assert.equal(params.provisional, true);
  assert.equal(normal.type, 'ok'); assert.equal(normal.passed, true); assert.ok(normal.matchRatio >= 0.85, `정상 샘플 매칭률 ${normal.matchRatio}`);
  assert.equal(offset.type, 'offset'); assert.equal(offset.passed, false); assert.ok(Math.abs(offset.recommendedOffsetSeconds + 0.7) <= 0.05, `offset 보정 ${offset.recommendedOffsetSeconds}`); assert.equal(offset.recheckAfterFix, 'ok'); assert.notEqual(offset.status, 'manual_review');
  assert.equal(drift.type, 'drift'); assert.equal(drift.passed, false); assert.equal(drift.driftStartBlock, 5); assert.equal(drift.driftStartSeconds, 12); assert.equal(drift.recheckAfterFix, 'ok');
  assert.equal(linear.type, 'drift_linear'); assert.equal(linear.passed, false); assert.ok(linear.r2 >= 0.9); assert.ok(Math.abs(linear.totalDriftSeconds) >= 1); assert.equal(linear.recheckAfterFix, 'ok');
  assert.equal(corrupt.type, 'corrupt'); assert.equal(corrupt.status, 'manual_review');
  assert.equal(irregular.passed, false); assert.equal(irregular.status, 'manual_review'); assert.ok(irregular.matchRatio >= 0.6, '불규칙 샘플은 내용은 맞아야 한다'); assert.notEqual(irregular.recheckAfterFix, 'ok');
  assert.equal(missing.passed, false); assert.equal(missing.id, 'sync_manual_review_required');
  assert.equal(noWords.passed, false); assert.equal(noWords.status, 'manual_review'); assert.equal(noWords.id, 'sync_word_timestamps_missing');
  assert.equal(translatedOk.passed, true); assert.equal(translatedOk.syncTarget, 'source_language_srt'); assert.equal(translatedOk.inheritedStart.passed, true);
  assert.equal(translatedShifted.passed, false); assert.equal(translatedShifted.type, 'inherited_mismatch');
  assert.equal(translatedNoSource.status, 'manual_review'); assert.equal(translatedNoSource.id, 'sync_source_srt_missing');

  const withTranscript = await runChecks('subtitle', { path: file('normal') }, { independentTranscript: transcriptOf('normal') });
  const withoutTranscript = await runChecks('subtitle', { path: file('normal') }, {});
  assert.equal(withTranscript.passed, true, JSON.stringify(withTranscript.failures));
  assert.equal(withoutTranscript.passed, false);
  assert.equal(withoutTranscript.failures.some(item => item.id === 'sync_manual_review_required'), true);

  const brief = r => ({ type: r.type, passed: r.passed, status: r.status || null, matchRatio: r.matchRatio, recheckAfterFix: r.recheckAfterFix, correction: r.correction, driftStartBlock: r.driftStartBlock, driftStartSeconds: r.driftStartSeconds, r2: r.r2, totalDriftSeconds: r.totalDriftSeconds, id: r.id, detail: r.detail });
  console.log(JSON.stringify({ normal: brief(normal), offset: brief(offset), drift: brief(drift), linear: brief(linear), corrupt: brief(corrupt), irregular: brief(irregular), missing: brief(missing), noWords: brief(noWords), translatedOk: brief(translatedOk), translatedShifted: brief(translatedShifted), translatedNoSource: brief(translatedNoSource) }, null, 2));
  console.log('sync-drift-stage4-3: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
