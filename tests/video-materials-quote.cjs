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
assert.strictEqual(p.days, '2~3일');
let d = v.autoQuoteDecision(wedding, p, { sentToday: 0 });
assert.strictEqual(d.send, true);
let msg = v.autoQuoteMessage(wedding, p, d);
assert.match(msg, /자료를 보고 정확한 금액을 확정/);
assert.match(msg, /89,000원부터/);
assert.match(msg, /자료 받고 2~3일/);
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
assert.strictEqual(v.DEFINITION.autoQuote.dailyMaxSends, 30); // 9/25 샘플 링크 붙음 → 30
assert.strictEqual(v.autoQuoteDecision(wedding, v.videoEditQuote(wedding), { sentToday: 29 }).send, true);
assert.strictEqual(v.autoQuoteDecision(wedding, v.videoEditQuote(wedding), { sentToday: 30 }).reason, 'daily_cap');
// 안 하는 작업·방문은 여전히 거름
assert.strictEqual(v.autoQuoteDecision({ text: '식전영상 3D 애니메이션 제작' }, v.videoEditQuote({ text: '식전영상 3D 애니메이션 제작' }), { sentToday: 0 }).reason, 'excluded_work');
assert.strictEqual(v.autoQuoteDecision({ text: '돌잔치 현장 촬영 해주세요' }, v.videoEditQuote({ text: '돌잔치 현장 촬영 해주세요' }), { sentToday: 0 }).reason, 'visit_or_shoot');
console.log('식전영상·길이 모름 자동 견적 통과');

// 9/25 A/B·샘플 링크
{
  const req = { text: '강의 영상 컷편집', volume: '10분 이내' };
  const p = v.videoEditQuote(req); const d = v.autoQuoteDecision(req, p, { sentToday: 0 });
  const a = v.autoQuoteMessage(req, p, d, { variant: 'A' });
  const b = v.autoQuoteMessage(req, p, d, { variant: 'B' });
  assert.ok(!/원하시는 완성 날짜/.test(a)); assert.match(b, /원하시는 완성 날짜만 알려주시면/);
  assert.ok(checkHonorific(b).ok);
  assert.ok(!/작업 예시 영상/.test(a), '링크가 비어 있으면 안 붙임');
  const saved = v.DEFINITION.quoteCopy.sampleUrl;
  v.DEFINITION.quoteCopy.sampleUrl = 'https://youtu.be/abc123';
  assert.match(v.autoQuoteMessage(req, p, d, { variant: 'A' }), /작업 예시 영상: https:\/\/youtu\.be\/abc123$/);
  v.DEFINITION.quoteCopy.sampleUrl = 'https://evil.example.com/x';
  assert.ok(!/작업 예시 영상/.test(v.autoQuoteMessage(req, p, d, { variant: 'A' })), '유튜브 링크만');
  v.DEFINITION.quoteCopy.sampleUrl = saved;
  assert.strictEqual(v.abVariant(''), 'A');
  console.log('A/B·샘플 링크 통과');
}

// 9/25 종류별 샘플 링크: 맞는 종류 링크가 먼저, 없으면 공통 링크
{
  const wedding = { text: '결혼식 식전영상 만들어 주세요' };
  const p = v.videoEditQuote(wedding); const d = v.autoQuoteDecision(wedding, p, { sentToday: 0 });
  const saved = { one: v.DEFINITION.quoteCopy.sampleUrl, many: { ...v.DEFINITION.quoteCopy.sampleUrls } };
  v.DEFINITION.quoteCopy.sampleUrl = 'https://youtu.be/common';
  v.DEFINITION.quoteCopy.sampleUrls.wedding = 'https://youtu.be/wedding';
  assert.match(v.autoQuoteMessage(wedding, p, d, { variant: 'A' }), /youtu\.be\/wedding$/);
  v.DEFINITION.quoteCopy.sampleUrls.wedding = 'https://share.descript.com/view/abc123';
  assert.match(v.autoQuoteMessage(wedding, p, d, { variant: 'A' }), /작업 예시 영상: https:\/\/share\.descript\.com\/view\/abc123$/);
  v.DEFINITION.quoteCopy.sampleUrls.wedding = 'https://evil.example/share.descript.com/x';
  assert.doesNotMatch(v.autoQuoteMessage(wedding, p, d, { variant: 'A' }), /evil/);
  v.DEFINITION.quoteCopy.sampleUrls.wedding = 'https://youtu.be/wedding';
  const other = { text: '가족 여행 영상 편집' };
  const po = v.videoEditQuote(other);
  assert.match(v.autoQuoteMessage(other, po, v.autoQuoteDecision(other, po, { sentToday: 0 }), { variant: 'A' }), /youtu\.be\/common$/);
  v.DEFINITION.quoteCopy.sampleUrl = saved.one; v.DEFINITION.quoteCopy.sampleUrls = saved.many;
  assert.strictEqual(v.videoType({ text: '돌잔치 성장영상' }), 'baby');
  console.log('종류별 샘플 링크 통과');
}
