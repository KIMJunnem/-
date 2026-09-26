'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return { version: 1, entries: {} }; } }

class SwanAiCache {
  constructor(root, config = {}) {
    this.dir = path.resolve(root); fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, 'ai-response-cache.json');
    this.defaultTtlSeconds = Number(config.defaultTtlSeconds || 86400);
    this.maxEntries = Number(config.maxEntries || 5000);
    this.noCacheFlags = new Set(config.noCacheFlags || []);
  }
  key(input) { return hash(input); }
  allowed(flags = []) { return !(flags || []).some(flag => this.noCacheFlags.has(String(flag))); }
  get(key) {
    const db = read(this.file); const item = db.entries[key];
    if (!item) return null;
    if (Number(item.expiresAt || 0) <= Date.now()) { delete db.entries[key]; this.write(db); return null; }
    return item.value;
  }
  set(key, value, ttlSeconds = this.defaultTtlSeconds, meta = {}) {
    const db = read(this.file);
    db.entries[key] = { value, meta, createdAt: new Date().toISOString(), expiresAt: Date.now() + Math.max(60, Number(ttlSeconds || 0)) * 1000 };
    const keys = Object.keys(db.entries);
    if (keys.length > this.maxEntries) {
      keys.sort((a,b) => Number(db.entries[a].expiresAt||0)-Number(db.entries[b].expiresAt||0)).slice(0, keys.length-this.maxEntries).forEach(k => delete db.entries[k]);
    }
    this.write(db); return key;
  }
  write(db) {
    const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8'); fs.renameSync(tmp, this.file);
  }
  stats() {
    const db = read(this.file); const now = Date.now(); const items = Object.values(db.entries || {});
    return { entries: items.length, active: items.filter(x => Number(x.expiresAt||0) > now).length };
  }
}
module.exports = { SwanAiCache, stable, hash };
