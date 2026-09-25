'use strict';
// 자동 업데이트(scripts/auto-update.cjs) 검증. PC를 흉내 낸다: zip 시점(7367f2f) 파일로 만든 "기록 없는" git 저장소에서
// 가짜 원격(이 저장소의 relay-desk 커밋)을 받아 적용한다. 실제 GitHub·서버에는 닿지 않는다.
// run-all에는 넣지 않는다(git 저장소와 전체 시험을 여러 번 돌려 오래 걸림). 사용: node tests/auto-update.cjs [node_modules 경로]
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const BASE = '7367f2f';
const nodeModules = path.resolve(process.argv[2] || path.join(REPO, 'node_modules'));
assert.ok(fs.existsSync(path.join(nodeModules, 'pptxgenjs')), `node_modules가 필요합니다: ${nodeModules}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-update-'));

function sh(cmd, args, cwd, extra = {}) {
  const run = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...extra });
  if (run.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 실패: ${run.stderr || run.stdout}`);
  return run.stdout;
}
const git = (cwd, ...args) => sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], cwd);

// 가짜 원격: 지금 HEAD를 relay-desk로
const head = git(REPO, 'rev-parse', 'HEAD').trim();
const origin = path.join(tmp, 'origin.git');
git(tmp, 'clone', '--quiet', '--bare', '--no-local', REPO, origin);
git(origin, 'update-ref', 'refs/heads/relay-desk', head);

function makePc(name) {
  const pc = path.join(tmp, name);
  fs.mkdirSync(pc);
  const tar = spawnSync('sh', ['-c', `git -C "${REPO}" archive ${BASE} | tar -x -C "${pc}"`]);
  assert.strictEqual(tar.status, 0);
  fs.symlinkSync(nodeModules, path.join(pc, 'node_modules'));
  git(pc, 'init', '--quiet');
  fs.appendFileSync(path.join(pc, '.git', 'info', 'exclude'), '\nnode_modules\n'); // .gitignore는 PC 그대로 둔다
  git(pc, 'add', '-A');
  git(pc, 'commit', '--quiet', '-m', 'pc');
  fs.mkdirSync(path.join(pc, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pc, 'scripts', 'auto-update.cjs'), git(REPO, 'show', `${head}:scripts/auto-update.cjs`));
  return pc;
}
function update(pc, install = false) {
  const env = { ...process.env, RELAY_AUTO_UPDATE_URL: origin, RELAY_PORT: '1' }; // 1번 포트: 서버 꺼짐으로 보임
  spawnSync(process.execPath, [path.join(pc, 'scripts', 'auto-update.cjs'), ...(install ? ['--install'] : [])], { cwd: pc, env, encoding: 'utf8', timeout: 40 * 60 * 1000 });
  const state = JSON.parse(fs.readFileSync(path.join(pc, 'backups', 'auto-update', 'state.json'), 'utf8'));
  const log = fs.readFileSync(path.join(pc, 'backups', 'auto-update', 'log.txt'), 'utf8');
  return { state, log };
}
const read = (pc, file) => fs.readFileSync(path.join(pc, file), 'utf8');

// 1) 첫 설치: 존댓말 수정까지 적용, 시험 통과, 서버 꺼짐 기록
const pc1 = makePc('pc1');
let r = update(pc1, true);
assert.strictEqual(r.state.lastApplied, head, r.log);
assert.ok(/적용 완료/.test(r.log) && /서버가 꺼져 있음/.test(r.log), r.log);
assert.ok(read(pc1, 'server/relay-server.js').includes("require('./honorific-guard')"));
assert.ok(fs.existsSync(path.join(pc1, 'server', 'honorific-guard.js')));
console.log('1 첫 설치 적용 통과');

// 2) 다시 돌리면 변화 없음
const before = read(pc1, 'server/relay-server.js');
r = update(pc1);
assert.strictEqual(r.state.lastApplied, head);
assert.strictEqual(read(pc1, 'server/relay-server.js'), before);
console.log('2 재실행 변화 없음 통과');

// 3) 존댓말-업데이트.bat이 이미 적용된 PC
const pc2 = makePc('pc2');
for (const f of ['server/honorific-guard.js', 'tests/honorific-guard.cjs', 'scripts/apply-honorific-update.cjs']) {
  fs.writeFileSync(path.join(pc2, f), git(REPO, 'show', `${head}:${f}`));
}
sh(process.execPath, ['scripts/apply-honorific-update.cjs'], pc2);
r = update(pc2, true);
assert.strictEqual(r.state.lastApplied, head, r.log);
console.log('3 이미 적용된 PC 통과');

// 4) PC에서 relay-server.js를 따로 고친 경우: 아무것도 바꾸지 않음
const pc3 = makePc('pc3');
const edited = read(pc3, 'server/relay-server.js').replace("const replyGuards = require('./reply-guards');", "const replyGuards = require('./reply-guards'); // PC에서 고침");
fs.writeFileSync(path.join(pc3, 'server', 'relay-server.js'), edited);
const snapshot = git(pc3, 'status', '--porcelain');
r = update(pc3, true);
assert.ok(/겹침/.test(r.log), r.log);
assert.strictEqual(read(pc3, 'server/relay-server.js'), edited);
assert.strictEqual(git(pc3, 'status', '--porcelain').replace('?? backups/auto-update/\n', ''), snapshot); // 자기 기록 폴더만 생김
console.log('4 겹침이면 그대로 통과');

// 5) 시험을 깨는 커밋: 되돌림
const work = path.join(tmp, 'work');
git(tmp, 'clone', '--quiet', '--branch', 'relay-desk', origin, work);
fs.appendFileSync(path.join(work, 'tests', 'honorific-guard.cjs'), "\nthrow new Error('일부러 실패');\n");
fs.appendFileSync(path.join(work, 'server', 'honorific-guard.js'), '\n// 바뀐 줄\n');
git(work, 'commit', '--quiet', '-am', 'break');
git(work, 'push', '--quiet', 'origin', 'relay-desk');
const good = { guard: read(pc1, 'server/honorific-guard.js'), test: read(pc1, 'tests/honorific-guard.cjs') };
r = update(pc1);
assert.ok(/시험 실패로 원래대로 되돌림/.test(r.log), r.log);
assert.strictEqual(r.state.lastApplied, head);
assert.strictEqual(read(pc1, 'server/honorific-guard.js'), good.guard);
assert.strictEqual(read(pc1, 'tests/honorific-guard.cjs'), good.test);
r = update(pc1); // 같은 실패 커밋은 다시 시도하지 않음
assert.strictEqual((r.log.match(/시험 실패/g) || []).length, 1);
console.log('5 시험 실패 되돌림 통과');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('자동 업데이트 검증 전부 통과');
