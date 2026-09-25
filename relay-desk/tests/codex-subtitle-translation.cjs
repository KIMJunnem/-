'use strict';

// 번역 자막 — Codex 대화방 경로(2026-09-23). 조각 나누기·답 검사·한국어 SRT 조립(원어 시각 그대로)·기계 검사. 외부 호출·유료 API 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const ct = require('../server/codex-subtitle-translation');
const { createAstraRoomBridge } = require('../server/astra-room-bridge');
const { runChecks } = require('../server/quality-runner');
const { parse } = require('../checks/_srt');
const root = path.join(__dirname, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-tr-'));
const stamp = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, x = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')},${String(r).padStart(3, '0')}`; };
(async () => {
  try {
    const N = 450;
    const sourceSrtPath = path.join(tmp, 'source.srt');
    fs.writeFileSync(sourceSrtPath, Array.from({ length: N }, (_, i) => `${i + 1}\n${stamp(i * 3 + 0.25)} --> ${stamp(i * 3 + 2.5)}\nsentence number ${i + 1}`).join('\n\n') + '\n');
    const transcriptPath = path.join(tmp, 'transcript.json');
    fs.writeFileSync(transcriptPath, JSON.stringify({ language: 'en', segments: Array.from({ length: N }, (_, i) => ({ id: i + 1, start: i * 3 + 0.25, end: i * 3 + 2.4, text: `sentence number ${i + 1}`, words: [{ start: i * 3 + 0.25, end: i * 3 + 1.2, word: 'sentence' }, { start: i * 3 + 1.2, end: i * 3 + 1.8, word: 'number' }, { start: i * 3 + 1.8, end: i * 3 + 2.4, word: `${i + 1}` }] })) }));
    const state = { translationQueue: [{ id: 'TQ-J1', jobId: 'J1', workflowId: 'W1', sourceLanguage: 'en', sourceSrtPath, transcriptPath, targetLanguage: 'ko', status: 'waiting_c2' }] };
    const on = { transcribe: { translationProvider: 'codex_room' } };

    // 켜기 전·없는 항목·허용 폴더 밖
    assert.equal(ct.prepareRequest({ policy: { transcribe: {} }, state, jobId: 'J1' }).error, 'translation_provider_not_codex_room', '기본 hold');
    assert.equal(ct.prepareRequest({ policy: on, state, jobId: 'NONE' }).error, 'translation_queue_item_not_found');
    assert.equal(ct.prepareRequest({ policy: on, state, jobId: 'J1', inputAllowed: () => false }).error, 'input_not_allowed');
    const policyFile = JSON.parse(fs.readFileSync(path.join(root, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));
    assert.equal(policyFile.transcribe.translationProvider, 'hold', '정책 기본값은 꺼짐');

    // 200블록씩 3조각, 같은 원어는 한 번만
    const req = ct.prepareRequest({ policy: on, state, jobId: 'J1' });
    assert.equal(req.ok, true); assert.equal(req.blocks, N); assert.equal(req.parts, 3);
    assert.deepEqual(req.events.map(e => e.payload.blocks.length), [200, 200, 50]);
    assert.match(req.events[0].payload.instructions, /\[MODE:SUBTITLE_TRANSLATION\]/);
    assert.match(req.events[0].payload.instructions, /합치거나 나누거나/);
    assert.deepEqual(req.events[1].payload.context.before, ['sentence number 199', 'sentence number 200'], '앞 조각 끝 두 줄은 참고용');
    assert.ok(!('start' in req.events[0].payload.blocks[0]), '대화방에는 시각을 보내지 않음(서버가 쥠)');
    const bridge = createAstraRoomBridge({ dataFile: path.join(tmp, 'bridge.json'), configFile: path.join(tmp, 'bridge-config.json') });
    const ids = req.events.map(e => bridge.enqueue(e).event.eventId);
    assert.equal(bridge.enqueue(ct.prepareRequest({ policy: on, state, jobId: 'J1' }).events[0]).duplicate, true);

    const answer = e => JSON.stringify(e.payload.blocks.map(b => ({ i: b.i, ko: b.i === 7 ? '고유명사 스미스 씨가 말한 문장입니다 [확인 필요]' : `${b.i}번째 문장입니다` })));
    const ev = id => bridge.get(id);
    // 답 검사: 개수·번호·모드
    assert.throws(() => bridge.complete(ids[0], `[MODE:SUBTITLE_TRANSLATION]\n[SUBTITLES_JSON]\n${JSON.stringify([{ i: 1, ko: '하나' }])}`), /astra_room_translation_mismatch:count/);
    const shifted = JSON.stringify(ev(ids[0]).payload.blocks.map(b => ({ i: b.i + 1, ko: '밀린 번호' })));
    assert.throws(() => bridge.complete(ids[0], `[MODE:SUBTITLE_TRANSLATION]\n[SUBTITLES_JSON]\n${shifted}`), /block_numbers_mismatch/, '번호가 한 칸 밀리면 거절');
    assert.throws(() => bridge.complete(ids[0], '[MODE:PRODUCTION_DRAFT]\n[SLIDES_JSON]\n{"slides":[]}'), /astra_room_mode_mismatch/);
    assert.throws(() => bridge.complete(ids[0], '[MODE:SUBTITLE_TRANSLATION]\n[SUBTITLES_JSON]\n{깨짐'), /astra_room_subtitles_json_invalid/);
    const cust = bridge.enqueue({ eventType: 'customer_message', caseId: 'C', idempotencyKey: 'c' }).event.eventId;
    assert.throws(() => bridge.complete(cust, '[MODE:SUBTITLE_TRANSLATION]\n[SUBTITLES_JSON]\n[]'), /astra_room_mode_mismatch/, '고객 사건에는 번역 모드 불가');

    // 한 조각만 오면 대기
    bridge.complete(ids[0], `[MODE:SUBTITLE_TRANSLATION]\n[SUBTITLES_JSON]\n\`\`\`json\n${answer(ev(ids[0]))}\n\`\`\``);
    const outDir = path.join(tmp, 'translations');
    const seen = [];
    const spyChecks = (id, deliverable, context) => { seen.push({ id, context }); return runChecks(id, deliverable, context); };
    let r = ct.assemble({ jobId: 'J1', events: bridge.list({ eventType: ct.EVENT_TYPE, limit: 50 }), item: state.translationQueue[0], outDir, runChecks: spyChecks });
    assert.equal(r.error, 'parts_pending'); assert.equal(r.done, 1);
    for (const id of ids.slice(1)) bridge.complete(id, `[MODE:SUBTITLE_TRANSLATION]\n[SUBTITLES_JSON]\n${answer(ev(id))}`);
    assert.equal(bridge.outbox().length, 0, '발송함에 안 올라감');
    r = ct.assemble({ jobId: 'J1', events: bridge.list({ eventType: ct.EVENT_TYPE, limit: 50 }), item: state.translationQueue[0], outDir, checkParams: { maxLineChars: 20 }, runChecks: spyChecks });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.status, 'awaiting_owner_review'); assert.equal(r.unconfirmed, 1); assert.equal(r.jevContentCheck, 'manual_route_only');
    // 시각은 원어 그대로, 블록 수 같음, 두 줄 이내
    const ko = parse({ path: r.file }); const src = parse({ path: sourceSrtPath });
    assert.equal(ko.blocks.length, N);
    assert.deepEqual(ko.blocks.map(b => [b.start, b.end]), src.blocks.map(b => [b.start, b.end]), '번역 때문에 시각이 바뀌지 않음');
    assert.equal(ko.blocks[9].lines.join(' '), '10번째 문장입니다');
    assert.ok(ko.blocks.every(b => b.lines.length <= 2));
    assert.deepEqual(ct.wrapKo('고유명사 스미스 씨가 말한 문장입니다 [확인 필요]', 20).length, 2);
    // 기계 검사: 번역 자막 모드(원어 SRT·독립 전사 함께)로 실제 검사기를 돌림
    assert.equal(seen.length, 1); assert.equal(seen[0].context.translated, true); assert.equal(seen[0].context.sourceLanguageSrt, sourceSrtPath);
    assert.ok(r.quality && typeof r.quality.status === 'string', JSON.stringify(r.quality));
    assert.equal(ct.summary(outDir).awaitingReview, 1);
    // 두 번째 조립은 덮어쓰지 않고 v2
    const r2 = ct.assemble({ jobId: 'J1', events: bridge.list({ eventType: ct.EVENT_TYPE, limit: 50 }), item: state.translationQueue[0], outDir });
    assert.match(path.basename(r2.file), /ko_v2\.srt$/);

    // 대화방이 NO_ACTION이면 조립하지 않음
    const st2 = { translationQueue: [{ ...state.translationQueue[0], jobId: 'J2' }] };
    const req2 = ct.prepareRequest({ policy: on, state: st2, jobId: 'J2' });
    const id2 = bridge.enqueue(req2.events[0]).event.eventId;
    bridge.complete(id2, '[MODE:NO_ACTION]\n[REASON]\n음성이 안 들림');
    assert.equal(ct.assemble({ jobId: 'J2', events: bridge.list({ eventType: ct.EVENT_TYPE, limit: 50 }), item: st2.translationQueue[0], outDir }).error, 'room_no_action');

    // 유료 API·네트워크 없음, 서버 경로는 로컬 전용·전용 헤더
    const mod = fs.readFileSync(path.join(root, 'server', 'codex-subtitle-translation.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/runOpenAI|runClaude|runGemini|callJev|fetch\(|https?:\/\//.test(mod), '유료 API·네트워크 없음');
    const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
    const i = server.indexOf("pathname.startsWith('/api/admin/codex-translation/')"); assert.ok(i > 0);
    const block = server.slice(i, i + 600); assert.match(block, /if \(!local\)/); assert.match(block, /'codex-translation'/);
    assert.equal(netCalls, 0);
    console.log('codex-subtitle-translation: PASS');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
