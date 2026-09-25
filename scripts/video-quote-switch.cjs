'use strict';
// 영상 편집 자동 견적 켜기/끄기 (2026-09-24 decisions 7-10, 개발방 지시 24). video-quote-on.bat / video-quote-off.bat가 부른다.
// 바꾸는 값은 하나뿐: services/video_edit.json의 autoQuote.enabled. 가격·하루 상한(dailyMaxSends)·문구는 건드리지 않는다.
// 바꾸기 전 원본을 backups/video-quote-switch/에 시각 붙여 남긴다.
// 이 값이 바뀌면 정의 파일 버전(definitionsVersion)도 바뀌어서, 요청봇이 전에 건너뛴 영상 편집 요청을 다시 판단한다.
const fs = require('node:fs');
const path = require('node:path');
const mode = String(process.argv[2] || '').toLowerCase();
if (!['on', 'off'].includes(mode)) { console.error('사용: node scripts/video-quote-switch.cjs on|off'); process.exit(2); }
const value = mode === 'on';
const root = path.join(__dirname, '..');
const file = path.join(root, 'services', 'video_edit.json');
const text = fs.readFileSync(file, 'utf8');
const before = JSON.parse(text).autoQuote;
if (!before || typeof before.enabled !== 'boolean') throw new Error('autoQuote_missing');
const backupDir = path.join(root, 'backups', 'video-quote-switch');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 15);
fs.writeFileSync(path.join(backupDir, `video_edit.${stamp}.before-${mode}.json`), text, 'utf8');
// 줄 모양을 바꾸지 않도록 "autoQuote": { "enabled": … 의 값만 바꾼다.
const re = /("autoQuote"\s*:\s*\{\s*"enabled"\s*:\s*)(true|false)/;
if (!re.test(text)) throw new Error('autoQuote_enabled_not_first');
const out = text.replace(re, `$1${value}`);
const check = JSON.parse(out);
if (check.autoQuote.enabled !== value || JSON.stringify({ ...check, autoQuote: { ...check.autoQuote, enabled: before.enabled } }) !== JSON.stringify(JSON.parse(text))) throw new Error('write_check_failed');
fs.writeFileSync(file, out, 'utf8');
console.log(`영상 편집 자동 견적 ${value ? '켜기' : '끄기'}: autoQuote.enabled ${before.enabled}→${value} · 하루 최대 ${check.autoQuote.dailyMaxSends}건 · 가격 그대로`);
