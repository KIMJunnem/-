'use strict';
// 2026-09-23(감독 지시 2): 서버 quote-result — 이미 'sent'인 요청을 늦게 온 결과가 덮지 못한다. 외부 호출 없음.
const assert = require('assert');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { applySoomgoQuoteResult: apply } = require('../server/relay-server.js');
const ev = (status, at, url = 'https://soomgo.com/requests/received/abc', note = '') => ({ status, at, sentAt: status === 'sent' ? at : null, url, note, customerReplied: false, customerReplyAt: null });
const chat = 'https://soomgo.com/pro/chats/123456789';

// 1) sent → 늦게 온 uncertain(재전송 순서 뒤바뀜): sent 유지, 기록에는 남김
{
  const lead = { requestId: 'R1', status: '견적 계산 완료 · 발송 결과 대기' };
  assert.equal(apply(lead, ev('sent', '2026-09-23T04:00:00Z', chat)).applied, true);
  const out = apply(lead, ev('uncertain', '2026-09-23T03:59:50Z'));
  assert.deepEqual(out, { applied: false, kept: 'sent' });
  assert.equal(lead.quoteEvidence.status, 'sent');
  assert.equal(lead.status, '견적 발송 확인 · 고용 요청 대기');
  assert.equal(lead.conversationId, '123456789');
  assert.equal(lead.quoteEvidenceHistory.length, 2);
  assert.equal(lead.quoteEvidenceHistory[0].status, 'uncertain');
  assert.equal(lead.quoteEvidenceHistory[0].ignored, true);
}
// 2) sent → 실패 보고(blocked): sent 유지 ('failed'는 서버에서 uncertain으로 바뀌어 1과 같다)
{
  const lead = { requestId: 'R2' };
  apply(lead, ev('sent', '2026-09-23T04:00:00Z', chat));
  for (const late of ['blocked', 'skipped']) {
    assert.equal(apply(lead, ev(late, '2026-09-23T04:01:00Z')).applied, false, late);
    assert.equal(lead.quoteEvidence.status, 'sent', late);
  }
  assert.equal(lead.quoteEvidenceHistory.filter(item => item.ignored).length, 2);
}
// 3) uncertain → 나중에 sent(정상 순서): sent로 바뀐다
{
  const lead = { requestId: 'R3' };
  apply(lead, ev('uncertain', '2026-09-23T04:00:00Z'));
  assert.equal(lead.status, '발송 확인 필요');
  assert.equal(apply(lead, ev('sent', '2026-09-23T04:00:05Z', chat)).applied, true);
  assert.equal(lead.quoteEvidence.status, 'sent');
  assert.equal(lead.status, '견적 발송 확인 · 고용 요청 대기');
  assert.equal(lead.conversationId, '123456789');
}
// 4) sent → sent 재전송: 처음 발송 시각·고객 답장 표시·채팅방 URL·진행 상태 유지
{
  const lead = { requestId: 'R4' };
  apply(lead, ev('sent', '2026-09-23T04:00:00Z', chat));
  lead.quoteEvidence.customerReplied = true;
  lead.quoteEvidence.customerReplyAt = '2026-09-23T05:00:00Z';
  lead.status = '고용 확정';
  const out = apply(lead, ev('sent', '2026-09-23T06:00:00Z', 'https://soomgo.com/requests/received?from=gnb'));
  assert.equal(out.applied, true);
  assert.equal(out.resend, true);
  assert.equal(lead.quoteEvidence.sentAt, '2026-09-23T04:00:00Z');
  assert.equal(lead.quoteEvidence.customerReplied, true);
  assert.equal(lead.quoteEvidence.customerReplyAt, '2026-09-23T05:00:00Z');
  assert.equal(lead.quoteEvidence.url, chat);
  assert.equal(lead.status, '고용 확정');
  assert.equal(lead.conversationId, '123456789');
}
// 5) 처음 결과(이전 기록 없음)는 예전처럼 그대로 반영
{
  const lead = { requestId: 'R5' };
  apply(lead, ev('blocked', '2026-09-23T04:00:00Z'));
  assert.equal(lead.status, '숨고 발송 제한');
  apply(lead, ev('skipped', '2026-09-23T04:01:00Z'));
  assert.equal(lead.status, '자동 발송 제외');
}
// 핸들러가 이 함수를 쓰는지(정적 검사)
const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
const handler = source.slice(source.indexOf("pathname === '/api/soomgo/quote-result'"), source.indexOf("pathname === '/api/soomgo/followup-result'"));
assert.match(handler, /const outcome = applySoomgoQuoteResult\(lead, evidence\);/);
assert.match(handler, /if \(outcome\.applied\) \{[\s\S]{0,300}closeFromQuoteResult/);
assert.doesNotMatch(handler, /lead\.quoteEvidence = evidence;/);
console.log('quote-result-order: PASS');
process.exit(0);
