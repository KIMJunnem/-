'use strict';

// 고객 첨부 판독(Claude)·알림 목록 회귀 검사. 실제 API 대신 가짜 runClaude를 쓴다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ar = require('../server/attachment-reader');

const PNG = Buffer.alloc(2000, 7).toString('base64');
(async () => {
  let sent = null;
  const fakeClaude = async content => { sent = content; return { model: 'claude-test', usage: { input_tokens: 10, output_tokens: 5 }, text: '판독 결과입니다 {"summary":"손글씨 회의 메모 사진","documentType":"손글씨 메모","pages":3,"minutes":null,"language":"ko","taskGuess":"writing","questionsForCustomer":["완성 문서 형식"],"concerns":[]}' }; };
  const read = await ar.readAttachments([{ kind: 'image', name: '사진', mediaType: 'image/png', data: PNG }], fakeClaude, { message: '[사진]' });
  assert.equal(read.status, 'ok');
  assert.equal(sent[0].type, 'image');
  assert.equal(sent[0].source.media_type, 'image/png');
  assert.equal(read.analysis.pages, 3);
  assert.ok(!('data' in read.attachments[0]), '판독 기록에 파일 본문을 남기지 않음');
  const reply = ar.replyForAttachments(read);
  assert.equal(reply.autoSend, true, '수신 확인은 자동 발송');
  assert.equal(reply.manualReview, false);
  assert.equal(reply.attention, true, '담당자 알림 대상');
  assert.match(reply.reason, /손글씨 메모 \(3쪽\)/);
  assert.doesNotMatch(reply.text, /\d+\s*원/, '금액은 자동으로 말하지 않음');

  // 주의점이 있으면 자동 발송하지 않는다
  const risky = ar.replyForAttachments(await ar.readAttachments([{ mediaType: 'image/jpeg', data: PNG }], async () => ({ text: '{"summary":"x","concerns":["카피킬러 통과 요구"]}' })));
  assert.equal(risky.autoSend, false);
  assert.equal(risky.manualReview, true);

  // 봇이 파일을 못 가져오면 Claude를 부르지 않고 알림만
  let called = false;
  const failed = await ar.readAttachments([{ kind: 'image', name: '사진', error: 'http_403' }], async () => { called = true; return {}; });
  assert.equal(called, false);
  assert.equal(failed.status, 'unreadable');
  assert.equal(ar.replyForAttachments(failed).attention, true);
  // 압축파일 등 지원하지 않는 형식은 판독하지 않음
  assert.equal(ar.normalizeAttachments([{ name: 'a.zip', mediaType: 'application/zip', data: PNG }])[0].readable, false);
  // Claude 오류
  const errored = await ar.readAttachments([{ mediaType: 'image/png', data: PNG }], async () => { throw new Error('claude_529_overloaded'); });
  assert.equal(errored.status, 'error');
  assert.equal(ar.replyForAttachments(null), null);

  // 서버 연결 확인
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
  assert.match(server, /linkReply \|\| attachmentReply \|\|/);
  assert.match(server, /pathname === '\/api\/attention'/);
  const { relayAttention } = require('../server/relay-server');
  if (relayAttention) {
    const now = new Date().toISOString();
    const out = relayAttention({ soomgoReplies: [
      { conversationId: '240001111', createdAt: now, incoming: '[사진]', reply: { attention: true, autoSend: true, attachmentRead: { status: 'ok' }, reason: 'Claude 첨부 판독: 메모' } },
      { conversationId: '240001112', createdAt: now, incoming: '네', reply: { autoSend: true } },
      { conversationId: 'TEST-1', createdAt: now, incoming: 'x', reply: { manualReview: true } }
    ], soomgoLeads: [], soomgoWorkflows: [] }, 70);
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].kind, 'attachment');
    assert.equal(out.items[0].link, 'https://soomgo.com/pro/chats/240001111');
  }
  const chat = fs.readFileSync(path.join(__dirname, '..', 'soomgo-chat-bot', 'chat-content.js'), 'utf8');
  assert.match(chat, /function messageAttachments\(node\)/);
  assert.match(chat, /attachments = await loadAttachments\(incoming\.attachments\)/);
  console.log('attachment-reader: PASS');
})().catch(error => { console.error(error); process.exit(1); });
