'use strict';

// 상담 단계 보강 규칙 회귀 검사(2026-09-21 봇 오류 매뉴얼).
const assert = require('node:assert/strict');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { soomgoReplyGuard } = require('../server/reply-guards');
const { soomgoReply } = require('../server/relay-server');

const expect = [
  ['김OO님이 채팅방을 나갔습니다.', 'guard_customer_left', { skip: true, closeConversation: true, autoSend: false }],
  ['다른 고수님과 진행하기로 했어요 감사합니다', 'guard_hired_other', { skip: true, closeConversation: true }],
  ['고객님이 다른 고수를 고용했습니다', 'guard_hired_other', { skip: true }],
  ['숨고 밖에서 거래 가능해요?', 'guard_off_platform', { autoSend: true }],
  ['만나서 얘기할 수 있나요', 'guard_meeting', { autoSend: true }],
  ['주민등록번호는 필요하신가요', 'guard_personal_id', { autoSend: true }],
  ['파일이 너무 커서 안올라가요', 'large_file_email', { autoSend: true }],
  ['카피킬러 10% 미만으로 써주세요', 'guard_plagiarism_evasion', { autoSend: true }],
  ['좀 더 싸게 안될까요? 15000원에 해주세요', 'guard_price_negotiation', { autoSend: true, manualReview: false }],
  ['너무 비싸네요', 'guard_price_negotiation', { autoSend: true }],
  ['시발 왜 답이 없어', 'guard_customer_frustrated', { autoSend: false, manualReview: true }],
  ['답변 좀요', 'guard_customer_frustrated', { autoSend: false }],
  ['광고입니다 부업 하실분', 'guard_spam', { skip: true }],
  ['사진을 보냈습니다.', 'guard_attachment_notice', { autoSend: false, manualReview: true }],
  ['(이모티콘)', 'guard_emoji_only', { skip: true }],
  ['사람이 하는 거 맞죠?', 'guard_human_question', { autoSend: true }]
];
for (const [message, key, fields] of expect) {
  const reply = soomgoReply({ conversationId: '235999999', message });
  assert.equal(reply.templateKey, key, message);
  for (const [name, value] of Object.entries(fields)) assert.equal(reply[name], value, `${message}: ${name}`);
}

// 일반 문의는 보강 규칙에 걸리지 않고 기존 흐름으로 간다
assert.equal(soomgoReplyGuard('대학교 과제 레포트를 처음부터 대신 써주세요.'), null, '학교 과제는 기존 흐름(자동 접수)');
for (const message of ['내일 오전까지 가능해요?', '영어로 번역도 되나요?', '견적 취소할게요', '환불해주세요', '번역은 안 하기로 했어요, 요약만 해주세요', '21,000원으로 진행할게요']) {
  assert.equal(soomgoReplyGuard(message)?.templateKey === 'guard_hired_other', false, `${message}: 대화 종료로 오인 금지`);
}
assert.equal(soomgoReplyGuard('내일 오전까지 가능해요?'), null);
assert.equal(soomgoReply({ conversationId: '235999999', message: '견적 취소할게요' }).templateKey, 'manual_cancel_review');

const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
assert.match(server, /if \(reply\.closeConversation\) \{[\s\S]{0,400}soomgoBlocks/, '대화 종료 시 후속 메시지 차단 목록에 등록');
console.log('reply-guards: PASS');
