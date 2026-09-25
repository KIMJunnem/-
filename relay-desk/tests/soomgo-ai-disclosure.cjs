'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildSoomgoQuote,
  soomgoReply,
  shouldUseSoomgoAiReply
} = require('../server/relay-server.js');

const supportedQuote = buildSoomgoQuote({
  purpose: '이력서/자소서 컨설팅',
  topic: '고객의 실제 경험 기반 자기소개서 대필',
  volume: '2,000자',
  company: '지원 회사 1곳',
  deadline: '내일'
}).quote;

assert.match(supportedQuote.followupMessage, /^안녕하세요, swan입니다\. 첫 상담은 채팅봇이 도와드리고 있어요\./);
assert.match(supportedQuote.followupMessage, /AI 도구를 보조적으로 활용/);
assert.match(supportedQuote.followupMessage, /생성 결과를 그대로 보내지 않고/);
assert.match(supportedQuote.followupMessage, /자기소개서 대필은 39,000원/);

for (const message of [
  'AI로 쓰신 건가요?',
  '챗GPT를 사용해서 작성하나요?',
  '100% 수작업인가요?'
]) {
  const reply = soomgoReply({
    conversationId: `AI-DISCLOSURE-${message.length}`,
    message,
    conversationText: `[고객] ${message}`,
    quote: supportedQuote
  });
  assert.equal(reply.templateKey, 'ai_workflow_disclosure');
  assert.equal(reply.autoSend, true);
  assert.equal(reply.manualReview, false);
  assert.match(reply.text, /AI 도구를 보조적으로 활용/);
  assert.doesNotMatch(reply.text, /Relay Desk|Astra/);
  assert.match(reply.text, /표현·논리·사실관계·출처/);
  assert.equal(shouldUseSoomgoAiReply(reply), false, 'the transparency answer must not be rewritten by another model');
}

const profileCopy = fs.readFileSync(path.join(__dirname, '..', 'sales', 'profile-sample-copy.txt'), 'utf8');
const headline = profileCopy.match(/\[숨고 프로필 한 줄 소개[^\n]*\]\s*\n([^\n]+)/)?.[1] || '';
const detail = profileCopy.match(/\[숨고 서비스 상세설명[^\n]*\]\s*\n([\s\S]+)/)?.[1]?.trim() || '';
assert.ok(headline.length > 0 && headline.length <= 80, `profile headline must be 1-80 characters, got ${headline.length}`);
assert.ok(detail.length > 0 && detail.length <= 1000, `profile detail must be 1-1000 characters, got ${detail.length}`);
assert.match(profileCopy, /첫 상담은 채팅봇이 기본 내용을 확인/);
assert.match(profileCopy, /자막과 일반 문서를 빠르고 깔끔하게/);
assert.match(profileCopy, /5분 이내 기본 SRT와 영상 자막 삽입본은 32,000원/);
assert.match(profileCopy, /1,500자 이내 내용 정리와 문장 작성은 21,000원/);
assert.doesNotMatch(profileCopy, /메로나|이력서·자소서 대필|데이터 크롤링/);

console.log('Soomgo profile, first-chat greeting, and AI disclosure contracts passed.');
