'use strict';

// Jev(TypeSafe AI) 키 등록 칸: 키 보관만, 호출 0회, 응답·상태 파일에 키 원문 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server', 'relay-server.js'), 'utf8');
assert.ok(!/api\.typesafe\.ai|systemone/i.test(server), '서버 본체에 Jev 호출 코드 없음(시뮬레이션 모듈에만 있음)');
assert.equal((server.match(/jevSimulation\.startSimulation\(/g) || []).length, 1, 'Jev 호출은 시뮬레이션 경로 한 곳뿐');
const dashboard = path.join(ROOT, 'dist', 'index.html');
if (fs.existsSync(dashboard)) {
  const html = fs.readFileSync(dashboard, 'utf8');
  assert.ok(html.includes('id="apiKeyJev"'), '설정 창에 Jev 칸');
  assert.equal((html.match(/\['Jev','apiKeyJev'\]/g) || []).length, 2, '저장 버튼 두 경로 모두 Jev 포함');
}

function copyDir(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    if (skip && skip(src, entry)) continue;
    if (entry.isDirectory()) copyDir(src, path.join(to, entry.name), skip);
    else if (entry.isFile()) fs.copyFileSync(src, path.join(to, entry.name));
  }
}
const request = (url, options = {}) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: options.method || 'GET', headers: options.headers || {} }, res => {
    let data = ''; res.setEncoding('utf8'); res.on('data', c => { data += c; });
    res.on('end', () => resolve({ status: res.statusCode, text: data, json: () => JSON.parse(data || '{}') }));
  });
  req.on('error', reject); if (options.body) req.write(options.body); req.end();
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-jev-'));
  copyDir(path.join(ROOT, 'server'), path.join(dir, 'server'), (src, entry) => entry.isDirectory() && ['data', 'storage'].includes(entry.name) && path.dirname(src) === path.join(ROOT, 'server'));
  copyDir(path.join(ROOT, 'services'), path.join(dir, 'services'));
  fs.mkdirSync(path.join(dir, 'server', 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'server', 'storage'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server', 'data', 'astra-scheduler-paused'), 'test');
  fs.writeFileSync(path.join(dir, 'server', 'data', 'state.json'), JSON.stringify({ soomgoLeads: [], soomgoReplies: [], promptPosts: [] }));
  const log = path.join(dir, 'api-calls.log');
  fs.writeFileSync(path.join(dir, 'preload.cjs'), `const fs=require('fs');const o=global.fetch;global.fetch=async(u,x)=>{const s=String(u&&u.url||u);if(!/127\\.0\\.0\\.1|localhost/.test(s)){fs.appendFileSync(${JSON.stringify(log)},s+'\\n');throw new Error('api_blocked');}return o(u,x);};`);
  const port = 19900 + Math.floor(Math.random() * 90);
  const env = { ...process.env, RELAY_PORT: String(port) };
  delete env.TYPESAFE_API_KEY;
  const child = spawn(process.execPath, ['--require', path.join(dir, 'preload.cjs'), path.join(dir, 'server', 'relay-server.js')], { cwd: dir, env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 60; i += 1) { try { if ((await request(`${base}/api/health`)).status === 200) break; } catch (_) {} await sleep(250); }
    const before = (await request(`${base}/api/providers`)).json();
    assert.equal(before.providers.Jev.configured, false);
    assert.equal(before.providers.Jev.callsEnabled, 'simulation_only');
    const fakeKey = 'sk-test-jev-not-a-real-key-000000';
    const set = await request(`${base}/api/providers/configure`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'jev', key: fakeKey }) });
    assert.equal(set.status, 200);
    assert.ok(!set.text.includes(fakeKey), '응답에 키 원문 없음');
    const body = set.json();
    assert.equal(body.provider, 'Jev'); assert.equal(body.requeued, 0);
    assert.equal(body.providers.Jev.configured, true);
    assert.equal(body.providers.Jev.callsEnabled, 'simulation_only');
    assert.match(body.providers.Jev.status, /시뮬레이션 전용/);
    // 키가 있어도 관리자 머리글 없이는 시뮬레이션이 시작되지 않는다
    const denied = await request(`${base}/api/jev/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 403);
    await sleep(300);
    const stateText = fs.readFileSync(path.join(dir, 'server', 'data', 'state.json'), 'utf8');
    assert.ok(!stateText.includes(fakeKey), '상태 파일에 키 원문 없음');
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    assert.ok(!calls.some(url => /typesafe/i.test(url)), `Jev 호출 0회 (${calls.join(',')})`);
    const cleared = (await request(`${base}/api/providers/configure`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'jev', key: '' }) })).json();
    assert.equal(cleared.providers.Jev.configured, false, '빈 값으로 해제');
    console.log('jev-key-slot: PASS');
  } finally {
    child.kill(); await sleep(200); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
