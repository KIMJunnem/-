'use strict';

// 자체 재시작 경로 정적 검사 + 봇 발행 동작 검사(임시 폴더, 서버는 띄우지 않음).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { publishBots, BOT_SETS } = require('../server/self-restart');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
assert.match(source, /pathname === '\/api\/admin\/restart' && req\.method === 'POST'/);
assert.match(source, /if \(!local\) return sendJson\(res, 403, \{ error: 'write_server_local_only' \}\);\s*if \(String\(req\.headers\['x-relay-admin'\]/, '로컬 전용 + 관리자 헤더');
assert.match(source, /production_running/, '제작 실행 중이면 재시작 보류');
assert.match(source, /error\.code === 'EADDRINUSE' && listenRetries > 0/, '재시작 직후 포트 재시도');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-restart-'));
for (const set of BOT_SETS) {
  fs.mkdirSync(path.join(root, set.source), { recursive: true });
  for (const name of set.files) fs.writeFileSync(path.join(root, set.source, name), name === 'manifest.json' ? JSON.stringify({ version: '9.9.9' }) : `// ${name}`);
}
const result = publishBots(root);
assert.equal(result.versions['숨고 요청'], '9.9.9');
assert.ok(fs.existsSync(path.join(root, 'dist', 'downloads', 'relay-desk-soomgo-bot', 'content-v3.js')));
assert.ok(fs.existsSync(path.join(root, 'dist', 'downloads', 'relay-desk-soomgo-chat-bot', 'chat-content.js')));
assert.match(fs.readFileSync(path.join(root, 'dist', 'downloads', 'BOT-LATEST.txt'), 'utf8'), /숨고 요청 봇: 9\.9\.9/);
fs.rmSync(root, { recursive: true, force: true });
console.log('self-restart: PASS');
