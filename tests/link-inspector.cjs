'use strict';

// 고객 링크 판단 회귀 검사. 실제 네트워크 대신 가짜 fetch를 쓴다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const li = require('../server/link-inspector');

const DOC = 'https://docs.google.com/document/d/1uthWawg5u3cdLv89u6JJa-FQyBIT-hGkQYAXRQebA6U/edit?usp=sharing';
const requested = [];
function fakeFetch(routes) {
  return async (url, options) => {
    requested.push(url);
    assert.equal(options.redirect, 'manual', '리다이렉트는 직접 판단');
    const route = routes.find(item => url.startsWith(item.prefix));
    if (!route) throw new Error(`unexpected_url:${url}`);
    const body = Buffer.from(route.body || '', 'utf8');
    return {
      status: route.status, ok: route.status >= 200 && route.status < 300,
      headers: { get: name => (name.toLowerCase() === 'location' ? route.location || null : null) },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    };
  };
}

(async () => {
  assert.equal(li.classifyLink(DOC).kind, 'google_doc');
  assert.equal(li.classifyLink('http://docs.google.com/document/d/1uthWawg5u3cdLv89u6JJa-FQyBIT/edit').kind, 'unknown', 'https만');
  assert.equal(li.classifyLink('https://docs.google.com.evil.com/document/d/1uthWawg5u3cdLv89u6JJa-FQyBIT/edit').kind, 'unknown', '비슷한 도메인 차단');
  assert.equal(li.classifyLink('https://example.com/a.pdf').kind, 'unknown');

  // 공개 문서: docs → googleusercontent → 본문. 표절 검사 회피 조건 → 자동 거절
  const publicFetch = fakeFetch([
    { prefix: 'https://docs.google.com/document/d/', status: 307, location: 'https://doc-0s-4c-docs.googleusercontent.com/export/abc' },
    { prefix: 'https://doc-0s-4c-docs.googleusercontent.com/', status: 200, body: '﻿09/24 연구질문 + 선행연구 문헌조사 1~2매\nGPT 킬러 및 카피 킬러 10% 미만으로 제출' }
  ]);
  const inspected = await li.inspectMessageLinks(`${DOC}\n\n혹시 위처럼 부탁드리면 비용이 어떻게 되나요?`, publicFetch);
  assert.equal(inspected.links[0].status, 'ok');
  assert.ok(requested[0].endsWith('/export?format=txt'), '고객 URL이 아니라 내보내기 주소를 새로 만든다');
  const decline = li.replyForInspection(inspected);
  assert.equal(decline.templateKey, 'link_academic_integrity_decline');
  assert.equal(decline.autoSend, true);
  assert.match(decline.text, /표절률이나 AI 판별 결과/);

  // 비공개 문서: 로그인 화면으로 리다이렉트 → 공유 설정 안내 자동 발송
  const privateReply = li.replyForInspection(await li.inspectMessageLinks(DOC, fakeFetch([
    { prefix: 'https://docs.google.com/document/d/', status: 302, location: 'https://accounts.google.com/ServiceLogin?continue=x' }
  ])));
  assert.equal(privateReply.templateKey, 'link_private_document');
  assert.equal(privateReply.autoSend, true);

  // 일반 문서: 열어서 담당자 확인으로(자동 발송 없음)
  const plain = li.replyForInspection(await li.inspectMessageLinks(DOC, fakeFetch([
    { prefix: 'https://docs.google.com/document/d/', status: 200, body: '회사 소개 문서 초안입니다. 3쪽 분량으로 정리 부탁드립니다.' }
  ])));
  assert.equal(plain.templateKey, 'link_document_review');
  assert.equal(plain.autoSend, false);
  assert.equal(plain.manualReview, true);

  // 허용되지 않은 주소는 요청 자체를 보내지 않는다
  const before = requested.length;
  const other = li.replyForInspection(await li.inspectMessageLinks('참고 https://example.com/file.pdf', fakeFetch([])));
  assert.equal(requested.length, before, '열지 않음');
  assert.equal(other.templateKey, 'link_not_opened');
  assert.equal(other.autoSend, false);

  // 링크 없는 메시지는 기존 흐름 그대로
  assert.equal(li.replyForInspection(await li.inspectMessageLinks('언제까지 가능하신가요?', fakeFetch([]))), null);

  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
  assert.match(server, /workflowForConversation\(before, conversationId\)\s*\?\s*null\s*:\s*linkInspector\.replyForInspection/, '고용된 업무 방은 제외');
  console.log('link-inspector: PASS');
})().catch(error => { console.error(error); process.exit(1); });
