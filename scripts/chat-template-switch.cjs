'use strict';
// 고객 말에 정해진 문구로 답하기 켜기/끄기 (2026-09-24 개발방 지시 30). chat-template-on.bat / chat-template-off.bat가 부른다.
// 바꾸는 값은 하나뿐: server/config/astra-relay-operating-policy.json의 chatReply.templatesForHumanMessages.
//   off(false, 지시 30 기본) = 고객이 직접 쓴 말은 Claude(붙여넣기 방식)가 답함 / on(true) = 예전처럼 정해진 문구.
// 채팅봇 발송·Claude 스위치(chatbot-switch)와 한도는 건드리지 않는다. 바꾸기 전 원본을 backups/chat-template-switch/에 남긴다.
const fs = require('node:fs');
const path = require('node:path');
const mode = String(process.argv[2] || '').toLowerCase();
if (!['on', 'off'].includes(mode)) { console.error('사용: node scripts/chat-template-switch.cjs on|off'); process.exit(2); }
const value = mode === 'on';
const root = path.join(__dirname, '..');
const file = path.join(root, 'server', 'config', 'astra-relay-operating-policy.json');
const text = fs.readFileSync(file, 'utf8');
const before = JSON.parse(text);
if (typeof before.chatReply?.templatesForHumanMessages !== 'boolean') throw new Error('chatReply_missing');
const backupDir = path.join(root, 'backups', 'chat-template-switch');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 15);
fs.writeFileSync(path.join(backupDir, `astra-relay-operating-policy.${stamp}.before-${mode}.json`), text, 'utf8');
const re = /("chatReply"\s*:\s*\{\s*"templatesForHumanMessages"\s*:\s*)(true|false)/;
if (!re.test(text)) throw new Error('chatReply_layout');
const out = text.replace(re, `$1${value}`);
const check = JSON.parse(out);
if (check.chatReply.templatesForHumanMessages !== value || JSON.stringify({ ...check, chatReply: { ...check.chatReply, templatesForHumanMessages: before.chatReply.templatesForHumanMessages } }) !== JSON.stringify(before)) throw new Error('write_check_failed');
fs.writeFileSync(file, out, 'utf8');
console.log(`고객 말 정해진 문구 답장 ${value ? '켜기(예전처럼)' : '끄기(Claude가 답함)'}: templatesForHumanMessages ${before.chatReply.templatesForHumanMessages}→${value} · 채팅봇 스위치·한도 그대로`);
