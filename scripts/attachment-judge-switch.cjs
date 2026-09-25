'use strict';
// 고객 첨부 판단(지시 20) 켜기/끄기. attachment-judge-on.bat / attachment-judge-off.bat가 부른다(감독이 실행).
// 바꾸는 값은 하나뿐: server/config/astra-relay-operating-policy.json의 attachmentJudge.enabled. 한도·모델·가격은 건드리지 않는다.
// 바꾸기 전 원본을 backups/attachment-judge-switch/에 남긴다.
const fs = require('node:fs');
const path = require('node:path');
const mode = String(process.argv[2] || '').toLowerCase();
if (!['on', 'off'].includes(mode)) { console.error('사용: node scripts/attachment-judge-switch.cjs on|off'); process.exit(2); }
const value = mode === 'on';
const root = path.join(__dirname, '..');
const file = path.join(root, 'server', 'config', 'astra-relay-operating-policy.json');
const text = fs.readFileSync(file, 'utf8');
const before = JSON.parse(text);
if (typeof before.attachmentJudge?.enabled !== 'boolean') throw new Error('attachmentJudge_missing');
const backupDir = path.join(root, 'backups', 'attachment-judge-switch');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 15);
fs.writeFileSync(path.join(backupDir, `astra-relay-operating-policy.${stamp}.before-${mode}.json`), text, 'utf8');
const re = /("attachmentJudge"\s*:\s*\{\s*"enabled"\s*:\s*)(true|false)/;
if (!re.test(text)) throw new Error('attachmentJudge_layout');
const out = text.replace(re, `$1${value}`);
const check = JSON.parse(out);
if (check.attachmentJudge.enabled !== value || JSON.stringify({ ...check, attachmentJudge: { ...check.attachmentJudge, enabled: before.attachmentJudge.enabled } }) !== JSON.stringify(before)) throw new Error('write_check_failed');
fs.writeFileSync(file, out, 'utf8');
console.log(`고객 첨부 판단 ${value ? '켜기' : '끄기'}: attachmentJudge.enabled ${before.attachmentJudge.enabled}→${value} · 모델 ${check.attachmentJudge.model} · 하루 호출·월 금액은 채팅봇 상한(customerRoomFallback)에 합쳐 셈`);
