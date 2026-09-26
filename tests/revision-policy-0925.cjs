'use strict';
// 9/25 준희 수정 방침: 기본 수정 2회 뒤 3번째 회차부터 작업 전에 추가 비용 안내·동의(가벼운 15,000원·쇼츠 10,000원 / 큰 수정 30,000원부터·쇼츠 20,000원부터·준희 확인 / 모르면 Claude),
// 수정은 모아서 마지막 메시지 2시간 뒤 제작(마감 오늘·내일이거나 급하면 바로), 옛 대용량 메일 문장은 정책 주소,
// 새벽(0~7시) 요청 안부 20~40분 한 번, 조용한 시간(02~08시) 자동 답장 미룸. 외부 호출 없음(서버 폴더 복사본, 가짜 대기열).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let apiCalls = 0;
global.fetch = async () => { apiCalls += 1; throw new Error('network_disabled_in_test'); };
const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-rev-policy-'));
const copy = (from, to) => { fs.mkdirSync(to, { recursive: true }); for (const e of fs.readdirSync(from, { withFileTypes: true })) { if (['data', 'storage'].includes(e.name) && from.endsWith('server')) continue; const s = path.join(from, e.name), d = path.join(to, e.name); if (e.isDirectory()) copy(s, d); else fs.copyFileSync(s, d); } };
copy(path.join(ROOT, 'server'), path.join(dir, 'server'));
copy(path.join(ROOT, 'services'), path.join(dir, 'services'));
fs.mkdirSync(path.join(dir, 'server', 'data'), { recursive: true });
const R = require(path.join(dir, 'server', 'relay-server.js'));
const t = require(path.join(dir, 'server', 'chat-timing.js'));
const { checkHonorific } = require(path.join(dir, 'server', 'honorific-guard.js'));
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));
const video = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', 'video_edit.json'), 'utf8'));
const KST = 9 * 3600e3;
const kst = iso => Date.parse(`${iso}+09:00`);
const clock = ms => new Date(ms + KST).toISOString().slice(11, 16);
const MIN = 60 * 1000;

// 정책 값은 파일에만
assert.deepEqual({ ...policy.revisionBatch, _note: undefined, urgentPattern: undefined }, { _note: undefined, urgentPattern: undefined, enabled: true, minDelayMinutes: 120, urgentSkip: true, urgentDeadlineDays: 1 });
assert.deepEqual([video.pricing.revisionFees.light.amount, video.pricing.revisionFees.light.shortsAmount, video.pricing.revisionFees.big.fromAmount, video.pricing.revisionFees.big.shortsFromAmount], [15000, 10000, 30000, 20000]);
assert.equal(video.includedRevisions, 2);
assert.equal(video.pricing.shorts.days, '당일~1일', '쇼츠 기간은 그대로(준희가 고침)');
assert.deepEqual([policy.dailyCapExtras.minScore, policy.dailyCapExtras.maxPerDay], [4, 10], '상한 넘은 요청 기준 그대로');

const T0 = kst('2026-09-25T13:00:00');
const mkState = (over = {}) => {
  const workflow = {
    id: 'WF-V', conversationId: 'C-V', requestId: 'REQ-V', taskId: 'T1', currentTaskId: 'T1', lastResultPostId: 'R1', stage: 'awaiting_feedback', cycle: 1, maxCycles: 2,
    quote: { serviceId: 'video_edit', amount: 89000, label: '영상 편집' }, request: { topic: '돌잔치 성장 영상', text: '서비스 분야\n돌잔치\n완료 희망일\n10월 10일\n' },
    additionalFees: [], feedbacks: [], paymentAmount: 89000, ...over
  };
  return { soomgoWorkflows: [workflow], tasks: [{ id: 'T1', title: '돌잔치 영상', lane: 'soomgo_fulfillment', ai: 'OpenAI' }], promptPosts: [], resultPosts: [{ id: 'R1', taskId: 'T1', text: '1차 영상 결과' }], activities: [] };
};
const say = (state, message, now, extra = {}) => R.workflowReply(state, { conversationId: 'C-V', message, ...extra }, { now, policy });
const wfOf = state => state.soomgoWorkflows[0];
const hon = r => assert.ok(checkHonorific(r.text).ok, r.text);

// 1) 기본 횟수 안: 받자마자 만들지 않고 모은다 → 같은 회차로 더 받음 → 마지막 메시지 2시간 뒤 제작 대기열에서 시작
{
  const state = mkState();
  let r = say(state, '자막 오타 수정해 주세요', T0);
  assert.equal(r.templateKey, 'revision_batch_ack');
  assert.equal(r.text, '수정 사항은 모아서 한 번에 꼼꼼히 반영해 드릴게요. 더 떠오르시는 부분 있으면 편하게 말씀해 주세요!'); hon(r);
  assert.equal(state.tasks.length, 1, '바로 제작하지 않음');
  assert.equal(wfOf(state).revisionBatch.eligibleAt, new Date(T0 + 120 * MIN).toISOString());
  r = say(state, '배경 음악도 좀 밝은 걸로 바꿔 주세요', T0 + 30 * MIN);
  assert.equal(r.templateKey, 'revision_batch_more'); hon(r);
  assert.equal(wfOf(state).revisionBatch.messages.length, 2);
  assert.equal(wfOf(state).revisionBatch.round, 1, '같은 회차');
  // 모으는 중 "좋습니다"는 최종 확인으로 넘기지 않음
  assert.equal(say(state, '네 좋습니다', T0 + 40 * MIN), null);
  assert.equal(wfOf(state).stage, 'awaiting_feedback');
  // 언제 되냐고 물으면 모으는 중이라고
  assert.equal(say(state, '언제쯤 받을 수 있을까요?', T0 + 45 * MIN).templateKey, 'revision_batch_status');
  assert.equal(R.releaseDueRevisionBatches(state, T0 + 149 * MIN), 0, '마지막 메시지 2시간 전에는 시작 안 함');
  assert.equal(R.releaseDueRevisionBatches(state, T0 + 150 * MIN), 1);
  assert.equal(wfOf(state).stage, 'quality_review_running');
  assert.equal(wfOf(state).feedbacks.length, 1, '두 메시지 = 1회차');
  assert.match(state.promptPosts[0].prompt, /1\) 자막 오타 수정해 주세요\n2\) 배경 음악도/);
  assert.equal(wfOf(state).revisionBatch, null);
  // 2회차(무료)
  wfOf(state).stage = 'awaiting_feedback';
  assert.equal(say(state, '엔딩 문구를 바꿔 주세요', T0 + 300 * MIN).templateKey, 'revision_batch_ack');
  R.releaseDueRevisionBatches(state, T0 + 420 * MIN);
  assert.equal(wfOf(state).feedbacks.length, 2);
  // 3회차: 가벼운 수정 → 작업 전에 금액 안내
  wfOf(state).stage = 'awaiting_feedback';
  const tasksBefore = state.tasks.length;
  r = say(state, '두 번째 컷 길이를 조금 줄여 주세요', T0 + 600 * MIN);
  assert.equal(r.templateKey, 'revision_fee_light');
  assert.equal(r.text, '말씀 주신 수정은 세 번째 수정이라, 기본 포함(2회) 이후라 1회 15,000원의 추가 비용이 있어요. 괜찮으시면 바로 반영해 드릴게요!'); hon(r);
  assert.equal(wfOf(state).stage, 'awaiting_additional_fee');
  assert.equal(R.releaseDueRevisionBatches(state, T0 + 2000 * MIN), 0, '동의 전에는 시작 안 함');
  assert.equal(state.tasks.length, tasksBefore);
  assert.equal(say(state, '추가 비용이 얼마라고요?', T0 + 601 * MIN).templateKey, 'revision_fee_light', '안내한 금액 그대로');
  r = say(state, '네 진행해 주세요', T0 + 610 * MIN);
  assert.equal(r.templateKey, 'revision_fee_agreed'); hon(r);
  assert.match(r.text, /추가 비용 15,000원은 결제 금액에 함께 반영해 둘게요/);
  const fee = wfOf(state).additionalFees.at(-1);
  assert.deepEqual([fee.amount, fee.accepted, fee.kind, fee.size, fee.round], [15000, true, 'revision', 'light', 3]);
  assert.equal(R.workflowPaymentAmount(wfOf(state)), 104000, '기존 결제 금액 계산에 추가금 반영');
  assert.equal(wfOf(state).paymentPlan.split, false, '전액 한 번 결제');
  assert.equal(wfOf(state).stage, 'awaiting_feedback');
  assert.equal(R.releaseDueRevisionBatches(state, T0 + 719 * MIN), 0, '마지막 수정 메시지 2시간 뒤');
  assert.equal(R.releaseDueRevisionBatches(state, T0 + 720 * MIN), 1);
  assert.equal(wfOf(state).feedbacks.at(-1).paidRevision, true);
  assert.equal(wfOf(state).additionalFees.length, 1, '추가금을 두 번 더하지 않음');
  assert.equal(R.customerRevisionRounds(wfOf(state)), 3);
  // 4회차 = 네 번째
  wfOf(state).stage = 'awaiting_feedback';
  assert.match(say(state, '자막 글자 크기를 키워 주세요', T0 + 900 * MIN).text, /^말씀 주신 수정은 네 번째 수정이라/);
}

// 2) 쇼츠 가벼운 수정 10,000원 · 큰 수정 "부터" + 준희 알림 · 동의하면 준희가 금액 확정(결제 금액에 아직 안 넣음)
{
  const shorts = mkState({ quote: { serviceId: 'video_edit', amount: 39000, videoEdit: { shorts: { count: 1 } } }, feedbacks: [{ text: '1' }, { text: '2' }] });
  const r = say(shorts, '자막 오타 하나 고쳐 주세요', T0);
  assert.equal(r.revisionFee.amount, 10000); assert.match(r.text, /1회 10,000원의 추가 비용/);
  const reels = mkState({ request: { topic: '인스타 릴스 편집', text: '' }, feedbacks: [{ text: '1' }, { text: '2' }] });
  assert.match(say(reels, '구성을 새로 짜서 다시 만들어 주세요', T0).text, /20,000원부터/);
  const big = mkState({ feedbacks: [{ text: '1' }, { text: '2' }] });
  const b = say(big, '분위기를 완전히 다르게 바꿔 주세요', T0);
  assert.equal(b.templateKey, 'revision_fee_big'); assert.equal(b.attention, true); hon(b);
  assert.equal(b.text, '말씀 주신 수정은 세 번째 수정이고, 구성이나 분위기를 새로 잡는 큰 수정이라 30,000원부터 추가 비용이 있어요. 정확한 금액은 요청 내용을 보고 바로 안내해 드릴게요. 괜찮으시면 편하게 말씀 주세요!');
  const more = say(big, '사진도 몇 장 더 넣어 주세요', T0 + MIN);
  assert.equal(more.templateKey, 'revision_fee_more'); assert.match(more.text, /30,000원부터/); hon(more);
  const ok = say(big, '네 괜찮아요', T0 + 2 * MIN);
  assert.equal(ok.templateKey, 'revision_fee_big_agreed'); assert.equal(ok.attention, true); hon(ok);
  assert.equal(wfOf(big).stage, 'manual_extension_review');
  assert.equal(wfOf(big).pendingExtension.amountToConfirm, true);
  assert.equal(wfOf(big).pendingExtension.fee, 30000);
  assert.match(wfOf(big).pendingExtension.feedback, /분위기[\s\S]*사진도/);
  assert.equal(R.workflowPaymentAmount(wfOf(big)), 89000, '금액 확정 전에는 결제 금액 그대로');
  // 가벼운 수정 안내 뒤 큰 수정이 더해지면 큰 수정으로 다시 안내
  const up = mkState({ feedbacks: [{ text: '1' }, { text: '2' }] });
  assert.equal(say(up, '자막 오타 고쳐 주세요', T0).templateKey, 'revision_fee_light');
  assert.equal(say(up, '그리고 새 영상 클립도 추가해 주세요', T0 + MIN).templateKey, 'revision_fee_big');
  // 거절하면 지금 버전으로 마무리
  const no = mkState({ feedbacks: [{ text: '1' }, { text: '2' }] });
  say(no, '자막 오타 고쳐 주세요', T0);
  const d = say(no, '그냥 지금 버전으로 할게요', T0 + MIN);
  assert.equal(d.templateKey, 'revision_fee_declined'); hon(d);
  assert.equal(wfOf(no).stage, 'awaiting_feedback'); assert.equal(wfOf(no).revisionBatch, null); assert.equal(wfOf(no).additionalFees.length, 0);
}

// 3) 가벼운지 큰지 모르면 Claude 판단(chatSupervisor 경로, 고용 뒤 업무여도) + 준희 알림 유지
{
  const s = mkState({ feedbacks: [{ text: '1' }, { text: '2' }] });
  const r = say(s, '전체적으로 느낌을 좀 바꿔 주세요', T0);
  assert.equal(r.templateKey, 'revision_fee_unclear'); assert.equal(r.revisionFeeJudge, true); assert.equal(r.manualReview, true);
  assert.equal(R.honorificCheckApplies(r), false, '보내지 않는 판단 요청');
  let sent = null;
  const asked = R.supervisorReply({ conversationId: 'C-V', message: '전체적으로 느낌을 좀 바꿔 주세요', hiredConversation: true }, r, { policy: {}, enqueue: (body, det) => { sent = det; return { autoSend: false, pendingRoom: true, text: det.text }; } });
  assert.equal(asked.supervisor, 'revision_fee'); assert.equal(asked.attention, true);
  assert.match(sent.text, /15,000원[\s\S]*30,000원부터/);
  assert.match(sent.factsText, /세 번째 수정/);
  assert.equal(R.supervisorReply({ conversationId: 'x', message: 'y', hiredConversation: true }, { autoSend: false, manualReview: true, workflowHandled: true }, { policy: {}, enqueue: () => ({}) }), null, '다른 고용 뒤 업무는 그대로');
}

// 4) 이미 결제한 업무: 동의 → 기존 추가금 흐름(거래 다시 등록) → 결제 확인 뒤에도 모은 수정의 시작 시각을 지킴
{
  const s = mkState({ feedbacks: [{ text: '1' }, { text: '2' }], paymentConfirmedAt: new Date(T0 - 86400e3).toISOString() });
  say(s, '자막 오타 고쳐 주세요', T0);
  const r = say(s, '네', T0 + 5 * MIN);
  assert.equal(r.templateKey, 'revision_fee_agreed_paid'); assert.equal(r.paymentReplacementPending, true); hon(r);
  assert.equal(wfOf(s).stage, 'transaction_replacement_pending');
  assert.equal(wfOf(s).paymentAmount, 104000);
  Object.assign(wfOf(s), { stage: 'payment_requested', transactionReplacementStage: 'new_payment_pending', paymentRequestedAt: new Date(T0).toISOString() });
  const paid = say(s, '숨고페이 결제 완료', T0 + 30 * MIN, { paymentEvidence: 'soomgo_system' });
  assert.equal(paid.templateKey, 'revision_fee_paid_confirmed'); hon(paid);
  assert.equal(wfOf(s).stage, 'awaiting_feedback', '2시간 전이라 아직 시작 안 함');
  assert.equal(R.releaseDueRevisionBatches(s, T0 + 120 * MIN), 1);
  assert.equal(wfOf(s).stage, 'quality_review_running');
}

// 5) 마감이 오늘·내일이거나 급하다고 하면 모으지 않고 바로
{
  const now = kst('2026-09-25T15:00:00');
  assert.equal(R.workflowDeadlineDays({ request: { text: '완료 희망일\n9월 26일\n' } }, now), 1);
  assert.equal(R.workflowDeadlineDays({ request: { deadline: '10월 3일' } }, now), 8);
  assert.equal(R.workflowDeadlineDays({ request: { deadline: '협의 가능' } }, now), null);
  assert.equal(R.workflowDeadlineDays({ request: { deadline: '1월 5일' } }, kst('2026-12-30T10:00:00')), 6, '해 넘김');
  const today = mkState({ request: { deadline: '오늘', text: '' } });
  const r = say(today, '자막 오타 수정해 주세요', now);
  assert.equal(r.templateKey, 'revision_batch_urgent'); hon(r);
  assert.equal(wfOf(today).stage, 'quality_review_running');
  const rush = mkState();
  assert.equal(say(rush, '급해요 내일까지 자막 오타 고쳐 주세요', now).templateKey, 'revision_batch_urgent');
  assert.equal(say(mkState(), '자막 오타 고쳐 주세요', now).templateKey, 'revision_batch_ack', '10월 10일 마감은 모음');
  // 스위치를 끄면 예전처럼 바로
  const off = mkState();
  const offReply = R.workflowReply(off, { conversationId: 'C-V', message: '자막 오타 수정해 주세요' }, { now, policy: { ...policy, revisionBatch: { enabled: false } } });
  assert.notEqual(offReply.templateKey, 'revision_batch_ack');
  assert.equal(wfOf(off).stage, 'quality_review_running');
}

// 6) 금액표가 없는 서비스(자막)는 예전 revision_overage 그대로, 수정 추가 비용 질문엔 금액표로
{
  const sub = mkState({ quote: { serviceId: 'subtitle', amount: 30000 }, feedbacks: [{ text: '1' }, { text: '2' }] });
  assert.equal(say(sub, '오타 좀 수정해 주세요', T0).templateKey, 'revision_overage');
  const info = say(mkState(), '수정 추가 비용은 얼마인가요?', T0);
  assert.equal(info.templateKey, 'revision_fee_info'); hon(info);
  assert.match(info.text, /기본 수정 2회까지는 추가 비용 없이[\s\S]*세 번째 수정부터[\s\S]*15,000원[\s\S]*30,000원부터/);
}

// 7) 옛 대용량 메일 문장: 정책 contact.materialsEmail(비면 메일 없이 링크)
{
  const src = fs.readFileSync(path.join(ROOT, 'server', 'relay-server.js'), 'utf8');
  assert.doesNotMatch(src, /[A-Za-z0-9._%+-]+@(?:gmail|naver|daum)\.[a-z]+/i, '서버 코드에 메일 주소 없음');
  assert.match(R.intakeAttachmentLine({ contact: { materialsEmail: 'files-x@example.org' } }), /files-x@example\.org으로 보내주시면/);
  assert.doesNotMatch(R.intakeAttachmentLine({ contact: { materialsEmail: '' } }), /@|메일/);
  assert.match(R.largeFileEmailText({ contact: { materialsEmail: 'files-x@example.org' } }), /files-x@example\.org으로 보내 주세요/);
  assert.doesNotMatch(R.largeFileEmailText({ contact: { materialsEmail: 'nope' } }), /@|메일/);
  for (const text of [R.intakeAttachmentLine({ contact: {} }), R.largeFileEmailText({ contact: {} })]) assert.ok(checkHonorific(text).ok, text);
  assert.match(R.soomgoReply({ conversationId: 'LF', message: '파일 용량이 커서 첨부가 안 돼요' }).text, new RegExp(policy.contact.materialsEmail.replace(/[.]/g, '\\.')));
}

// 8) 새벽(0~7시) 요청 안부: 스위치가 꺼져 있어도 새벽 요청만 한 번, 읽은 뒤 20~40분(02~08시는 8시로), 낮 요청은 없음
{
  assert.equal(policy.quoteReadFollowup.enabled, false, '낮 요청은 계속 기다린다');
  assert.deepEqual({ ...policy.quoteReadFollowup.nightRequests, _note: undefined }, { _note: undefined, enabled: true, startHour: 0, endHour: 7, delayMinutes: [20, 40] });
  const lead = (seenIso, extra = {}) => ({ requestId: `RQ-${seenIso}`, conversationId: 'N1', createdAt: new Date(kst(seenIso)).toISOString(), request: { text: '요청 상세\n견적 보낸 고수 1명\n방금 전\n', topic: '돌잔치 영상' }, quote: { serviceId: 'video_edit', amount: 69000 }, quoteEvidence: { status: 'sent', at: new Date(kst(seenIso) + 5 * MIN).toISOString() }, ...extra });
  const ask = (l, replies = []) => R.soomgoQuoteReadFollowupReply({ soomgoLeads: [l], soomgoWorkflows: [], soomgoReplies: replies }, { conversationId: 'N1', quoteReadFollowup: true, quoteReadEvidence: true }, { policy });
  const night = ask(lead('2026-09-25T03:00:00'));
  assert.equal(night.templateKey, 'quote_read_followup_night');
  assert.equal(night.autoSend, true);
  assert.equal(night.text, '늦은 시간까지 준비하시느라 고생 많으세요! 급하게 필요하시면 일정 최대한 맞춰 보겠습니다. 편하게 말씀 주세요.');
  assert.doesNotMatch(night.text, /10분 안쪽|원본/, '엉뚱한 길이 질문 없음');
  for (const text of [night.nightFollowup.text, night.nightFollowup.dayText]) assert.ok(checkHonorific(text).ok, text);
  assert.equal(ask(lead('2026-09-25T14:00:00')).templateKey, 'quote_read_followup_off', '낮 요청은 안부 없음');
  assert.equal(ask(lead('2026-09-25T06:59:00')).templateKey, 'quote_read_followup_night', '06:59 새벽');
  assert.equal(ask(lead('2026-09-25T07:00:00')).templateKey, 'quote_read_followup_off', '07:00은 낮');
  assert.equal(ask(lead('2026-09-25T00:00:00')).templateKey, 'quote_read_followup_night');
  assert.equal(ask(lead('2026-09-24T23:59:00')).templateKey, 'quote_read_followup_off');
  // 요청서 "N분 전"을 빼서 요청 생성 시각을 쓴다(07:10에 본 "20분 전" 요청 = 06:50 요청)
  assert.equal(ask(lead('2026-09-25T07:10:00', { request: { text: '견적 보낸 고수 0명\n20분 전\n', topic: '돌잔치' } })).templateKey, 'quote_read_followup_night');
  assert.equal(R.soomgoRequestPostedAt({ createdAt: new Date(kst('2026-09-25T09:00:00')).toISOString(), request: { text: '2시간 전' } }), kst('2026-09-25T07:00:00'));
  assert.equal(R.soomgoRequestPostedAt({ quoteEvidence: { at: new Date(kst('2026-09-25T03:00:00')).toISOString() } }), kst('2026-09-25T03:00:00'), '모르면 견적 발송 시각');
  // 한 요청에 한 번
  assert.equal(ask(lead('2026-09-25T03:00:00'), [{ conversationId: 'N1', createdAt: new Date(kst('2026-09-25T03:30:00')).toISOString(), reply: { templateKey: 'quote_read_followup_night', linkedLeadRequestId: 'RQ-2026-09-25T03:00:00' } }]).templateKey, 'quote_read_already_sent');
  // 자료를 봐야 금액이 정해지는 영상이면 자료 한 줄
  assert.match(ask(lead('2026-09-25T03:00:00', { quote: { serviceId: 'video_edit', amount: 89000, videoEdit: { materialsBased: 'photo' } } })).text, /자료만 보내주시면 바로 확인해 드릴게요\.$/);
  // 보낼 시각: 00~02시는 읽은 뒤 20~40분 그대로, 02~08시에 걸리면 8시(+0~20분)
  const cfg = R.quoteReadNightConfig(policy);
  const quiet = R.quietHoursConfig(policy);
  for (let i = 0; i < 40; i += 1) {
    const readAt = kst('2026-09-25T00:30:00');
    const rel = R.nightFollowupReleaseAt(readAt, `n${i}`, cfg, quiet);
    assert.ok(rel - readAt >= 20 * MIN && rel - readAt <= 40 * MIN, clock(rel));
    const late = R.nightFollowupReleaseAt(kst('2026-09-25T03:10:00'), `n${i}`, cfg, quiet);
    assert.ok(late >= kst('2026-09-25T08:00:00') && late <= kst('2026-09-25T08:20:00'), clock(late));
  }
  assert.match(R.nightFollowupTextAt(kst('2026-09-25T00:55:00'), night.nightFollowup), /^늦은 시간까지/);
  assert.match(R.nightFollowupTextAt(kst('2026-09-25T08:10:00'), night.nightFollowup), /^안녕하세요! 급하게/);
  const src = fs.readFileSync(path.join(ROOT, 'server', 'relay-server.js'), 'utf8');
  assert.match(src, /astraRoomBridge\.cancelScheduled\(conversationId, \['quote_read_followup', 'delayed_reply'\], 'customer_spoke_first'\)/, '고객이 먼저 말하면 취소(같은 kind)');
  const chat = fs.readFileSync(path.join(ROOT, 'soomgo-chat-bot', 'chat-content.js'), 'utf8');
  const quoteReadStart = chat.indexOf('  async function processQuoteReadFollowup() {');
  const quoteReadEnd = chat.indexOf('\n  async function processPendingFollowup(', quoteReadStart + 1);
  assert.ok(quoteReadStart >= 0 && quoteReadEnd > quoteReadStart, '견적 읽음 처리 함수 블록을 찾는다');
  const quoteReadBlock = chat.slice(quoteReadStart, quoteReadEnd);
  assert.doesNotMatch(quoteReadBlock, /getHours|새벽/, '채팅봇은 시각과 상관없이 읽음 이벤트를 서버에 보낸다');
}

// 9) 조용한 시간(02~08시): 자동 답장·예약 발송은 8시 이후로
{
  assert.deepEqual({ ...policy.quietHours, _note: undefined }, { _note: undefined, start: 2, end: 8, windowMinutes: 20 });
  const q = R.quietHoursConfig(policy);
  assert.equal(R.quietReleaseAt(kst('2026-09-25T01:59:00'), 'k', policy), kst('2026-09-25T01:59:00'), '01:59 그대로');
  for (const hhmm of ['02:00', '07:59']) {
    const v = R.quietReleaseAt(kst(`2026-09-25T${hhmm}:00`), 'k', policy);
    assert.ok(v >= kst('2026-09-25T08:00:00') && v <= kst('2026-09-25T08:20:00'), `${hhmm} → ${clock(v)}`);
  }
  assert.equal(R.quietReleaseAt(kst('2026-09-25T08:00:00'), 'k', policy), kst('2026-09-25T08:00:00'), '08:00 그대로');
  assert.equal(R.quietHoursNow(kst('2026-09-25T01:59:00'), policy), false);
  assert.equal(R.quietHoursNow(kst('2026-09-25T02:00:00'), policy), true);
  assert.equal(R.quietHoursNow(kst('2026-09-25T07:59:00'), policy), true);
  assert.equal(R.quietHoursNow(kst('2026-09-25T08:00:00'), policy), false);
  // 안부 멘트(2~4시간)도 경계만 02~08시로
  assert.equal(t.deferOutOfNight(kst('2026-09-25T01:30:00'), 'k', q), kst('2026-09-25T01:30:00'));
  const moved = t.deferOutOfNight(kst('2026-09-25T02:00:00'), 'k', q);
  assert.ok(moved >= kst('2026-09-25T08:00:00') && moved <= kst('2026-09-25T09:30:00'));
  assert.equal(R.quietScheduleAllowed({ autoSend: true, workflowHandled: true, text: '수정 사항은 모아서 한 번에 꼼꼼히 반영해 드릴게요.' }), true);
  assert.equal(R.quietScheduleAllowed({ autoSend: true, hireRequest: true, text: '고용 요청 보내드릴게요' }), false);
  assert.equal(R.quietScheduleAllowed({ autoSend: true, attachment: { fileUrl: 'x' }, text: '샘플' }), false);
  const src = fs.readFileSync(path.join(ROOT, 'server', 'relay-server.js'), 'utf8');
  assert.match(src, /releaseAt: new Date\(quietReleaseAt\(Date\.now\(\) \+ chatTiming\.replyDelayMs\(messageId, body\.message \|\| body\.text \|\| ''\), messageId\)\)\.toISOString\(\)/, 'Claude 답도 조용한 시간이면 미룸');
  assert.match(src, /kind: 'delayed_reply', releaseAt: quietReleaseAt\(/);
  assert.match(src, /kind: 'quiet_reply', releaseAt: quietReleaseAt\(/);
}

assert.equal(apiCalls, 0);
fs.rmSync(dir, { recursive: true, force: true });
console.log('revision-policy-0925: PASS');
