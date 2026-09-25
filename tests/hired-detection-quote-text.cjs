'use strict';

// 우리 견적 문구의 '거래 확정하시면 됩니다'를 고용 완료로 오판하던 문제(2026-09-22, PPT 고객 …6ab20 '장당39000원인가요?'에
// '고용 확정 감사합니다'가 나감). 안내 표현은 고용 증거가 아니고, 숨고의 실제 고용 완료 표현은 그대로 인정한다.
const assert = require('node:assert/strict');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { soomgoReply, buildSoomgoQuote } = require('../server/relay-server');

const quote = buildSoomgoQuote({ requestId: 'HIRE-T1', text: '요청 상세\nPPT 제작\n이용 목적\n연설/강연\n작업 분량\n10장\n' }).quote;
assert.match(quote.message, /거래를? 확정하시면 됩니다/); // 9/23 준희 승인 새 문구: '거래를 확정하시면 됩니다'
const reply = message => soomgoReply({ conversationId: `HIRE-${message.length}`, message, conversationText: `[swan] ${quote.message}\n[고객] ${message}`, quote });
for (const m of ['장당39000원인가요?', '10장이면 얼마예요?', '샘플 있나요?', '언제까지 가능해요?']) {
  const r = reply(m);
  assert.ok(!/^post_hire/.test(String(r.templateKey || '')), `${m} → ${r.templateKey}`);
  assert.ok(!/고용 확정 감사합니다/.test(String(r.text || '')), `${m}: 고용 전 고객에게 고용 감사 문구 금지`);
}
// 실제 고용 완료 표현은 고용으로 본다
const hired = soomgoReply({ conversationId: 'HIRE-REAL', message: '자료 보내드릴게요', conversationText: '[시스템] 고용이 확정되었습니다.\n[고객] 자료 보내드릴게요', quote });
assert.match(String(hired.templateKey || ''), /^post_hire/);
console.log('hired-detection-quote-text: PASS');
