'use strict';

// 전사 단어 시각으로 SRT 초안 만들기(2026-09-22, T-4). 기준은 services/subtitle.json checkParams:
//   한 줄 maxLineChars(20, 전각 1·반각 0.5), 최대 maxLines(2)줄, 초당 글자 수 maxCps(15), 노출 minDurationSeconds(0.8)~maxDurationSeconds(7.0)초.
// 끊는 위치: 단어 사이에서만 끊는다. 문장 끝(. ? !)은 항상 끊고, 쉼표는 한 줄이 찼을 때, 말이 1초 넘게 쉬면 끊는다.
// 노출 시간: 시작은 첫 단어 시작 그대로 두고(싱크 기준), 끝만 최소 노출·초당 글자 수를 맞추도록 다음 블록 시작 전까지 늘린다.

// 글자 폭 계산은 기계 검사와 같은 checks/_srt.js를 쓴다. 서버만 복사한 환경(일부 테스트)을 위해 쓸 때 불러온다.
const weightedLength = (text, p) => require('../../checks/_srt').weightedLength(text, p);

const PAUSE_BREAK_SECONDS = 1.0;
const NO_SPACE_LANGUAGES = new Set(['ja', 'zh', 'th']);

function params(checkParams = {}) {
  return {
    maxChars: Number(checkParams.maxLineChars ?? 20),
    maxLines: Number(checkParams.maxLines ?? 2),
    maxCps: Number(checkParams.maxCps ?? 15),
    minDur: Number(checkParams.minDurationSeconds ?? 0.8),
    maxDur: Number(checkParams.maxDurationSeconds ?? 7.0),
    weights: { charWeightFullWidth: checkParams.charWeightFullWidth ?? 1, charWeightHalfWidth: checkParams.charWeightHalfWidth ?? 0.5 }
  };
}

// transcript.json → 단어 목록. 단어 시각이 없으면 구간을 공백 기준으로 나눠 글자 수 비례로 시각을 나눈다.
function wordsFromTranscript(transcript) {
  const out = [];
  for (const seg of transcript?.segments || []) {
    const words = Array.isArray(seg.words) ? seg.words.filter(w => String(w.word ?? w.text ?? '').trim()) : [];
    if (words.length) { for (const w of words) out.push({ start: Number(w.start), end: Number(w.end), text: String(w.word ?? w.text).trim() }); continue; }
    const parts = String(seg.text || '').trim().split(/\s+/).filter(Boolean);
    const total = parts.reduce((a, p) => a + p.length, 0) || 1;
    let t = Number(seg.start); const span = Number(seg.end) - Number(seg.start);
    for (const p of parts) { const d = span * p.length / total; out.push({ start: t, end: t + d, text: p, estimated: true }); t += d; }
  }
  return out.filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
}

const joinWords = (words, lang) => words.map(w => w.text).join(NO_SPACE_LANGUAGES.has(lang) ? '' : ' ');
const len = (text, p) => weightedLength(String(text).trim(), p.weights);

// 단어들을 최대 maxLines줄로 나눈다. 못 나누면 null. 두 줄이면 길이가 비슷하고 문장부호 뒤를 우선.
function wrap(words, p, lang) {
  const whole = joinWords(words, lang);
  if (len(whole, p) <= p.maxChars) return [whole];
  if (p.maxLines < 2) return null;
  let best = null;
  for (let k = 1; k < words.length; k += 1) {
    const a = joinWords(words.slice(0, k), lang); const b = joinWords(words.slice(k), lang);
    const la = len(a, p); const lb = len(b, p);
    if (la > p.maxChars || lb > p.maxChars) continue;
    const score = Math.abs(la - lb) - (/[.?!,。、]$/.test(words[k - 1].text) ? p.maxChars : 0);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best ? best.lines : null;
}

// 한 단어가 한 줄보다 길면 글자 단위로 잘라 여러 단어로 만든다(드묾).
function splitLongWord(w, p) {
  if (len(w.text, p) <= p.maxChars) return [w];
  const chars = [...w.text]; const pieces = []; let cur = '';
  for (const ch of chars) { if (len(cur + ch, p) > p.maxChars) { pieces.push(cur); cur = ''; } cur += ch; }
  if (cur) pieces.push(cur);
  const span = (w.end - w.start) / pieces.length;
  return pieces.map((text, i) => ({ start: w.start + span * i, end: w.start + span * (i + 1), text }));
}

function buildBlocks(transcript, checkParams = {}, { language = transcript?.language || '' } = {}) {
  const p = params(checkParams);
  const words = wordsFromTranscript(transcript).flatMap(w => splitLongWord(w, p));
  const blocks = []; let cur = [];
  const close = () => { if (cur.length) blocks.push({ words: cur }); cur = []; };
  for (const w of words) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const candidate = [...cur, w];
      const tooLong = !wrap(candidate, p, language);
      const tooSlow = w.end - cur[0].start > p.maxDur;
      const pause = w.start - last.end >= PAUSE_BREAK_SECONDS;
      if (tooLong || tooSlow || pause) close();
    }
    cur.push(w);
    const text = joinWords(cur, language);
    if (/[.?!。？！]$/.test(w.text)) close();
    else if (/[,，、]$/.test(w.text) && len(text, p) >= p.maxChars) close();
  }
  close();
  // 시각: 시작 = 첫 단어 시작. 끝 = 마지막 단어 끝을 최소 노출·초당 글자 수에 맞게 늘림(다음 블록 시작·최대 노출 넘지 않게).
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    b.lines = wrap(b.words, p, language) || [joinWords(b.words, language)];
    b.text = b.lines.join(' ');
    b.start = b.words[0].start;
    const chars = b.lines.reduce((a, l) => a + len(l, p), 0);
    const need = Math.max(p.minDur, chars / p.maxCps);
    const limit = Math.min(i + 1 < blocks.length ? blocks[i + 1].words[0].start : Infinity, b.start + p.maxDur);
    b.end = Math.min(Math.max(b.words[b.words.length - 1].end, b.start + need), limit);
    if (!(b.end > b.start)) b.end = b.start + 0.001;
  }
  return blocks;
}

function ts(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, x = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`;
}
function toSrt(blocks) { return blocks.map((b, i) => `${i + 1}\n${ts(b.start)} --> ${ts(b.end)}\n${b.lines.join('\n')}`).join('\n\n') + '\n'; }

// 싱크 검사용 독립 전사: 블록 크기로 묶은 구간(시각은 전사 단어 시각 그대로, 늘린 노출 시간은 넣지 않음).
// sync_drift는 자막 블록과 전사 구간을 1:1로 대조하므로 문장 전체 구간보다 블록 크기 구간이 맞다.
function checksTranscript(blocks, meta = {}) {
  return {
    engine: meta.engine || 'faster-whisper', language: meta.language || null, derivedFrom: meta.derivedFrom || null, grouping: 'subtitle_block',
    segments: blocks.map((b, i) => ({ id: i + 1, start: b.words[0].start, end: b.words[b.words.length - 1].end, text: b.text, words: b.words.map(w => ({ start: w.start, end: w.end, word: w.text })) }))
  };
}

module.exports = { PAUSE_BREAK_SECONDS, params, wordsFromTranscript, wrap, buildBlocks, toSrt, checksTranscript };
