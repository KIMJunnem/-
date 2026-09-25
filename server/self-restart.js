'use strict';

// Relay Desk 자체 재시작(2026-09-21). server/restart-relay-server.ps1과 같은 일을
// Node 안에서 한다: 봇 소스를 dist/downloads로 발행하고, 새 서버 프로세스를
// 분리 실행한 뒤 현재 프로세스를 종료한다. 외부 네트워크 호출은 없다.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BOT_SETS = Object.freeze([
  { label: '숨고 요청', source: 'soomgo-bot-extension', target: 'relay-desk-soomgo-bot', files: ['content-v3.js', 'automation-guard.js', 'auto-update.js', 'manifest.json', 'README.md'] },
  { label: '숨고 채팅', source: 'soomgo-chat-bot', target: 'relay-desk-soomgo-chat-bot', files: ['chat-content.js', 'automation-guard.js', 'auto-update.js', 'manifest.json', 'README.md'] },
  { label: '크몽', source: 'kmong-bot-extension', target: 'relay-desk-kmong-bot', files: ['content.js', 'auto-update.js', 'manifest.json', 'README.md'] }
]);

function readVersion(file) {
  try { return String(JSON.parse(fs.readFileSync(file, 'utf8')).version || ''); } catch (_) { return ''; }
}

// 봇 파일을 발행 폴더로 복사하고 BOT-LATEST.txt를 갱신한다. 확장 프로그램의
// auto-update.js는 이 파일의 변경 시각으로 새 버전을 감지해 스스로 다시 켠다.
// ZIP 다운로드본은 만들지 않는다(설치된 봇은 폴더를 직접 읽는다).
function publishBots(root) {
  const downloadRoot = path.join(root, 'dist', 'downloads');
  const resolvedRoot = path.resolve(root);
  const versions = {};
  const copied = [];
  for (const set of BOT_SETS) {
    const targetDir = path.resolve(downloadRoot, set.target);
    if (!targetDir.startsWith(resolvedRoot)) throw new Error(`publish_path_outside_root:${targetDir}`);
    fs.mkdirSync(targetDir, { recursive: true });
    for (const name of set.files) {
      const from = path.join(root, set.source, name);
      if (!fs.existsSync(from)) continue;
      fs.copyFileSync(from, path.join(targetDir, name));
      copied.push(`${set.target}/${name}`);
    }
    versions[set.label] = readVersion(path.join(targetDir, 'manifest.json'));
  }
  const publishedAt = new Date().toISOString();
  const text = [
    'Relay Desk 숨고 봇 최신 발행본',
    `업데이트: ${publishedAt} (Relay Desk 자체 재시작)`,
    '',
    ...BOT_SETS.map(set => `${set.label} 봇: ${versions[set.label]}\n폴더: ${set.target}`)
  ].join('\n');
  fs.writeFileSync(path.join(downloadRoot, 'BOT-LATEST.txt'), `﻿${text}\n`, 'utf8');
  return { publishedAt, versions, copied };
}

// 현재 서버를 닫은 뒤 새 서버를 분리 실행하고 종료한다. 설정 화면으로 넣은
// 제공자 키(메모리 보관)는 새 프로세스의 환경변수로만 넘기고 파일에 쓰지 않는다.
function restartProcess({ server, root, entry, runtimeKeys = {}, delayMs = 400 }) {
  const env = { ...process.env, RELAY_RESTART_RETRY: '1' };
  if (runtimeKeys.OpenAI) env.OPENAI_API_KEY = runtimeKeys.OpenAI;
  if (runtimeKeys.Gemini) env.GEMINI_API_KEY = runtimeKeys.Gemini;
  if (runtimeKeys.Claude) env.ANTHROPIC_API_KEY = runtimeKeys.Claude;
  if (runtimeKeys.Jev) env.TYPESAFE_API_KEY = runtimeKeys.Jev;
  const logDir = path.join(root, 'server');
  const launch = () => {
    const out = fs.openSync(path.join(logDir, 'relay-server.log'), 'w');
    const err = fs.openSync(path.join(logDir, 'relay-server-error.log'), 'w');
    const child = spawn(process.execPath, [entry], { cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
    child.unref();
    setTimeout(() => process.exit(0), 200);
  };
  setTimeout(() => {
    let launched = false;
    const once = () => { if (!launched) { launched = true; launch(); } };
    try { server.close(once); } catch (_) { once(); }
    if (typeof server.closeAllConnections === 'function') { try { server.closeAllConnections(); } catch (_) {} }
    setTimeout(once, 3000);
  }, delayMs);
}

module.exports = { BOT_SETS, publishBots, restartProcess };
