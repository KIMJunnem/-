// 1) 로컬 API가 방문 중인 아무 웹사이트에나 열려 있던 문제
// 2) 고객이 "결제했어요"라고 말한 것만으로 정산이 끝나던 문제
// 3) 수정 한도를 넘으면 고객이 동의한 추가금이 사라지던 문제
// 세 가지를 실제 서버에 요청해 확인한다. 서버가 떠 있어야 한다.
const assert = require('node:assert/strict');

const origin = 'http://127.0.0.1:8787';
const runId = Date.now();
let checks = 0;

function ok(name) { checks += 1; console.log(`[PASS] ${name}`); }

async function call(path, init = {}) {
  const response = await fetch(`${origin}${path}`, init);
  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  return { status: response.status, headers: response.headers, payload };
}

async function checkOriginGate() {
  // 외부 사이트가 고객 대화가 담긴 상태를 읽어가지 못해야 한다.
  const evilRead = await call('/api/state', { headers: { origin: 'https://evil.example.com' } });
  assert.equal(evilRead.status, 403, `외부 사이트가 상태를 읽었습니다 (${evilRead.status})`);
  assert.notEqual(evilRead.headers.get('access-control-allow-origin'), '*', 'CORS가 전면 허용으로 남아 있습니다.');
  ok('외부 사이트 오리진의 상태 읽기 차단');

  const evilWrite = await call('/api/state', {
    method: 'POST',
    headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' },
    body: JSON.stringify({ tasks: [], activities: [] })
  });
  assert.equal(evilWrite.status, 403, `외부 사이트가 상태를 덮어썼습니다 (${evilWrite.status})`);
  ok('외부 사이트 오리진의 상태 쓰기 차단');

  // Origin 없이 img/script 태그로 부르는 브라우저 교차 요청도 막는다.
  const taggedRead = await call('/api/state', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(taggedRead.status, 403, `Origin 없는 교차 사이트 요청이 통과했습니다 (${taggedRead.status})`);
  ok('Origin 없는 브라우저 교차 요청 차단');

  // 실제로 쓰는 경로는 그대로 동작해야 한다.
  const botRead = await call('/api/soomgo/workflow', { headers: { origin: 'https://soomgo.com' } });
  assert.equal(botRead.status, 200, '숨고 확장 호출이 막혔습니다.');
  assert.equal(botRead.headers.get('access-control-allow-origin'), 'https://soomgo.com');
  ok('숨고 페이지 확장 호출 허용');

  const dashboardRead = await call('/api/state', { headers: { origin: 'http://127.0.0.1:8787', 'sec-fetch-site': 'same-origin' } });
  assert.equal(dashboardRead.status, 200, '대시보드 호출이 막혔습니다.');
  ok('대시보드 동일 출처 호출 허용');

  const scriptRead = await call('/api/state');
  assert.equal(scriptRead.status, 200, 'node 스크립트·브리지 호출이 막혔습니다.');
  ok('브리지·테스트 등 비브라우저 호출 허용');

  const extensionRead = await call('/api/soomgo/bot-version', { headers: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } });
  assert.equal(extensionRead.status, 200, '확장 서비스워커 호출이 막혔습니다.');
  ok('확장 서비스워커의 버전 확인 허용');
}

// 결제·수정 한도 검증은 고용된 의뢰 흐름이 필요하므로 상태에 직접 심는다.
async function seedWorkflow(overrides = {}) {
  const conversationId = `SAFETY-${runId}-${Math.random().toString(16).slice(2, 8)}`;
  const state = (await call('/api/state')).payload;
  const workflow = {
    id: `WF-SAFETY-${conversationId}`,
    leadId: `LEAD-${conversationId}`,
    requestId: `REQ-${conversationId}`,
    conversationId,
    taskId: `TASK-${conversationId}`,
    currentTaskId: `TASK-${conversationId}`,
    stage: 'payment_requested',
    cycle: 1,
    maxCycles: 2,
    pendingDelivery: null,
    pendingAction: null,
    additionalFees: [],
    quote: { amount: 29000, days: '당일~1일' },
    paymentAmount: 29000,
    feedbacks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
  const next = { ...state, soomgoWorkflows: [workflow, ...(Array.isArray(state.soomgoWorkflows) ? state.soomgoWorkflows : [])] };
  const saved = await call('/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
  assert.equal(saved.status, 200, '테스트용 작업 흐름을 저장하지 못했습니다.');
  return { conversationId, workflowId: workflow.id };
}

async function readWorkflow(conversationId) {
  const result = await call(`/api/soomgo/workflow?conversationId=${encodeURIComponent(conversationId)}`);
  return (result.payload?.workflows || [])[0] || null;
}

async function reply(conversationId, message, extra = {}) {
  return call('/api/soomgo/reply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId, messageId: `MSG-${Math.random().toString(16).slice(2)}`, message, conversationText: '', ...extra })
  });
}

async function checkPaymentEvidence() {
  for (const message of ['최종본 확인했습니다라고 하면 결제되나요?', '최종본 확인했습니다. 그런데 진행은 안 하겠습니다']) {
    const pending = await seedWorkflow({ stage: 'awaiting_completion_confirmation' });
    await reply(pending.conversationId, message);
    assert.equal((await readWorkflow(pending.conversationId)).stage, 'awaiting_completion_confirmation');
  }
  ok('최종 확인 질문·거절은 결제 요청 동의로 처리하지 않음');
  const { conversationId } = await seedWorkflow();

  // 고객이 결제했다고 말해도 정산 단계를 닫지 않는다.
  const claimed = await reply(conversationId, '결제 완료했습니다');
  assert.equal(claimed.status, 200);
  assert.equal(claimed.payload.reply.paymentClaimPending, true, '고객 주장만으로 다음 단계로 넘어갔습니다.');
  const afterClaim = await readWorkflow(conversationId);
  assert.equal(afterClaim.stage, 'payment_requested', `고객 주장만으로 단계가 ${afterClaim.stage}로 바뀌었습니다.`);
  assert.equal(afterClaim.pendingAction, null, '고객 주장만으로 리뷰 요청이 예약되었습니다.');
  ok('고객의 결제 완료 주장만으로는 리뷰 요청·완료 처리하지 않음');

  // 숨고 화면의 결제 완료 표시를 확인했을 때만 넘어간다.
  const confirmed = await reply(conversationId, '숨고페이 결제 완료 확인', { paymentEvidence: 'soomgo_system' });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.payload.reply.reviewReady, false, '거래 확정 전 리뷰 단계로 바로 넘어갔습니다.');
  const afterConfirm = await readWorkflow(conversationId);
  assert.equal(afterConfirm.stage, 'transaction_confirmation_wait');
  assert.equal(afterConfirm.pendingAction, 'request_transaction_confirmation');
  assert.ok(afterConfirm.paymentConfirmedAt, '결제 확인 시각이 기록되지 않았습니다.');
  assert.ok(afterConfirm.transactionConfirmReadyAt, '거래 확정 가능 시각이 기록되지 않았습니다.');
  ok('숨고 결제 완료 표시를 확인한 경우에만 3시간 거래 확정 대기로 이동');
  const stateAfterConfirm = (await call('/api/state')).payload;
  const seeded = (stateAfterConfirm.soomgoWorkflows || []).find(item => item.conversationId === conversationId);
  seeded.transactionConfirmReadyAt = new Date(Date.now() - 1000).toISOString();
  await call('/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(stateAfterConfirm) });
  const transaction = await call('/api/soomgo/workflow/action', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId, action: 'transaction_confirmation_requested' })
  });
  assert.equal(transaction.status, 200);
  assert.equal(transaction.payload.workflow.stage, 'review_requested');
  const closed = await call('/api/soomgo/workflow/action', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId, action: 'review_requested' })
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.payload.workflow.stage, 'completed');
  ok('리뷰 요청 기록 후 완료 전환');
  const premature = await seedWorkflow();
  const refused = await call('/api/soomgo/workflow/action', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: premature.conversationId, action: 'review_requested' })
  });
  assert.equal(refused.status, 409);
  const unconfirmedHire = await call('/api/soomgo/hire', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'UNCONFIRMED' })
  });
  assert.equal(unconfirmedHire.payload.error, 'soomgo_hire_not_confirmed');
  ok('결제 전 완료 처리 및 미확정 고용 차단');
}

async function checkRevisionCap() {
  // 이미 수정 1회를 모두 쓴 상태에서 고객이 추가금에 동의한 경우
  const { conversationId } = await seedWorkflow({
    stage: 'awaiting_additional_fee',
    cycle: 2,
    maxCycles: 2,
    pendingFeedback: '결론을 한 단락 더 늘려 주세요'
  });

  const consent = await reply(conversationId, '추가금에 동의하고 진행하겠습니다');
  assert.equal(consent.status, 200);
  const replyBody = consent.payload.reply;
  assert.equal(replyBody.manualReview, true, '한도를 넘은 수정이 자동으로 진행되었습니다.');
  assert.equal(replyBody.extensionPending, true, '추가 수정 대기 표시가 없습니다.');
  assert.match(replyBody.reason || '', /수정 횟수/, `사유가 한도 초과를 설명하지 않습니다: ${replyBody.reason}`);

  const after = await readWorkflow(conversationId);
  assert.equal(after.stage, 'manual_extension_review', `단계가 ${after.stage}에 머물러 같은 안내를 반복합니다.`);
  assert.ok(after.pendingExtension, '고객이 동의한 추가 수정 내용이 기록되지 않았습니다.');
  assert.ok(Number(after.pendingExtension.fee) > 0, '동의한 추가금 금액이 기록되지 않았습니다.');
  assert.match(String(after.pendingExtension.feedback || ''), /결론/, '어떤 수정에 동의했는지가 기록되지 않았습니다.');
  ok('수정 한도 초과 시 고객 동의 내용과 추가금을 기록하고 사람 확인으로 넘김');

  // 같은 방에서 다시 말해도 자동 답변이 반복되지 않는다.
  const again = await reply(conversationId, '네 진행해주세요');
  assert.equal(again.payload.reply.manualReview, true, '한도 초과 상태에서 자동 답변이 다시 나갔습니다.');
  assert.equal(again.payload.reply.extensionPending, true);
  ok('한도 초과 대기 상태에서 같은 안내를 반복하지 않음');

  // 결제 금액에는 아직 반영되지 않아야 한다 (작업을 하지 않았으므로)
  assert.equal(Number(after.paymentAmount || 0), 29000, '진행하지 않은 추가 수정이 결제 금액에 반영되었습니다.');
  ok('미진행 추가 수정은 결제 금액에 반영하지 않음');
}

async function run() {
  await checkOriginGate();
  await checkPaymentEvidence();
  await checkRevisionCap();
  console.log(`${checks} safety guard checks passed.`);
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
