'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('./swan-ai-cache');

function usageTokens(usage = {}) {
  return {
    input: Number(usage.input_tokens || usage.prompt_tokens || usage.promptTokenCount || 0) || 0,
    output: Number(usage.output_tokens || usage.completion_tokens || usage.candidatesTokenCount || 0) || 0
  };
}
function estimateCost(candidate, usage = {}) {
  const t=usageTokens(usage);
  return Number(((t.input/1e6)*Number(candidate.inputUsdPerMillion||0)+(t.output/1e6)*Number(candidate.outputUsdPerMillion||0)).toFixed(6));
}
function loadJson(file) { return JSON.parse(fs.readFileSync(file,'utf8')); }

class SwanModelRouter {
  constructor(options={}) {
    this.registryPath=path.resolve(options.registryPath);
    this.registry=loadJson(this.registryPath);
    this.executor=options.executor;
    this.available=options.available || (()=>true);
    this.cache=options.cache || null;
    this.ledger=options.ledger || null;
  }
  reload(){ this.registry=loadJson(this.registryPath); return this.registry; }
  candidates(role){
    const list=this.registry.roles?.[role]?.candidates;
    if(!Array.isArray(list)||!list.length) throw new Error('model_role_missing:'+role);
    return list;
  }
  choose(role, opts={}){
    let items=this.candidates(role).filter(c=>c.provider==='Local'||this.available(c.provider,c.model)!==false);
    if(opts.preferProvider) items.sort((a,b)=>Number(b.provider===opts.preferProvider)-Number(a.provider===opts.preferProvider));
    if(opts.cheapest===true) items.sort((a,b)=>(Number(a.inputUsdPerMillion||0)+Number(a.outputUsdPerMillion||0))-(Number(b.inputUsdPerMillion||0)+Number(b.outputUsdPerMillion||0)));
    if(!items.length) throw new Error('no_available_model_for_role:'+role);
    return items[0];
  }
  async call(input={}){
    if(typeof this.executor!=='function') throw new Error('model_executor_missing');
    const role=String(input.role||'');
    const prompt=String(input.prompt||'');
    if(!role||!prompt) throw new Error('role_and_prompt_required');
    const flags=Array.isArray(input.flags)?input.flags:[];
    const primary=this.choose(role,{preferProvider:input.preferProvider,cheapest:input.cheapest===true});
    const cacheKey=this.cache ? this.cache.key({
      v:this.registry.version, role, department:input.department||null, model:primary.model,
      provider:primary.provider, promptHash:hash(prompt), contextFingerprint:input.contextFingerprint||null
    }) : null;
    if(cacheKey && this.cache.allowed(flags)) {
      const cached=this.cache.get(cacheKey);
      if(cached){
        this.ledger?.record(input.jobId,{department:input.department,role,provider:cached.provider,model:cached.model,costUsd:0,cached:true,shadow:input.shadow===true,responseId:cached.providerResponseId,note:'cache_hit'});
        return {...cached,cached:true,costUsd:0,cacheKey};
      }
    }
    const errors=[];
    const ordered=[primary,...this.candidates(role).filter(x=>!(x.provider===primary.provider&&x.model===primary.model))];
    for(const candidate of ordered){
      if(candidate.provider!=='Local'&&this.available(candidate.provider,candidate.model)===false) continue;
      try{
        const result=await this.executor({provider:candidate.provider,model:candidate.model,prompt,role,department:input.department,jobId:input.jobId,maxTokens:input.maxTokens,timeoutMs:input.timeoutMs});
        const costUsd=Number.isFinite(Number(result.costUsd))?Number(result.costUsd):estimateCost(candidate,result.usage||{});
        const normalized={provider:candidate.provider,model:candidate.model,text:String(result.text||''),usage:result.usage||null,providerResponseId:result.providerResponseId||null,costUsd};
        this.ledger?.record(input.jobId,{department:input.department,role,provider:candidate.provider,model:candidate.model,inputTokens:usageTokens(result.usage).input,outputTokens:usageTokens(result.usage).output,costUsd,shadow:input.shadow===true,responseId:result.providerResponseId||null});
        if(cacheKey&&this.cache?.allowed(flags)) this.cache.set(cacheKey,normalized,undefined,{role,department:input.department,model:candidate.model});
        return {...normalized,cached:false,cacheKey};
      }catch(error){ errors.push({provider:candidate.provider,model:candidate.model,error:String(error.message||error).slice(0,300)}); if(!/429|quota|rate|timeout|5\d\d|key_missing|temporarily|unavailable|credit/i.test(String(error.message||error))) break; }
    }
    throw Object.assign(new Error('model_route_failed'),{details:errors});
  }
}
module.exports={SwanModelRouter,usageTokens,estimateCost};
