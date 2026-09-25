'use strict';

// G-1 3단계: 파이버 영어 답장 초안 — 가짜 Claude만, 실제 호출 0회.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const gr = require('../server/global-reply');
const root = path.join(__dirname, '..');
const policyFile = JSON.parse(fs.readFileSync(path.join(root, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));
const fiverr = JSON.parse(fs.readFileSync(path.join(root, 'services', 'subtitle.json'), 'utf8')).channels.fiverr;

// 0) 정책: 켜짐, 하루 20건·1,400원
assert.equal(policyFile.globalReply.enabled, true); assert.equal(policyFile.globalReply.dailyMaxCalls, 20); assert.equal(policyFile.globalReply.dailyBudgetKrw, 1400);
assert.equal(policyFile.globalReply.model, 'claude-haiku-4-5'); assert.equal(policyFile.globalReply.usdPerMillionInputTokens, 1); assert.equal(policyFile.globalReply.usdPerMillionOutputTokens, 5);

// 1) 금액 계산(정의 파일 값). 2026-09-23 준희: 파이버 5달러 단위 → $25/$45/$75, 자막 입히기는 파이버 옵션 없음 → 맞춤 견적
assert.equal(gr.priceFor(fiverr, { minutes: 4 }).usd, 25);
assert.equal(gr.priceFor(fiverr, { minutes: 5 }).usd, 25);
assert.equal(gr.priceFor(fiverr, { minutes: 6 }).usd, 45);
assert.equal(gr.priceFor(fiverr, { minutes: 30 }).usd, 75);
assert.deepEqual([gr.priceFor(fiverr, { minutes: 12, burnIn: true }).reason, gr.priceFor(fiverr, { minutes: 12, burnIn: true }).burnIn], ['custom_offer', true], '자막 입히기 요청 = 맞춤 견적');
const offered = { ...fiverr, options: fiverr.options.map(o => ({ ...o, offeredOnFiverr: true })) };
assert.equal(gr.priceFor(offered, { minutes: 12, burnIn: true }).usd, 75 + 3 * 11, '옵션을 다시 켜면 5분 단위 계산은 그대로');
assert.ok(!/Optional: subtitles burned/.test(gr.buildPrompt ? gr.buildPrompt({ message: 'x', fiverr }) : 'x'), '옵션 없을 때 프롬프트가 삽입을 기본 옵션으로 말하지 않음');
assert.equal(gr.priceFor(fiverr, { minutes: 31 }).reason, 'custom_offer');
assert.equal(gr.priceFor(fiverr, { minutes: null }).reason, 'minutes_unknown');
assert.equal(gr.priceFor(fiverr, { minutes: 4 }).deliveryDays, 2); assert.equal(gr.priceFor(fiverr, { minutes: 8 }).deliveryDays, 2); assert.equal(gr.priceFor(fiverr, { minutes: 25 }).deliveryDays, 3);
assert.equal(gr.priceFor(fiverr, { minutes: 8 }).pendingApproval, false);
assert.match(gr.priceLines(gr.priceFor(fiverr, { minutes: 8 })).en, /^Price: \$45 · Delivery within 2 days after I receive the video · 2 revisions included$/);
assert.match(gr.priceLines(gr.priceFor({ ...fiverr, pendingApproval: true }, { minutes: 8 })).en, /^\[가격 승인 전\] Price: \$45/);
assert.match(gr.priceLines(gr.priceFor(fiverr, { minutes: 45 })).en, /맞춤 견적/);

const good = { messageKo: '10분짜리 영어 유튜브 영상에 한국어 자막이 필요해요.', replyEn: 'Thanks for your message. You need Korean subtitles for a 10-minute English YouTube video.\n{{PRICE_LINE}}\nI check the timing across the whole video, not just a few spots.\nDo you need the subtitles burned into the video, or SRT only?', replyKo: '메시지 감사합니다. 10분 영어 유튜브 영상에 한국어 자막이 필요하시군요.\n{{PRICE_LINE}}\n몇 군데만이 아니라 영상 전체 싱크를 확인합니다.\n자막을 영상에 입혀야 하나요, SRT만 필요하신가요?', detected: { minutes: 10, sourceLanguage: 'English', burnIn: null, inScope: true } };
const mk = (out, extra = {}) => {
  const calls = [];
  let state = { globalReplyLog: extra.log || [] };
  const deps = { readPolicy: () => extra.policy || policyFile, hasKey: () => extra.key !== false, model: 'claude-fable-5-1', fiverr: () => fiverr, runClaude: async (prompt, opts) => { calls.push({ prompt, opts }); if (extra.fail) throw new Error('boom'); return { text: typeof out === 'string' ? out : JSON.stringify(out), usage: { input_tokens: 1200, output_tokens: 500 } }; } };
  return { calls, state, deps };
};

(async () => {
  // 2) 정상: 금액 줄은 서버가 채움, 모델에 금액을 주지 않음
  let t = mk(good);
  let r = await gr.draft({ message: 'Hi, I need Korean subs for my 10 min English YouTube video. email me at a@b.com', state: t.state, deps: t.deps });
  assert.equal(r.ok, true); assert.equal(t.calls.length, 1);
  assert.match(r.replyEn, /Price: \$45 · Delivery within 2 days/); assert.match(r.replyKo, /금액 \$45 · 영상 받은 뒤 2일 안에 납품 · 수정 2회 포함/);
  assert.ok(!r.replyEn.includes('{{PRICE_LINE}}'));
  assert.ok(!/\$\d/.test(t.calls[0].prompt), '프롬프트에 금액 없음'); assert.ok(t.calls[0].prompt.includes('[email]') && !t.calls[0].prompt.includes('a@b.com'), '이메일 가림');
  assert.equal(t.calls[0].opts.maxTokens, 900); assert.equal(t.calls[0].opts.model, 'claude-haiku-4-5', '정책의 모델로 호출');
  assert.deepEqual(r.issues, []); assert.equal(r.messageId, 'fiverr.reply.v1');
  const expectedKrw = Math.round(((1200 * 1 + 500 * 5) / 1e6) * 1500 * 100) / 100;
  assert.equal(r.cost.krw, expectedKrw); assert.equal(r.log.krw, expectedKrw);
  // 화면 입력이 모델 추정보다 우선(길이·삽입)
  t = mk(good); r = await gr.draft({ message: 'x', hints: { minutes: 3, burnIn: true }, state: t.state, deps: t.deps });
  assert.equal(r.price.reason, 'custom_offer'); assert.equal(r.price.burnIn, true); assert.match(r.replyEn, /맞춤 견적/); assert.ok(!/Price: \$/.test(r.replyEn), '삽입 요청은 금액 줄 대신 맞춤 견적');

  // 3) 모델이 금액을 직접 쓰거나 질문 2개·허위 표현 → 경고 표시(보내지는 않음)
  t = mk({ ...good, replyEn: 'It costs $50. 100% human made! Is it long? Is it English?\n{{PRICE_LINE}}' });
  r = await gr.draft({ message: 'x', state: t.state, deps: t.deps });
  assert.ok(r.issues.includes('model_wrote_price') && r.issues.includes('more_than_one_question') && r.issues.includes('forbidden_claim'));
  // 범위 밖 → 금액 줄 없음
  t = mk({ ...good, detected: { ...good.detected, inScope: false } }); r = await gr.draft({ message: 'x', state: t.state, deps: t.deps });
  assert.equal(r.price.reason, 'out_of_scope'); assert.ok(!/Price:/.test(r.replyEn));

  // 4) 꺼짐·키 없음·빈 메시지 → 호출 0
  for (const [extra, err, msg] of [[{ policy: { globalReply: { ...policyFile.globalReply, enabled: false } } }, 'global_reply_disabled', 'x'], [{ key: false }, 'claude_key_missing', 'x'], [{}, 'message_empty', '  ']]) {
    t = mk(good, extra); r = await gr.draft({ message: msg, state: t.state, deps: t.deps });
    assert.equal(r.ok, false); assert.equal(r.error, err); assert.equal(t.calls.length, 0);
  }
  // 5) 하루 상한: 20건 / 1,400원
  const today = gr.kstDay();
  t = mk(good, { log: Array.from({ length: 20 }, () => ({ day: today, called: true, krw: 1 })) });
  r = await gr.draft({ message: 'x', state: t.state, deps: t.deps }); assert.equal(r.error, 'daily_max_calls'); assert.equal(t.calls.length, 0);
  t = mk(good, { log: [{ day: today, called: true, krw: 1399.9 }] });
  r = await gr.draft({ message: 'x', state: t.state, deps: t.deps }); assert.equal(r.error, 'daily_budget_krw'); assert.equal(t.calls.length, 0);
  t = mk(good, { log: Array.from({ length: 20 }, () => ({ day: '2000-01-01', called: true, krw: 999 })) });
  r = await gr.draft({ message: 'x', state: t.state, deps: t.deps }); assert.equal(r.ok, true, '어제 기록은 안 셈');
  // 6) 호출 실패·해석 실패 → 기록은 남기고(비용 집계) 실패로 돌려줌, 재시도 없음
  t = mk(good, { fail: true }); r = await gr.draft({ message: 'x', state: t.state, deps: t.deps });
  assert.equal(r.error, 'call_failed'); assert.equal(t.calls.length, 1); assert.equal(r.log.called, true);
  // 잔액 부족·인증 실패 → api_unavailable 한 줄, 재시도 없음(호출 1번)
  for (const msg of ['claude_400_Your credit balance is too low to access the Anthropic API.', 'claude_401_invalid x-api-key', 'claude_403_permission_error']) {
    const t2 = mk(good); t2.deps.runClaude = async (prompt, opts) => { t2.calls.push({ prompt, opts }); throw new Error(msg); };
    const r2 = await gr.draft({ message: 'x', state: t2.state, deps: t2.deps });
    assert.equal(r2.error, 'api_unavailable', msg); assert.equal(t2.calls.length, 1); assert.equal(r2.log.krw, 0);
  }
  assert.equal(gr.isBalanceOrAuthError('claude_529_overloaded'), false);
  t = mk('not json'); r = await gr.draft({ message: 'x', state: t.state, deps: t.deps });
  assert.equal(r.error, 'parse_failed'); assert.equal(t.calls.length, 1);
  const st = {}; gr.appendLog(st, r.log); assert.equal(gr.todayUsage(st).calls, 1);

  // 7) 서버·화면: 로컬 전용, 보내기 없음, 파이버 페이지 접근 없음
  const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
  for (const p of ["'/api/global/reply-draft'", "'/api/global/reply-usage'"]) {
    const at = server.indexOf(`pathname === ${p}`); assert.ok(at > 0, p);
    assert.ok(server.slice(at, at + 300).includes('write_server_local_only'), `${p} 로컬 전용`);
  }
  const page = fs.readFileSync(path.join(root, 'dist', 'global-reply.html'), 'utf8');
  const script = page.match(/<script>([\s\S]*)<\/script>/)[1];
  const fetches = [...script.matchAll(/fetch\('([^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(fetches, ['/api/global/reply-draft', '/api/global/reply-usage']);
  assert.ok(!/fiverr\.com|upwork\.com|send\(|sendMessage/i.test(script), '보내기·외부 페이지 없음');
  assert.ok(script.includes("api_unavailable: 'API 잔액이 없어 초안을 만들 수 없습니다'"), '잔액 안내 문구');
  assert.match(server, /const model = options\.model \? String\(options\.model\) : \(process\.env\.CLAUDE_MODEL \|\| 'claude-fable-5-1'\);/, 'runClaude 기본 모델은 그대로');
  const mod = fs.readFileSync(path.join(root, 'server', 'global-reply.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/fetch\(|https?:\/\//.test(mod), '모듈은 직접 네트워크를 쓰지 않음(기존 runClaude만)');
  for (const dir of ['soomgo-bot-extension', 'soomgo-chat-bot', 'kmong-bot-extension']) for (const f of fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.js'))) assert.ok(!/global-reply|reply-draft/.test(fs.readFileSync(path.join(root, dir, f), 'utf8')), f);
  assert.equal(netCalls, 0);
  console.log('global-reply: PASS');
})().catch(error => { console.error(error); process.exit(1); });
