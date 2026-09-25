'use strict';
// 9/25 준희 지시: 채팅봇은 무조건 존댓말. 반말 문장은 보내지 않고 사람 확인으로 넘긴다.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkHonorific } = require('../server/honorific-guard');
const { createAstraRoomBridge } = require('../server/astra-room-bridge');

// 1) 반말은 막는다
for (const text of ['네 알겠어', '파일 보내줘', '내일까지 해줄게', '이건 안 돼', '가능해?', '그건 제가 할게.', '오늘 보냈다.', '확인했음', '괜찮아',
  '견적은 3만원입니다. 파일은 내일 보낼게.']) {
  assert.strictEqual(checkHonorific(text).ok, false, `반말 통과: ${text}`);
}
// 2) 존댓말·문장이 아닌 줄은 통과
for (const text of ['네, 알겠습니다.', '파일 보내 주세요!', '내일까지 드릴게요 :)', '가능하실까요?', '확인했습니다 ㅎㅎ', '감사합니다~^^', '네',
  '- 교정: 30,000원 → 21,000원', '기간: 2일', '자막 언어: 영어', '[메로나 문서사무소]', 'https://soomgo.com/pro/chats/1',
  '안녕하세요 고객님\n영상 길이와 원하시는 언어를 알려 주시면 바로 견적 드리겠습니다.\n- 기본 수정: 2회']) {
  assert.strictEqual(checkHonorific(text).ok, true, `존댓말 막힘: ${text} ${JSON.stringify(checkHonorific(text).problems)}`);
}
// 3) 서비스 정의 파일의 고객용 문구(설명·내부 메모 제외)는 모두 통과해야 한다
const customerKeys = /(text|message|template|reply|copy|greeting|closing|intro|body)$/i;
function walk(value, key, out) {
  if (typeof value === 'string') { if (customerKeys.test(key) && /[가-힣]{2}/.test(value)) out.push(value); return; }
  if (Array.isArray(value)) { value.forEach(item => walk(item, key, out)); return; }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k, out);
}
const servicesDir = path.join(__dirname, '..', 'services');
for (const file of fs.readdirSync(servicesDir).filter(name => name.endsWith('.json'))) {
  const texts = [];
  walk(JSON.parse(fs.readFileSync(path.join(servicesDir, file), 'utf8')), '', texts);
  for (const text of texts) assert.strictEqual(checkHonorific(text).ok, true, `${file} 문구가 막힘: ${text.slice(0, 60)}`);
}
// 4) 대기열: 반말 답은 held, 존댓말 답은 ready
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'honorific-guard-'));
const bridge = createAstraRoomBridge({ dataFile: path.join(root, 'data.json'), configFile: path.join(root, 'config.json') });
function sendReply(key, reply) {
  const queued = bridge.enqueue({ eventType: 'customer_message', caseId: 'CHAT-9', idempotencyKey: key, payload: { conversationId: 'CHAT-9' } });
  return bridge.complete(queued.event.eventId, `[MODE:CUSTOMER_REPLY]\n[DECISION:SEND]\n[REPLY]\n${reply}`).event;
}
const banmal = sendReply('k1', '응 내일까지 보내줄게');
assert.strictEqual(banmal.deliveryStatus, 'held');
assert.ok(banmal.honorificHold && /존댓말/.test(banmal.honorificHold.reason));
const polite = sendReply('k2', '네, 내일까지 보내 드리겠습니다.');
assert.strictEqual(polite.deliveryStatus, 'ready');
assert.deepStrictEqual(bridge.outbox({ conversationId: 'CHAT-9' }).map(e => e.eventId), [polite.eventId]);
fs.rmSync(root, { recursive: true, force: true });
console.log('존댓말 필수 검사 통과');
