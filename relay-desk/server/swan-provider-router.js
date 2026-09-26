'use strict';

function envNumber(name, fallback = null) { const n = Number(process.env[name]); return Number.isFinite(n) ? n : fallback; }
function compact(list) { return [...new Set(list.filter(Boolean).map(x => String(x).trim()).filter(Boolean))]; }
function timeoutSignal(ms) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms); return { signal: controller.signal, clear: () => clearTimeout(timer) }; }

const PROVIDERS = {
  OpenAI: {
    key: () => process.env.OPENAI_API_KEY || '',
    model: () => process.env.SWAN_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-6-astra',
    inputRate: () => envNumber('SWAN_OPENAI_INPUT_USD_PER_M', 10),
    outputRate: () => envNumber('SWAN_OPENAI_OUTPUT_USD_PER_M', 50)
  },
  Claude: {
    key: () => process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '',
    model: () => process.env.SWAN_CLAUDE_MODEL || process.env.CLAUDE_MODEL || 'claude-opus-5-5',
    inputRate: () => envNumber('SWAN_CLAUDE_INPUT_USD_PER_M', 4),
    outputRate: () => envNumber('SWAN_CLAUDE_OUTPUT_USD_PER_M', 20)
  },
  Gemini: {
    key: () => process.env.GEMINI_API_KEY || '',
    model: () => process.env.SWAN_GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    inputRate: () => envNumber('SWAN_GEMINI_INPUT_USD_PER_M', null),
    outputRate: () => envNumber('SWAN_GEMINI_OUTPUT_USD_PER_M', null)
  }
};

function laneOrder(lane) {
  const override = {
    director: process.env.SWAN_DIRECTOR_PROVIDER,
    producer: process.env.SWAN_PRODUCER_PROVIDER,
    qa: process.env.SWAN_QA_PROVIDER,
    cheap: process.env.SWAN_CHEAP_PROVIDER
  }[lane];
  const defaults = {
    director: ['Claude','OpenAI','Gemini'],
    producer: ['Claude','OpenAI','Gemini'],
    qa: ['OpenAI','Claude','Gemini'],
    cheap: ['Gemini','OpenAI','Claude']
  }[lane] || ['OpenAI','Claude','Gemini'];
  return compact([override, ...defaults]);
}
function estimate(provider, usage) {
  const cfg = PROVIDERS[provider]; if (!cfg) return null;
  const ir = cfg.inputRate(); const or = cfg.outputRate();
  if (!(Number.isFinite(ir) && Number.isFinite(or))) return null;
  return ((Number(usage.inputTokens)||0) * ir + (Number(usage.outputTokens)||0) * or) / 1e6;
}
function preflight() {
  const out = {}; for (const [name,cfg] of Object.entries(PROVIDERS)) out[name] = { configured: Boolean(cfg.key() && cfg.model()), model: cfg.model() || null };
  return out;
}
async function callOpenAI(prompt, cfg, options) {
  const t = timeoutSignal(options.timeoutMs);
  try {
    const r = await fetch('https://api.openai.com/v1/responses', { method:'POST', signal:t.signal, headers:{'content-type':'application/json','authorization':`Bearer ${cfg.key()}`}, body:JSON.stringify({model:cfg.model(),input:prompt,max_output_tokens:options.maxOutputTokens}) });
    const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`openai_http_${r.status}:${JSON.stringify(body).slice(0,500)}`);
    const text = body.output_text || (body.output || []).flatMap(x => x.content || []).map(x => x.text || '').join('\n');
    const usage = { inputTokens: body.usage?.input_tokens || 0, outputTokens: body.usage?.output_tokens || 0 };
    return { provider:'OpenAI', model:cfg.model(), text, usage, responseId:body.id || null, estimatedCostUsd:estimate('OpenAI',usage) };
  } finally { t.clear(); }
}
async function callClaude(prompt, cfg, options) {
  const t = timeoutSignal(options.timeoutMs);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST', signal:t.signal, headers:{'content-type':'application/json','x-api-key':cfg.key(),'anthropic-version':'2023-06-01'}, body:JSON.stringify({model:cfg.model(),max_tokens:options.maxOutputTokens,messages:[{role:'user',content:prompt}]}) });
    const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`claude_http_${r.status}:${JSON.stringify(body).slice(0,500)}`);
    const text = (body.content || []).filter(x => x.type === 'text').map(x => x.text || '').join('\n');
    const usage = { inputTokens: body.usage?.input_tokens || 0, outputTokens: body.usage?.output_tokens || 0 };
    return { provider:'Claude', model:cfg.model(), text, usage, responseId:body.id || null, estimatedCostUsd:estimate('Claude',usage) };
  } finally { t.clear(); }
}
async function callGemini(prompt, cfg, options) {
  const t = timeoutSignal(options.timeoutMs);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model())}:generateContent?key=${encodeURIComponent(cfg.key())}`;
    const r = await fetch(url,{method:'POST',signal:t.signal,headers:{'content-type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:options.maxOutputTokens}})});
    const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`gemini_http_${r.status}:${JSON.stringify(body).slice(0,500)}`);
    const text = (body.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('\n');
    const usage = { inputTokens: body.usageMetadata?.promptTokenCount || 0, outputTokens: body.usageMetadata?.candidatesTokenCount || 0 };
    return { provider:'Gemini', model:cfg.model(), text, usage, responseId:null, estimatedCostUsd:estimate('Gemini',usage) };
  } finally { t.clear(); }
}

async function callProvider(lane, prompt, options = {}) {
  const order = laneOrder(lane); const configured = preflight(); const errors=[];
  const timeoutMs = Math.max(5000, Number(options.timeoutMs || process.env.SWAN_PROVIDER_TIMEOUT_MS || 120000));
  const maxOutputTokens = Math.max(200, Math.min(Number(options.maxOutputTokens || 1800), 12000));
  for (const name of order) {
    if (!configured[name]?.configured) continue;
    const cfg = PROVIDERS[name];
    try {
      if (name === 'OpenAI') return await callOpenAI(prompt,cfg,{timeoutMs,maxOutputTokens});
      if (name === 'Claude') return await callClaude(prompt,cfg,{timeoutMs,maxOutputTokens});
      if (name === 'Gemini') return await callGemini(prompt,cfg,{timeoutMs,maxOutputTokens});
    } catch (error) {
      errors.push(`${name}:${error.message}`);
      if (process.env.SWAN_PROVIDER_FALLBACK_ON_ERROR !== '1') break;
    }
  }
  throw new Error(errors.length ? `provider_failed:${errors.join('|')}` : 'no_provider_configured');
}

module.exports = { PROVIDERS, laneOrder, preflight, callProvider, estimate };
