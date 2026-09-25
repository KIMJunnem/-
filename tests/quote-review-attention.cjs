'use strict';

// 사람 확인 판정 견적 요청 → 알림 목록(quote_review) 회귀 검사.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const qr = require('../server/quote-review-attention');

const TEXT = '요청 상세\n고객 정보\n견적 보낸 고수 6명\n1시간 전\n교정/교열\n\n일주일 이내로 진행하고 싶어요\n\n서울 강서구\n\n희망 서비스\n교정교열 + 윤문\n작성 언어\n영어\n문서 유형\n보고서\n작업 분량\n영문 보고서 워드 150쪽 내외\n고객 정보\n신고하기\n\n홍길순\n\n2026년 9월 21일 가입숨고 1회 이용';
const request = { text: TEXT, purpose: '교정/교열', scope: '교정교열 + 윤문', volume: '영문 보고서 워드 150쪽 내외', deadline: '' };
const quote = { serviceId: 'translation_en', label: '영어 번역', amount: 55000, manualReview: true, autoSend: false, reason: 'swan 계정 제공 서비스 외 요청입니다.' };
const t0 = new Date('2026-09-21T12:55:57.778Z');

const state = {};
const first = qr.upsertQuoteReview(state, { requestId: '6ab11a5d8cb44e6297d6d39a', request, quote, receivedAt: t0.toISOString(), supported: false, now: t0 });
assert.equal(first.created, true);
const item = state.attentionItems[0];
assert.equal(item.type, 'quote_review');
assert.equal(item.category, '교정/교열');
assert.equal(item.prosQuoted, 6);
assert.equal(item.amountLabel, '금액 미정', '판매하지 않는 서비스의 임시 계산가는 쓰지 않음');
assert.match(item.summary, /분량: 영문 보고서 워드 150쪽 내외/);
assert.match(item.summary, /기한: 일주일 이내로 진행하고 싶어요/);
assert.ok(!JSON.stringify(state).includes('홍길순'), '고객 이름 저장 금지');
assert.match(item.summary, /예산: 미기재/, '예산 항목이 없으면 미기재');
assert.equal(qr.budgetHint({ text: '희망 서비스\n교정\n예산\n10만원~20만원\n작업 분량\n5쪽' }), '10만원~20만원');
assert.equal(qr.budgetHint({ text: '예산: 협의 가능' }), '협의 가능');
assert.equal(qr.budgetHint({ text: '예산\n고객 정보' }), '', '다음 줄이 금액이 아니면 읽지 않음');
const withBudget = {};
qr.upsertQuoteReview(withBudget, { requestId: 'BUDGET1', request: { ...request, text: TEXT.replace('작업 분량', '예산\n30만원\n작업 분량') }, quote, now: t0 });
assert.equal(withBudget.attentionItems[0].budget, '30만원');
assert.equal(qr.attentionView(withBudget.attentionItems[0], t0).budget, '30만원');
assert.match(withBudget.attentionItems[0].summary, /예산: 30만원/);
assert.ok(!JSON.stringify(state).includes('강서구'), '원문 저장 금지');

// 봇이 다시 열어도 중복 등록하지 않음
for (let i = 1; i <= 3; i += 1) qr.upsertQuoteReview(state, { requestId: '6ab11a5d8cb44e6297d6d39a', request, quote, supported: false, now: new Date(t0.getTime() + i * 600000) });
assert.equal(state.attentionItems.length, 1);
assert.equal(state.attentionItems[0].seenCount, 4);

// 긴급도: 처음엔 아님 → 12시간 뒤 긴급
let view = qr.attentionView(item, new Date(t0.getTime() + 3600000));
assert.equal(view.urgent, false);
assert.equal(view.pros, '6/10');
view = qr.attentionView(item, new Date(t0.getTime() + 12 * 3600000 + 1000));
assert.equal(view.urgent, true);
assert.deepEqual(view.urgentReasons, ['접수 후 12시간 경과']);

// 고수 8명 → 긴급, 10명 → 자동 닫힘
const s2 = {};
qr.upsertQuoteReview(s2, { requestId: 'REQ8', request: { ...request, text: TEXT.replace('6명', '8명') }, quote, supported: true, now: t0 });
assert.equal(qr.attentionView(s2.attentionItems[0], t0).urgent, true);
assert.equal(s2.attentionItems[0].amountLabel, '55,000원', '판매 서비스는 계산가 표시');
qr.upsertQuoteReview(s2, { requestId: 'REQ8', request: { ...request, text: TEXT.replace('6명', '10명') }, quote, supported: true, now: t0 });
assert.equal(s2.attentionItems[0].status, 'resolved');
assert.equal(s2.attentionItems[0].resolution, 'quote_closed_10');

// 자동 발송·삭제 대상은 등록 안 함
const s3 = {};
assert.equal(qr.upsertQuoteReview(s3, { requestId: 'A', request, quote: { ...quote, manualReview: false } }).changed, false);
assert.equal(qr.upsertQuoteReview(s3, { requestId: 'B', request, quote: { ...quote, deleteRequest: true } }).changed, false);
assert.equal((s3.attentionItems || []).length, 0);

// 발송 결과로 닫힘: 10명 마감 팝업, 발송 확인
const s4 = {};
qr.upsertQuoteReview(s4, { requestId: 'C', request, quote, now: t0 });
qr.upsertQuoteReview(s4, { requestId: 'D', request, quote, now: t0 });
assert.equal(qr.closeFromQuoteResult(s4, 'C', 'skipped', '고수 10명 견적 마감 요청 · 발송 불가 · 숨고 요청 삭제 완료'), true);
assert.equal(qr.closeFromQuoteResult(s4, 'D', 'skipped', '지원 범위 외'), false, '일반 건너뜀은 닫지 않음');
assert.equal(qr.closeFromQuoteResult(s4, 'D', 'sent', ''), true);

// 담당자 처리
const s5 = {};
qr.upsertQuoteReview(s5, { requestId: 'E', request, quote, now: t0 });
assert.equal(qr.resolveReview(s5, { requestId: 'E', resolution: 'manual_quote_sent', note: '직접 발송' }).ok, true);
assert.equal(s5.attentionItems[0].resolvedBy, 'owner');
assert.equal(qr.resolveReview(s5, { requestId: 'E', resolution: 'skip' }).alreadyResolved, true);
assert.equal(qr.resolveReview(s5, { requestId: 'NONE' }).ok, false);

// 요청봇이 살아 있는데 3시간 넘게 안 보이면 사라진 것으로 추정해 닫음. 봇이 꺼져 있으면 닫지 않음
const s6 = {};
qr.upsertQuoteReview(s6, { requestId: 'F', request, quote, now: t0 });
const later = new Date(t0.getTime() + 4 * 3600000);
assert.equal(qr.autoCloseStale(s6, { now: later, requestBotAlive: false }), 0);
assert.equal(qr.autoCloseStale(s6, { now: later, requestBotAlive: true }), 1);
assert.equal(s6.attentionItems[0].resolution, 'request_gone_suspected');

// 알림 목록: 새 항목은 items에, 열린 항목 전체는 openQuoteReviews에
const { relayAttention } = require('../server/relay-server');
const now = new Date().toISOString();
const live = {};
qr.upsertQuoteReview(live, { requestId: 'LIVE1', request, quote, receivedAt: now });
const out = relayAttention({ ...live, soomgoReplies: [], soomgoLeads: [], soomgoWorkflows: [] }, 70);
assert.equal(out.items.filter(entry => entry.type === 'quote_review').length, 1);
assert.equal(out.openQuoteReviews.length, 1);
assert.equal(out.items[0].link, '');
const old = relayAttention({ attentionItems: live.attentionItems.map(entry => ({ ...entry, createdAt: '2026-09-01T00:00:00Z', receivedAt: new Date(Date.now() - 3600000).toISOString() })), soomgoReplies: [], soomgoLeads: [], soomgoWorkflows: [] }, 70);
assert.equal(old.items.length, 0, '이미 알린 항목은 긴급이 되기 전까지 반복 알림 안 함');
assert.equal(old.openQuoteReviews.length, 1);

const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
assert.match(server, /quoteReviewAttention\.upsertQuoteReview\(current, \{ requestId, request, quote, receivedAt: existing\.createdAt/);
assert.match(server, /quoteReviewAttention\.closeFromQuoteResult\(current, requestId, resultStatus, evidence\.note\)/);
assert.match(server, /pathname === '\/api\/attention\/resolve' && req\.method === 'POST'/);
console.log('quote-review-attention: PASS');
