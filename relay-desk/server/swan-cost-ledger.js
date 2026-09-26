'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(x => JSON.parse(x)); } catch (_) { return []; }
}
class SwanCostLedger {
  constructor(root) { this.root = path.resolve(root); fs.mkdirSync(this.root, { recursive: true }); }
  file(jobId) { const dir = path.join(this.root, String(jobId).replace(/[^A-Za-z0-9_.-]/g,'_')); fs.mkdirSync(dir,{recursive:true}); return path.join(dir,'costs.jsonl'); }
  record(jobId, row = {}) {
    const item = {
      at: new Date().toISOString(), jobId, department: row.department || null, role: row.role || null,
      provider: row.provider || 'Local', model: row.model || 'local_tool',
      inputTokens: Number.isFinite(Number(row.inputTokens)) ? Number(row.inputTokens) : null,
      outputTokens: Number.isFinite(Number(row.outputTokens)) ? Number(row.outputTokens) : null,
      costUsd: Number.isFinite(Number(row.costUsd)) ? Number(row.costUsd) : 0,
      cached: row.cached === true, shadow: row.shadow === true, success: row.success !== false,
      responseId: row.responseId || null, note: row.note || null
    };
    fs.appendFileSync(this.file(jobId), JSON.stringify(item)+'\n','utf8'); return item;
  }
  rows(jobId) { return readLines(this.file(jobId)); }
  summary(jobId) {
    const rows=this.rows(jobId), departments={}; let totalUsd=0, providerCalls=0, teacherCalls=0, shadowCalls=0;
    for(const r of rows){ totalUsd += Number(r.costUsd||0); if(r.provider!=='Local'&&!r.cached) providerCalls++; if(String(r.role||'').startsWith('teacher_')&&!r.cached) teacherCalls++; if(r.shadow) shadowCalls++; departments[r.department||'unknown']=(departments[r.department||'unknown']||0)+Number(r.costUsd||0); }
    return { jobId, totalUsd:Number(totalUsd.toFixed(6)), providerCalls, teacherCalls, shadowCalls, departments:Object.fromEntries(Object.entries(departments).map(([k,v])=>[k,Number(v.toFixed(6))])) };
  }
}
module.exports={SwanCostLedger};
