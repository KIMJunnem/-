'use strict';
// 채팅봇 켜기/끄기 (2026-09-24 decisions 7-5, 개발방 지시 17). 준희가 chatbot-on.bat / chatbot-off.bat로 직접 실행한다.
// 바꾸는 값은 세 개뿐: soomgoChat.sendEnabled, customerRoomFallback.enabled, customerRoomFallback.claudeEnabled.
// 바꾸기 전 원본을 backups/chatbot-switch/에 시각 붙여 남긴다. 한도(dailyMaxCalls·monthlyBudgetKrw)·모델은 건드리지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const mode = String(process.argv[2] || '').toLowerCase();
if (!['on', 'off'].includes(mode)) { console.error('사용: node scripts/chatbot-switch.cjs on|off'); process.exit(2); }
const value = mode === 'on';
const root = path.join(__dirname, '..');
const file = path.join(root, 'server', 'config', 'astra-relay-operating-policy.json');
const text = fs.readFileSync(file, 'utf8');
const policy = JSON.parse(text);
const before = { sendEnabled: policy.soomgoChat?.sendEnabled, enabled: policy.customerRoomFallback?.enabled, claudeEnabled: policy.customerRoomFallback?.claudeEnabled };
const backupDir = path.join(root, 'backups', 'chatbot-switch');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 15);
fs.writeFileSync(path.join(backupDir, `astra-relay-operating-policy.${stamp}.before-${mode}.json`), text, 'utf8');
// 줄 모양을 바꾸지 않도록 해당 칸 안의 값만 바꾼다.
function setIn(src, section, key, next) {
  const start = src.indexOf(`"${section}"`);
  if (start < 0) throw new Error(`section_missing:${section}`);
  const open = src.indexOf('{', start); let depth = 0; let end = -1;
  for (let i = open; i < src.length; i += 1) { if (src[i] === '{') depth += 1; else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } } }
  const block = src.slice(open, end);
  const re = new RegExp(`("${key}"\\s*:\\s*)(true|false)`);
  if (!re.test(block)) throw new Error(`key_missing:${section}.${key}`);
  return src.slice(0, open) + block.replace(re, `$1${next}`) + src.slice(end);
}
let out = text;
out = setIn(out, 'soomgoChat', 'sendEnabled', value);
out = setIn(out, 'customerRoomFallback', 'enabled', value);
out = setIn(out, 'customerRoomFallback', 'claudeEnabled', value);
const check = JSON.parse(out);
if (check.soomgoChat.sendEnabled !== value || check.customerRoomFallback.enabled !== value || check.customerRoomFallback.claudeEnabled !== value) throw new Error('write_check_failed');
fs.writeFileSync(file, out, 'utf8');
console.log(`채팅봇 ${value ? '켜기' : '끄기'}: sendEnabled ${before.sendEnabled}→${value}, customerRoomFallback.enabled ${before.enabled}→${value}, claudeEnabled ${before.claudeEnabled}→${value}`);
console.log(`한도 그대로: 하루 ${check.customerRoomFallback.dailyMaxCalls}건 · 월 ${check.customerRoomFallback.monthlyBudgetKrw}원 · 모델 ${check.customerRoomFallback.model}`);
