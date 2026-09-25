'use strict';

// Jev 내용 대조 한 건 확인(2026-09-23 준희 승인: 33분 건, 130~400초 블록만).
// 번역 자막 블록(한국어)과 같은 시각의 원어 전사를 짝지어 Jev에 "같은 내용인가"를 묻는다.
// 앞·뒤 블록 시각의 원어와도 비교해 "한 칸 밀림"(자막 시각은 맞는데 문장이 한 칸 늦게 들어감)인지 본다.
// - Jev에는 글자만 보낸다(파일명·경로·고객 정보 없음). 이름은 [이름]으로 가린다.
// - 사람이 부를 때만(관리자 경로). 하루 예산 주머니(jev-sim)를 같이 쓰고, 쓴 만큼 기록한다.
// - 전체 결과(글자 포함)는 이 PC의 outDir에만 저장. 응답에는 숫자만.

const fs = require('node:fs');
const path = require('node:path');

const QUESTION = {
  same_content: {
    type: 'noul',
    instructions: 'Does srt_block express the same content as transcript? They may be in different languages. Judge meaning only.',
    criteria: { true: 'same content', false: 'different content' }
  }
};
const DEFAULT_REDACT = ['Sylvie', 'Savare', 'Savaré', '실비', '실비에', '사바르', '사바레', '사바흐'];
const r3 = v => Number(Number(v).toFixed(3));

function redact(text, terms) {
  let out = String(text || '');
  for (const term of terms) {
    if (!term) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), '[이름]');
  }
  return out;
}

function wordsOf(transcript) {
  const words = [];
  for (const segment of transcript.segments || []) {
    const list = Array.isArray(segment.words) && segment.words.length ? segment.words : [{ start: segment.start, end: segment.end, word: segment.text }];
    for (const w of list) if (Number.isFinite(Number(w.start))) words.push({ start: Number(w.start), end: Number(w.end ?? w.start), text: String(w.word || '').trim() });
  }
  return words.sort((a, b) => a.start - b.start);
}

// 시각 구간 [a, b]에 시작하는 원어 단어들
function textInSpan(words, a, b, pad = 0.25) {
  return words.filter(w => w.start >= a - pad && w.start < b + pad).map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
}

function noulOf(body) {
  const a = body?.answers?.same_content ?? body?.same_content;
  const v = Number(a?.noul ?? a?.value ?? a);
  return Number.isFinite(v) ? v : null;
}
const estimateTokens = state => Math.ceil((JSON.stringify(state).length + JSON.stringify(QUESTION).length) / 3) + 50;

function planPairs({ blocks, words, fromSeconds, toSeconds, neighbors = 1, redactTerms = DEFAULT_REDACT }) {
  const inRange = blocks.map((b, i) => ({ ...b, i })).filter(b => b.start >= fromSeconds && b.start <= toSeconds);
  const pairs = [];
  for (const b of inRange) {
    const ko = redact((b.lines || []).join(' ').trim(), redactTerms);
    for (let off = -neighbors; off <= neighbors; off += 1) {
      const other = blocks[b.i + off];
      if (!other) continue;
      const fr = redact(textInSpan(words, other.start, other.end), redactTerms);
      if (!ko || !fr) continue;
      pairs.push({ block: b.number, offset: off, start: r3(b.start), end: r3(b.end), ko, fr });
    }
  }
  return pairs;
}

// 판정: 블록마다 같은 시각(0)과 앞(-1)·뒤(+1) 점수를 비교
function judge(items, margin = 0.2) {
  const byBlock = new Map();
  for (const it of items) {
    if (!byBlock.has(it.block)) byBlock.set(it.block, { block: it.block, start: it.start, end: it.end });
    byBlock.get(it.block)[it.offset === 0 ? 'same' : it.offset < 0 ? 'prev' : 'next'] = it.answer;
  }
  const rows = [...byBlock.values()].sort((a, b) => a.block - b.block).map(row => {
    const same = row.same ?? null, prev = row.prev ?? null, next = row.next ?? null;
    let verdict = 'unclear';
    if (same != null && same >= 0.5 && (prev == null || same >= prev - margin) && (next == null || same >= next - margin)) verdict = 'same_time';
    else if (prev != null && prev >= 0.5 && (same == null || prev > same + margin)) verdict = 'late_one';   // 한국어가 앞 블록 말을 담고 있음 = 한 칸 늦게 들어감
    else if (next != null && next >= 0.5 && (same == null || next > same + margin)) verdict = 'early_one';
    else if ([same, prev, next].every(v => v == null || v < 0.5)) verdict = 'no_match';
    return { ...row, verdict };
  });
  const counts = rows.reduce((acc, r) => { acc[r.verdict] = (acc[r.verdict] || 0) + 1; return acc; }, {});
  // 한 칸 밀림이 시작된 첫 블록: 그 뒤 5블록 중 3개 이상이 late_one인 첫 자리
  let shiftStart = null;
  for (let i = 0; i < rows.length; i += 1) {
    const win = rows.slice(i, i + 5);
    if (rows[i].verdict === 'late_one' && win.filter(r => r.verdict === 'late_one').length >= 3) { shiftStart = { block: rows[i].block, start: rows[i].start }; break; }
  }
  return { rows, counts, shiftStart };
}

async function probe({ srtPath, transcriptPath, fromSeconds, toSeconds, neighbors = 1, maxCalls = 300, redactTerms = DEFAULT_REDACT, getKey, callJev, limitStatus, recordSpend, limits, dataDir, outDir, fetchImpl = global.fetch, concurrency = 4, now = Date.now(), parseImpl = null }) {
  const parse = parseImpl || require('../../checks/_srt').parse;
  const parsed = parse({ path: srtPath });
  if (parsed.error) return { ok: false, error: `srt_parse:${parsed.error}` };
  const blocks = parsed.blocks.map(b => ({ number: b.number, start: b.start / 1000, end: b.end / 1000, lines: b.lines }));
  const words = wordsOf(JSON.parse(fs.readFileSync(transcriptPath, 'utf8')));
  const pairs = planPairs({ blocks, words, fromSeconds, toSeconds, neighbors, redactTerms });
  if (!pairs.length) return { ok: false, error: 'no_pairs' };
  if (pairs.length > maxCalls) return { ok: false, error: 'too_many_calls', planned: pairs.length, maxCalls };
  const key = String(getKey() || '').trim();
  if (!key) return { ok: false, error: 'no_key', planned: pairs.length };
  const estimate = pairs.reduce((s, p) => s + estimateTokens({ srt_block: p.ko, transcript: p.fr }), 0);
  const status = limitStatus(dataDir, limits, now);
  if (status.capReached || estimate > status.remainingTokens) return { ok: false, error: 'daily_budget', planned: pairs.length, estimateTokens: estimate, remainingTokens: status.remainingTokens };

  const items = new Array(pairs.length);
  let next = 0, tokens = 0, calls = 0, errors = 0, authError = null;
  const worker = async () => {
    while (!authError && next < pairs.length) {
      const i = next; next += 1;
      const p = pairs[i];
      const state = { srt_block: p.ko, transcript: p.fr };
      calls += 1;
      try {
        const body = await callJev({ key, questions: QUESTION, state, fetchImpl });
        tokens += Number(body?.usage?.input_tokens) || estimateTokens(state);
        items[i] = { ...p, answer: noulOf(body) };
      } catch (error) {
        tokens += estimateTokens(state); errors += 1;
        if ([401, 403].includes(error.status)) authError = error;
        items[i] = { ...p, answer: null, error: error.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker));
  const price = Number(limits?.usdPerMillionInputTokens) || 0.042;
  const krwPerUsd = Number(limits?.krwPerUsd) || 0;
  const krw = krwPerUsd ? Math.round(tokens * price / 1e6 * krwPerUsd * 100) / 100 : null;
  if (calls && dataDir && recordSpend) recordSpend(dataDir, { calls, tokens, krw, price, now });
  const done = items.filter(Boolean);
  const verdict = judge(done);
  let savedPath = null;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    savedPath = path.join(outDir, `jevprobe-${Date.now()}.json`);
    fs.writeFileSync(savedPath, JSON.stringify({ srtPath, transcriptPath, fromSeconds, toSeconds, checkedAt: new Date(now).toISOString(), calls, tokens, krw, errors, items: done, verdict }, null, 2));
  }
  return {
    ok: !authError, error: authError ? `jev_auth:${authError.status}` : null,
    calls, tokens, krw, errors, savedPath,
    counts: verdict.counts, shiftStart: verdict.shiftStart,
    rows: verdict.rows.map(r => [r.block, r.start, r.same ?? null, r.prev ?? null, r.next ?? null, r.verdict])
  };
}

module.exports = { QUESTION, DEFAULT_REDACT, redact, wordsOf, textInSpan, planPairs, judge, probe };
