'use strict';
// 성과 숫자 내보내기 검증(가짜 원격). 숫자만 올라가고 이름·본문·대화 번호는 없어야 한다. run-all에는 넣지 않음(git 저장소 필요).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-export-'));
const sh = (args, cwd) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout; };
const origin = path.join(tmp, 'origin.git');
sh(['init', '--quiet', '--bare', origin], tmp);
const pc = path.join(tmp, 'pc');
fs.mkdirSync(path.join(pc, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'stats-export.cjs'), path.join(pc, 'scripts', 'stats-export.cjs'));
sh(['init', '--quiet'], pc);
fs.writeFileSync(path.join(pc, 'a.txt'), 'pc\n');
sh(['add', 'a.txt'], pc); sh(['commit', '--quiet', '-m', 'pc'], pc);
const head = sh(['rev-parse', 'HEAD'], pc).trim();

const now = Date.now();
const at = new Date(now - 3600e3).toISOString();
const state = {
  soomgoLeads: [
    { requestId: '9999111', createdAt: at, customerName: '홍길순', text: '결혼식 식전영상 비밀내용', quote: { autoSend: true, pricing: { type: 'video_edit' }, videoEdit: { autoDecision: 'ok' } } },
    { requestId: '9999112', createdAt: at, quote: { videoEdit: { autoDecision: 'excluded_work' } } }
  ],
  soomgoReplies: [
    { conversationId: '235777001', createdAt: at, incoming: '010-1234-5678 로 연락주세요 비밀대화', reply: { templateKey: 'hire_ready', autoSend: true, agreedAmount: 62000 } },
    { conversationId: '235777002', createdAt: at, incoming: '결제했어요', reply: { templateKey: 'astra_room_pending', paymentCheck: true, honorificHold: { problems: [{ sentence: '반말문장' }] } } }
  ],
  jevGateLog: [{ at, choice: 'thanks', action: 'thanks', called: true }],
  botStatus: { chat: { at: now - 45 * 60000, status: '채팅 확인 오류 · Resource::kQuotaBytes quota exceeded 홍길순' }, request: { at: now - 60000, status: '정상' } },
  soomgoWorkflows: [{ id: 'WF-1', stage: 'payment_requested', hireEvidence: { confirmed: true }, updatedAt: new Date(now - 130 * 60000).toISOString() }, { id: 'WF-TEST-2', stage: 'x', hireEvidence: { confirmed: true }, updatedAt: at }, { id: 'WF-OLD-3', stage: 'awaiting_completion_confirmation', updatedAt: new Date(now - 9000 * 60000).toISOString() }]
};
const stateFile = path.join(tmp, 'state.json');
fs.writeFileSync(stateFile, JSON.stringify(state));
const env = { ...process.env, RELAY_AUTO_UPDATE_URL: origin, RELAY_STATS_STATE_FILE: stateFile, RELAY_PORT: '1' };
const run = () => { const r = spawnSync(process.execPath, [path.join(pc, 'scripts', 'stats-export.cjs')], { cwd: pc, env, encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stderr); return JSON.parse(r.stdout); };

const first = run();
assert.strictEqual(first.ok, true);
const text = sh(['show', 'relay-stats:stats/latest.json'], origin);
const stats = JSON.parse(text);
assert.strictEqual(stats.extra.videoAutoDecision.ok, 1);
assert.strictEqual(typeof stats.extra.videoRequestTypes, 'object');
assert.strictEqual(stats.extra.videoAutoDecision.excluded_work, 1);
assert.strictEqual(stats.extra.replyTemplates.hire_ready, 1);
assert.strictEqual(stats.extra.agreedDiscounts, 1);
assert.strictEqual(stats.extra.paymentClaims, 1);
assert.strictEqual(stats.extra.honorificHeld, 1);
assert.strictEqual(stats.extra.jevGate['thanks:thanks'], 1);
assert.strictEqual(stats.funnel, null, '서버 꺼짐이면 깔때기 없음');
assert.ok(stats.extra.botHealth.chat.minutesSinceHeartbeat >= 44 && stats.extra.botHealth.chat.errorWord === true);
assert.strictEqual(stats.extra.botHealth.request.errorWord, false);
assert.deepStrictEqual(stats.extra.workflows.byStage, { payment_requested: 1 });
assert.ok(stats.extra.workflows.oldestStuckMinutes >= 129);
for (const secret of ['홍길순', '비밀', '010-1234', '235777', '9999111', '반말문장']) assert.ok(!text.includes(secret), `새면 안 됨: ${secret}`);
sh(['show', `relay-stats:stats/${stats.kstDay}.json`], origin);
// 두 번째는 앞 커밋 위에 쌓인다. 이 PC의 브랜치·작업 파일은 그대로
run();
assert.strictEqual(sh(['rev-list', '--count', 'relay-stats'], origin).trim(), '2');
assert.strictEqual(sh(['rev-parse', 'HEAD'], pc).trim(), head);
assert.strictEqual(sh(['status', '--porcelain'], pc).trim(), '?? scripts/');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('성과 숫자 내보내기 통과');
