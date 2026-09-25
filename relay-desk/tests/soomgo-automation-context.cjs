const assert = require('node:assert/strict');
const { soomgoReply, buildSoomgoAiReplyPrompt } = require('../server/relay-server.js');
const conversationText = '[고객] 로그인 후 자동 클릭하고 페이지를 이동해서 파일을 다운로드하는 매크로 제작입니다.\n[고객] 데이터 분석은 필요 없고 파일만 받으면 됩니다.';
const quote = { amount: 140000, basicScope: '매크로 제작' };
for (const message of [
  '이미지로 전달드려도 될까요?',
  '이미지 이동 순서대로 작업해 주시면 됩니다. 1번 사진에서 미접수 주문 클릭, 2번 사진에서 엑셀 다운로드, 종료합니다.',
  '데이터 분석은 필요없고 단순히 파일만 받아주시면 됩니다',
  '전체 과정을 녹화해서 보내주실 수 있나요?',
  '사진 첨부',
]) {
  const r = soomgoReply({ message, conversationText, quote });
  assert.equal(r.templateKey, 'automation_context', message);
  assert.equal(r.hireRequest, false);
  assert.doesNotMatch(r.text, /표 1개|공개자료 조사|자료조사는 필요|진행할까요|진행해도/);
  console.log('PASS', message);
}
assert.doesNotMatch(buildSoomgoAiReplyPrompt({ conversationText }, { text: '접수했습니다' }), /질문 하나만 남기고/);
const script = soomgoReply({ message: '파이썬 스크립트로 제작 요청합니다', conversationText, quote });
assert.notEqual(script.templateKey, 'manual_script');
const document = soomgoReply({ message: '표 하나 넣어주세요', conversationText: '[고객] 회사 보고서입니다', quote: { amount: 9000 } });
assert.notEqual(document.templateKey, 'automation_context');
const ready = soomgoReply({ message: '데이터 분석 필요없고 단순히 파일만 받아주시면 됩니다', conversationText, quote });
assert.match(ready.text, /140,000원 견적/);
assert.match(ready.text, /고용을 확정해 주시면 Relay Desk에서 바로 제작/);
assert.doesNotMatch(ready.text, /자료|이미지.{0,12}(?:보내|전달).*주세요/);
console.log('PASS programming script and document routing');
