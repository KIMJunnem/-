'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DECISION_LEDGER_FILE = 'customer-simulation-decisions.jsonl';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function confidenceFor({ severity = 'warning', count = 1, evidenceKinds = [] } = {}) {
  const base = severity === 'hard' ? 0.42 : 0.32;
  const repeatBoost = Math.min(0.18, Math.max(0, Number(count || 1) - 1) * 0.03);
  const kinds = new Set(Array.isArray(evidenceKinds) ? evidenceKinds : []);
  const independentBoost = Math.min(0.24, Math.max(0, kinds.size - 1) * 0.12);
  return Number(clamp(base + repeatBoost + independentBoost, 0.3, 0.95).toFixed(2));
}

function promotionStatus(candidate = {}) {
  const kinds = new Set(Array.isArray(candidate.evidenceKinds) ? candidate.evidenceKinds : []);
  const independent = kinds.has('regression') || kinds.has('real_customer') || kinds.has('human_review');
  const ready = Number(candidate.confidence || 0) >= 0.8
    && Number(candidate.count || 0) >= 3
    && kinds.size >= 2
    && independent;
  return {
    ready,
    mode: ready ? 'eligible_for_review' : 'watch',
    reason: ready
      ? 'confidence/evidence threshold met; human or regression review still required'
      : 'synthetic-only or insufficient independent evidence; never auto-promote'
  };
}

function enrichCandidate(candidate = {}, { sourceKind = 'synthetic', scope = 'customer-support' } = {}) {
  const evidenceKinds = [...new Set([
    ...(Array.isArray(candidate.evidenceKinds) ? candidate.evidenceKinds : []),
    sourceKind
  ])];
  const next = {
    ...candidate,
    scope: String(candidate.scope || scope),
    evidenceKinds,
    confidence: confidenceFor({
      severity: candidate.severity,
      count: candidate.count,
      evidenceKinds
    })
  };
  next.promotion = promotionStatus(next);
  return next;
}

function currentCodeFingerprint(rootDir) {
  const root = rootDir || path.resolve(__dirname, '..');
  const files = [
    'server/relay-server.js',
    'server/reply-guards.js',
    'server/customer-simulator.js',
    'server/model-router.js',
    'services/video_edit.json',
    'server/config/astra-relay-operating-policy.json'
  ];
  const sha = crypto.createHash('sha256');
  const used = [];
  for (const relative of files) {
    const file = path.join(root, relative);
    try {
      const data = fs.readFileSync(file);
      sha.update(relative);
      sha.update('\0');
      sha.update(data);
      sha.update('\0');
      used.push(relative);
    } catch (_) {
      sha.update(relative);
      sha.update('\0MISSING\0');
    }
  }
  return { hash: sha.digest('hex'), files: used };
}

function quietStreak(history = [], fingerprint = '') {
  let streak = 0;
  for (const run of Array.isArray(history) ? history : []) {
    if (fingerprint && run.codeFingerprint && run.codeFingerprint !== fingerprint) break;
    if (Number(run.hardFailureCount || 0) !== 0) break;
    if (Number(run.newLearningCandidateCount || 0) !== 0) break;
    streak += 1;
  }
  return streak;
}

function effectiveIntervalMinutes(baseMinutes, history = [], fingerprint = '') {
  const base = Math.max(15, Number(baseMinutes || 180));
  const streak = quietStreak(history, fingerprint);
  if (streak >= 6) return Math.min(720, base * 4);
  if (streak >= 3) return Math.min(360, base * 2);
  return base;
}

function passMetrics(results = [], history = [], fingerprint = '') {
  const cases = (Array.isArray(results) ? results : []).filter(item => !String(item.id || '').startsWith('GUARD-'));
  const passed = cases.filter(item => !(item.hard || []).length).length;
  const passAt1 = cases.length ? passed / cases.length : 1;
  const byArchetype = {};
  for (const item of cases) {
    const key = String(item.archetype || 'unknown');
    const row = byArchetype[key] || { total: 0, passed: 0 };
    row.total += 1;
    if (!(item.hard || []).length) row.passed += 1;
    byArchetype[key] = row;
  }
  const archetypes = Object.fromEntries(Object.entries(byArchetype).map(([key, row]) => [key, {
    total: row.total,
    passed: row.passed,
    passRate: Number((row.total ? row.passed / row.total : 1).toFixed(4))
  }]));
  const priorStreak = quietStreak(history, fingerprint);
  return {
    passAt1: Number(passAt1.toFixed(4)),
    passCount: passed,
    caseCount: cases.length,
    stablePassStreakBeforeThisRun: priorStreak,
    stablePass3BeforeThisRun: priorStreak >= 3,
    archetypes
  };
}

function appendDecisionLedger(dataDir, entry = {}) {
  const file = path.join(dataDir, DECISION_LEDGER_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, \`\${JSON.stringify(entry)}\n\`, 'utf8');
  return file;
}

function decisionEntry({ run, previousRun = null, candidates = [], fingerprint = '' } = {}) {
  const top = (Array.isArray(candidates) ? candidates : [])
    .filter(item => item.status === 'open')
    .slice(0, 8)
    .map(item => ({
      key: item.key,
      severity: item.severity,
      code: item.code,
      confidence: item.confidence,
      scope: item.scope,
      mark: item.promotion?.ready ? 'needs_review' : 'watch'
    }));
  const healthy = Number(run?.hardFailureCount || 0) === 0;
  const priorHealthy = previousRun ? Number(previousRun.hardFailureCount || 0) === 0 : null;
  return {
    version: 1,
    rolloutId: String(run?.rolloutId || ''),
    timestamp: String(run?.completedAt || new Date().toISOString()),
    prior: previousRun ? {
      rolloutId: previousRun.rolloutId || null,
      healthy: priorHealthy,
      hardFailureCount: Number(previousRun.hardFailureCount || 0),
      newLearningCandidateCount: Number(previousRun.newLearningCandidateCount || 0)
    } : null,
    freshInformation: {
      codeFingerprint: fingerprint,
      newLearningCandidateCount: Number(run?.newLearningCandidateCount || 0),
      newHardLearningCandidateCount: Number(run?.newHardLearningCandidateCount || 0)
    },
    search: {
      caseCount: Number(run?.caseCount || 0),
      archetypeCount: Object.keys(run?.coverage || {}).length,
      trialCount: Number(run?.caseCount || 0),
      effectiveTrialCount: Number(run?.metrics?.caseCount || run?.caseCount || 0)
    },
    topCandidates: top,
    coherence: {
      matchesPriorHealth: priorHealthy == null ? null : healthy === priorHealthy,
      currentHealthy: healthy,
      livePromotionAllowed: false,
      reason: 'simulation evidence is advisory; promotion requires independent evidence and review'
    },
    promotionGate: {
      passed: false,
      reason: 'automatic promotion disabled'
    }
  };
}

module.exports = {
  DECISION_LEDGER_FILE,
  confidenceFor,
  promotionStatus,
  enrichCandidate,
  currentCodeFingerprint,
  quietStreak,
  effectiveIntervalMinutes,
  passMetrics,
  appendDecisionLedger,
  decisionEntry
};
