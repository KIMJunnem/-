'use strict';

const crypto = require('node:crypto');

function handoff(input = {}) {
  return {
    version: 1,
    handoffId: 'HO-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    at: new Date().toISOString(),
    job_id: String(input.job_id || ''),
    from: String(input.from || 'system'),
    to: String(input.to || ''),
    facts: input.facts && typeof input.facts === 'object' ? input.facts : {},
    requirements: input.requirements && typeof input.requirements === 'object' ? input.requirements : {},
    unknowns: Array.isArray(input.unknowns) ? input.unknowns : [],
    decisions: input.decisions && typeof input.decisions === 'object' ? input.decisions : {},
    artifacts: Array.isArray(input.artifacts) ? input.artifacts : [],
    risk: ['low','medium','high','critical'].includes(input.risk) ? input.risk : 'medium',
    confidence: Number.isFinite(Number(input.confidence)) ? Math.max(0,Math.min(1,Number(input.confidence))) : null,
    flags: Array.isArray(input.flags) ? [...new Set(input.flags.map(String))] : [],
    budget: input.budget && typeof input.budget === 'object' ? input.budget : {},
    note: String(input.note || '').slice(0,2000)
  };
}
module.exports={handoff};
