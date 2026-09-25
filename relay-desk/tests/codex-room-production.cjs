'use strict';

// Codex 대화방(구독) 제작 경로(2026-09-23 지시 4). 가짜 브리지(임시 폴더)만 쓰고 외부 호출은 0회.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let fetchCalls = 0;
global.fetch = async () => { fetchCalls += 1; throw new Error('network_disabled_in_test'); };

const { createAstraRoomBridge, parseFields } = require('../server/astra-room-bridge');
const codexRoom = require('../server/production-codex-room');
const { PRODUCTION_PROVIDERS, readOperatingPolicy } = require('../server/operating-policy');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-room-production-'));
const bridge = createAstraRoomBridge({ dataFile: path.join(root, 'data.json'), configFile: path.join(root, 'config.json') });
const post = { id: 'POST-TEST-PPT-1', taskId: 'TASK-TEST-PPT-1', lane: 'soomgo_fulfillment', status: '대기', title: '시범사업 결과 보고 PPT', manuscript: '1. 추진 배경\n2. 운영 결과\n3. 확대 계획' };
const state = { promptPosts: [post] };
const deck = JSON.stringify({ meta: { title: '시범사업 결과 보고', date: '2026.09.23' }, slides: [{ type: 'cover' }, { type: 'agenda', items: ['배경', '결과'] }, { type: 'text', headline: '요약', bullets: ['가', '나'] }, { type: 'closing' }] });

// 1) 정책 값: codex_room 허용, 실제 정책은 hold 유지
assert.ok(PRODUCTION_PROVIDERS.includes('codex_room'));
assert.equal(readOperatingPolicy().production.provider, 'hold', '정책 production.provider는 hold 유지');

// 2) 대기 게시물 → production_draft 사건 1건(대화방 1턴)
const dispatched = codexRoom.dispatchWaitingPosts(bridge, state, { isProductionPost: p => p.lane === 'soomgo_fulfillment', maxRequests: 3 });
assert.equal(dispatched.length, 1);
assert.equal(dispatched[0].queued, true);
assert.equal(dispatched[0].paidCalls, 0);
const event = dispatched[0].event;
assert.equal(event.eventType, 'production_draft');
assert.equal(event.payload.turns, 1);
assert.equal(event.payload.template, 't1-report');
assert.match(event.payload.manuscript, /추진 배경/);
assert.equal(post.status, '대화방 제작 대기');
// 열린 사건이 있으면 다시 올리지 않음, 대기 상태가 아니면 건너뜀
assert.equal(codexRoom.dispatchWaitingPosts(bridge, state, { isProductionPost: () => true }).length, 0);
assert.equal(codexRoom.enqueueProductionDraft(bridge, { post, maxRequests: 3 }).reason, 'codex_room_draft_open');

// 3) 결과 수신: 형식 틀린 JSON은 거절, 올바른 슬라이드 JSON은 게시물에 붙고 준희 확인 대기
assert.throws(() => parseFields('[MODE:PRODUCTION_DRAFT]\n[SLIDES_JSON]\n{"meta":{"title":"x"},"slides":[{"type":"unknown"}]}'), /slide_type_invalid/);
assert.throws(() => parseFields('[MODE:PRODUCTION_DRAFT]\n[SLIDES_JSON]\n{not json'), /slides_json_invalid/);
bridge.claim(event.eventId, 'test-room');
const done = bridge.complete(event.eventId, `[MODE:PRODUCTION_DRAFT]\n[SLIDES_JSON]\n\`\`\`json\n${deck}\n\`\`\``);
assert.equal(done.event.response.slides.slides.length, 4);
assert.equal(done.event.deliveryStatus, 'not_applicable', '제작 초안은 고객 발송 대상이 아님');
assert.equal(bridge.outbox().length, 0);
assert.equal(codexRoom.attachCompletedDrafts(bridge, state), 1);
assert.equal(codexRoom.attachCompletedDrafts(bridge, state), 0, '같은 결과 중복 부착 없음');
assert.equal(post.codexRoomDraft.slideCount, 4);
assert.equal(post.codexRoomDraft.review, 'manual_pending');
assert.equal(post.status, '최종 확인 대기');
assert.equal(codexRoom.codexRoomDraftAttention(state, { sinceMs: 0 }).fresh.length, 1);

// 4) 재요청 상한 3회
post.status = '대기';
const second = codexRoom.enqueueProductionDraft(bridge, { post, maxRequests: 3 });
assert.equal(second.queued, true);
assert.equal(second.event.payload.attempt, 2);
bridge.fail(second.event.eventId, 'test_fail');
const third = codexRoom.enqueueProductionDraft(bridge, { post, maxRequests: 3 });
assert.equal(third.queued, true);
bridge.fail(third.event.eventId, 'test_fail');
const fourth = codexRoom.enqueueProductionDraft(bridge, { post, maxRequests: 3 });
assert.equal(fourth.queued, false);
assert.equal(fourth.reason, 'codex_room_request_limit');
assert.equal(bridge.list({ eventType: 'production_draft' }).length, 3);
assert.equal(codexRoom.maxRequestsFrom({}), 3);
assert.equal(codexRoom.maxRequestsFrom({ production: { codexRoomMaxRequests: 2 } }), 2);

// 5) 서버 연결: /api/run의 codex_room 분기가 유료 호출 앞에서 202로 끝남, 자동 대기열도 브리지로
const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
const branch = source.indexOf("productionLaneProvider === 'codex_room'");
assert.ok(branch > 0 && branch < source.indexOf('const forcedAstraProduction = productionLane'), 'codex_room 분기는 유료 제공자 선택보다 앞');
assert.match(source, /queued\.queued \? 202 : 409, \{ ok: queued\.queued, provider: 'codex_room', paidCalls: 0/);
assert.match(source, /holdState\.provider === 'codex_room'[\s\S]{0,400}dispatchWaitingPosts\(astraRoomBridge/);
assert.match(source, /completed\.event\?\.eventType === 'production_draft'[\s\S]{0,200}attachCompletedDrafts/);
require('../server/relay-server');

assert.equal(fetchCalls, 0, '유료·외부 호출 0회');
fs.rmSync(root, { recursive: true, force: true });
console.log('codex-room-production: PASS');
