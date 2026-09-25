// 감사 인사(2026-09-23 준희 지시): 견적 첫 줄에 감사 인사, '내일 연락드리겠습니다'류에는 감사 답장(긴급 오판 없음).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { soomgoReply, shouldUseSoomgoAiReply } = require('../server/relay-server.js');
const ctx = '[고수] 요청 주셔서 감사합니다. 요청서 확인했습니다.\n견적 99,000원\n[고객] 네';
for (const message of ['내일 연락드리겠습니다!', '생각해보고 연락드릴게요', '검토 후 다시 연락드리겠습니다', '좀 더 고민해볼게요', '상의해보고 말씀드릴게요']) {
  const r = soomgoReply({ conversationId: 'TEST-LATER', message, conversationText: ctx, quote: { amount: 99000, days: '1~2일' } });
  assert.equal(r.templateKey, 'later_contact_thanks', message);
  assert.equal(r.autoSend, true);
  assert.match(r.text, /감사합니다/);
  assert.equal(shouldUseSoomgoAiReply(r), false, '정해진 문구 그대로');
}
// 질문이나 긴급 문의는 기존대로
assert.notEqual(soomgoReply({ conversationId: 'TEST-LATER', message: '오늘 연락 주실 수 있나요?', conversationText: ctx, quote: {} }).templateKey, 'later_contact_thanks');
assert.notEqual(soomgoReply({ conversationId: 'TEST-LATER', message: '연락처 알려주세요', conversationText: ctx, quote: {} }).templateKey, 'later_contact_thanks');
// 첫 견적은 실제 요청 내용을 먼저 보여준다. 나중에 연락한다는 답변의 감사 문구는 유지한다.
const { quoteRequestIntro } = require('../server/pricing-table');
assert.match(quoteRequestIntro({ topic: '회사 안내문 작성' }, '문서 작성'), /회사 안내문 작성/);
assert.match(quoteRequestIntro({}, '문서 작성'), /감사합니다/);
for (const id of ['presentation', 'subtitle']) {
  const def = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'services', `${id}.json`), 'utf8'));
  assert.match(def.quoteText, /^\{\{requestIntro\}\}/, id);
}
console.log('thanks-copy: PASS');
