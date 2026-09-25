'use strict';

// 개발방 지시 19 (2026-09-24, decisions 7-10): 견적 판단(감독 스타일)을 Claude에게. 스위치 기본 꺼짐(quote-judge-on.bat).
// 합성 요청 5건 + 가짜 Claude만. 실제 숨고 발송·삭제·유료 API 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const R = require('../server/relay-server');
const rules = require('../server/soomgo-auto-rules');
const registry = require('../server/service-registry');
const qj = require('../server/quote-judge');
const root = path.join(__dirname, '..');
const supported = registry.listServices({ channel: 'soomgo' }).map(service => service.id);
const policyFile = JSON.parse(fs.readFileSync(path.join(root, 'server', 'config', 'astra-relay-operating-policy.json'), 'utf8'));

// 0) 스위치·한도 값, bat, 유료 호출 예외는 스위치가 켜졌을 때만
assert.equal(typeof policyFile.quoteJudge.enabled, 'boolean');
assert.equal(policyFile.quoteJudge.dailyMaxCalls, 40, '하루 40회(채팅봇과 따로)');
assert.equal(policyFile.quoteJudge.dailyMaxAutoSends, 10, '자동 발송 하루 10건');
assert.equal(policyFile.quoteJudge.model, 'claude-opus-5-5');
for (const mode of ['on', 'off']) assert.match(fs.readFileSync(path.join(root, `quote-judge-${mode}.bat`), 'utf8'), new RegExp(`node scripts\\\\quote-judge-switch\\.cjs ${mode}`));
const server = fs.readFileSync(path.join(root, 'server', 'relay-server.js'), 'utf8');
assert.match(server, /options\.trigger === 'quote_judge' && provider === 'Claude'[\s\S]{0,200}judge\?\.enabled === true\) return;/, '견적 판단 호출은 quoteJudge.enabled일 때만 통과');
assert.equal((server.match(/trigger: 'quote_judge'/g) || []).length, 1, '예외 표시는 견적 판단 한 곳');
const off = { ...policyFile, quoteJudge: { ...policyFile.quoteJudge, enabled: false } };
const on = { ...policyFile, quoteJudge: { ...policyFile.quoteJudge, enabled: true } };
assert.equal(qj.readConfig(off), null, '꺼져 있으면 아무것도 안 함');
assert.equal(qj.readConfig(on).monthlyBudgetKrw, 15000, '월 금액은 채팅봇과 같은 한도');

const mk = (id, body, extra = {}) => ({ requestId: id, text: `요청 상세\n고객 정보\n견적 보낸 고수 2명\n30분 전\n${body}\n고객 정보\n신고하기\n홍길동\n연락처 010-1234-5678 hong@example.com\n`, ...extra });
const ruleQuote = (input, video = false) => {
  const { parsed, quote } = R.buildSoomgoQuote(input);
  rules.applySoomgoAutoRules({ body: input, request: parsed, quote, requestedServiceId: null, existingLead: null, state: {}, requestId: input.requestId, supportedServiceIds: supported, sampleAmount: a => a, videoAutoQuoteConfig: { enabled: video } });
  return { parsed, quote };
};
const answers = {};
let lastPrompt = '';
const deps = (state = {}) => ({ readPolicy: () => on, readState: () => state, hasKey: () => true, runClaude: async prompt => { lastPrompt = prompt; const fields = prompt.split('[숨고 요청 칸')[1].split('[서버 계산]')[0]; const key = Object.keys(answers).find(k => fields.includes(k)); return { text: answers[key] || '판단: 보류 — 모름', usage: { input_tokens: 3000, output_tokens: 300 }, model: 'claude-opus-5-5' }; } });

(async () => {
  // 1) 영상 편집 10분 토의 → 보내기 추천 · 서버 금액 69,000원과 같음 → 자동 발송
  {
    const input = mk('6ab4c9b7ee47727f22e94601', '영상 편집\n\n서비스 분야\n미니포럼 토의 영상\n원본 길이\n10분 이내', { volume: '10분 이내' });
    const { parsed, quote } = ruleQuote(input);
    assert.equal(qj.eligible(quote), true, '규칙이 사람 확인으로 남긴 영상 편집');
    answers['미니포럼 토의 영상'] = '판단: 보내기 추천 — 토의 영상이라 컷편집+자막 범위에 맞고 견적 보낸 고수 2명.\n견적 금액: 69,000원\n견적 설명:\n안녕하세요. 미니포럼 토의 영상 편집 건 확인했습니다. 불필요한 부분을 다듬고 발언 자막을 넣어 69,000원에 1~2일 안에 드립니다(수정 2회 포함). 토의 영상은 이미 촬영해 두셨을까요?';
    const out = await qj.attempt({ requestId: input.requestId, request: parsed, quote, deps: deps() });
    assert.equal(out.action, 'send');
    assert.ok(!/홍길동|010-1234-5678|hong@example\.com/.test(lastPrompt), '이름·연락처가 호출에 없음');
    assert.match(lastPrompt, /너는 Swan\(숨고 고수\) 운영 감독이다/, '프롬프트 원문(docs/quote-judge-prompt.md)');
    assert.match(lastPrompt, /\[docs\/astra-brief\.md/, 'astra-brief 포함'); assert.match(lastPrompt, /## 7-4\. 영상 편집 판매/, 'decisions 7-4 포함');
    qj.applyResult(quote, out, parsed);
    assert.equal(quote.autoSend, true); assert.equal(quote.amount, 69000); assert.equal(quote.autoRule.ruleId, 'quote_judge_send');
    assert.match(quote.quoteJudge.head, /^견적 판단 · 영상 편집 · 69,000원 · 보내기 추천$/, '알림 첫 줄');
  }
  // 2) 돌영상 스토리보드(길이 모름) → 추천이어도 서버 금액이 없어 자동 발송 안 함 → 알림(보류)
  {
    const input = mk('6ab4c9b7ee47727f22e94602', '영상 편집\n\n서비스 분야\n돌잔치 영상\n요청 사항\n스토리보드대로 만들어 주세요');
    const { parsed, quote } = ruleQuote(input);
    answers['돌잔치 영상'] = '판단: 보내기 추천 — 스토리보드가 있어 범위가 분명함. 견적에 샘플 캡처 첨부\n견적 금액: 69,000원\n견적 설명:\n안녕하세요. 돌잔치 영상 건 확인했습니다. 콘티대로 만든 샘플 영상이 프로필 포트폴리오에 있고, 견적에 장면 캡처도 붙였습니다. 원본 10분 이내면 69,000원입니다. 원본 길이가 어느 정도일까요?';
    const out = await qj.attempt({ requestId: input.requestId, request: parsed, quote, deps: deps() });
    assert.equal(out.action, 'hold'); assert.equal(out.judge.sendBlocked, 'amount_mismatch'); // 9/25: 돌잔치는 서버 시작가 89,000원이 생겨, Claude가 다른 금액(69,000원)을 쓰면 여전히 보류
    qj.applyResult(quote, out, parsed);
    assert.equal(quote.autoSend, false); assert.equal(quote.manualReview, true, '준희 알림');
    assert.match(quote.reason, /^견적 판단 · 영상 편집 · 69,000원 · 보내기 추천/);
    assert.match(quote.reason, /견적 설명 초안:/);
  }
  // 3) 기업 영상 5분 → 보류 판단 → 알림
  {
    const input = mk('6ab4c9b7ee47727f22e94603', '영상 편집\n\n서비스 분야\n기업 홍보 영상\n원본 길이\n5분 이내\n요청 사항\n모션그래픽 로고 애니메이션', { volume: '5분 이내' });
    const { parsed, quote } = ruleQuote(input);
    answers['기업 홍보 영상'] = '판단: 보류 — 모션그래픽 로고가 핵심이라 범위 밖일 수 있음\n견적 금액: 69,000원\n견적 설명:\n안녕하세요. 기업 홍보 영상 건 확인했습니다. 컷편집과 자막은 69,000원에 해 드릴 수 있습니다. 로고 애니메이션이 꼭 필요하신가요?';
    const out = await qj.attempt({ requestId: input.requestId, request: parsed, quote, deps: deps() });
    assert.equal(out.action, 'hold'); qj.applyResult(quote, out, parsed);
    assert.equal(quote.autoSend, false); assert.equal(quote.deleteRequest, false);
  }
  // 4) 자소서 대필 → 보내지 않음 → 삭제 판정(실제 숨고 삭제는 안 함). 규칙이 이미 삭제로 정하면 판단은 안 부름
  {
    const input = mk('6ab4c9b7ee47727f22e94604', '문서/글 작성\n\n작성 주제\n대기업 공채 자기소개서 대필\n작업 분량\nA4 2쪽', { purpose: '자기소개서', topic: '대기업 공채 자기소개서 대필' });
    const { parsed, quote } = ruleQuote(input);
    if (quote.deleteRequest === true) assert.equal(qj.eligible(quote), false, '규칙이 이미 삭제 → 판단 호출 안 함');
    const manual = { ...quote, deleteRequest: false, autoSend: false, manualReview: true, unsupportedService: null, autoRule: null };
    answers['자기소개서 대필'] = '판단: 보내지 않음 — 자소서 대필은 판매하지 않음\n견적 금액: 0원\n견적 설명:\n(없음)';
    const out = await qj.attempt({ requestId: input.requestId, request: parsed, quote: manual, deps: deps() });
    assert.equal(out.action, 'delete'); qj.applyResult(manual, out, parsed);
    assert.equal(manual.deleteRequest, true); assert.equal(manual.autoSend, false); assert.equal(manual.autoRule.ruleId, 'quote_judge_delete');
    const summary = qj.dailySummary({ soomgoLeads: [{ createdAt: new Date().toISOString(), request: { soomgoCategory: '문서/글 작성' }, quote: manual }] });
    assert.match(summary.line, /^견적 판단 삭제 1건\(문서\/글 작성 1\)$/, '폰 알림은 하루 요약 1줄');
  }
  // 5) 문서 3쪽 → 숨고 문서 자동 견적 멈춤(7-13)이면 판단 안 함 / 켜져 있으면 규칙이 자동 견적(판단 안 함)
  {
    const input = mk('6ab4c9b7ee47727f22e94605', '문서/글 작성\n\n작업 분량\nA4 3쪽\n작성 주제\n사업 안내문 작성', { purpose: '문서/글 작성', volume: 'A4 3쪽', topic: '사업 안내문 작성' });
    const { quote } = ruleQuote(input);
    assert.equal(qj.eligible(quote), false, '문서는 판단 대상 아님(멈춤 또는 규칙 자동 견적)');
  }
  // 6) 한도: 하루 40회 · 월 금액(채팅봇과 합쳐) · 하루 자동 발송 10건
  {
    const input = mk('6ab4c9b7ee47727f22e94606', '영상 편집\n\n서비스 분야\n미니포럼 토의 영상\n원본 길이\n10분 이내', { volume: '10분 이내' });
    const { parsed, quote } = ruleQuote(input);
    const day = qj.kstDay();
    const calls = { quoteJudgeLog: Array.from({ length: 40 }, () => ({ day, called: true, krw: 1 })) };
    assert.equal((await qj.attempt({ requestId: input.requestId, request: parsed, quote, deps: deps(calls) })).capped, 'daily_call_cap');
    const month = { customerRoomFallbackLog: Array.from({ length: 30 }, () => ({ day, called: true, krw: 400 })), quoteJudgeLog: [{ day, called: true, krw: 3500 }] };
    assert.equal((await qj.attempt({ requestId: input.requestId, request: parsed, quote, deps: deps(month) })).capped, 'monthly_budget_cap', '채팅봇 12,000 + 판단 3,500 ≥ 15,000');
    const sends = { quoteJudgeLog: Array.from({ length: 10 }, () => ({ day, called: true, autoSend: true, krw: 1 })) };
    const out = await qj.attempt({ requestId: input.requestId, request: parsed, quote, deps: deps(sends) });
    assert.equal(out.action, 'hold'); assert.equal(out.judge.sendBlocked, 'daily_auto_send_cap', '11번째 추천은 알림');
    const offOut = await qj.attempt({ requestId: input.requestId, request: parsed, quote, deps: { ...deps(), readPolicy: () => off } });
    assert.equal(offOut, null, '꺼져 있으면 호출 없음');
  }
  // 7) 금액 검사: 서버 금액과 다르거나 다른 금액이 섞이면 자동 발송 안 함
  {
    const q = { videoEdit: { amount: 69000 }, amount: 69000 };
    assert.equal(qj.sendCheck({ amount: 79000, message: '79,000원' }, q), 'amount_mismatch');
    assert.equal(qj.sendCheck({ amount: 69000, message: '69,000원, 급하면 89,000원' }, q), 'message_other_amount');
    assert.equal(qj.sendCheck({ amount: 69000, message: '69,000원에 해 드릴 수 있습니다.' }, q), '');
  }
  assert.equal(netCalls, 0, '외부 호출 없음');
  console.log('quote-judge-19: PASS');
})().catch(error => { console.error(error); process.exit(1); });
