'use strict';

// 번역 자막 — Codex 대화방 경로(2026-09-23 준희: "번역 경로 먼저"). 유료 API를 부르지 않는다.
// 외국어 영상 흐름(transcribe/pipeline.js)이 만든 원어 SRT(source.srt)·전사를 받아:
//   1) 원어 블록을 200개씩 나눠 astra-room 브리지에 subtitle_translation_draft 사건으로 올린다
//      (블록 번호·시각은 서버가 쥐고, 대화방은 블록별 한국어 문장만 돌려준다 → 번역 때문에 시각이 밀릴 수 없다)
//   2) 대화방이 [MODE:SUBTITLE_TRANSLATION] + [SUBTITLES_JSON] [{"i":번호,"ko":"한국어"}]로 완료 보고
//   3) 모든 조각이 오면 원어 블록 시각 그대로 한국어 SRT를 만들고, 기계 검사(번역 자막 싱크 포함)를 돌린다
//   4) "준희 확인 대기". 고객에게 보내지 않는다. Jev 내용 대조(유료, 33분 약 27원)는 관리자 경로로 따로.
// 켜는 곳: 정책 transcribe.translationProvider = "codex_room" (기본 hold → 요청을 받지 않는다).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LIMITS = Object.freeze({ chunkBlocks: 200, maxBlocks: 2000, maxKoChars: 120 });
const EVENT_TYPE = 'subtitle_translation_draft';
const clean = value => String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
const parseSrt = file => require('../checks/_srt').parse({ path: file });
const weighted = (text, w) => require('../checks/_srt').weightedLength(text, w);

function instructions({ sourceLanguage, part, parts }) {
  return [
    `이 사건은 ${EVENT_TYPE}(번역 자막 초안, ${part}/${parts}번째 조각)다. 운영 계약의 모드에 더해 이 사건에만 [MODE:SUBTITLE_TRANSLATION]을 쓴다.`,
    '답의 첫 줄은 [MODE:SUBTITLE_TRANSLATION], 그 아래 [SUBTITLES_JSON] 줄, 그 아래 JSON 배열 하나만 쓴다(코드펜스 없이): [{"i":블록번호,"ko":"한국어 자막"}, ...]',
    `payload.blocks의 모든 블록을 빠짐없이, 같은 번호로 하나씩 번역한다(원어: ${sourceLanguage || '자동 감지'} → 한국어). 블록을 합치거나 나누거나 순서를 바꾸지 않는다. 시각은 서버가 원어 그대로 쓴다.`,
    '자막 규칙: 한국 시청자가 읽기 자연스러운 구어체, 한 블록 40자 안팎(두 줄 이내로 서버가 줄바꿈), 말하는 내용만 옮기고 설명을 덧붙이지 않는다. 앞뒤 블록(payload.context)은 흐름 참고용이며 번역하지 않는다.',
    '고유명사·전문용어는 원어 발음대로 적되 확신이 없으면 끝에 "[확인 필요]"를 붙인다. 들리지 않거나 뜻이 불분명한 블록은 원문을 괄호로 두고 "[확인 필요]".',
    '판단이 안 서면 [MODE:NO_ACTION]과 [REASON]으로 돌려준다. 고객에게 보내는 문장은 쓰지 않는다.'
  ].join('\n');
}

// 원어 SRT → 조각별 사건 입력. 같은 원어(내용 해시)는 한 번만 올라간다.
function buildEvents({ jobId, sourceSrtPath, sourceLanguage = '', now = new Date() }) {
  const parsed = parseSrt(sourceSrtPath);
  if (parsed.error) return { ok: false, error: `source_srt:${parsed.error}` };
  const blocks = parsed.blocks.map(b => ({ i: Number(b.number), start: b.start / 1000, end: b.end / 1000, text: clean(b.lines.join(' ')) }));
  if (!blocks.length) return { ok: false, error: 'source_srt_empty' };
  if (blocks.length > LIMITS.maxBlocks) return { ok: false, error: `too_many_blocks:${blocks.length}` };
  const hash = crypto.createHash('sha256').update(JSON.stringify(blocks)).digest('hex').slice(0, 16);
  const parts = Math.ceil(blocks.length / LIMITS.chunkBlocks);
  const events = [];
  for (let k = 0; k < parts; k += 1) {
    const slice = blocks.slice(k * LIMITS.chunkBlocks, (k + 1) * LIMITS.chunkBlocks);
    const before = blocks.slice(Math.max(0, k * LIMITS.chunkBlocks - 2), k * LIMITS.chunkBlocks).map(b => b.text);
    const after = blocks.slice((k + 1) * LIMITS.chunkBlocks, (k + 1) * LIMITS.chunkBlocks + 2).map(b => b.text);
    events.push({
      eventType: EVENT_TYPE,
      caseId: String(jobId),
      idempotencyKey: `subtitle_translation:${jobId}:${hash}:${k + 1}/${parts}`,
      source: 'relay_desk_codex_translation',
      occurredAt: now.toISOString(),
      snapshotVersion: `source:${hash}`,
      payload: { jobId: String(jobId), sourceHash: hash, part: k + 1, parts, sourceLanguage, targetLanguage: 'ko', instructions: instructions({ sourceLanguage, part: k + 1, parts }), context: { before, after }, blocks: slice.map(b => ({ i: b.i, text: b.text })) }
    });
  }
  return { ok: true, blocks: blocks.length, parts, sourceHash: hash, events };
}

// 요청 검사: 정책·대기열 항목·파일. inputAllowed는 서버(transcribe 설정)에서 넘긴다.
function prepareRequest({ policy, state, jobId, inputAllowed = () => true, now = new Date() }) {
  if (String(policy?.transcribe?.translationProvider || 'hold') !== 'codex_room') return { ok: false, status: 409, error: 'translation_provider_not_codex_room' };
  const item = (Array.isArray(state?.translationQueue) ? state.translationQueue : []).find(q => String(q.jobId) === String(jobId || ''));
  if (!item) return { ok: false, status: 404, error: 'translation_queue_item_not_found' };
  if (String(item.targetLanguage || 'ko') !== 'ko') return { ok: false, status: 409, error: 'target_not_korean' };
  for (const p of [item.sourceSrtPath, item.transcriptPath]) {
    if (!p || !inputAllowed(p)) return { ok: false, status: 400, error: 'input_not_allowed' };
    if (!fs.existsSync(p)) return { ok: false, status: 400, error: 'input_missing' };
  }
  const built = buildEvents({ jobId: item.jobId, sourceSrtPath: item.sourceSrtPath, sourceLanguage: item.sourceLanguage, now });
  if (!built.ok) return { ok: false, status: 400, error: built.error };
  return { ok: true, item, ...built };
}

// 브리지가 부르는 답 검사: 조각의 블록 번호와 정확히 맞아야 완료된다.
function checkTranslations(event, translations) {
  if (!Array.isArray(translations)) return 'not_array';
  const want = (event?.payload?.blocks || []).map(b => Number(b.i));
  const got = translations.map(t => Number(t?.i));
  if (got.length !== want.length) return `count:${got.length}/${want.length}`;
  const set = new Set(want);
  if (new Set(got).size !== got.length || got.some(i => !set.has(i))) return 'block_numbers_mismatch';
  if (translations.some(t => typeof t.ko !== 'string' || !clean(t.ko))) return 'empty_ko';
  if (translations.some(t => clean(t.ko).length > LIMITS.maxKoChars)) return 'ko_too_long';
  return null;
}

// 한국어 한 블록 → 최대 2줄(검사와 같은 글자 폭). 못 나누면 한 줄 그대로(기계 검사가 잡는다).
function wrapKo(text, maxChars = 20, weights = {}) {
  const t = clean(text);
  if (weighted(t, weights) <= maxChars) return [t];
  const words = t.split(' ');
  let best = null;
  for (let k = 1; k < words.length; k += 1) {
    const a = words.slice(0, k).join(' '); const b = words.slice(k).join(' ');
    const la = weighted(a, weights); const lb = weighted(b, weights);
    const score = Math.max(la, lb) * 10 + Math.abs(la - lb);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best ? best.lines : [t];
}

const ts = s => { const ms = Math.max(0, Math.round(s * 1000)); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, x = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')},${String(r).padStart(3, '0')}`; };

// 조각이 다 모였으면 한국어 SRT + 기계 검사. 아니면 { ok:false, error:'parts_pending' }.
function assemble({ jobId, events, item, outDir, checkParams = {}, runChecks = null, now = new Date() }) {
  const mine = (events || []).filter(e => e.eventType === EVENT_TYPE && String(e.payload?.jobId) === String(jobId));
  if (!mine.length) return { ok: false, error: 'no_events' };
  const hash = mine[0].payload.sourceHash;
  const current = mine.filter(e => e.payload.sourceHash === hash);
  const parts = Number(current[0].payload.parts);
  const done = current.filter(e => e.status === 'completed' && e.response?.mode === 'SUBTITLE_TRANSLATION');
  const refused = current.filter(e => e.status === 'completed' && e.response?.mode === 'NO_ACTION');
  if (refused.length) return { ok: false, error: 'room_no_action', parts: refused.map(e => e.payload.part) };
  const have = new Set(done.map(e => e.payload.part));
  if (have.size < parts) return { ok: false, error: 'parts_pending', done: have.size, parts };
  const ko = new Map();
  for (const e of done) for (const t of e.response.translations) ko.set(Number(t.i), clean(t.ko));
  const source = parseSrt(item.sourceSrtPath);
  if (source.error) return { ok: false, error: `source_srt:${source.error}` };
  const maxChars = Number(checkParams.maxLineChars ?? 20);
  const weights = { charWeightFullWidth: checkParams.charWeightFullWidth ?? 1, charWeightHalfWidth: checkParams.charWeightHalfWidth ?? 0.5 };
  const missing = source.blocks.filter(b => !ko.has(Number(b.number))).map(b => b.number);
  if (missing.length) return { ok: false, error: 'blocks_missing', missing: missing.slice(0, 20) };
  const srt = source.blocks.map((b, n) => `${n + 1}\n${ts(b.start / 1000)} --> ${ts(b.end / 1000)}\n${wrapKo(ko.get(Number(b.number)), maxChars, weights).join('\n')}`).join('\n\n') + '\n';
  const dir = path.join(outDir, String(jobId).replace(/[^A-Za-z0-9._-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  let v = 1;
  while (fs.existsSync(path.join(dir, `ko_v${v}.srt`))) v += 1;
  const file = path.join(dir, `ko_v${v}.srt`);
  fs.writeFileSync(file, srt);
  const unconfirmed = [...ko.values()].filter(t => /\[확인 필요\]/.test(t)).length;
  let quality = null;
  if (runChecks) {
    try {
      const q = runChecks('subtitle', { path: file }, { independentTranscript: { path: item.transcriptPath }, sourceLanguageSrt: item.sourceSrtPath, translated: true, checkParams });
      quality = { status: q.status, passed: q.passed, failures: (q.failures || []).map(f => ({ id: f.id, status: f.status, detail: String(f.detail || '').slice(0, 200) })) };
    } catch (error) { quality = { status: 'error', detail: String(error.message || error).slice(0, 200) }; }
  }
  const record = { jobId: String(jobId), file, blocks: source.blocks.length, parts, unconfirmed, quality, jevContentCheck: 'manual_route_only', status: 'awaiting_owner_review', assembledAt: now.toISOString() };
  appendLog(outDir, record);
  return { ok: true, ...record };
}

function appendLog(outDir, record) {
  const file = path.join(outDir, 'log.json');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  if (!Array.isArray(list)) list = [];
  list.unshift(record);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list.slice(0, 500), null, 2));
}

function summary(outDir) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(path.join(outDir, 'log.json'), 'utf8')); } catch (_) {}
  if (!Array.isArray(list)) list = [];
  return { awaitingReview: list.filter(r => r.status === 'awaiting_owner_review').length, latest: list.slice(0, 5).map(r => ({ jobId: r.jobId, file: path.basename(r.file || ''), blocks: r.blocks, unconfirmed: r.unconfirmed, quality: r.quality?.status || null, assembledAt: r.assembledAt })) };
}

module.exports = { LIMITS, EVENT_TYPE, instructions, buildEvents, prepareRequest, checkTranslations, wrapKo, assemble, summary };
