'use strict';
// 제브 문지기(지시 31) 켜기/끄기. jev-gate-on.bat / jev-gate-off.bat가 부른다(준희가 실행).
// 바꾸는 값은 하나뿐: server/config/astra-relay-operating-policy.json의 jevGate.enabled. 한도·모델·가격은 건드리지 않는다.
// 바꾸기 전 원본을 backups/jev-gate-switch/에 남긴다.
const fs = require('node:fs');
const path = require('node:path');
const mode = String(process.argv[2] || '').toLowerCase();
if (!['on', 'off'].includes(mode)) { console.error('사용: node scripts/jev-gate-switch.cjs on|off'); process.exit(2); }
const value = mode === 'on';
const root = path.join(__dirname, '..');
const file = path.join(root, 'server', 'config', 'astra-relay-operating-policy.json');
const text = fs.readFileSync(file, 'utf8');
const before = JSON.parse(text);
if (typeof before.jevGate?.enabled !== 'boolean') throw new Error('jevGate_missing');
const backupDir = path.join(root, 'backups', 'jev-gate-switch');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 15);
fs.writeFileSync(path.join(backupDir, `astra-relay-operating-policy.${stamp}.before-${mode}.json`), text, 'utf8');
const re = /("jevGate"\s*:\s*\{[^{}]*?"enabled"\s*:\s*)(true|false)/;
if (!re.test(text)) throw new Error('jevGate_layout');
const out = text.replace(re, `$1${value}`);
const check = JSON.parse(out);
if (check.jevGate.enabled !== value || JSON.stringify({ ...check, jevGate: { ...check.jevGate, enabled: before.jevGate.enabled } }) !== JSON.stringify(before)) throw new Error('write_check_failed');
fs.writeFileSync(file, out, 'utf8');
console.log(`제브 문지기 ${value ? '켜기' : '끄기'}: jevGate.enabled ${before.jevGate.enabled}→${value} · 하루 호출 ${check.jevGate.dailyMaxCalls}회 · 확률 기준 ${check.jevGate.threshold}`);
