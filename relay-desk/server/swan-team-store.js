'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }
function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`; }
function sha256(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }
function safeJson(value) { return JSON.stringify(value, null, 2); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function appendJsonl(file, value) { ensureDir(path.dirname(file)); fs.appendFileSync(file, JSON.stringify(value) + '\n', 'utf8'); }
function readJsonl(file) { try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch (_) { return []; } }
function safeName(value) { return String(value || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 140); }
function scrub(text) {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}/g, '[phone]')
    .slice(0, 8000);
}
function tokens(text) { return new Set(String(text || '').toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(x => x.length > 1)); }

const JOB_DOCS = Object.freeze([
  'intake.json','facts.json','requirements.json','unknowns.json','risk.json',
  'decisions.json','handoff.json','artifacts.json','qc.json','history.json'
]);

class SwanTeamStore {
  constructor(root) {
    this.root = ensureDir(path.resolve(root));
    this.jobsDir = ensureDir(path.join(this.root, 'jobs'));
    this.knowledgeFile = path.join(this.root, 'knowledge.jsonl');
    this.artifactsFile = path.join(this.root, 'artifacts.jsonl');
    this.eventsFile = path.join(this.root, 'events.jsonl');
    this.legacyIndexFile = path.join(this.root, 'legacy-index.json');
  }
  jobDir(jobId) { return ensureDir(path.join(this.jobsDir, safeName(jobId))); }
  jobFile(jobId) { return path.join(this.jobDir(jobId), 'job.json'); }
  docFile(jobId, name) {
    if (!JOB_DOCS.includes(name)) throw new Error('unsupported_job_doc:' + name);
    return path.join(this.jobDir(jobId), name);
  }
  writeDoc(jobId, name, value) {
    const file=this.docFile(jobId,name); const tmp=file+'.tmp'; fs.writeFileSync(tmp,safeJson(value),'utf8'); fs.renameSync(tmp,file);
    this.event(jobId,'job.doc.updated',{name}); return value;
  }
  readDoc(jobId, name, fallback = null) { return readJson(this.docFile(jobId,name), fallback); }
  jobContext(jobId) {
    const job=this.getJob(jobId); const docs={};
    for(const name of JOB_DOCS) docs[name.replace('.json','')]=this.readDoc(jobId,name, name==='unknowns.json'?[]:{});
    return {job,docs,artifacts:this.listArtifacts({jobId,limit:100})};
  }
  createJob(input = {}) {
    const jobId = input.id ? safeName(input.id) : id('SWAN');
    const job = {
      id: jobId, createdAt: now(), updatedAt: now(), status: 'READY',
      serviceType: String(input.serviceType || 'generic'), taskTypeKnown: input.taskTypeKnown === true,
      title: String(input.title || input.objective || 'untitled').slice(0, 160),
      objective: String(input.objective || '').slice(0, 8000),
      customerId: input.customerId ? String(input.customerId) : null,
      constraints: input.constraints && typeof input.constraints === 'object' ? input.constraints : {},
      inputs: Array.isArray(input.inputs) ? input.inputs : [],
      budgetUsd: Number.isFinite(Number(input.budgetUsd)) ? Number(input.budgetUsd) : null,
      maxProviderCalls: Number.isFinite(Number(input.maxProviderCalls)) ? Number(input.maxProviderCalls) : null,
      allowLocalTools: input.allowLocalTools !== false, stages: [], errors: []
    };
    this.saveJob(job);
    this.writeDoc(jobId,'intake.json', input.intake || {raw_request:scrub(input.objective||''), source:input.source||'manual'});
    this.writeDoc(jobId,'facts.json', input.facts || {});
    this.writeDoc(jobId,'requirements.json', input.requirements || {});
    this.writeDoc(jobId,'unknowns.json', Array.isArray(input.unknowns)?input.unknowns:[]);
    this.writeDoc(jobId,'risk.json', input.risk || {level:'medium',flags:[]});
    this.writeDoc(jobId,'decisions.json',{});
    this.writeDoc(jobId,'handoff.json',{items:[]});
    this.writeDoc(jobId,'artifacts.json',{items:[]});
    this.writeDoc(jobId,'qc.json',{status:'pending'});
    this.writeDoc(jobId,'history.json',{items:[{at:now(),type:'created'}]});
    this.event(jobId, 'job.created', { serviceType: job.serviceType, title: job.title });
    return job;
  }
  saveJob(job) {
    job.updatedAt = now(); const file=this.jobFile(job.id), tmp=file+'.tmp'; fs.writeFileSync(tmp, safeJson(job), 'utf8'); fs.renameSync(tmp,file); return job;
  }
  getJob(jobId) { const job = readJson(this.jobFile(jobId), null); if (!job) throw new Error('job_not_found'); return job; }
  listJobs(limit = 50) {
    return fs.readdirSync(this.jobsDir,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x => readJson(path.join(this.jobsDir,x.name,'job.json'), null)).filter(Boolean)
      .sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.max(1, Math.min(Number(limit)||50, 200)));
  }
  appendHistory(jobId, item) {
    const history=this.readDoc(jobId,'history.json',{items:[]}); history.items=Array.isArray(history.items)?history.items:[];
    history.items.push({at:now(),...item}); if(history.items.length>1000) history.items=history.items.slice(-1000);
    return this.writeDoc(jobId,'history.json',history);
  }
  addHandoff(jobId, item) {
    const data=this.readDoc(jobId,'handoff.json',{items:[]}); data.items=Array.isArray(data.items)?data.items:[];
    data.items.push(item); return this.writeDoc(jobId,'handoff.json',data);
  }
  event(jobId, type, data) { appendJsonl(this.eventsFile, { id: id('EVT'), at: now(), jobId: jobId || null, type, data: data || {} }); }
  addKnowledge(entry = {}) {
    const summary = scrub(entry.summary || entry.text || '');
    if (!summary.trim()) return null;
    const record = {
      id: id('KN'), at: now(), kind: String(entry.kind || 'learning'), team: entry.team || null,
      serviceType: entry.serviceType || null, sourceJobId: entry.sourceJobId || null,
      customerId: entry.customerId || null, reusable: entry.reusable !== false,
      title: scrub(entry.title || '').slice(0, 200), summary,
      tags: Array.isArray(entry.tags) ? entry.tags.map(String).slice(0, 20) : [],
      fingerprint: sha256([entry.kind, entry.team, entry.serviceType, summary].join('|'))
    };
    const exists = readJsonl(this.knowledgeFile).some(x => x.fingerprint === record.fingerprint);
    if (!exists) appendJsonl(this.knowledgeFile, record);
    return exists ? null : record;
  }
  searchKnowledge(query, options = {}) {
    const q = tokens(query), serviceType = options.serviceType || null, customerId = options.customerId || null;
    return readJsonl(this.knowledgeFile).filter(item => {
      if (item.reusable === false && (!customerId || item.customerId !== customerId)) return false;
      if (item.customerId && customerId && item.customerId !== customerId && item.reusable !== true) return false;
      if (serviceType && item.serviceType && item.serviceType !== serviceType) return false;
      return true;
    }).map(item => {
      const hay = tokens([item.title, item.summary, ...(item.tags || [])].join(' ')); let score = 0;
      for (const t of q) if (hay.has(t)) score += 1; if (serviceType && item.serviceType === serviceType) score += 2; return { item, score };
    }).filter(x => !q.size || x.score > 0).sort((a,b) => b.score - a.score || String(b.item.at).localeCompare(String(a.item.at)))
      .slice(0, Math.max(1, Math.min(Number(options.limit)||6, 20))).map(x => x.item);
  }
  registerArtifact(entry = {}) {
    const record = {
      id: id('ART'), at: now(), jobId: entry.jobId || null, team: entry.team || null, kind: entry.kind || 'file',
      label: String(entry.label || path.basename(String(entry.path || 'artifact'))).slice(0, 200),
      path: entry.path ? path.resolve(entry.path) : null, sha256: entry.sha256 || null,
      bytes: Number(entry.bytes || 0) || null, reusable: entry.reusable === true, metadata: entry.metadata || {}
    };
    appendJsonl(this.artifactsFile, record);
    if(record.jobId){const doc=this.readDoc(record.jobId,'artifacts.json',{items:[]});doc.items=Array.isArray(doc.items)?doc.items:[];doc.items.push(record);this.writeDoc(record.jobId,'artifacts.json',doc);}
    return record;
  }
  listArtifacts(options = {}) { return readJsonl(this.artifactsFile).filter(x => !options.jobId || x.jobId === options.jobId).slice(-Math.max(1, Math.min(Number(options.limit)||100, 500))).reverse(); }
  syncRelayState(stateFile) {
    const state = readJson(path.resolve(stateFile), null); if (!state || typeof state !== 'object') return { ok: true, added: 0, missing: true };
    const candidates = []; for (const key of ['tasks','jobs','orders','soomgoLeads']) { const arr = Array.isArray(state[key]) ? state[key] : []; for (const item of arr) if (item && typeof item === 'object') candidates.push({ key, item }); }
    let added = 0;
    for (const { key, item } of candidates) {
      const title=item.title||item.name||item.serviceName||item.requestTitle||item.id||item.taskId||key,status=item.status||item.stage||item.state||'',serviceType=item.serviceType||item.serviceCode||item.category||null,customerId=item.customerId||item.conversationId||null;
      const details=[item.summary,item.description,item.scope,item.note].filter(Boolean).join(' | ');
      const rec=this.addKnowledge({kind:'relay_state_summary',serviceType,customerId,reusable:false,title:String(title),summary:`${key} / 상태 ${status||'미기록'}${details?' / '+details:''}`,tags:[key,status,serviceType].filter(Boolean)}); if(rec)added++;
    }
    return { ok:true, added, scanned:candidates.length, missing:false };
  }
  syncLegacyArtifacts(storageRoot) {
    const root=path.resolve(storageRoot); if(!fs.existsSync(root))return {ok:true,scanned:0,added:0,root,missing:true};
    const index=readJson(this.legacyIndexFile,{});let scanned=0,added=0;const queue=[root];
    while(queue.length&&scanned<10000){const dir=queue.shift();let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch(_){continue;}
      for(const entry of entries){const full=path.join(dir,entry.name);if(entry.isDirectory()){queue.push(full);continue;}if(!entry.isFile())continue;scanned++;let stat;try{stat=fs.statSync(full);}catch(_){continue;}const key=`${full}|${stat.size}|${stat.mtimeMs}`;if(index[key])continue;this.registerArtifact({kind:'legacy_file',label:entry.name,path:full,bytes:stat.size,metadata:{importedFrom:'relay-storage',modifiedAt:stat.mtime.toISOString()}});index[key]=now();added++;}
    }
    fs.writeFileSync(this.legacyIndexFile,safeJson(index),'utf8');return {ok:true,scanned,added,root};
  }
}

module.exports = { SwanTeamStore, scrub, readJsonl, JOB_DOCS };
