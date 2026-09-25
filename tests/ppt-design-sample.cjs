'use strict';

// PPT 디자인 샘플 자동 발송(2026-09-22 준희 지시): PPT 견적 고객이 샘플을 달라고 하면 유형에 맞는 예시 PDF 한 개를 첨부해 보낸다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { soomgoReply, pptDesignSampleReply, PPT_DESIGN_SAMPLES } = require('../server/relay-server');
const root = path.join(__dirname, '..');
const dir = path.join(root, 'services', 'presentation-design', 'samples', 'customer-samples');

// 5개 파일 모두 있어야 한다(학교 과제형은 강의·세미나형을 같이 쓴다)
for (const [type, item] of Object.entries(PPT_DESIGN_SAMPLES)) assert.ok(fs.existsSync(path.join(dir, item.file)), `${type} → ${item.file}`);

const ppt = { serviceId: 'presentation', amount: 39000, label: 'PPT 제작' };
const ask = (message, conversationText = '', quote = ppt) => soomgoReply({ conversationId: `PPT-SAMPLE-${message.length}-${conversationText.length}`, message, conversationText: `${conversationText}\n[고객] ${message}`, quote });

// 강연 요청 → 강의·세미나형 PDF, 첨부 정보와 문구
const lecture = ask('샘플 볼 수 있을까요?', '[고객] 연설/강연 발표 자료입니다');
assert.equal(lecture.templateKey, 'ppt_design_sample');
assert.equal(lecture.autoSend, true);
assert.notEqual(lecture.hireRequest, true, '샘플 요청은 고용 요청이 아님');
assert.equal(lecture.attachment.filename, 'Swan-샘플-04-강의세미나형.pdf');
assert.match(lecture.attachment.fileUrl, /^\/api\/soomgo\/design-sample\//);
assert.match(lecture.text, /강의·강연 발표 자료에 가까워서 그 방향 샘플 하나 보내드립니다/);
assert.match(lecture.text, /원고가 몇 쪽인지 알려주시면 금액을 확정해 드리겠습니다/);

// 유형별 고르기
assert.equal(ask('샘플 있나요?', '[고객] 조달청 입찰 제안서 PPT').attachment.filename, 'Swan-샘플-03-제안서형.pdf');
assert.equal(ask('샘플 부탁드려요', '[고객] 대표님께 드릴 3분기 실적 보고').attachment.filename, 'Swan-샘플-02-기업보고형.pdf');
assert.equal(ask('샘플 보내주세요', '[고객] 카페 매장 업체 소개 자료').attachment.filename, 'Swan-샘플-05-업체소개형.pdf');
assert.equal(ask('샘플 보여주세요', '[고객] 조별 과제 발표').attachment.filename, 'Swan-샘플-04-강의세미나형.pdf');
assert.equal(ask('샘플 있을까요?').attachment.filename, 'Swan-샘플-02-기업보고형.pdf', '단서 없으면 기업 보고형');

// 보내지 않는 경우: 유료 샘플을 분명히 말함 / 이미 보냄 / PPT가 아님
assert.notEqual(ask('샘플 구매할게요').templateKey, 'ppt_design_sample');
assert.notEqual(ask('샘플 하나 더 있나요?', '[swan] 요청하신 내용은 제안서에 가까워서 그 방향 샘플 하나 보내드립니다.').templateKey, 'ppt_design_sample', '같은 대화에 두 번 보내지 않음');
assert.notEqual(ask('샘플 있나요?', '', { serviceId: 'subtitle', amount: 49000 }).templateKey, 'ppt_design_sample');
assert.equal(pptDesignSampleReply({ quote: null, message: '샘플' }), null, '견적 없으면 보내지 않음');

// 서버 경로: 목록에 있는 PDF만 내보낸다
const src = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
const route = src.slice(src.indexOf("pathname.startsWith('/api/soomgo/design-sample/')"), src.indexOf("pathname.startsWith('/api/soomgo/design-sample/')") + 1400);
assert.match(route, /allowed\.includes\(name\)/); assert.match(route, /access-control-allow-origin/, '숨고 화면에서 받을 수 있게 출처 헤더'); assert.match(route, /application\/pdf/); assert.match(route, /if \(!local\)/);

// 채팅봇: 첨부가 있으면 먼저 붙이고, 실패하면 문구도 보내지 않는다
const bot = fs.readFileSync(path.join(root, 'soomgo-chat-bot', 'chat-content.js'), 'utf8');
const i = bot.indexOf('if (reply.attachment?.fileUrl) {');
assert.ok(i > 0 && i < bot.indexOf('const sent = await sendChatText(reply.text);', i), '첨부가 문구 전송보다 먼저');
assert.match(bot.slice(i, i + 1200), /if \(!attached\.attached\) \{[\s\S]*?return true;/);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'soomgo-chat-bot', 'manifest.json'), 'utf8')).version, '0.3.25'); // 9/24 지시 15: 채팅봇 0.3.24(감지 전용 추가)
// 0.3.21 대기열(Astra 고객대응실) 답변: 같은 문구가 방에 있으면 생략, [ATTACHMENT] 샘플은 먼저 첨부하고 실패하면 보내지 않음
const outbox = bot.slice(bot.indexOf('async function processAstraRoomOutbox()'));
assert.ok(outbox.indexOf('reply_text_already_in_room') > 0 && outbox.indexOf('reply_text_already_in_room') < outbox.indexOf('await sendChatText(replyText)'));
assert.ok(outbox.indexOf("event.response?.fields?.ATTACHMENT") > 0 && outbox.indexOf('attachWorkflowFile(') < outbox.indexOf('await sendChatText(replyText)'));
assert.match(outbox.slice(0, outbox.indexOf('await sendChatText(replyText)')), /attachment_failed[\s\S]*?return true;/);
console.log('ppt-design-sample: PASS');
