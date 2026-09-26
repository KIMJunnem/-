'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function mkdir(d){fs.mkdirSync(d,{recursive:true});return d;}
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return fallback;}}
function atomic(file,value){mkdir(path.dirname(file));const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8');fs.renameSync(tmp,file);}
function sanitizeText(text){return String(text||'').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]').replace(/(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}/g,'[phone]');}
function safeId(v){return String(v||'case').replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,100);}
function flatten(value,prefix='',out={}){
  if(Array.isArray(value)){value.forEach((v,i)=>flatten(v,prefix?prefix+'.'+i:String(i),out));return out;}
  if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value)) flatten(v,prefix?prefix+'.'+k:k,out);return out;}
  out[prefix]=value;return out;
}
function norm(v){return typeof v==='string'?v.trim().replace(/\s+/g,' ').toLowerCase():JSON.stringify(v);}
function tokenSet(v){return new Set(String(v||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));}
function jaccard(a,b){const A=tokenSet(a),B=tokenSet(b);if(!A.size&&!B.size)return 1;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/(A.size+B.size-hit||1);}

function compareOutputs(teacher,student,requiredFields=[]){
  let t=teacher,s=student;
  try{if(typeof t==='string')t=JSON.parse(t);}catch(_){}
  try{if(typeof s==='string')s=JSON.parse(s);}catch(_){}
  if(t&&s&&typeof t==='object'&&typeof s==='object'){
    const tf=flatten(t),sf=flatten(s);const keys=[...new Set([...Object.keys(tf),...Object.keys(sf)])];
    let exact=0;for(const k of keys)if(k in tf&&k in sf&&norm(tf[k])===norm(sf[k]))exact++;
    const req=requiredFields.length?requiredFields:Object.keys(tf);
    let reqHit=0;for(const k of req)if(k in sf&&sf[k]!==null&&sf[k]!==''&&sf[k]!==undefined)reqHit++;
    return {mode:'structured',decisionMatch:keys.length?exact/keys.length:1,requiredFieldRecall:req.length?reqHit/req.length:1,subjective:false,keysCompared:keys.length};
  }
  return {mode:'text',decisionMatch:jaccard(typeof t==='string'?t:JSON.stringify(t),typeof s==='string'?s:JSON.stringify(s)),requiredFieldRecall:1,subjective:true,keysCompared:0};
}

class SwanLearning {
  constructor(root,config={}){
    this.root=path.resolve(root);mkdir(this.root);
    this.goldRoot=mkdir(path.join(this.root,'gold-samples'));
    this.shadowRoot=mkdir(path.join(this.root,'shadow'));
    this.metricsFile=path.join(this.root,'department-metrics.json');
    this.promotion=config.promotion||{};
  }
  metrics(){return read(this.metricsFile,{version:1,departments:{}});}
  recordShadow(row={}){
    const dept=String(row.department||'unknown'),metrics=this.metrics();const m=metrics.departments[dept]||{samples:0,decisionMatchSum:0,requiredFieldRecallSum:0,safetyErrors:0,reworks:0,failures:0,level:0,manualApprovedLevel:0};
    m.samples++;m.decisionMatchSum+=Number(row.comparison?.decisionMatch||0);m.requiredFieldRecallSum+=Number(row.comparison?.requiredFieldRecall||0);
    if(row.safetyError)m.safetyErrors++;if(row.rework)m.reworks++;if(row.failed)m.failures++;
    m.decisionMatch=Number((m.decisionMatchSum/m.samples).toFixed(4));m.requiredFieldRecall=Number((m.requiredFieldRecallSum/m.samples).toFixed(4));m.reworkRate=Number((m.reworks/m.samples).toFixed(4));
    m.level=this.recommendedLevel(m);m.updatedAt=new Date().toISOString();metrics.departments[dept]=m;atomic(this.metricsFile,metrics);
    const file=path.join(this.shadowRoot,dept+'.jsonl');fs.appendFileSync(file,JSON.stringify({...row,at:new Date().toISOString()})+'\n','utf8');return m;
  }
  recommendedLevel(m){
    const levels=this.promotion.levels||{};let level=0;const maxAuto=Number(this.promotion.maxAutoLevel||3);
    for(const n of [1,2,3,4,5]){
      const r=levels[String(n)];if(!r)continue;
      const pass=Number(m.samples)>=Number(r.minSamples||Infinity)&&Number(m.decisionMatch||0)>=Number(r.minDecisionMatch||1)&&Number(m.requiredFieldRecall||0)>=Number(r.minRequiredFieldRecall||1)&&Number(m.safetyErrors||0)<=Number(r.maxSafetyErrors||0)&&Number(m.reworkRate||0)<=Number(r.maxReworkRate||1);
      if(pass){ if(n<=maxAuto)level=n; else if(Number(m.manualApprovedLevel||0)>=n)level=n; }
    }
    return level;
  }
  level(department){return Number(this.metrics().departments?.[department]?.level||0);}
  approveLevel(department,level){const metrics=this.metrics();const m=metrics.departments[department]||{samples:0,decisionMatchSum:0,requiredFieldRecallSum:0,safetyErrors:0,reworks:0,failures:0,level:0};m.manualApprovedLevel=Math.max(Number(m.manualApprovedLevel||0),Number(level||0));m.level=this.recommendedLevel(m);metrics.departments[department]=m;atomic(this.metricsFile,metrics);return m;}
  createGold(input={}){
    const department=safeId(input.department),caseId=safeId(input.caseId||input.jobId||('GOLD-'+Date.now()));const dir=mkdir(path.join(this.goldRoot,department,caseId));
    const files={
      'input.json':input.input||{},'context.json':input.context||{},'teacher_output.json':input.teacherOutput||{},
      'evaluation.json':input.evaluation||{},'lessons.json':input.lessons||{}
    };
    for(const [name,value] of Object.entries(files)) atomic(path.join(dir,name),JSON.parse(sanitizeText(JSON.stringify(value))));
    if(input.finalOutputPath&&fs.existsSync(input.finalOutputPath)){const dest=path.join(dir,path.basename(input.finalOutputPath));fs.copyFileSync(input.finalOutputPath,dest);}
    return {department,caseId,dir,createdAt:new Date().toISOString()};
  }
  shadowCaseId(){return 'SH-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex');}
}
module.exports={SwanLearning,compareOutputs,sanitizeText};
