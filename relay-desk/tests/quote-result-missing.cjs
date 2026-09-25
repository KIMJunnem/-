// 2026-09-23: 견적 발송 결과가 하루 넘게 안 들어온 건을 알림 목록에 올린다(최근 7일·최대 5건, 자체 점검 제외).
const assert = require('assert');
const { relayAttention } = require('../server/relay-server.js');
const iso = hoursAgo => new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
const lead = (requestId, hoursAgo, status = '견적 계산 완료 · 발송 결과 대기') => ({ requestId, status, createdAt: iso(hoursAgo), quote: { amount: 99000 } });
const state = {
  soomgoLeads: [
    lead('REAL-OLD-1', 30),
    lead('REAL-OLD-2', 40),
    lead('TOO-NEW', 3),
    lead('TOO-OLD', 24 * 9),
    lead('SELFTEST-SKIP', 30),
    lead('DONE', 30, '견적 발송 확인 · 고용 요청 대기')
  ]
};
const out = relayAttention(state, 70);
const missing = out.items.filter(item => item.kind === 'quote_result_missing').map(item => item.requestId);
assert.deepEqual(missing.sort(), ['REAL-OLD-1', 'REAL-OLD-2'], '하루~7일 사이 미확인 건만');
assert.match(out.items.find(item => item.kind === 'quote_result_missing').reason, /99,000원/);
// 최대 5건
const many = { soomgoLeads: Array.from({ length: 9 }, (_, i) => lead(`R${i}`, 30)) };
assert.equal(relayAttention(many, 70).items.filter(i => i.kind === 'quote_result_missing').length, 5);
console.log('quote-result-missing: PASS');
