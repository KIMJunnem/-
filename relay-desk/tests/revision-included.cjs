'use strict';

// 기본 포함 수정 횟수(2026-09-22 준희 결정: 자막 2회·문서 3회·PPT 1회) 회귀 검사.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
// 상태 파일을 임시 폴더에 쓰도록 서버 폴더를 복사해서 불러온다.
const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-rev-'));
const copy = (from, to) => { fs.mkdirSync(to, { recursive: true }); for (const e of fs.readdirSync(from, { withFileTypes: true })) { if (['data', 'storage'].includes(e.name) && from.endsWith('server')) continue; const s = path.join(from, e.name), d = path.join(to, e.name); if (e.isDirectory()) copy(s, d); else fs.copyFileSync(s, d); } };
copy(path.join(ROOT, 'server'), path.join(dir, 'server'));
copy(path.join(ROOT, 'services'), path.join(dir, 'services'));
if (fs.existsSync(path.join(ROOT, 'checks'))) copy(path.join(ROOT, 'checks'), path.join(dir, 'checks'));
fs.mkdirSync(path.join(dir, 'server', 'data'), { recursive: true });
const { buildSoomgoQuote, soomgoReply, workflowReply } = require(path.join(dir, 'server', 'relay-server.js'));

const sub = buildSoomgoQuote({ purpose: '자막 제작', volume: '10분', topic: '한국어 인터뷰 자막', format: 'SRT' }).quote;
assert.match(sub.message, /수정 2회 포함/); assert.match(sub.basicScope, /수정 2회/);
const doc = buildSoomgoQuote({ requestId: 'R', text: '요청 상세\n문서/글 작성\n\n작업 분량\nA4 3쪽\n' }).quote;
assert.match(doc.message, /수정 3회 포함/); assert.match(doc.basicScope, /수정 3회/);
const steno = buildSoomgoQuote({ requestId: 'S', text: '요청 상세\n속기(타이핑)\n\n작업 분량\n30분\n' }).quote;
assert.match(steno.message, /수정 3회 포함/);
assert.match(buildSoomgoQuote({ purpose: 'PPT 제작', volume: '7장', topic: '원고 발표자료 변환', format: 'PPTX' }).quote.message, /수정 2회/);
const pptWf = { soomgoWorkflows: [{ id: 'WF-ppt', conversationId: 'C-ppt-2', stage: 'awaiting_feedback', cycle: 1, quote: { serviceId: 'presentation', amount: 51000 }, feedbacks: [{ text: '1', extraFeeAccepted: false }, { text: '2', extraFeeAccepted: false }] }], tasks: [], promptPosts: [], resultPosts: [], activities: [] };
const pptOver = workflowReply(pptWf, { conversationId: 'C-ppt-2', message: '글자 크기 좀 수정해 주세요' });
assert.equal(pptOver.templateKey, 'revision_overage'); assert.match(pptOver.text, /기본 수정 2회.*10,000원/);
assert.match(soomgoReply({ conversationId: '235000902', message: '수정 몇 번까지 되나요?' }).text, /자막은 수정 2회, 문서는 수정 3회/);

const wf = (serviceId, used) => ({ soomgoWorkflows: [{ id: `WF-${serviceId}`, conversationId: `C-${serviceId}-${used}`, stage: 'awaiting_feedback', cycle: 1, quote: { serviceId, amount: 30000, label: serviceId }, feedbacks: Array.from({ length: used }, (_, i) => ({ text: `수정 ${i + 1}`, extraFeeAccepted: false })) }], tasks: [], promptPosts: [], resultPosts: [], activities: [] });
// 자막 2회를 다 쓴 뒤의 수정: 추가금 먼저 안내, 추가 수정 10,000원
let state = wf('subtitle', 2);
let reply = workflowReply(state, { conversationId: 'C-subtitle-2', message: '오타 좀 수정해 주세요' });
assert.equal(reply.templateKey, 'revision_overage'); assert.match(reply.text, /기본 수정 2회를 모두 쓰셔서.*10,000원/);
assert.equal(state.soomgoWorkflows[0].stage, 'awaiting_additional_fee');
// 자막 1회 사용: 아직 기본 안(추가금 안내 없음)
state = wf('subtitle', 1);
reply = workflowReply(state, { conversationId: 'C-subtitle-1', message: '오타 좀 수정해 주세요' });
assert.notEqual(reply?.templateKey, 'revision_overage');
// 문서 2회 사용: 3회 안이라 추가금 없음, 3회 사용 후에는 추가금
state = wf('document_writing', 2);
assert.notEqual(workflowReply(state, { conversationId: 'C-document_writing-2', message: '문장을 수정해 주세요' })?.templateKey, 'revision_overage');
state = wf('document_writing', 3);
reply = workflowReply(state, { conversationId: 'C-document_writing-3', message: '문장을 수정해 주세요' });
assert.equal(reply.templateKey, 'revision_overage'); assert.match(reply.text, /기본 수정 3회/);
// 추가금 동의로 진행한 수정은 기본 횟수에 세지 않는다
state = wf('document_writing', 3); state.soomgoWorkflows[0].feedbacks[2].extraFeeAccepted = true;
assert.notEqual(workflowReply(state, { conversationId: 'C-document_writing-3', message: '문장을 수정해 주세요' })?.templateKey, 'revision_overage');
fs.rmSync(dir, { recursive: true, force: true });
console.log('revision-included: PASS');
