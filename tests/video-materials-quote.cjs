'use strict';
// 9/25 준희: 식전영상처럼 원본 길이로 정해지지 않는 영상 요청은 "자료 보고 확정" + 시작가로 자동 견적. 하루 30건.
const assert = require('assert');
const v = require('../server/video-edit-quote');
const { checkHonorific } = require('../server/honorific-guard');

const wedding = { text: '결혼식 식전영상 제작 부탁드립니다. 사진 40장 정도 있어요', volume: '' };
const general = { text: '유튜브 브이로그 영상 편집 부탁드립니다', volume: '' };
const known = { text: '강의 영상 컷편집', volume: '10분 이내' };

let p = v.videoEditQuote(wedding);
assert.strictEqual(p.materialsBased, 'photo');
assert.strictEqual(p.amount, 89000);
assert.strictEqual(p.days, '3~4일');
let d = v.autoQuoteDecision(wedding, p, { sentToday: 0 });
assert.strictEqual(d.send, true);
let msg = v.autoQuoteMessage(wedding, p, d);
assert.match(msg, /자료를 보고 정확한 금액을 확정/);
assert.match(msg, /89,000원부터/);
assert.match(msg, /자료 받고 3~4일/);
assert.ok(checkHonorific(msg).ok, msg);

p = v.videoEditQuote(general);
assert.strictEqual(p.materialsBased, 'general');
assert.strictEqual(p.amount, 69000);
assert.match(p.message, /69,000원부터\(자료를 보고 최종 금액 확정\)/);

// 길이를 아는 요청은 예전 그대로
p = v.videoEditQuote(known);
assert.strictEqual(p.materialsBased, undefined);
assert.strictEqual(p.amount, 69000);

// 하루 30건
assert.strictEqual(v.DEFINITION.autoQuote.dailyMaxSends, 30);
assert.strictEqual(v.autoQuoteDecision(wedding, v.videoEditQuote(wedding), { sentToday: 29 }).send, true);
assert.strictEqual(v.autoQuoteDecision(wedding, v.videoEditQuote(wedding), { sentToday: 30 }).reason, 'daily_cap');
// 안 하는 작업·방문은 여전히 거름
assert.strictEqual(v.autoQuoteDecision({ text: '식전영상 3D 애니메이션 제작' }, v.videoEditQuote({ text: '식전영상 3D 애니메이션 제작' }), { sentToday: 0 }).reason, 'excluded_work');
assert.strictEqual(v.autoQuoteDecision({ text: '돌잔치 현장 촬영 해주세요' }, v.videoEditQuote({ text: '돌잔치 현장 촬영 해주세요' }), { sentToday: 0 }).reason, 'visit_or_shoot');
console.log('식전영상·길이 모름 자동 견적 통과');
