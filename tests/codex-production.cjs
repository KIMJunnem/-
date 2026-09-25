'use strict';

// PPT 제작 — Codex 대화방 경로(2026-09-23). 브리지 사건·답 검사·PPTX 만들기. 외부 호출·유료 API 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const cp = require('../server/codex-production');
const { createAstraRoomBridge } = require('../server/astra-room-bridge');
const { selectDesignType } = require('../server/presentation-design');
const root = path.join(__dirname, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-prod-'));
(async () => {
  try {
    const bridge = createAstraRoomBridge({ dataFile: path.join(tmp, 'bridge.json'), configFile: path.join(tmp, 'bridge-config.json') });
    const post = { id: 'POST-PPT-1', taskId: 'PPT-1', lane: 'soomgo_fulfillment', title: 'PPT-1 AI 작성 지시', prompt: '서비스: PPT 제작\n파일 형식: PPTX' };
    const state = { tasks: [{ id: 'PPT-1', quote: { label: 'PPT 제작', serviceId: 'presentation' } }, { id: 'DOC-1', quote: { label: '일반 문서·글 작성' } }], promptPosts: [post, { id: 'POST-DOC-1', taskId: 'DOC-1', lane: 'soomgo_fulfillment', title: '문서', prompt: '서비스: 문서/글 작성' }, { ...post, id: 'POST-PPT-FINAL', astraFinalReview: true }] };
    const manuscript = '3분기 실적 보고. 매출은 전년 대비 늘었고 비용은 줄었다. '.repeat(10);
    const codex = { production: { provider: 'codex_room' } };
    const ask = (over = {}) => cp.prepareRequest({ policy: codex, state, postId: 'POST-PPT-1', manuscript, typeId: 'corporate_internal', selectDesignType, ...over });

    // 켜지 않았으면 받지 않음 / 게시물·원고·유형 검사
    assert.equal(cp.prepareRequest({ policy: { production: { provider: 'hold' } }, state, postId: 'POST-PPT-1', manuscript }).error, 'provider_not_codex_room');
    assert.equal(ask({ postId: 'NONE' }).error, 'prompt_post_not_found');
    assert.equal(ask({ postId: 'POST-DOC-1' }).error, 'not_presentation_post', 'PPT만');
    assert.equal(ask({ postId: 'POST-PPT-FINAL' }).error, 'final_review_post');
    assert.equal(ask({ manuscript: '짧음' }).error, 'manuscript_too_short');
    assert.equal(ask({ typeId: 'proposal' }).error, 'template_not_ready', 'T2 유형은 아직 없음');
    assert.equal(ask({ typeId: '', manuscript: `대표님께 드리는 3분기 실적 보고 ${manuscript}` }).typeId, 'corporate_internal', '유형 자동 고르기');
    const ok = ask();
    assert.equal(ok.ok, true);
    assert.equal(ok.event.eventType, 'production_draft');
    assert.match(ok.event.payload.instructions, /\[MODE:PRODUCTION_DRAFT\]/);
    assert.match(ok.event.payload.instructions, /원고에 없는 숫자·사실/);

    // 브리지: 같은 원고는 한 번만
    const q1 = bridge.enqueue(ok.event); const q2 = bridge.enqueue(ask().event);
    assert.equal(q1.duplicate, false); assert.equal(q2.duplicate, true);
    const id = q1.event.eventId;
    bridge.claim(id, 'codex-test');

    // 답 검사: 모드 불일치·JSON 오류는 완료되지 않음
    assert.throws(() => bridge.complete(id, '[MODE:CUSTOMER_REPLY]\n[DECISION:WAIT]'), /astra_room_mode_mismatch/);
    assert.throws(() => bridge.complete(id, '[MODE:PRODUCTION_DRAFT]\n[SLIDES_JSON]\n{깨진 json'), /astra_room_slides_json_invalid/);
    assert.throws(() => bridge.complete(id, '[MODE:PRODUCTION_DRAFT]\n[SLIDES_JSON]\n'), /astra_room_slides_json_missing/);
    const other = bridge.enqueue({ eventType: 'customer_message', caseId: 'C1', idempotencyKey: 'c1' }).event.eventId;
    assert.throws(() => bridge.complete(other, '[MODE:PRODUCTION_DRAFT]\n[SLIDES_JSON]\n{"slides":[]}'), /astra_room_mode_mismatch/, '고객 사건에는 제작 초안 모드 불가');

    // 정상 답(가상 샘플 JSON, 코드펜스 붙여도 받음) → PPTX
    const sample = JSON.parse(fs.readFileSync(path.join(root, 'services', 'presentation-design', 'templates', 'sample-corporate-internal.json'), 'utf8'));
    const done = bridge.complete(id, `[MODE:PRODUCTION_DRAFT]\n[SLIDES_JSON]\n\`\`\`json\n${JSON.stringify(sample, null, 1)}\n\`\`\``);
    assert.equal(done.event.status, 'completed'); assert.equal(done.event.deliveryStatus, 'not_applicable', '고객 발송 대상 아님');
    assert.equal(bridge.outbox().length, 0, '발송함에 안 올라감');
    const outDir = path.join(tmp, 'productions');
    const { runChecks } = require('../server/quality-runner');
    const r = await cp.render({ event: done.event, outDir, now: new Date('2026-09-23T05:00:00Z'), runChecks });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(fs.existsSync(r.file)); assert.equal(fs.readFileSync(r.file).subarray(0, 2).toString(), 'PK', 'PPTX(zip)');
    assert.match(path.basename(r.file), /_20260923_v1\.pptx$/);
    assert.equal(r.status, 'awaiting_owner_review'); assert.equal(r.fontsEmbedded, true, r.fontError || '글꼴 넣기');
    assert.ok(fs.readdirSync(path.dirname(r.file)).every(n => !n.includes('nofont')), '중간 파일 남기지 않음');
    assert.equal(r.quality.status, 'manual_review', JSON.stringify(r.quality)); // 주문 장수(pages) 없으면 장수 검사는 사람 확인
    assert.deepEqual(r.quality.failures.map(f => f.id), ['pptx_slide_count']);
    assert.match(ok.event.payload.instructions, /플러그인을 적극 활용해서 만들 것/);
    const r2 = await cp.render({ event: done.event, outDir, now: new Date('2026-09-23T05:00:00Z') });
    assert.match(path.basename(r2.file), /_v2\.pptx$/, '덮어쓰지 않고 버전 올림');
    assert.equal(cp.summary(outDir).awaitingReview, 2);

    // NO_ACTION 답은 완료되지만 만들지 않음 / 슬라이드 종류 오류는 만들지 않음
    const e2 = bridge.enqueue(ask({ manuscript: `${manuscript} 추가` }).event).event.eventId;
    const na = bridge.complete(e2, '[MODE:NO_ACTION]\n[REASON]\n원고 없음');
    assert.equal((await cp.render({ event: na.event, outDir })).error, 'draft_not_ready');
    const bad = cp.validateSlides({ meta: { title: 't' }, slides: [{ type: 'cover' }, { type: 'video' }, { type: 'closing', headline: '가'.repeat(30) }] });
    assert.equal(bad.ok, false); assert.ok(bad.errors.includes('slide_2_type:video')); assert.ok(bad.warnings.includes('slide_3_headline_over_25'));

    // 유료 API·외부 호출을 부르지 않는 모듈, 서버 경로는 로컬 전용·전용 헤더
    const mod = fs.readFileSync(path.join(root, 'server', 'codex-production.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/runOpenAI|runClaude|runGemini|fetch\(|https?:\/\//.test(mod), '유료 API·네트워크 없음');
    const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
    const i = server.indexOf("pathname.startsWith('/api/admin/codex-production/')"); assert.ok(i > 0);
    const block = server.slice(i, i + 600); assert.match(block, /if \(!local\)/); assert.match(block, /'codex-production'/);
    assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^server\/data\/productions\/$/m, '결과 PPTX는 저장소 밖');
    const op = fs.readFileSync(path.join(root, 'server', 'operating-policy.js'), 'utf8');
    assert.match(op, /if \(value === 'codex_room'\) return \{ provider: 'hold', hold: true, reason: 'codex_room'/, 'API 제작 lane은 hold와 같음');
    assert.equal(netCalls, 0);
    console.log('codex-production: PASS');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
