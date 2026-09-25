'use strict';

// 말투 문서(docs/tone-human-newcomer.md) — 2026-09-24 지시 23에서 챗봇 프롬프트에 넣었다가, 지시 29(교체, decisions 7-14)에서 뺐다.
// 규칙 목록을 붙일수록 외워 읊는 말투가 된다(준희·감독). 이 시험은 "프롬프트에 다시 들어가지 않았는지"를 본다. 합성 대화 3건, 외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let netCalls = 0;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_test'); };
const R = require('../server/relay-server');
const root = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(root, 'docs', 'tone-human-newcomer.md'), 'utf8').replace(/\r/g, '');
const block = (doc.match(/```\n([\s\S]*?)\n```/) || [])[1];
assert.ok(block, '문서 코드블록은 그대로 있음(참고용)');
const sq = R.buildSoomgoQuote({ requestId: 'TONE-SUB', purpose: '자막 제작', volume: '10분', topic: '한국어 강의 영상 자막', format: 'SRT' }).quote;
for (const [name, message] of [['첫 문의', '안녕하세요 강의 영상 자막 문의드려요'], ['일정 질문', '언제까지 받을 수 있어요?'], ['경력 질문', '경력이 어떻게 되세요? 리뷰가 없네요']]) {
  const body = { message, quote: sq };
  const reply = R.applyChatReplyPolicy(body, R.soomgoReply(body));
  const prompt = R.buildSoomgoAiReplyPrompt(body, reply);
  assert.ok(!prompt.includes(block) && !prompt.includes('[말투 — 사람 냄새]'), `${name}: 말투 규칙 블록 없음`);
  assert.match(prompt, /^준희가 숨고 채팅방 하나를 통째로 붙여 넣고/, `${name}: 붙여넣기 틀`);
  assert.ok(prompt.includes(message), `${name}: 고객 말 그대로`);
}
assert.equal(netCalls, 0, '외부 호출 없음');
console.log('tone-human-newcomer: PASS');
