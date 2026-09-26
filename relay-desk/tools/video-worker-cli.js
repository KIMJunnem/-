'use strict';

const fs = require('node:fs');
const path = require('node:path');
const worker = require('../server/video-worker');

function readJsonArg(value) {
  const raw = String(value || '').trim();
  if (!raw) return {};
  const asPath = path.resolve(raw);
  if (fs.existsSync(asPath) && fs.statSync(asPath).isFile()) {
    return JSON.parse(fs.readFileSync(asPath, 'utf8'));
  }
  return JSON.parse(raw);
}

async function main() {
  const command = String(process.argv[2] || 'status').trim();
  if (command === 'status') {
    process.stdout.write(JSON.stringify(worker.status(), null, 2) + '\n');
    process.exitCode = worker.status().ready ? 0 : 2;
    return;
  }

  if (command === 'plan') {
    const plan = readJsonArg(process.argv[3]);
    const result = await worker.runPlan(plan);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const payload = readJsonArg(process.argv[3] || '{}');
  const result = await worker.runAction(command, payload);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result && result.ok === false ? 1 : 0;
}

main().catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, error: error.message }, null, 2) + '\n');
  process.exitCode = 1;
});
