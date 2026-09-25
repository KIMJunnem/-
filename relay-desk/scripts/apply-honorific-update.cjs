'use strict';
// 채팅봇 존댓말 필수(9/25) 수정을 PC 폴더에 넣는다. 존댓말-업데이트.bat가 부른다.
// - 새 파일(server/honorific-guard.js, tests/honorific-guard.cjs)은 bat가 GitHub에서 받아 둔다.
// - 여기서는 기존 파일 세 개에 몇 줄만 끼워 넣는다. 이미 들어 있으면 건너뛴다(두 번 실행해도 같음).
// - 바꾸기 전 원본을 backups/honorific-update/<시각>/에 남긴다. 끼워 넣을 자리를 못 찾으면 아무것도 바꾸지 않고 멈춘다.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 15);
const backupDir = path.join(root, 'backups', 'honorific-update', stamp);

function eol(text) { return text.includes('\r\n') ? '\r\n' : '\n'; }

const edits = [
  {
    file: 'server/relay-server.js',
    marker: "require('./honorific-guard')",
    apply(text) {
      const nl = eol(text);
      const reqAnchor = "const replyGuards = require('./reply-guards');";
      const routeAnchor = ['          : await conversationalSoomgoReply(replyBody, deterministicReply));', '      // 9/24 지시 28'].join(nl);
      if (text.split(reqAnchor).length !== 2) throw new Error('relay-server.js: reply-guards 줄을 못 찾음');
      if (text.split(routeAnchor).length !== 2) throw new Error('relay-server.js: 답장 만드는 자리를 못 찾음');
      return text
        .replace(reqAnchor, reqAnchor + nl + "const honorificGuard = require('./honorific-guard');")
        .replace(routeAnchor, [
          '          : await conversationalSoomgoReply(replyBody, deterministicReply));',
          '      // 9/25 준희 지시: 채팅봇은 무조건 존댓말. 반말 문장이 있으면 보내지도 예약하지도 않고 사람 확인으로 넘긴다.',
          '      if (reply && reply.text && !reply.skip) {',
          '        const honorific = honorificGuard.checkHonorific(reply.text);',
          '        if (!honorific.ok) reply = { ...reply, autoSend: false, manualReview: true, attention: true, honorificHold: { problems: honorific.problems.slice(0, 5) }, reason: honorificGuard.holdReason(honorific) };',
          '      }',
          '      // 9/24 지시 28'
        ].join(nl));
    }
  },
  {
    file: 'server/astra-room-bridge.js',
    marker: "require('./honorific-guard')",
    apply(text) {
      const nl = eol(text);
      const anchor = [
        '    event.deliveryStatus = event.eventType === \'customer_message\'',
        '      ? (parsed.mode === \'CUSTOMER_REPLY\' && parsed.decision === \'SEND\' ? \'ready\' : \'held\')',
        '      : \'not_applicable\';'
      ].join(nl);
      if (text.split(anchor).length !== 2) throw new Error('astra-room-bridge.js: 발송 상태 정하는 자리를 못 찾음');
      if (!/^const crypto = require\('crypto'\);/m.test(text)) throw new Error('astra-room-bridge.js: 첫 require 줄을 못 찾음');
      return text
        .replace(/^const crypto = require\('crypto'\);/m, "const { checkHonorific, holdReason } = require('./honorific-guard');" + nl + "const crypto = require('crypto');")
        .replace(anchor, anchor + nl + [
          '    // 9/25 준희 지시: 채팅봇은 무조건 존댓말. 반말 문장이 있으면 내보내지 않고 사람 확인(held)으로 둔다.',
          "    if (event.deliveryStatus === 'ready') {",
          '      const honorific = checkHonorific(parsed.reply);',
          '      if (!honorific.ok) {',
          "        event.deliveryStatus = 'held';",
          '        event.honorificHold = { reason: holdReason(honorific), problems: honorific.problems.slice(0, 5) };',
          '      }',
          '    }'
        ].join(nl));
    }
  },
  {
    file: 'tests/run-all.cjs',
    marker: "'tests/honorific-guard.cjs'",
    apply(text) {
      const nl = eol(text);
      const anchor = "  ['고객응대실 합치기 (Astra→Claude→정해진 문구, 가짜 호출)', 'tests/customer-room-fallback.cjs'],";
      if (text.split(anchor).length !== 2) return text; // 시험 목록은 못 찾아도 운영에는 상관없음
      return text.replace(anchor, anchor + nl + "  ['채팅봇 존댓말 필수', 'tests/honorific-guard.cjs'],");
    }
  }
];

for (const need of ['server/honorific-guard.js', 'tests/honorific-guard.cjs']) {
  if (!fs.existsSync(path.join(root, need))) { console.error(`${need} 이(가) 없습니다. bat가 GitHub에서 받지 못했습니다.`); process.exit(1); }
}

// 1) 전부 계산해 본 뒤(하나라도 실패하면 아무것도 안 씀) 2) 백업 3) 쓰기
const planned = [];
for (const edit of edits) {
  const full = path.join(root, edit.file);
  const text = fs.readFileSync(full, 'utf8');
  if (text.includes(edit.marker)) { console.log(`이미 적용됨: ${edit.file}`); continue; }
  planned.push({ edit, full, before: text, after: edit.apply(text) });
}
if (planned.length) fs.mkdirSync(backupDir, { recursive: true });
for (const item of planned) fs.copyFileSync(item.full, path.join(backupDir, path.basename(item.full)));
for (const item of planned) { fs.writeFileSync(item.full, item.after, 'utf8'); console.log(`적용: ${item.edit.file}`); }
if (planned.length) console.log(`원본 백업: ${path.relative(root, backupDir)}`);
