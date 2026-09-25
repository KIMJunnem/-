'use strict';

// Codex 대화방(구독) 제작 경로 (2026-09-23 지시 4, decisions.md 1번 PPT 행).
// production.provider가 'codex_room'이면 유료 API를 부르지 않고 astra-room-bridge에
// production_draft 사건을 올린다. 대화방이 [MODE:PRODUCTION_DRAFT] + [SLIDES_JSON]으로
// 돌려주면 게시물에 붙이고 준희 확인 대기(finalGrade manual)로 둔다. 고객 전달은 하지 않는다.
// - 사건 1건 = 대화방 1턴(payload.turns = 1)
// - 같은 게시물 재요청 상한: 기본 3회(정책 production.codexRoomMaxRequests가 있으면 그 값)
// - 열린(pending·dispatched) 사건이 있으면 새로 올리지 않는다

const DEFAULT_MAX_REQUESTS = 3;
const OPEN_STATUSES = new Set(['pending', 'dispatched']);
const WAITING = new Set(['게시됨', '대기', '인수인계 대기', '예약됨', '', '보류']);
const clean = (value, max = 20000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);

function maxRequestsFrom(policy) {
  const value = Number(policy?.production?.codexRoomMaxRequests);
  return Number.isInteger(value) && value > 0 && value <= 10 ? value : DEFAULT_MAX_REQUESTS;
}

function caseIdFor(post = {}) {
  return `production:${clean(post.id, 200)}`;
}

function draftEventsFor(bridge, post) {
  const caseId = caseIdFor(post);
  return bridge.list({ eventType: 'production_draft', limit: 500 }).filter(event => event.caseId === caseId);
}

// 원고·요청 요약만 싣는다. 고객 이름·연락처 필드는 넣지 않는다.
function draftInput(post = {}, workflow = null) {
  const manuscript = clean(post.manuscript || post.sourceText || workflow?.manuscriptText || post.prompt || post.body || '', 20000);
  const requestSummary = clean(post.requestSummary || workflow?.request?.summary || workflow?.request?.purpose || post.title || '', 1000);
  return { manuscript, requestSummary };
}

function enqueueProductionDraft(bridge, { post, workflow = null, maxRequests = DEFAULT_MAX_REQUESTS, now = new Date() } = {}) {
  if (!post || !post.id) throw new Error('codex_room_post_required');
  const existing = draftEventsFor(bridge, post);
  const open = existing.find(event => OPEN_STATUSES.has(event.status));
  if (open) return { queued: false, reason: 'codex_room_draft_open', event: open, requestCount: existing.length, maxRequests, paidCalls: 0 };
  if (existing.length >= maxRequests) return { queued: false, reason: 'codex_room_request_limit', requestCount: existing.length, maxRequests, paidCalls: 0 };
  const attempt = existing.length + 1;
  const caseId = caseIdFor(post);
  const { manuscript, requestSummary } = draftInput(post, workflow);
  const result = bridge.enqueue({
    eventType: 'production_draft',
    caseId,
    idempotencyKey: `${caseId}:draft:${attempt}`,
    source: 'relay_desk',
    occurredAt: now.toISOString(),
    snapshotVersion: `${clean(post.id, 120)}:${attempt}`,
    payload: {
      postId: String(post.id),
      taskId: String(post.taskId || ''),
      workflowId: workflow?.id || null,
      serviceId: 'presentation',
      template: 't1-report',
      attempt,
      maxRequests,
      turns: 1,
      requestSummary,
      manuscript,
      output: 't1-report 슬라이드 JSON {meta:{title,...}, slides:[{type,...}]}',
      responseFormat: '[MODE:PRODUCTION_DRAFT]\n[SLIDES_JSON]\n{...}'
    }
  });
  return { queued: !result.duplicate, duplicate: result.duplicate, event: result.event, requestCount: attempt, maxRequests, paidCalls: 0 };
}

// 완료된 production_draft 결과를 게시물에 붙인다. 바뀌면 붙인 수를 돌려준다.
function attachCompletedDrafts(bridge, state, now = new Date()) {
  const posts = Array.isArray(state.promptPosts) ? state.promptPosts : [];
  let attached = 0;
  for (const event of bridge.list({ eventType: 'production_draft', status: 'completed', limit: 500 })) {
    const post = posts.find(item => String(item.id) === String(event.payload?.postId || ''));
    if (!post) continue;
    if (post.codexRoomDraft?.eventId === event.eventId) continue;
    const slides = event.response?.mode === 'PRODUCTION_DRAFT' ? event.response.slides : null;
    if (!slides) continue;
    post.codexRoomDraft = {
      eventId: event.eventId,
      attempt: Number(event.payload?.attempt || 0),
      slides,
      slideCount: Array.isArray(slides.slides) ? slides.slides.length : 0,
      receivedAt: now.toISOString(),
      review: 'manual_pending'
    };
    post.status = '최종 확인 대기';
    post.pendingManualReview = true;
    attached += 1;
  }
  return attached;
}

// 정책이 codex_room일 때 대기 중인 제작 게시물을 브리지에 올린다(유료 호출 없음).
function dispatchWaitingPosts(bridge, state, { isProductionPost, maxRequests = DEFAULT_MAX_REQUESTS, workflowFor = () => null } = {}) {
  const posts = Array.isArray(state.promptPosts) ? state.promptPosts : [];
  const results = [];
  for (const post of posts) {
    if (!isProductionPost(post) || post.astraFinalReview === true) continue;
    if (!WAITING.has(clean(post.status))) continue;
    const result = enqueueProductionDraft(bridge, { post, workflow: workflowFor(post), maxRequests });
    post.codexRoom = { lastResult: result.queued ? 'queued' : result.reason, eventId: result.event?.eventId || null, requestCount: result.requestCount, maxRequests, at: new Date().toISOString() };
    if (result.queued) post.status = '대화방 제작 대기';
    results.push({ postId: post.id, ...result });
  }
  return results;
}

function codexRoomDraftAttention(state, { sinceMs = 0 } = {}) {
  const open = (Array.isArray(state.promptPosts) ? state.promptPosts : [])
    .filter(post => post.codexRoomDraft && post.codexRoomDraft.review === 'manual_pending')
    .map(post => ({ kind: 'production_draft_review', urgent: false, at: post.codexRoomDraft.receivedAt, postId: post.id, taskId: post.taskId, slideCount: post.codexRoomDraft.slideCount, reason: '대화방 제작 초안(슬라이드 JSON) 도착 · 준희 확인 대기' }));
  return { fresh: open.filter(item => (Date.parse(item.at || '') || 0) >= sinceMs), open };
}

module.exports = { DEFAULT_MAX_REQUESTS, maxRequestsFrom, caseIdFor, enqueueProductionDraft, attachCompletedDrafts, dispatchWaitingPosts, codexRoomDraftAttention };
