'use strict';
// 견적 판단(지시 19) 켜기/끄기. quote-judge-on.bat / quote-judge-off.bat가 부른다(감독이 실행).
// 바꾸는 값은 하나뿐: server/config/astra-relay-operating-policy.json의 quoteJudge.enabled. 한도·모델·가격은 건드리지 않는다.
// 바꾸기 전 원본을 backups/quote-judge-switch/에 남긴다.
const fs = require('node:fs');
const path = require('node:path');
const mode = String(process.argv[2] || '').toLowerCase();
if (!['on', 'off'].includes(mode)) { console.error('사용: node scripts/quote-judge-switch.cjs on|off'); process.exit(2); }
const value = mode === 'on';
const root = path.join(__dirname, '..');
const file = path.join(root, 'server', 'config', 'astra-relay-operating-policy.json');
const text = fs.readFileSync(file, 'utf8');
const before = JSON.parse(text);
if (typeof before.quoteJudge?.enabled !== 'boolean') throw new Error('quoteJudge_missing');
const backupDir = path.join(root, 'backups', 'quote-judge-switch');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 15);
fs.writeFileSync(path.join(backupDir, `astra-relay-operating-policy.${stamp}.before-${mode}.json`), text, 'utf8');
const re = /("quoteJudge"\s*:\s*\{\s*"enabled"\s*:\s*)(true|false)/;
if (!re.test(text)) throw new Error('quoteJudge_layout');
const out = text.replace(re, `$1${value}`);
const check = JSON.parse(out);
if (check.quoteJudge.enabled !== value || JSON.stringify({ ...check, quoteJudge: { ...check.quoteJudge, enabled: before.quoteJudge.enabled } }) !== JSON.stringify(before)) throw new Error('write_check_failed');
fs.writeFileSync(file, out, 'utf8');
console.log(`견적 판단 ${value ? '켜기' : '끄기'}: quoteJudge.enabled ${before.quoteJudge.enabled}→${value} · 하루 호출 ${check.quoteJudge.dailyMaxCalls}회 · 자동 발송 ${check.quoteJudge.dailyMaxAutoSends}건 · 모델 ${check.quoteJudge.model}`);
