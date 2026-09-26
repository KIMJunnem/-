'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../server/learning-ledger');

const synthetic = L.enrichCandidate({
  key: 'x',
  severity: 'hard',
  count: 10
}, { sourceKind: 'synthetic', scope: 'customer-support:video_edit' });

assert.equal(synthetic.scope, 'customer-support:video_edit');
assert.deepEqual(synthetic.evidenceKinds, ['synthetic']);
assert.ok(synthetic.confidence < 0.8, '합성 반복만으로 승격 임계값을 넘지 않는다');
assert.equal(synthetic.promotion.ready, false);

let mixed = L.enrichCandidate({ ...synthetic, count: 10 }, { sourceKind: 'regression' });
mixed = L.enrichCandidate({ ...mixed, count: 10 }, { sourceKind: 'real_customer' });
assert.ok(mixed.confidence >= 0.8, '독립 증거가 충분하면 검토 후보 신뢰도에 도달');
assert.equal(mixed.promotion.ready, true, '그래도 자동 승격이 아니라 검토 후보');

const clean = fingerprint => ({
  codeFingerprint: fingerprint,
  hardFailureCount: 0,
  newLearningCandidateCount: 0
});
const noisy = fingerprint => ({
  codeFingerprint: fingerprint,
  hardFailureCount: 1,
  newLearningCandidateCount: 1
});
assert.equal(L.quietStreak([clean('a'), clean('a'), clean('a')], 'a'), 3);
assert.equal(L.quietStreak([clean('a'), noisy('a'), clean('a')], 'a'), 1);
assert.equal(L.effectiveIntervalMinutes(180, [clean('a'), clean('a'), clean('a')], 'a'), 360);
assert.equal(L.effectiveIntervalMinutes(180, Array.from({ length: 6 }, () => clean('a')), 'a'), 720);
assert.equal(L.effectiveIntervalMinutes(180, [clean('a'), clean('b')], 'a'), 180, '코드 지문이 바뀌면 안정 streak를 이어가지 않음');

const metrics = L.passMetrics([
  { id: '1', archetype: 'price', hard: [] },
  { id: '2', archetype: 'price', hard: [{ code: 'x' }] },
  { id: '3', archetype: 'refund', hard: [] },
  { id: 'GUARD-x', archetype: 'model_guard', hard: [{ code: 'g' }] }
], [], 'a');
assert.equal(metrics.caseCount, 3, 'guard probe는 고객 pass@1 분모에서 제외');
assert.equal(metrics.passCount, 2);
assert.equal(metrics.passAt1, 0.6667);
assert.equal(metrics.archetypes.price.passRate, 0.5);
assert.equal(metrics.archetypes.refund.passRate, 1);

const fingerprint = L.currentCodeFingerprint(path.join(__dirname, '..'));
assert.match(fingerprint.hash, /^[a-f0-9]{64}$/);
assert.ok(fingerprint.files.includes('server/relay-server.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-learning-ledger-'));
try {
  const entry = L.decisionEntry({
    run: {
      rolloutId: 'rollout-1',
      completedAt: '2026-09-27T00:00:00Z',
      hardFailureCount: 0,
      newLearningCandidateCount: 1,
      newHardLearningCandidateCount: 0,
      caseCount: 80,
      coverage: { price: 10, refund: 10 },
      metrics: { caseCount: 80 }
    },
    previousRun: {
      rolloutId: 'rollout-0',
      hardFailureCount: 0,
      newLearningCandidateCount: 0
    },
    candidates: [mixed],
    fingerprint: fingerprint.hash
  });
  assert.equal(entry.coherence.livePromotionAllowed, false);
  assert.equal(entry.promotionGate.passed, false);
  assert.equal(entry.search.trialCount, 80);
  const file = L.appendDecisionLedger(tmp, entry);
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rolloutId, 'rollout-1');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('learning-ledger: PASS');
