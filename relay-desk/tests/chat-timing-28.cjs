'use strict';

// 개발방 지시 28 (2026-09-24, 준희 "채팅이 제일 중요"): 채팅이 봇처럼 보이는 것 고치기.
// 답장 지연(1분 30초~4분, 밤도 같음) · 안부 멘트 2~4시간·밤 12시~8시면 아침 8시~9시 30분 · 고객이 먼저 말하면 안부 취소 ·
// 120자 넘으면 두 통(20~40초) · 보내기 직전 AI 티 점검. 합성 입력·가짜 Claude만, 외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const t = require('../server/chat-timing');
const fb = require('../server/customer-room-fallback');
const { createAstraRoomBridge } = require('../server/astra-room-bridge');
const root = path.join(__dirname, '..');
const KST = 9 * 3600e3;
const kstHour = ms => new Date(ms + KST).getUTCHours();
const at = iso => Date.parse(iso);

// 1) 답장 지연 범위 · 길수록 뒤쪽 · 시각과 무관(밤·새벽도 같은 범위)
{
  const shortOnes = []; const longOnes = [];
  for (let i = 0; i < 200; i += 1) {
    const a = t.replyDelayMs(`m${i}`, '네 감사합니다'); const b = t.replyDelayMs(`m${i}`, '가'.repeat(180));
    for (const v of [a, b]) assert.ok(v >= 90000 && v <= 240000, `지연 범위 ${v}`);
    shortOnes.push(a); longOnes.push(b);
  }
  const avg = list => list.reduce((x, y) => x + y, 0) / list.length;
  assert.ok(avg(longOnes) > avg(shortOnes) + 40000, '긴 글일수록 뒤쪽');
  assert.equal(t.replyDelayMs('same', 'x'), t.replyDelayMs('same', 'x'), '같은 메시지 = 같은 지연(재시작해도 흔들리지 않음)');
  assert.ok(!/Date|now|Hour/.test(t.replyDelayMs.toString()), '시각을 보지 않음 → 밤·새벽도 같은 범위');
  const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
  // 9/25 준희 "2시~8시 외에는 답하자": 같은 지연 + 조용한 시간(02~08시)이면 8시 이후(quietReleaseAt)
  assert.match(server, /releaseAt: new Date\(quietReleaseAt\(Date\.now\(\) \+ chatTiming\.replyDelayMs\(messageId, body\.message \|\| body\.text \|\| ''\), messageId\)\)\.toISOString\(\)/, 'Claude 답장 대기열에도 같은 지연');
  assert.match(server, /kind: 'delayed_reply', releaseAt: quietReleaseAt\(Date\.now\(\) \+ chatTiming\.replyDelayMs\(messageId, incomingText\), messageId\)/, '정해진 문구 답장도 같은 지연');
}
// 2) 안부 멘트: 읽은 뒤 2~4시간, 조용한 시간(9/25 준희: 새벽 2시~아침 8시, 예전 0시~8시)에 걸리면 그날 8시~9시 30분
{
  for (let i = 0; i < 300; i += 1) {
    const readAt = at('2026-09-24T00:00:00Z') + i * 11 * 60 * 1000; // 하루 넘게 11분 간격
    const release = t.followupReleaseAt(readAt, `room${i}`);
    const hour = kstHour(release);
    assert.ok(!(hour >= 2 && hour < 8), `새벽에 안 나감 (${new Date(release + KST).toISOString()})`);
    const gap = release - readAt;
    const kst = new Date(release + KST);
    const minutesOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    const inWindow = gap >= 2 * 3600e3 && gap <= 4 * 3600e3;
    const morning = minutesOfDay >= 8 * 60 && minutesOfDay <= 9 * 60 + 30 && gap > 2 * 3600e3;
    assert.ok(inWindow || morning, `2~4시간 또는 아침 8시~9시 30분으로 미룸 (${kst.toISOString()}, ${Math.round(gap / 60000)}분)`);
  }
  const afternoon = at('2026-09-24T05:00:00Z'); // KST 14:00
  const r1 = t.followupReleaseAt(afternoon, 'x');
  assert.ok(r1 - afternoon >= 2 * 3600e3 && r1 - afternoon <= 4 * 3600e3, '오후 2시에 읽음 → 4~6시');
  const late = at('2026-09-24T14:30:00Z'); // KST 23:30 → 1:30~3:30. 2시 전이면 그대로, 2시 넘으면 아침으로
  const r2 = t.followupReleaseAt(late, 'y');
  const r2Hour = kstHour(r2);
  assert.ok((r2 - late >= 2 * 3600e3 && r2Hour < 2) || (r2 >= at('2026-09-24T23:00:00Z') && r2 <= at('2026-09-25T00:30:00Z')), `밤 11시 반에 읽음 → 2시 전 그대로 또는 다음 날 아침 8시~9시 30분 (${new Date(r2 + KST).toISOString()})`);
  // 경계: 01:59는 그대로, 02:00·07:59는 아침으로, 08:00은 그대로
  assert.equal(t.deferOutOfNight(at('2026-09-24T16:59:00Z'), 'b'), at('2026-09-24T16:59:00Z'));
  for (const iso of ['2026-09-24T17:00:00Z', '2026-09-24T22:59:00Z']) { const v = t.deferOutOfNight(at(iso), 'b'); assert.ok(v >= at('2026-09-24T23:00:00Z') && v <= at('2026-09-25T00:30:00Z'), iso); }
  assert.equal(t.deferOutOfNight(at('2026-09-24T23:00:00Z'), 'b'), at('2026-09-24T23:00:00Z'));
}
// 3) 120자 나누기
{
  const long = '안녕하세요, 돌잔치 영상 원본 5분 이내면 필요 없는 부분 정리하고 자막까지 넣어서 69,000원에 해 드릴 수 있습니다. 영상 받고 1~2일 안에 MP4로 보내드리고, 수정은 2회까지 가능합니다!! 원하시는 완성 날짜만 알려주시면 바로 일정 잡아드릴 수 있습니다!';
  const parts = t.splitReply(long);
  assert.equal(parts.length, 2); for (const p of parts) assert.ok(p.length <= 120, p);
  assert.equal(parts.join(' ').replace(/\s+/g, ''), long.replace(/\s+/g, ''), '나눠도 글자는 그대로');
  assert.deepEqual(t.splitReply('짧은 답장입니다.'), ['짧은 답장입니다.']);
  assert.equal(t.splitReply('가'.repeat(260)), null, '문장 경계가 없으면 나누지 못함 → 보내지 않음');
  for (let i = 0; i < 50; i += 1) { const g = t.splitGapMs(`e${i}`); assert.ok(g >= 20000 && g <= 40000); }
}
// 4) AI 티 점검
assert.equal(t.aiTellCheck('네, 1~2일 안에 보내드릴 수 있습니다!'), '');
// 9/26 준희 실제 말투: 😊 한 개·"~드릴게요"는 준희도 쓴다. 이모지 두 개 이상·"~하겠습니다" 연발·"~습니당" 두 번은 봇 티
assert.equal(t.aiTellCheck('네 좋습니다 😊'), '');
assert.equal(t.aiTellCheck('네 좋습니다 😊😊'), 'emoji');
assert.equal(t.aiTellCheck('네 가능해요! 오늘 새벽 3시 전까지 맞춰 드릴게요 😊'), '');
assert.equal(t.aiTellCheck('확인하겠습니다. 바로 진행하겠습니다.'), 'tone_rule');
assert.equal(t.aiTellCheck('적어주시면 좋습니당 감사합니당'), 'tone_rule');
assert.equal(t.aiTellCheck('가'.repeat(181), '', { maxChars: 180 }), 'too_long');
assert.equal(t.aiTellCheck('한 줄\n두 줄\n세 줄\n네 줄\n다섯 줄', '', { maxLines: 4 }), 'too_long');
assert.equal(t.aiTellCheck('가'.repeat(181)), '', '상한을 안 주면 검사 안 함');
assert.equal(t.aiTellCheck('금액 69,000원 · 기간 1~2일'), 'list_or_dots');
assert.equal(t.aiTellCheck('네, 바로 해 드릴게요.'), '', '9/26 준희도 쓰는 끝맺음');
assert.equal(t.aiTellCheck('Relay Desk 작업을 시작합니다.'), 'system_tone');
assert.equal(t.aiTellCheck('수정은 2회까지 가능합니다!!', '[고객] 수정은요?\n[내 답변] 수정은 2회까지 가능합니다!!'), 'repeated_sentence');
assert.equal(t.aiTellCheck('수정은 2회까지 가능합니다!!', '[고객] 수정은 2회까지 가능합니다!!'), '', '고객 말과 같은 건 반복 아님');

// 5) 대기열: 보낼 시각 전에는 내보내지 않음 · 두 번째 통은 첫 통이 나간 뒤 · 고객이 먼저 말하면 예약 취소
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-28-'));
const bridge = createAstraRoomBridge({ dataFile: path.join(tmp, 'bridge.json'), configFile: path.join(tmp, 'config.json') });
{
  const soon = new Date(Date.now() + 3 * 3600e3).toISOString();
  const q = bridge.enqueue({ eventType: 'customer_message', caseId: '235900001', idempotencyKey: 'f1', payload: { conversationId: '235900001', messageId: '', kind: 'quote_read_followup', releaseAt: soon } });
  bridge.complete(q.event.eventId, fb.responseText('SEND', { source: 'quote_read_followup', reply: '안녕하세요, 돌잔치 영상 건으로 다시 인사드려요!' }));
  assert.equal(bridge.outbox({}).length, 0, '2~4시간 전에는 안 나감');
  assert.equal(bridge.outbox({ now: Date.now() + 4 * 3600e3 }).length, 1, '시각이 되면 나감');
  assert.deepEqual(bridge.cancelScheduled('235900001', ['quote_read_followup'], 'customer_spoke_first'), [q.event.eventId], '고객이 먼저 말하면 취소');
  assert.equal(bridge.outbox({ now: Date.now() + 4 * 3600e3 }).length, 0, '취소된 안부는 안 나감');
  const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
  assert.match(server, /astraRoomBridge\.cancelScheduled\(conversationId, \['quote_read_followup', 'delayed_reply'\], 'customer_spoke_first'\)/, '고객 말이 들어오면 서버가 예약을 취소');
  assert.match(server, /chatTiming\.followupReleaseAt\(readAt, conversationId, quiet\)/, '안부 멘트는 2~4시간 예약');
}
// 6) Claude 대체 흐름(가짜 Claude): 보낼 시각 전엔 안 부름 · 긴 답은 두 통 · AI 티 걸리면 준희 알림(정해진 문구도 안 보냄)
(async () => {
  const policy = { customerRoomFallback: { enabled: true, claudeEnabled: true, waitSeconds: 60, staleDispatchMinutes: 10, maxAgeHours: 3, perTick: 5, dailyMaxCalls: 40, dailyBudgetKrw: 3000, monthlyBudgetKrw: 15000, krwPerUsd: 1500, usdPerMillionInputTokens: 3, usdPerMillionOutputTokens: 15, maxOutputTokens: 400 } };
  const R = require('../server/relay-server');
  const mkEvent = (conv, msg, claude) => {
    const q = bridge.enqueue({ eventType: 'customer_message', caseId: conv, idempotencyKey: `c:${conv}:${msg}`, payload: { conversationId: conv, messageId: `M-${conv}`, customerMessage: msg, conversationText: `[고객] ${msg}\n[내 답변] 수정은 2회까지 가능합니다!!`, replyPrompt: 'p', deterministicReply: { text: '견적 금액은 69,000원입니다. 예상 작업 기간은 1~2일입니다.', autoSend: true }, releaseAt: new Date(Date.now() + t.replyDelayMs(`M-${conv}`, msg)).toISOString() } });
    return { id: q.event.eventId, claude };
  };
  const answers = {};
  const cases = [mkEvent('235900010', '5분짜리 돌영상 편집 얼마예요?', '안녕하세요, 돌잔치 영상 원본 5분 이내면 필요 없는 부분 정리하고 자막까지 넣어서 69,000원에 해 드릴 수 있습니다. 영상 받고 1~2일 안에 MP4로 보내드리고 수정도 두 번까지 됩니다! 원하시는 완성 날짜만 알려주시면 바로 일정 잡아드릴 수 있습니다!'),
    mkEvent('235900011', '언제 받아요?', '69,000원이고 영상 받고 1~2일 안에 보내드릴 수 있습니다! 😊🎬'), // 9/26: 이모지 한 개는 준희도 씀 → 두 개면 봇 티
    mkEvent('235900012', '수정은요?', '69,000원에 1~2일이고요. 수정은 2회까지 가능합니다!!')];
  for (const c of cases) answers[c.id] = c.claude;
  let calls = 0;
  const deps = now => ({ now: () => now, readPolicy: () => policy, bridge, readState: () => ({}), writeState: () => {}, hasKey: () => true, cleanText: x => x, validReply: R.validSoomgoAiReply,
    runClaude: async () => { calls += 1; const ev = bridge.list({ eventType: 'customer_message', limit: 50 }).find(e => e.status === 'dispatched'); return { text: answers[ev.eventId], usage: {} }; } });
  const early = await fb.tick(deps(Date.now() + 60 * 1000));
  assert.equal(calls, 0, '1분 뒤: 아직 답 안 씀(1분 30초~4분)');
  assert.equal(early.handled.length, 0);
  const later = await fb.tick(deps(Date.now() + 5 * 60 * 1000));
  assert.equal(calls, 3, '4분 넘으면 답을 씀');
  const byId = Object.fromEntries(later.handled.map(h => [h.eventId, h]));
  assert.equal(byId[cases[0].id].decision, 'SEND'); assert.equal(byId[cases[0].id].parts, 2, '120자 넘는 답은 두 통');
  assert.equal(byId[cases[1].id].decision, 'ESCALATE'); assert.equal(byId[cases[1].id].reason, 'ai_tell:emoji', '이모지 두 개 이상 → 준희 알림, 정해진 문구도 안 보냄');
  assert.equal(byId[cases[2].id].decision, 'ESCALATE'); assert.equal(byId[cases[2].id].reason, 'ai_tell:repeated_sentence', '앞 답장과 같은 문장 → 알림');
  const first = bridge.get(cases[0].id);
  const second = bridge.list({ eventType: 'customer_message', limit: 50 }).find(e => e.payload?.afterEventId === cases[0].id);
  assert.ok(second && second.payload.kind === 'split_part');
  assert.ok(first.response.reply.length <= 120 && second.response.reply.length <= 120);
  const future = Date.now() + 10 * 60 * 1000;
  assert.ok(bridge.outbox({ now: future }).some(e => e.eventId === first.eventId), '첫 통은 나감');
  assert.ok(!bridge.outbox({ now: future }).some(e => e.eventId === second.eventId), '두 번째 통은 첫 통이 나가기 전엔 안 나감');
  bridge.markDelivery(first.eventId, 'sent', {});
  const sentAt = Date.parse(bridge.get(first.eventId).deliveryUpdatedAt);
  assert.ok(!bridge.outbox({ now: sentAt + 10 * 1000 }).some(e => e.eventId === second.eventId), '10초 뒤엔 아직');
  assert.ok(bridge.outbox({ now: sentAt + 41 * 1000 }).some(e => e.eventId === second.eventId), '20~40초 뒤 두 번째 통');
  // 고객이 새로 말하면 옛 메시지 답은 닫히고 새 메시지로 판단(기존 규칙): 두 번째 통·예약은 "새 메시지" 판정에서 빠진다
  assert.equal(fb.closeReason({ eventId: 'X', createdAt: new Date().toISOString(), payload: { conversationId: '235900010' } }, [second], { maxAgeMs: 3 * 3600e3 }, Date.now()), '', '예약·두 번째 통은 고객 새 메시지로 안 셈');
  assert.equal(netCalls, 0, '외부 호출 없음');
  console.log('chat-timing-28: PASS');
})().catch(error => { console.error(error); process.exit(1); });
