'use strict';
// 2026-09-23 next-soomgo 지시 5: Astra 숨고 답장 기록 경로. 모의 데이터만, 임시 폴더에만 쓴다(실제 기록 파일은 건드리지 않음).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('../server/astra-chat-log');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-chat-log-'));
const file = path.join(dir, 'astra-chat-log.json');
const now = Date.parse('2026-09-23T10:00:00Z');
const call = (over = {}) => log.handle({ local: true, origin: undefined, header: 'chat-log', method: 'POST', pathname: '/api/astra/chat-log', file, now, ...over });
const base = { conversationId: '235999001', at: '2026-09-23T09:50:00Z', customerMessageAt: '2026-09-23T09:48:00Z', kind: 'reply_sent', delivery: 'visible', resolution: 'open', stage: 'question', serviceId: 'document_writing', quoteVersion: 'v7', replySha: 'a1b2c3d4e5f6', note: '분량 질문에 답함' };

try {
  // 로컬이 아니거나 헤더가 없으면 403
  assert.equal(call({ local: false, body: base }).status, 403);
  assert.equal(call({ origin: 'https://evil.example', body: base }).status, 403);
  assert.equal(call({ header: '', body: base }).status, 403);
  assert.equal(log.handle({ local: false, header: 'chat-log', method: 'GET', pathname: '/api/astra/chat-log/summary', file, now }).status, 403);

  // 필수 칸 없으면 400
  for (const drop of ['conversationId', 'customerMessageAt', 'kind', 'resolution', 'delivery', 'replySha']) {
    const body = { ...base }; delete body[drop];
    const out = call({ body });
    assert.equal(out.status, 400, `${drop} 없음`);
  }
  assert.equal(call({ body: { ...base, conversationId: 'test-1' } }).status, 400, '숫자 아닌 대화번호');
  assert.equal(call({ body: { ...base, stage: 'order' } }).status, 400, '모르는 단계');
  assert.equal(call({ body: { ...base, replySha: 'xyz' } }).status, 400, 'sha 12자리 16진수');

  // 본문·개인정보는 받지 않는다
  assert.deepEqual(call({ body: { ...base, text: '고객님 안녕하세요' } }).payload.details, ['body_not_stored:text']);
  assert.equal(call({ body: { ...base, customerMessage: '견적 얼마예요' } }).status, 400);
  assert.deepEqual(call({ body: { ...base, note: '연락처 010-1234-5678 받음' } }).payload.details, ['note_personal_info']);
  assert.deepEqual(call({ body: { ...base, note: 'abc@example.com' } }).payload.details, ['note_personal_info']);
  assert.equal(call({ body: { ...base, note: '가'.repeat(121) } }).status, 400, 'note 120자 초과');
  assert.equal(call({ body: { ...base, note: '줄\n바꿈' } }).status, 400, '본문 붙여넣기(여러 줄) 거절');
  assert.equal(fs.existsSync(file), false, '거절된 요청은 파일을 만들지 않는다');

  // 정상 기록 + 중복은 한 건
  const first = call({ body: base });
  assert.equal(first.status, 200);
  assert.equal(first.payload.duplicate, false);
  assert.equal(first.payload.countedAsSent, true);
  const again = call({ body: { ...base, note: '다시 보냄' } });
  assert.equal(again.payload.duplicate, true);
  assert.equal(log.load(file).entries.length, 1, '같은 (대화·고객 메시지 시각·종류·sha)는 한 건');
  const saved = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(saved, /고객님 안녕하세요|견적 얼마예요/, '본문 저장 안 함');

  // uncertain은 보냄으로 세지 않고 주의 목록
  const unsure = call({ body: { ...base, conversationId: '235999002', replySha: 'bbbbbbbbbbbb', delivery: 'uncertain', resolution: 'open', stage: 'quote_sent', at: '2026-09-23T09:30:00Z', customerMessageAt: '2026-09-23T09:20:00Z' } });
  assert.equal(unsure.payload.countedAsSent, false);
  assert.equal(unsure.payload.attention, true);

  // 결제 요청 단계 + 사람 확인 + 해결된 대화
  call({ body: { conversationId: '235999003', at: '2026-09-23T09:40:00Z', customerMessageAt: '2026-09-23T09:39:00Z', kind: 'reply_sent', delivery: 'visible', resolution: 'resolved', stage: 'payment_requested', replySha: 'cccccccccccc' } });
  call({ body: { conversationId: '235999004', at: '2026-09-23T09:45:00Z', customerMessageAt: '2026-09-23T09:10:00Z', kind: 'handoff_to_owner', resolution: 'owner_needed', note: '환불 문의 · 준희 확인' } });
  // 같은 대화에서 나중 기록이 마지막 상태(보냄 ≠ 해결: 먼저 open, 나중 resolved)
  call({ body: { ...base, at: '2026-09-23T09:55:00Z', customerMessageAt: '2026-09-23T09:54:00Z', replySha: 'dddddddddddd', resolution: 'resolved', stage: 'scope_agreed' } });

  const sum = log.handle({ local: true, header: 'chat-log', method: 'GET', pathname: '/api/astra/chat-log/summary', file, now });
  assert.equal(sum.status, 200);
  const s = sum.payload;
  assert.equal(s.totals.conversations, 4);
  assert.equal(s.totals.repliesVisible, 3, '보이는 답장만 보냄으로 센다');
  assert.equal(s.totals.repliesUncertain, 1);
  assert.equal(s.totals.handoffs, 1);
  // 미해결: uncertain 1 + owner_needed 1 (resolved 둘은 빠짐), 고객 메시지가 오래된 순
  assert.deepEqual(s.unresolved.map(item => [item.conversationId, item.reason]), [['235999004', 'owner_needed'], ['235999002', 'delivery_uncertain']]);
  assert.equal(s.unresolved[0].minutesSinceCustomer, 50);
  assert.equal(s.attention.length, 2);
  // 단계는 이름 그대로: 결제 요청을 주문으로 세지 않는다
  assert.equal(s.stageCounts.payment_requested, 1);
  assert.equal(s.stageCounts.quote_sent, 1);
  assert.equal(s.stageCounts.scope_agreed, 1);
  assert.equal(s.stageCounts.question, 0, '같은 대화의 앞선 단계는 마지막 단계로 대체');
  for (const key of ['orders', 'inquiries', 'order', 'inquiry']) {
    assert.equal(Object.prototype.hasOwnProperty.call(s, key), false, key);
    assert.equal(Object.prototype.hasOwnProperty.call(s.totals, key), false, key);
    assert.equal(Object.prototype.hasOwnProperty.call(s.stageCounts, key), false, key);
  }
  assert.deepEqual(Object.keys(s.stageCounts), log.STAGES);

  // 다른 방법은 405
  assert.equal(log.handle({ local: true, header: 'chat-log', method: 'GET', pathname: '/api/astra/chat-log', file, now }).status, 405);

  // 서버 연결(정적 검사): 로컬 여부·origin·헤더를 넘기고, 저장 위치는 server/data/astra-chat-log.json, 기존 /api/astra/ 처리보다 앞
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
  const at = server.indexOf("if (pathname === '/api/astra/chat-log' || pathname === '/api/astra/chat-log/summary') {");
  assert.ok(at > 0 && at < server.indexOf("if (pathname.startsWith('/api/astra/')) {"));
  assert.match(server.slice(at, at + 700), /astraChatLog\.handle\(\{ local, origin: req\.headers\.origin, header: req\.headers\['x-relay-astra'\][\s\S]{0,160}path\.join\(DATA_DIR, 'astra-chat-log\.json'\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'), /server\/data\/astra-chat-log\.json/);
  console.log('astra-chat-log: PASS');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
