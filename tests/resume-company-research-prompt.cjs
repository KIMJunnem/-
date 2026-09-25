'use strict';

const assert = require('node:assert/strict');
const { buildSoomgoFulfillmentPrompt, buildSoomgoReviewPrompt } = require('../server/relay-server.js');

const request = {
  purpose: '이력서/자소서 컨설팅',
  topic: 'LG전자 생산기술 직무 자기소개서',
  text: '지원 회사: LG전자\n직무: 생산기술\n첨부 이력서의 실제 경험만 사용',
  format: '워드',
  volume: '자기소개서 2문항'
};
const fulfillment = buildSoomgoFulfillmentPrompt(
  { id: 'test-resume', project: '회사 지원서', operatorNotes: [] },
  request,
  { label: '자기소개서 직무 맞춤 구성', amount: 28000 }
);
assert.match(fulfillment, /공식 홈페이지\(인재상·핵심가치·비전·사업\/제품\)/);
assert.match(fulfillment, /공식 채용 페이지/);
assert.match(fulfillment, /기존 이력서·자소서·경력자료/);
assert.match(fulfillment, /절대 만들어내지 않는다/);
assert.match(fulfillment, /공식 페이지 제목·URL·확인일/);

const review = buildSoomgoReviewPrompt(
  { id: 'test-resume', project: '회사 지원서', operatorNotes: [], soomgoRequest: request },
  { text: '[[DELIVERABLE_START]]초안[[DELIVERABLE_END]]', provider: 'OpenAI' },
  'Claude',
  3
);
assert.match(review, /공식 홈페이지의 인재상·핵심가치·사업 정보/);
assert.match(review, /고객이 제공한 기존 이력서·경력자료/);
assert.match(review, /공식 페이지 제목·URL·확인일/);

console.log('resume-company-research-prompt: ok');
