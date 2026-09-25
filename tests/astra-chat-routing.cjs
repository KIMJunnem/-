const fs = require('fs');

const source = fs.readFileSync('server/relay-server.js', 'utf8');
const start = source.indexOf('async function conversationalSoomgoReply');
const end = source.indexOf('\nfunction duplicateMatches', start);

if (start < 0 || end < 0) throw new Error('채팅 응답 함수 범위를 찾을 수 없습니다.');

const body = source.slice(start, end);
if (!body.includes('buildSoomgoAiReplyPrompt(body, deterministicReply)')
  || !body.includes('route?.model || SOOMGO_ASTRA_FINAL_MODEL')) {
  throw new Error('일반 고객 채팅 응답이 Astra 모델을 직접 지정하지 않습니다.');
}
if (/process\.env\.OPENAI_MODEL\s*\|\|\s*'gpt-5\.6-luna'/.test(body)) {
  throw new Error('일반 고객 채팅 응답이 Luna 기본 모델로 되돌아갔습니다.');
}

console.log('[PASS] 일반 고객 채팅 응답은 Astra 전용 모델을 사용합니다.');
