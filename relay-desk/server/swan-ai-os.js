'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {SwanTeamStore}=require('./swan-team-store');
const {SwanAiCache,hash}=require('./swan-ai-cache');
const {SwanCostLedger}=require('./swan-cost-ledger');
const {SwanModelRouter}=require('./swan-model-router');
const {SwanLearning,compareOutputs}=require('./swan-learning');
const {chooseExecution}=require('./swan-cost-router');
const {handoff}=require('./swan-handoff');

function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function safeParse(text){
  if(text&&typeof text==='object')return text;
  const raw=String(text||'').trim();
  try{return JSON.parse(raw);}catch(_){}
  const m=raw.match(/\{[\s\S]*\}/);if(m)try{return JSON.parse(m[0]);}catch(_){}
  return {summary:raw.slice(0,8000),confidence:null};
}
function deterministicBucket(...parts){
  const h=crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0,8);
  return parseInt(h,16)/0xffffffff;
}
function compact(value,max=16000){const s=JSON.stringify(value);return s.length<=max?value:JSON.parse(JSON.stringify({truncated:true,preview:s.slice(0,max)}));}
function riskFlags(ctx,input){
  const risk=ctx.docs?.risk||{};const flags=[...(Array.isArray(risk.flags)?risk.flags:[]),...(Array.isArray(input.flags)?input.flags:[])];
  return [...new Set(flags.map(String))];
}

function createSwanAiOs(options={}){
  const root=path.resolve(options.root);
  const configDir=path.resolve(options.configDir);
  const teamConfig=readJson(path.join(configDir,'swan-teams.json'));
  const modelConfig=readJson(path.join(configDir,'swan-model-roles.json'));
  const store=new SwanTeamStore(root);
  const cache=new SwanAiCache(path.join(root,'cache'),modelConfig.cache||{});
  const ledger=new SwanCostLedger(path.join(root,'jobs'));
  const learning=new SwanLearning(path.join(root,'learning'),{promotion:modelConfig.promotion||{}});
  const modelRouter=new SwanModelRouter({
    registryPath:path.join(configDir,'swan-model-roles.json'),
    executor:options.modelExecutor,
    available:options.providerAvailable,
    cache,ledger
  });
  const playbookRoot=path.resolve(options.playbookRoot||path.join(path.dirname(configDir),'..','playbooks'));
  const videoWorker=options.videoWorker||null;
  const localExecutors=options.localExecutors&&typeof options.localExecutors==='object'?options.localExecutors:{};

  function playbook(department){
    const file=path.join(playbookRoot,String(department)+'.md');
    try{return fs.readFileSync(file,'utf8').slice(0,20000);}catch(_){return '';}
  }
  function roles(department){
    const map=modelConfig.departmentRoleMap?.[department]||{teacher:'teacher_reasoning',student:'worker_reasoning'};
    return map;
  }
  function escalation(ctx,department,input={}){
    const flags=riskFlags(ctx,input);const threshold=Number(modelConfig.escalation?.confidenceBelow||0.85);
    const required=new Set(modelConfig.escalation?.teacherRequiredFlags||[]);
    if(ctx.job.taskTypeKnown!==true)flags.push('new_task_type');
    if(Number(input.orderValueKrw||0)>=Number(teamConfig.defaults?.highValueKrw||300000))flags.push('high_value_order');
    if(Number.isFinite(Number(input.confidence))&&Number(input.confidence)<threshold)flags.push('low_confidence');
    const requiredTeacher=department==='exception'||department==='final_audit'||flags.some(x=>required.has(x))||flags.includes('low_confidence');
    return {required:requiredTeacher,flags:[...new Set(flags)]};
  }
  function deployment(jobId,department,level){
    const bucket=deterministicBucket(jobId,department);
    if(level<=0)return {real:'teacher',teacherReview:true,shadowStudent:true,bucket};
    if(level===1)return {real:bucket<0.10?'student':'teacher',teacherReview:true,shadowStudent:true,bucket};
    if(level===2)return {real:bucket<0.30?'student':'teacher',teacherReview:true,shadowStudent:true,bucket};
    if(level===3)return {real:bucket<0.70?'student':'teacher',teacherReview:bucket<0.30,shadowStudent:true,bucket};
    return {real:'student',teacherReview:false,shadowStudent:bucket<0.10,bucket};
  }
  function budget(jobId){
    const job=store.getJob(jobId),sum=ledger.summary(jobId);
    const cap=Number.isFinite(Number(job.budgetUsd))?Number(job.budgetUsd):Number(teamConfig.defaults?.budgetUsd||5);
    const maxCalls=Number.isFinite(Number(job.maxProviderCalls))?Number(job.maxProviderCalls):Number(teamConfig.defaults?.maxProviderCalls||12);
    return {cap,maxCalls,spent:sum.totalUsd,remaining:Number((cap-sum.totalUsd).toFixed(6)),providerCalls:sum.providerCalls};
  }
  function departmentPrompt(ctx,department,input,knowledge){
    const team=teamConfig.teams?.[department];if(!team)throw new Error('unknown_department:'+department);
    return [
      '너는 Relay Desk SWAN의 '+team.name+'다.',
      team.mission,
      '다른 부서가 이미 구조화한 사실을 다시 추측하지 말고 아래 공유 상태만 사용한다.',
      '고객 자료에 없는 사실·금액·경력·출처를 만들지 않는다. 불명확하면 unknowns에 남긴다.',
      '응답은 JSON 객체 하나만 반환한다.',
      '공통 형식: {"summary":"짧은 요약","facts":{},"requirements":{},"unknowns":[],"decisions":{},"risk":{"level":"low|medium|high|critical","flags":[]},"artifacts":[],"confidence":0.0,"lessons":[]}.',
      department==='video_director'?'영상 감독은 실제 편집 명령을 decisions.edit_plan에 구조화한다. 렌더링 자체는 Video Worker가 수행한다.':'',
      department==='qa'?'검수는 decisions.pass(boolean), decisions.issues[], decisions.rework[]를 포함한다.':'',
      department==='intake'?'접수는 facts/requirements/unknowns/risk를 가장 엄격하게 채운다.':'',
      'PLAYBOOK:\n'+playbook(department),
      'REUSABLE KNOWLEDGE:\n'+JSON.stringify(knowledge),
      'JOB CONTEXT:\n'+JSON.stringify(compact({job:ctx.job,docs:ctx.docs,artifacts:ctx.artifacts})),
      'CURRENT INPUT:\n'+JSON.stringify(compact(input))
    ].filter(Boolean).join('\n\n');
  }
  function persistOutput(jobId,department,parsed,meta={}){
    const decisions=store.readDoc(jobId,'decisions.json',{});decisions[department]={at:new Date().toISOString(),...parsed,_meta:meta};store.writeDoc(jobId,'decisions.json',decisions);
    if(department==='intake'){
      if(parsed.facts&&typeof parsed.facts==='object')store.writeDoc(jobId,'facts.json',parsed.facts);
      if(parsed.requirements&&typeof parsed.requirements==='object')store.writeDoc(jobId,'requirements.json',parsed.requirements);
      if(Array.isArray(parsed.unknowns))store.writeDoc(jobId,'unknowns.json',parsed.unknowns);
      if(parsed.risk&&typeof parsed.risk==='object')store.writeDoc(jobId,'risk.json',parsed.risk);
      const job=store.getJob(jobId);job.taskTypeKnown=parsed.confidence>=0.9&&!(parsed.risk?.flags||[]).includes('new_task_type');store.saveJob(job);
    }
    if(department==='qa'){
      store.writeDoc(jobId,'qc.json',{at:new Date().toISOString(),status:parsed.decisions?.pass===true?'passed':'failed',...parsed});
    }
    if(Array.isArray(parsed.lessons))for(const lesson of parsed.lessons.slice(0,10)){
      const text=typeof lesson==='string'?lesson:JSON.stringify(lesson);store.addKnowledge({kind:'candidate_lesson',team:department,serviceType:store.getJob(jobId).serviceType,sourceJobId:jobId,reusable:false,title:department+' lesson',summary:text,tags:[department,'candidate']});
    }
    store.appendHistory(jobId,{type:'department.completed',department,provider:meta.provider||'Local',model:meta.model||'local_tool',role:meta.role||null,cached:meta.cached===true});
    return parsed;
  }
  function nextDepartment(serviceType,department){
    const pipeline=teamConfig.pipelines?.[serviceType]||teamConfig.pipelines?.generic||[];
    const i=pipeline.indexOf(department);return i>=0&&i+1<pipeline.length?pipeline[i+1]:null;
  }
  function createHandoff(jobId,from,to,parsed,ctx){
    if(!to)return null;
    const item=handoff({job_id:jobId,from,to,facts:parsed.facts||ctx.docs.facts||{},requirements:parsed.requirements||ctx.docs.requirements||{},unknowns:parsed.unknowns||ctx.docs.unknowns||[],decisions:parsed.decisions||{},artifacts:parsed.artifacts||[],risk:parsed.risk?.level||ctx.docs.risk?.level||'medium',confidence:parsed.confidence,flags:parsed.risk?.flags||[],budget:budget(jobId)});
    store.addHandoff(jobId,item);return item;
  }
  async function callRole({jobId,department,role,prompt,flags,shadow=false,cheapest=false}){
    const b=budget(jobId);if(b.remaining<=0)throw new Error('job_budget_exhausted');if(b.providerCalls>=b.maxCalls)throw new Error('job_provider_call_limit');
    return modelRouter.call({jobId,department,role,prompt,flags,shadow,cheapest,contextFingerprint:hash({jobId,department,role,prompt})});
  }
  async function shadowRun({jobId,department,prompt,teacherParsed,studentRole,flags,input}){
    const b=budget(jobId),maxFraction=Number(modelConfig.shadow?.maxShadowBudgetFraction||0.2);
    if(modelConfig.shadow?.enabled!==true||b.spent>b.cap*maxFraction&&b.spent>0)return null;
    const result=await callRole({jobId,department,role:studentRole,prompt,flags,shadow:true,cheapest:true});
    const studentParsed=safeParse(result.text);const comparison=compareOutputs(teacherParsed,studentParsed,input.requiredFields||[]);
    const metrics=learning.recordShadow({caseId:learning.shadowCaseId(),jobId,department,teacherRole:roles(department).teacher,studentRole,comparison,safetyError:input.shadowSafetyError===true,rework:false,failed:false});
    return {result:{provider:result.provider,model:result.model,costUsd:result.costUsd},student:studentParsed,comparison,metrics};
  }
  async function localDepartment(jobId,department,input,ctx){
    if(department==='finance'){
      const b=budget(jobId);const result={summary:'작업별 AI 예산과 현재 사용량을 계산했습니다.',facts:{budgetUsd:b.cap,spentUsd:b.spent,remainingUsd:b.remaining,providerCalls:b.providerCalls,maxProviderCalls:b.maxCalls},requirements:{},unknowns:[],decisions:{continue:b.remaining>0&&b.providerCalls<b.maxCalls},risk:{level:b.remaining>0?'low':'high',flags:b.remaining>0?[]:['budget_exhausted']},artifacts:[],confidence:1,lessons:[]};
      ledger.record(jobId,{department,role:'local_tool',provider:'Local',model:'cost_router',costUsd:0});return result;
    }
    if(department==='delivery'){
      const qc=ctx.docs.qc||{},unknowns=ctx.docs.unknowns||[],arts=store.listArtifacts({jobId,limit:100});
      const pass=qc.status==='passed'&&unknowns.length===0&&arts.length>0;
      ledger.record(jobId,{department,role:'local_tool',provider:'Local',model:'delivery_gate',costUsd:0});
      return {summary:pass?'납품 준비 조건을 통과했습니다.':'납품 전 확인이 필요합니다.',facts:{artifactCount:arts.length},requirements:{},unknowns,decisions:{pass,externalDeliveryExecuted:false},risk:{level:pass?'low':'high',flags:pass?[]:['delivery_gate_failed']},artifacts:arts,confidence:1,lessons:[]};
    }
    if(department==='quote'){
      if(typeof localExecutors.quote==='function'){
        const quoted=await localExecutors.quote({job:ctx.job,docs:ctx.docs,input});
        ledger.record(jobId,{department,role:'local_tool',provider:'Local',model:'pricing_rules',costUsd:0});
        return quoted;
      }
      if(input.ruleResult){ledger.record(jobId,{department,role:'local_tool',provider:'Local',model:'validated_pricing_rule',costUsd:0});return input.ruleResult;}
      throw new Error('quote_rule_input_required');
    }
    if(['video_analysis','transcription','video_production'].includes(department)){
      if(!videoWorker)throw new Error('video_worker_unavailable');
      let action=input.action;
      if(department==='video_analysis')action=action||'video.inspect';
      if(department==='transcription')action=action||'video.transcribe';
      if(department==='video_production'&&!action)throw new Error('video_production_action_required');
      const allowedByDepartment={
        video_analysis:new Set(['video.inspect','video.qc']),
        transcription:new Set(['video.transcribe']),
        video_production:new Set(['video.cut','video.subtitle','video.render','video.qc'])
      };
      if(!allowedByDepartment[department].has(action))throw new Error('video_action_not_allowed_for_department:'+department+':'+action);
      const result=await videoWorker.runAction(action,input.payload||input);
      ledger.record(jobId,{department,role:'local_tool',provider:'Local',model:'video-worker',costUsd:0,note:action});
      if(result.outputPath)store.registerArtifact({jobId,team:department,kind:action,label:path.basename(result.outputPath),path:result.outputPath,sha256:result.sha256,bytes:result.outputBytes,metadata:{action}});
      if(action==='video.qc')store.writeDoc(jobId,'qc.json',{status:result.ok?'passed':'failed',at:new Date().toISOString(),...result});
      return {summary:action+' 완료',facts:{action,result},requirements:{},unknowns:[],decisions:{localTool:true},risk:{level:result.ok===false?'high':'low',flags:result.ok===false?['qc_failed']:[]},artifacts:result.outputPath?[{path:result.outputPath,sha256:result.sha256||null}]:[],confidence:1,lessons:[]};
    }
    if(typeof localExecutors[department]==='function'){
      const result=await localExecutors[department]({job:ctx.job,docs:ctx.docs,input});
      ledger.record(jobId,{department,role:'local_tool',provider:'Local',model:'local_executor',costUsd:0});return result;
    }
    if(input.ruleResult){ledger.record(jobId,{department,role:'local_tool',provider:'Local',model:'validated_rule',costUsd:0});return input.ruleResult;}
    throw new Error('local_execution_unavailable:'+department);
  }

  async function runDepartment(jobId,department,input={}){
    const ctx=store.jobContext(jobId),team=teamConfig.teams?.[department];if(!team)throw new Error('unknown_department');
    const esc=escalation(ctx,department,input),roleMap=roles(department),level=learning.level(department),deploy=deployment(jobId,department,level);
    const localCapable=['finance','delivery','quote','video_analysis','transcription','video_production'].includes(department)||Boolean(input.ruleResult)||typeof localExecutors[department]==='function';
    const plan=chooseExecution({localCapable,playbookCapable:Boolean(input.ruleResult),ruleConfidence:Number(input.ruleConfidence||0),studentLevel:level,confidence:Number(input.confidence||1),escalation:esc.required,teacherRole:roleMap.teacher,studentRole:roleMap.student,budgetRemainingUsd:budget(jobId).remaining});
    if(plan.mode==='blocked')throw new Error(plan.reason);
    if(plan.mode==='local'||plan.mode==='rule'){
      const parsed=persistOutput(jobId,department,await localDepartment(jobId,department,input,ctx),{role:'local_tool'});
      const ho=createHandoff(jobId,department,nextDepartment(ctx.job.serviceType,department),parsed,ctx);return {ok:true,mode:'local',department,output:parsed,handoff:ho,budget:budget(jobId)};
    }
    const knowledge=store.searchKnowledge([ctx.job.serviceType,department,ctx.job.title].join(' '),{serviceType:ctx.job.serviceType,customerId:ctx.job.customerId,limit:Number(teamConfig.defaults?.knowledgeTopK||6)});
    const prompt=departmentPrompt(ctx,department,input,knowledge);
    const real=esc.required?'teacher':deploy.real;
    let chosen,teacherResult=null,studentResult=null,comparison=null;
    if(real==='teacher'){
      teacherResult=await callRole({jobId,department,role:roleMap.teacher,prompt,flags:esc.flags});chosen=teacherResult;
      const teacherParsed=safeParse(teacherResult.text);
      if(deploy.shadowStudent&&roleMap.student!=='local_tool'){
        try{studentResult=await shadowRun({jobId,department,prompt,teacherParsed,studentRole:roleMap.student,flags:esc.flags,input});}catch(error){store.appendHistory(jobId,{type:'shadow.failed',department,error:String(error.message||error).slice(0,300)});}
      }
    }else{
      studentResult={result:await callRole({jobId,department,role:roleMap.student,prompt,flags:esc.flags,cheapest:true})};chosen=studentResult.result;
      if(deploy.teacherReview||esc.required){
        teacherResult=await callRole({jobId,department,role:roleMap.teacher,prompt,flags:esc.flags});const t=safeParse(teacherResult.text),s=safeParse(chosen.text);comparison=compareOutputs(t,s,input.requiredFields||[]);
        const m=learning.recordShadow({caseId:learning.shadowCaseId(),jobId,department,teacherRole:roleMap.teacher,studentRole:roleMap.student,comparison,safetyError:input.shadowSafetyError===true,rework:comparison.decisionMatch<0.95,failed:false});
        if(comparison.decisionMatch<0.95||comparison.requiredFieldRecall<0.97){chosen=teacherResult;store.appendHistory(jobId,{type:'student.overridden',department,comparison,metrics:m});}
      }
    }
    const parsed=persistOutput(jobId,department,safeParse(chosen.text),{role:chosen===teacherResult?roleMap.teacher:roleMap.student,provider:chosen.provider,model:chosen.model,costUsd:chosen.costUsd,cached:chosen.cached});
    const ho=createHandoff(jobId,department,nextDepartment(ctx.job.serviceType,department),parsed,ctx);
    return {ok:true,mode:chosen===teacherResult?'teacher':'student',department,level,escalation:esc,provider:chosen.provider,model:chosen.model,cached:chosen.cached===true,costUsd:chosen.costUsd,output:parsed,handoff:ho,shadow:studentResult?.comparison?studentResult:null,comparison,budget:budget(jobId)};
  }

  async function runVideoAction(jobId,action,payload={}){
    if(!videoWorker)throw new Error('video_worker_unavailable');
    const allowed=['video.inspect','video.transcribe','video.cut','video.subtitle','video.render','video.qc'];if(!allowed.includes(action))throw new Error('video_action_not_allowed');
    const result=await videoWorker.runAction(action,payload);ledger.record(jobId,{department:'video_production',role:'local_tool',provider:'Local',model:'video-worker',costUsd:0,note:action});
    if(result.outputPath)store.registerArtifact({jobId,team:'video_production',kind:action,label:path.basename(result.outputPath),path:result.outputPath,sha256:result.sha256,bytes:result.outputBytes,metadata:{action}});
    if(action==='video.qc')store.writeDoc(jobId,'qc.json',{status:result.ok?'passed':'failed',at:new Date().toISOString(),...result});
    store.appendHistory(jobId,{type:'video.action',action,ok:result.ok!==false});return result;
  }

  function createJob(input={}){
    const defaults=teamConfig.defaults||{};return store.createJob({...input,budgetUsd:input.budgetUsd??defaults.budgetUsd,maxProviderCalls:input.maxProviderCalls??defaults.maxProviderCalls});
  }
  function promoteGold(jobId,department,input={}){
    const ctx=store.jobContext(jobId),qc=ctx.docs.qc||{};if(qc.status!=='passed'&&input.force!==true)throw new Error('gold_requires_passed_qc');
    const out=ctx.docs.decisions?.[department];if(!out)throw new Error('department_output_missing');
    return learning.createGold({department,jobId,caseId:input.caseId,input:ctx.docs.intake,context:{facts:ctx.docs.facts,requirements:ctx.docs.requirements,risk:ctx.docs.risk},teacherOutput:out,finalOutputPath:input.finalOutputPath,evaluation:input.evaluation||qc,lessons:input.lessons||out.lessons||[]});
  }
  function syncExisting(options2={}){
    const state=options2.stateFile?store.syncRelayState(options2.stateFile):null;const artifacts=options2.storageRoot?store.syncLegacyArtifacts(options2.storageRoot):null;return {state,artifacts};
  }
  function status(){return {ok:true,version:1,teams:teamConfig.teams,pipelines:teamConfig.pipelines,modelRoles:modelConfig.roles,metrics:learning.metrics(),cache:cache.stats(),jobs:store.listJobs(20)};}
  return {createJob,getJob:id=>store.jobContext(id),listJobs:n=>store.listJobs(n),runDepartment,runVideoAction,promoteGold,syncExisting,status,searchKnowledge:(q,o)=>store.searchKnowledge(q,o),approveStudentLevel:(d,l)=>learning.approveLevel(d,l),costSummary:id=>ledger.summary(id)};
}

module.exports={createSwanAiOs,safeParse,deterministicBucket};
