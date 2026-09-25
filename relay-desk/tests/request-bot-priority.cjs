// 0.4.20(2026-09-23 준희 승인): 요청 목록에서 PPT → 문서 → 자막 → 그 외 순으로 먼저 연다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'soomgo-bot-extension', 'content-v3.js'), 'utf8');
const block = source.slice(source.indexOf('  const REQUEST_PRIORITY = ['), source.indexOf('  const skipRecord = entry => {'));
const requestPriority = eval(`(() => {${block}; return requestPriority; })()`);
assert.equal(requestPriority('홍길동 · 견적 보낸 고수 3명 PPT 제작 발표 10장'), 0);
assert.equal(requestPriority('문서/글 작성 날짜 협의 필요 충북 진천군'), 1);
assert.equal(requestPriority('교정/교열 A4 20쪽'), 1);
assert.equal(requestPriority('자막 제작 영상 33분'), 2);
assert.equal(requestPriority('통계분석 SPSS'), 3);
assert.equal(requestPriority(''), 3);
// 고르는 방식: 순위 → 같은 순위는 목록 순서
assert.match(source, /\.sort\(\(a, b\) => a\.rank - b\.rank \|\| a\.index - b\.index\)\[0\]\?\.entry;/);
assert.match(source, /text: cardText\.slice\(0, 300\)/, '카드 글을 순위 판단에 넘긴다');
assert.match(source, /요청봇 0\.4\.2[0-9]/);
console.log('request-bot-priority: PASS');
