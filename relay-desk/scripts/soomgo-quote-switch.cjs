'use strict';
// 숨고 문서·교정 / PPT 자동 견적 켜기·끄기 (2026-09-24 decisions 7-13, 개발방 지시 27). doc-quote-on/off.bat, ppt-quote-on/off.bat가 부른다.
// 바꾸는 값은 하나뿐: services/document_writing.json 또는 services/presentation.json의 "soomgoAutoQuote". 가격·문구·크몽은 건드리지 않는다.
// 바꾸기 전 원본을 backups/soomgo-quote-switch/에 시각 붙여 남긴다. 값이 바뀌면 정의 파일 버전도 바뀌어 요청봇이 건너뛴 요청을 다시 판단한다.
const fs = require('node:fs');
const path = require('node:path');
const FILES = { doc: 'document_writing.json', ppt: 'presentation.json' };
const which = String(process.argv[2] || '').toLowerCase();
const mode = String(process.argv[3] || '').toLowerCase();
if (!FILES[which] || !['on', 'off'].includes(mode)) { console.error('사용: node scripts/soomgo-quote-switch.cjs doc|ppt on|off'); process.exit(2); }
const value = mode === 'on';
const root = path.join(__dirname, '..');
const file = path.join(root, 'services', FILES[which]);
const text = fs.readFileSync(file, 'utf8');
const before = JSON.parse(text);
if (typeof before.soomgoAutoQuote !== 'boolean') throw new Error('soomgoAutoQuote_missing');
const backupDir = path.join(root, 'backups', 'soomgo-quote-switch');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 15);
fs.writeFileSync(path.join(backupDir, `${FILES[which].replace('.json', '')}.${stamp}.before-${mode}.json`), text, 'utf8');
// 줄 모양을 바꾸지 않도록 값만 바꾼다(줄바꿈 CRLF 그대로).
const re = /("soomgoAutoQuote"\s*:\s*)(true|false)/;
const out = text.replace(re, `$1${value}`);
const check = JSON.parse(out);
if (check.soomgoAutoQuote !== value || JSON.stringify({ ...check, soomgoAutoQuote: before.soomgoAutoQuote }) !== JSON.stringify(before)) throw new Error('write_check_failed');
fs.writeFileSync(file, out, 'utf8');
console.log(`숨고 ${which === 'doc' ? '문서·교정' : 'PPT'} 자동 견적 ${value ? '켜기' : '끄기'}: soomgoAutoQuote ${before.soomgoAutoQuote}→${value} · 가격·문구 그대로`);
