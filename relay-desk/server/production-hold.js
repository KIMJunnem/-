'use strict';

// 제작 대기(hold) 알림(2026-09-21). production.provider가 hold이거나 허용값이 아니면
// 제작 lane 게시물은 실행하지 않고 대기로 남긴다. 대기 중인 게시물을 알림 목록에
// type "production_hold"로 한 번씩 올리고, 게시물이 끝나거나 hold가 풀리면 닫는다.
// 고객 이름·원문은 넣지 않는다(서비스·납기·postId만).

const WAITING = new Set(['게시됨', '대기', '인수인계 대기', '예약됨', '', '보류']);
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

function isProductionPost(post = {}) {
  return post.lane === 'soomgo_fulfillment' || post.astraProduction === true;
}

function items(state) {
  if (!Array.isArray(state.attentionItems)) state.attentionItems = [];
  return state.attentionItems;
}

function describe(state, post) {
  const task = (Array.isArray(state.tasks) ? state.tasks : []).find(item => String(item.id || '') === String(post.taskId || '')) || {};
  const workflow = (Array.isArray(state.soomgoWorkflows) ? state.soomgoWorkflows : [])
    .find(item => [item.taskId, item.currentTaskId].map(String).includes(String(post.taskId || ''))) || {};
  const service = clean(task.quote?.label || workflow.quote?.label || task.soomgoRequest?.purpose || workflow.request?.purpose || task.category || '제작').slice(0, 40);
  const deadline = clean(task.soomgoRequest?.deadline || workflow.request?.deadline || task.quote?.days || workflow.quote?.days || '미정').slice(0, 40);
  return { service, deadline, workflowId: workflow.id || null, kind: post.astraFinalReview === true ? 'final_review' : String(post.taskId || '').includes('-REV') ? 'revision' : Number(post.cycle || 1) > 1 ? 'review_cycle' : 'production' };
}

// 대기 게시물을 등록하고, 끝난 게시물·풀린 hold의 항목은 닫는다. 바뀌면 true.
function syncProductionHolds(state, holdState, now = new Date()) {
  const nowIso = now.toISOString();
  const posts = (Array.isArray(state.promptPosts) ? state.promptPosts : []).filter(isProductionPost);
  const list = items(state);
  let changed = false;
  const waitingIds = new Set();
  if (holdState?.hold) {
    for (const post of posts) {
      const status = clean(post.status);
      const retryableFailure = status === '실행 실패';
      if (!WAITING.has(status) && !retryableFailure) continue;
      waitingIds.add(String(post.id));
      const existing = list.find(item => item.type === 'production_hold' && item.postId === String(post.id) && item.status === 'open');
      if (existing) {
        if (existing.reason !== holdState.reason) { existing.reason = holdState.reason; changed = true; }
        continue;
      }
      const info = describe(state, post);
      list.unshift({
        id: `ATTN-P-${post.id}-${now.getTime()}`, type: 'production_hold', status: 'open',
        postId: String(post.id), taskId: String(post.taskId || ''), workflowId: info.workflowId,
        service: info.service, deadline: info.deadline, postKind: info.kind,
        reason: holdState.reason, configuredProvider: holdState.configured ?? null,
        createdAt: nowIso
      });
      changed = true;
    }
  }
  for (const item of list) {
    if (item.type !== 'production_hold' || item.status !== 'open') continue;
    if (holdState?.hold && waitingIds.has(item.postId)) continue;
    item.status = 'resolved';
    item.resolution = holdState?.hold ? 'post_no_longer_waiting' : 'hold_released';
    item.resolvedAt = nowIso;
    changed = true;
  }
  if (changed) state.attentionItems = list.slice(0, 500);
  return changed;
}

function productionHoldAttention(state, { sinceMs }) {
  const open = items(state).filter(item => item.type === 'production_hold' && item.status === 'open').map(item => ({
    type: 'production_hold', kind: 'production_hold', id: item.id, postId: item.postId, taskId: item.taskId,
    service: item.service, deadline: item.deadline, postKind: item.postKind, reason: item.reason,
    at: item.createdAt, urgent: false
  }));
  return { fresh: open.filter(view => (Date.parse(view.at || '') || 0) >= sinceMs), open };
}

module.exports = { isProductionPost, syncProductionHolds, productionHoldAttention, WAITING };
