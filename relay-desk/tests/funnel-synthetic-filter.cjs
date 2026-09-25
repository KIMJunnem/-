// 2026-09-23: 자체 점검(SELFTEST·TEST) 기록이 숨고 깔때기 숫자에 섞이지 않는지 확인한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
const start = source.indexOf("pathname === '/api/soomgo/revenue-funnel'");
assert.ok(start > 0);
const block = source.slice(start, start + 1200);
assert.match(block, /const isSynthetic = value => isSyntheticRecord\(value\);/, '깔때기도 공용 판정을 쓴다');
assert.doesNotMatch(block, /String\(value\?\.conversationId \|\| value\?\.id \|\| ''\)/, '아이디 두 개만 보던 판정은 없어야 한다');
// 공용 판정이 요청번호까지 본다
const fn = source.match(/const isSyntheticRecord = value => [\s\S]{0,200}?\);/)[0];
assert.match(fn, /requestId/);
assert.match(fn, /TEST/);
const isSynthetic = eval(`(${fn.replace('const isSyntheticRecord = ', '').replace(/;$/, '')})`);
assert.equal(isSynthetic({ requestId: 'SELFTEST-PPT-REV-20260922' }), true);
assert.equal(isSynthetic({ requestId: 'TEST-PPT-CONVERSION-002' }), true);
assert.equal(isSynthetic({ requestId: '6ab212f9a7dff8644acc8d15', conversationId: '235864997' }), false);
console.log('funnel-synthetic-filter: PASS');
