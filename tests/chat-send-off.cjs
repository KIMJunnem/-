'use strict';
// 2026-09-23 준희 결정(decisions.md 6번): 숨고 고객 채팅 답장은 아스트라만.
// Relay Desk 채팅봇은 읽고 기록만 하고 보내지 않는다. Claude 대체도 끈다. 외부 호출 없음.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));

// 1) 정책 값 — 9/24 지시 24: 실제 스위치는 준희가 chatbot-on.bat / chatbot-off.bat로 정한다(decisions 7-5).
//    시험은 실제 값에 기대지 않고, 시험용 설정(꺼짐·켜짐 두 벌)으로 안전장치가 각각 지켜지는지 본다.
//    실제 파일은 세 스위치가 함께 움직였는지만 본다(한쪽만 켜진 상태 = 스크립트 밖 수정 → 실패).
assert.equal(typeof policy.soomgoChat.sendEnabled, 'boolean', '채팅봇 발송 스위치');
assert.equal(policy.customerRoomFallback.enabled, policy.soomgoChat.sendEnabled, '발송·대체 스위치 함께');
assert.equal(policy.customerRoomFallback.claudeEnabled, policy.soomgoChat.sendEnabled, '발송·Claude 스위치 함께');
const withSwitches = on => ({ ...policy, soomgoChat: { ...policy.soomgoChat, sendEnabled: on }, customerRoomFallback: { ...policy.customerRoomFallback, enabled: on, claudeEnabled: on } });
const offPolicy = withSwitches(false);
const onPolicy = withSwitches(true);
assert.equal(offPolicy.soomgoChat.sendEnabled, false, '꺼짐 설정: 채팅봇 발송 끔');
assert.equal(offPolicy.customerRoomFallback.claudeEnabled, false, '꺼짐 설정: Claude 대체 끔');

// 2) 서버: /api/soomgo/control GET이 chatSendEnabled를 정책에서 읽어 준다. paused(전체 정지·감시 탭 재로드)와는 따로다.
const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
const control = server.slice(server.indexOf("if (pathname === '/api/soomgo/control' && req.method === 'GET')"), server.indexOf("if (pathname === '/api/soomgo/control' && req.method === 'POST')"));
assert.match(control, /chatSendEnabled = readOperatingPolicy\(\)\.soomgoChat\?\.sendEnabled !== false/);
assert.match(control, /sendJson\(res, 200, \{ paused: automationPaused\(\), chatSendEnabled \}\)/);

// 3) 채팅봇: chatSendEnabled:false면 발송 관문(serverPaused)이 닫힌다 — 고객 글 종류와 상관없이
const bot = fs.readFileSync(path.join(root, 'soomgo-chat-bot', 'chat-content.js'), 'utf8');
const gate = bot.slice(bot.indexOf('  const controlState = '), bot.indexOf('  const setGlobalPause = '));
const makeGate = response => new Function('fetch', 'AbortSignal', `${gate}; return { serverPaused, controlState };`)(async () => ({ ok: true, json: async () => response }), { timeout: () => undefined });
(async () => {
  const off = makeGate({ paused: false, chatSendEnabled: false });
  assert.equal(await off.serverPaused(true), true, '발송 끔이면 관문 닫힘');
  assert.equal(off.controlState.sendOff, true);
  const on = makeGate({ paused: false, chatSendEnabled: true });
  assert.equal(await on.serverPaused(true), false, '켜져 있으면 예전처럼 열림');
  const old = makeGate({ paused: false });
  assert.equal(await old.serverPaused(true), false, '값이 없는 옛 서버는 예전처럼');
  const paused = makeGate({ paused: true, chatSendEnabled: true });
  assert.equal(await paused.serverPaused(true), true, '전체 정지는 그대로 닫힘');

  // 고객에게 나가는 동작(글 보내기·파일 첨부·결제 요청 누르기)은 모두 이 관문을 먼저 지난다
  for (const fn of ['async function sendChatText(message) {', 'async function attachWorkflowFile(delivery) {']) {
    const at = bot.indexOf(fn);
    assert.ok(at > 0, fn);
    assert.ok(bot.slice(at, at + 400).includes('await serverPaused(true)'), `${fn} 관문 확인`);
  }
  const pay = bot.slice(bot.indexOf('async function requestSoomgoPayment(workflow) {'));
  assert.ok(pay.slice(0, pay.indexOf('submit.click();')).includes('await serverPaused(true)'), '결제 요청 누르기 전 관문');
  // 글을 실제로 보내는 곳은 sendChatText 하나뿐(모든 답장·P4·정해진 문구·납품 안내가 이 함수를 부른다)
  const sendCalls = (bot.match(/await sendChatText\(/g) || []).length;
  assert.ok(sendCalls >= 8, `sendChatText 호출 ${sendCalls}곳`);
  assert.match(bot, /if \(controlState\.sendOff\) renderStatus\('발송 끔 · 기록만'/);
  // 감시 탭 재로드(auto-update.js)는 paused만 본다 → 발송 끔이어도 멈춘 탭은 되살린다
  assert.match(fs.readFileSync(path.join(root, 'soomgo-chat-bot', 'auto-update.js'), 'utf8'), /control\.paused\) return;/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'soomgo-chat-bot', 'manifest.json'), 'utf8')).version, '0.3.25'); // 9/24 지시 15: 0.3.24 = 0.3.23 + 감지 전용 customer-observer(8791), 발송 코드 변경 없음

  // 4) Claude 대체
  const fb = require('../server/customer-room-fallback');
  const now = Date.parse('2026-09-23T07:00:00Z');
  const day = fb.kstDay(now);
  const runTick = async (usePolicy, state = {}) => {
    let claudeCalls = 0; const completed = [];
    const event = { eventId: 'AR-1', eventType: 'customer_message', status: 'pending', createdAt: new Date(now - 120000).toISOString(), payload: { conversationId: '235919723', replyPrompt: 'p', deterministicReply: { text: '네, 확인했습니다.', autoSend: true } } };
    const result = await fb.tick({
      now: () => now,
      readPolicy: () => usePolicy,
      bridge: { list: () => [event], claim: () => ({ duplicate: false }), complete: (id, text) => completed.push(text), fail: () => {} },
      readState: () => state, writeState: () => {},
      runClaude: async () => { claudeCalls += 1; return { text: 'x' }; },
      hasKey: () => true, cleanText: t => t, validReply: () => true
    });
    return { result, claudeCalls, completed };
  };
  // 4-1) 꺼짐 설정: 키가 있어도 Claude를 부르지 않고, 사건을 아예 가져가지 않는다
  const offTick = await runTick(offPolicy);
  assert.equal(offTick.claudeCalls, 0, '꺼짐: Claude 호출 0회');
  assert.equal((offTick.result.handled || []).length, 0, '꺼짐: 가져간 사건 0');
  // 4-2) 합치기만 켜지고 Claude가 꺼진 설정: Claude는 건너뛴다
  const half = await runTick({ ...offPolicy, customerRoomFallback: { ...offPolicy.customerRoomFallback, enabled: true } });
  assert.equal(half.claudeCalls, 0, 'Claude 꺼짐: 호출 0회');
  assert.equal(half.result.handled[0]?.reason, 'claude_disabled');
  // 4-3) 켜짐 설정: 한도(하루 건수)에 닿으면 Claude를 부르지 않고 정해진 문구도 보내지 않는다(준희 알림으로 넘김)
  const capped = await runTick(onPolicy, { customerRoomFallbackLog: Array.from({ length: Number(onPolicy.customerRoomFallback.dailyMaxCalls) }, () => ({ day, called: true, krw: 10 })) });
  assert.equal(capped.claudeCalls, 0, '켜짐+하루 한도: Claude 호출 0회');
  assert.match(capped.completed[0] || '', /\[DECISION:ESCALATE\]/, '켜짐+하루 한도: 발송 없이 준희 확인');
  // 4-4) 켜짐 설정 + 자동 유료 호출 전체 정지 값은 그대로(채팅봇 예외 한 곳 말고는 막힘 — tests/paid-api-guard.cjs)
  assert.equal(onPolicy.spendControls.automaticPaidQuotesPaused, true, '켜짐이어도 다른 자동 유료 호출은 정지');
  console.log('chat-send-off: PASS');
})().catch(error => { console.error(error); process.exit(1); });
