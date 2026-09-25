'use strict';

// Internal-only operations helpers. These functions never call Soomgo,
// payment providers, browsers, or Astra. They operate on supplied snapshots.
const crypto = require('crypto');

const TOOL_VERSION = 'internal-ops-mvp-1';
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function scopeDiff(contract = {}, requested = {}) {
  const keys = ['service', 'units', 'format', 'deadline', 'revisions', 'research', 'tables', 'images'];
  const changes = keys.filter(key => {
    const a = Object.prototype.hasOwnProperty.call(contract, key) ? normalizeText(contract[key]) : '__MISSING__';
    const b = Object.prototype.hasOwnProperty.call(requested, key) ? normalizeText(requested[key]) : '__MISSING__';
    return a !== b;
  })
    .map(key => ({ key, before: contract[key] ?? null, after: requested[key] ?? null }));
  return { classification: changes.length ? 'SCOPE_CHANGE_REVIEW' : 'IN_SCOPE', changes, requiresConsent: changes.length > 0 };
}

function profitReconciliation(records = []) {
  const seen = new Set();
  const rows = records.map(record => {
    const eventKey = String(record.settlementEventId || record.orderId || '');
    if (eventKey && seen.has(eventKey)) return null;
    if (eventKey) seen.add(eventKey);
    if (record.currency && String(record.currency).toUpperCase() !== 'KRW') throw new Error('mixed_currency_requires_conversion');
    const revenue = Number(record.settledKrw ?? record.paidKrw ?? 0);
    const refunds = Number(record.refundedKrw ?? 0);
    const fees = Number(record.feesKrw ?? 0);
    const direct = Number(record.directCostKrw ?? 0);
    const contribution = revenue - refunds - fees - direct;
    return { orderId: String(record.orderId || ''), revenue, refunds, fees, direct, contribution, verified: record.settledKrw != null };
  }).filter(Boolean);
  return { toolVersion: TOOL_VERSION, rows, totals: rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, refunds: a.refunds + r.refunds, fees: a.fees + r.fees, direct: a.direct + r.direct, contribution: a.contribution + r.contribution }), { revenue: 0, refunds: 0, fees: 0, direct: 0, contribution: 0 }) };
}

function capacityEstimate({ minutesPerUnit = 0, units = 0, queuedMinutes = 0, availableMinutes = 0, buffer = 0.2 } = {}) {
  const work = Math.max(0, Number(minutesPerUnit) * Number(units));
  const reserved = Math.max(0, Number(queuedMinutes));
  const capacity = Math.max(0, Number(availableMinutes) * (1 - Number(buffer)));
  const decision = work + reserved <= capacity ? 'ACCEPT' : (work + reserved <= Number(availableMinutes) ? 'DEADLINE_REVIEW' : 'REJECT_CAPACITY');
  return { toolVersion: TOOL_VERSION, workMinutes: work, reservedMinutes: reserved, effectiveCapacityMinutes: capacity, decision };
}

function funnel(events = []) {
  const stages = ['received', 'quoted', 'consented', 'paid', 'delivered', 'settled'];
  const counts = Object.fromEntries(stages.map(stage => [stage, 0]));
  const seen = new Set();
  for (const event of events) {
    const id = String(event.eventId || '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    if (Object.prototype.hasOwnProperty.call(counts, event.stage)) counts[event.stage] += 1;
  }
  return { toolVersion: TOOL_VERSION, counts, generatedAt: new Date().toISOString(), denominatorZero: counts.received === 0 };
}

function exceptionList(items = []) {
  return items.filter(item => ['UNKNOWN', 'PENDING', 'REVIEW', 'FAILED'].includes(String(item.status || '').toUpperCase()))
    .map(item => ({ id: item.id, status: item.status, reason: item.reason || 'unclassified', safeActions: ['READ_STATUS', 'RECONCILE'] }));
}

function simulation(scenario = 'duplicate_delivery') {
  const allowed = new Set(['duplicate_delivery', 'timeout_unknown', 'scope_change', 'restart_recovery']);
  if (!allowed.has(scenario)) throw new Error('unsupported_simulation');
  const outcomes = {
    duplicate_delivery: { invariant: 'no_duplicate_side_effect', result: 'BLOCK_DUPLICATE' },
    timeout_unknown: { invariant: 'unknown_is_not_success', result: 'HOLD_UNKNOWN' },
    scope_change: { invariant: 'consent_required_after_change', result: 'REQUIRE_CONSENT' },
    restart_recovery: { invariant: 'resume_from_persisted_state', result: 'RECONCILE_BEFORE_RESUME' },
  };
  return { toolVersion: TOOL_VERSION, simulationId: sha({ scenario, at: Date.now() }).slice(0, 16), scenario, externalCalls: 0, ...outcomes[scenario] };
}

function validateInvariant(result) {
  const checks = {
    no_duplicate_side_effect: result.result === 'BLOCK_DUPLICATE' && result.externalCalls === 0,
    unknown_is_not_success: result.result === 'HOLD_UNKNOWN' && result.externalCalls === 0,
    consent_required_after_change: result.result === 'REQUIRE_CONSENT' && result.externalCalls === 0,
    resume_from_persisted_state: result.result === 'RECONCILE_BEFORE_RESUME' && result.externalCalls === 0,
  };
  return { pass: checks[result.invariant] === true, invariant: result.invariant, checks };
}

function knowledgeEntry({ title, facts = [], tests = [], status = 'DRAFT' } = {}) {
  return { id: sha({ title, facts, tests }).slice(0, 16), toolVersion: TOOL_VERSION, title: String(title || ''), facts, tests, status, approved: false };
}

function customerResponseSimulation({ count = 20, responseRate = 0.01, seed = 'internal' } = {}) {
  const total = Math.max(0, Number(count) || 0);
  const rate = Math.max(0, Math.min(1, Number(responseRate)));
  const conversations = Array.from({ length: total }, (_, index) => {
    const digest = sha(`${seed}:${index + 1}`);
    const responded = parseInt(digest.slice(0, 8), 16) / 0xffffffff < rate;
    return { id: `SIM-CHAT-${String(index + 1).padStart(2, '0')}`, responded, nextAction: responded ? 'CONTINUE_CONVERSATION' : 'HOLD_NO_RESPONSE' };
  });
  return { toolVersion: TOOL_VERSION, responseRate: rate, conversations, responded: conversations.filter(item => item.responded).length, noResponse: conversations.filter(item => !item.responded).length };
}

function intakeFit({ supported = true, withinBudget = true, withinCapacity = true, requiredInfoComplete = true } = {}) {
  const checks = { supported: Boolean(supported), withinBudget: Boolean(withinBudget), withinCapacity: Boolean(withinCapacity), requiredInfoComplete: Boolean(requiredInfoComplete) };
  const missing = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
  return { fit: missing.length === 0 ? 'QUALIFIED' : (missing.includes('requiredInfoComplete') ? 'NEEDS_INFO' : 'NOT_A_FIT'), checks, missing };
}

function noResponseGuard({ status = 'HOLD_NO_RESPONSE', pollCount = 0, costUsd = 0, dailyCostUsd = 0, dailyLimitUsd = 1 } = {}) {
  const blocked = status === 'HOLD_NO_RESPONSE';
  return { blocked, externalCallsAllowed: false, additionalPollingAllowed: !blocked && pollCount < 1, costAllowed: dailyCostUsd + Number(costUsd || 0) <= Number(dailyLimitUsd || 0), reason: blocked ? 'customer_no_response' : 'active_conversation' };
}

function expectedContribution({ responseRate = 0, completionRate = 0, contributionKrw = 0, preCostKrw = 0, responseCostKrw = 0 } = {}) {
  return { responseRate, completionRate, expectedKrw: Number(responseRate) * Number(completionRate) * Number(contributionKrw) - Number(preCostKrw) - Number(responseRate) * Number(responseCostKrw) };
}

module.exports = { TOOL_VERSION, scopeDiff, profitReconciliation, capacityEstimate, funnel, exceptionList, simulation, validateInvariant, knowledgeEntry, customerResponseSimulation, intakeFit, noResponseGuard, expectedContribution };
