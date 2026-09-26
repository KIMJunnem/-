'use strict';

const assert=require('node:assert');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createSwanAiOs}=require('../server/swan-ai-os');
const {compareOutputs}=require('../server/swan-learning');
const {SwanAiCache}=require('../server/swan-ai-cache');

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'swan-ai-os-'));
  let calls=0;
  const fakeVideo={runAction:async(action,payload)=>({ok:true,action,inputPath:payload.inputPath||'x',outputPath:payload.outputPath||null,outputBytes:12,sha256:'abc'})};
  const executor=async({provider,model,role,department})=>{
    calls++;
    const base={
      summary:department+' done',facts:{service:'test'},requirements:{format:'json'},unknowns:[],
      decisions:department==='qa'?{pass:true}:{route:'ok'},risk:{level:'low',flags:[]},artifacts:[],
      confidence:0.99,lessons:['reuse structured state']
    };
    return {provider,model,text:JSON.stringify(base),usage:{input_tokens:100,output_tokens:50},providerResponseId:'fake-'+calls};
  };
  const ai=createSwanAiOs({
    root,configDir:path.join(__dirname,'..','server','config'),playbookRoot:path.join(__dirname,'..','playbooks'),
    videoWorker:fakeVideo,providerAvailable:()=>true,modelExecutor:executor
  });

  const job=ai.createJob({serviceType:'generic',objective:'테스트 고객 요청',budgetUsd:10,maxProviderCalls:20});
  assert.ok(job.id.startsWith('SWAN-'));
  const finance=await ai.runDepartment(job.id,'finance',{});
  assert.equal(finance.mode,'local');
  assert.equal(calls,0,'local department must not call a model');

  const intake=await ai.runDepartment(job.id,'intake',{requiredFields:['facts.service','requirements.format']});
  assert.equal(intake.mode,'teacher');
  assert.ok(calls>=1);
  const status=ai.status();
  assert.ok(status.metrics.departments.intake.samples>=1,'teacher run should create a student shadow sample');

  const qa=await ai.runDepartment(job.id,'qa',{});
  assert.equal(qa.output.decisions.pass,true);
  const gold=ai.promoteGold(job.id,'intake',{evaluation:{passed:true}});
  assert.ok(fs.existsSync(path.join(gold.dir,'teacher_output.json')));

  const sync=ai.syncExisting({});
  assert.deepEqual(sync,{state:null,artifacts:null});

  const cmp=compareOutputs({a:1,b:2},{a:1,b:2},['a','b']);
  assert.equal(cmp.decisionMatch,1);
  assert.equal(cmp.requiredFieldRecall,1);

  const cache=new SwanAiCache(path.join(root,'cache-test'),{defaultTtlSeconds:60});
  const key=cache.key({a:1});
  cache.set(key,{ok:true});
  assert.deepEqual(cache.get(key),{ok:true});
  assert.equal(cache.allowed(['safety_or_legal']),true,'isolated cache has no noCache flags unless configured');

  const cost=ai.costSummary(job.id);
  assert.ok(cost.providerCalls>=2);
  assert.ok(cost.teacherCalls>=2);

  console.log(JSON.stringify({ok:true,calls,jobId:job.id,cost,metrics:ai.status().metrics.departments},null,2));
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
