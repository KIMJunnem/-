const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.resolve(process.argv[2] || path.join(__dirname, 'config.json'));
const MAX_FILE_BYTES = 18 * 1024 * 1024;
const DEFAULT_EXTENSIONS = ['.txt', '.md', '.json', '.html', '.htm', '.csv', '.pdf', '.docx', '.zip'];
const MIME_TYPES = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.html': 'text/html',
  '.htm': 'text/html', '.csv': 'text/csv', '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.zip': 'application/zip'
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`설정 파일이 없습니다: ${CONFIG_PATH}`);
    console.error('bridge/config.example.json을 config.json으로 복사한 뒤 감시 폴더를 입력하세요.');
    process.exitCode = 1;
    return null;
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return {
    server: String(config.server || 'http://127.0.0.1:8787').replace(/\/$/, ''),
    pollMs: Math.max(1000, Number(config.pollMs || 3000)),
    extensions: (config.extensions || DEFAULT_EXTENSIONS).map(ext => String(ext).toLowerCase()),
    folders: Array.isArray(config.folders) ? config.folders.filter(folder => folder && folder.path) : []
  };
}

function dataDir() {
  const target = path.join(__dirname, 'data');
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function loadManifest() {
  const target = path.join(dataDir(), 'manifest.json');
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch (_) { return {}; }
}

function saveManifest(manifest) {
  const target = path.join(dataDir(), 'manifest.json');
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(temp, target);
}

function listFiles(root, recursive) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.endsWith('.tmp') || entry.name.endsWith('.crdownload')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory() && recursive) result.push(...listFiles(full, recursive));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

async function importFile(filePath, folder, manifest, config) {
  const stat = fs.statSync(filePath);
  if (stat.size === 0 || stat.size > MAX_FILE_BYTES) return;
  const ext = path.extname(filePath).toLowerCase();
  if (!config.extensions.includes(ext)) return;
  const buffer = fs.readFileSync(filePath);
  const hash = sha256(buffer);
  const previous = manifest[filePath];
  if (previous?.sha256 === hash) return;
  const response = await fetch(`${config.server}/api/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: path.basename(filePath),
      source: folder.source || '브리지',
      mimeType: MIME_TYPES[ext] || 'application/octet-stream',
      capturedAt: new Date(stat.mtimeMs).toISOString(),
      dataBase64: buffer.toString('base64')
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${payload.error || 'import_failed'}`);
  manifest[filePath] = { sha256: hash, size: stat.size, importedAt: new Date().toISOString(), duplicate: Boolean(payload.duplicate) };
  saveManifest(manifest);
  console.log(`${payload.duplicate ? '중복 건너뜀' : '자동 등록'} · ${folder.source || '브리지'} · ${path.basename(filePath)}`);
}

async function scan(config, manifest) {
  for (const folder of config.folders) {
    const root = path.resolve(String(folder.path));
    for (const filePath of listFiles(root, folder.recursive !== false)) {
      try { await importFile(filePath, folder, manifest, config); }
      catch (error) { console.error(`등록 실패 · ${filePath} · ${error.message}`); }
    }
  }
}

const config = loadConfig();
if (config) {
  if (!config.folders.length) {
    console.error('감시할 폴더가 없습니다. config.json의 folders를 설정하세요.');
    process.exitCode = 1;
  } else {
    const manifest = loadManifest();
    console.log(`Relay Bridge 실행 · ${config.folders.length}개 폴더 감시 · ${config.server}`);
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try { await scan(config, manifest); } finally { running = false; }
    };
    tick();
    const timer = setInterval(tick, config.pollMs);
    process.on('SIGINT', () => { clearInterval(timer); saveManifest(manifest); process.exit(0); });
    process.on('SIGTERM', () => { clearInterval(timer); saveManifest(manifest); process.exit(0); });
  }
}
