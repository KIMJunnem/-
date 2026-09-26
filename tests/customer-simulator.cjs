'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sim = require('../server/customer-simulator');
const R = require('../server/relay-server');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-customer-sim-'));
let netCalls = 0;
const realFetch = global.fetch;
global.fetch = async () => { netCalls += 1; throw new Error('network_disabled_in_customer_sim_test'); };

try {
  const forced = sim.readConfig({
    customerSimulation: {
      enabled: true,
      intervalMinutes: 1,
      casesPerRun: 18,
      paidModelCalls: true,
      autoPatch: true,
      teacherReview: { enabled: true, provider: 'Claude', model: 'claude-opus-5-5', maxCasesPerRun: 3 }
    }
  });
  assert.equal(forced.intervalMinutes, 15, '최소 15분');
  assert.equal(forced.casesPerRun, 18);
  assert.equal(forced.paidModelCalls, false, '시뮬레이터는 유료 모델을 직접 호출하지 않는다');
  assert.equal(forced.autoPatch, false, '시뮬레이터는 코드를 자동 수정하지 않는다');
  assert.equal(forced.teacherReview.enabled, true, '교수 검토는 큐 생성만 허용');

  const a = sim.generateCases(36, 'same-seed');
  const b = sim.generateCases(36, 'same-seed');
  assert.deepEqual(a, b, '같은 seed면 완전히 재현 가능');
  assert.ok(new Set(a.map(x => x.archetype)).size >= 15, '다양한 고객 유형 포함');
  assert.ok(a.filter(x => x.archetype === 'system_notice').every(x => x.message === sim.BASE_CASES.find(y => y.archetype === 'system_notice').message), '시스템 알림은 의미 보존을 위해 변형하지 않음');

  const deps = {
    soomgoReply: R.soomgoReply,
    applyChatReplyPolicy: R.applyChatReplyPolicy,
    humanChatViaClaude: R.humanChatViaClaude,
    supervisorReply: R.supervisorReply,
    isSoomgoSystemMessage: R.isSoomgoSystemMessage,
    isWorkflowCompletion: R.isWorkflowCompletion,
    validSoomgoAiReply: R.validSoomgoAiReply
  };

  // 변형 전 핵심 케이스는 기대 동작을 직접 고정한다.
  const baseByType = Object.fromEntries(sim.BASE_CASES.map(x => [x.archetype, x]));
  const cfg = sim.readConfig({ customerSimulation: { enabled: true, casesPerRun: 18 } });
  for (const type of ['system_notice', 'short_proceed', 'delivery_ack', 'delivery_revision', 'refund', 'out_of_scope']) {
    const result = sim.runCase({ ...baseByType[type], id: `BASE-${type}` }, deps, cfg);
    assert.equal(result.hard.length, 0, `${type}: ${JSON.stringify(result.hard)}`);
  }

  const probes = sim.guardProbes(deps);
  assert.ok(probes.every(x => x.passed), JSON.stringify(probes));

  const run = sim.runSimulation({
    policy: {
      customerSimulation: {
        enabled: true,
        intervalMinutes: 180,
        casesPerRun: 36,
        teacherReview: { enabled: true, provider: 'Claude', model: 'claude-opus-5-5', maxCasesPerRun: 3 }
      }
    },
    dataDir: tmp,
    deps,
    reason: 'test',
    now: Date.parse('2026-09-26T14:00:00Z'),
    seed: 'customer-sim-regression'
  });

  assert.equal(run.caseCount, 36);
  assert.equal(run.paidModelCalls, 0);
  assert.equal(run.autoPatches, 0);
  assert.ok(run.teacherQueue.every(x => x.externalCallMade === false), '교수 큐를 만들어도 실제 외부 호출은 안 함');
  assert.ok(fs.existsSync(path.join(tmp, 'customer-simulation-state.json')));
  assert.ok(fs.existsSync(path.join(tmp, 'customer-simulation-latest.txt')));
  assert.ok(fs.existsSync(path.join(tmp, 'customer-simulation-decisions.jsonl')), '결정 원장 JSONL 생성');
  const stored = sim.readState(tmp);
  assert.equal(stored.latest.seed, 'customer-sim-regression');
  assert.ok(Array.isArray(stored.learningCandidates));
  assert.match(run.codeFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(run.metrics.passAt1 >= 0 && run.metrics.passAt1 <= 1);
  assert.ok(run.effectiveIntervalMinutes >= 180);
  assert.ok(stored.learningCandidates.every(x => Number(x.confidence || 0) >= 0.3 && Number(x.confidence || 0) <= 0.95));
  assert.ok(stored.learningCandidates.every(x => x.promotion?.ready !== true), '합성 데이터만으로 자동 승격 금지');
  assert.equal(sim.status(tmp, { customerSimulation: { enabled: true, intervalMinutes: 180 } }).due, false);

  // 검증기가 고장난 경우를 합성해 실패가 Learning Candidate로 승격되는지 확인.
  const brokenDeps = { ...deps, validSoomgoAiReply: () => true };
  const broken = sim.runSimulation({
    policy: { customerSimulation: { enabled: true, casesPerRun: 18, maxLearningCandidates: 50 } },
    dataDir: tmp,
    deps: brokenDeps,
    reason: 'broken-guard-test',
    now: Date.parse('2026-09-26T15:00:00Z'),
    seed: 'broken-guard'
  });
  assert.ok(broken.hardFailureCount > 0, '고장난 안전 검증기를 탐지');
  const after = sim.readState(tmp);
  assert.ok(after.learningCandidates.some(x => /^guard_probe_/.test(x.code)), '새 실패를 학습 후보에 저장');
  assert.ok(after.learningCandidates.filter(x => /^guard_probe_/.test(x.code)).every(x => x.evidenceKinds.includes('synthetic')));
  assert.ok(after.learningCandidates.every(x => /자동 반영하지 않음/.test(x.promotionRule)), '합성 실패는 운영 규칙에 자동 승격하지 않음');

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
  assert.match(serverSource, /startCustomerSimulationScheduler\(\)/);
  assert.match(serverSource, /\/api\/customer-simulation/);
  assert.match(serverSource, /customer_simulation_failure/);
  assert.equal(netCalls, 0, '시뮬레이션 테스트 중 외부 네트워크 호출 0');

  console.log('customer-simulator: PASS');
} finally {
  global.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
}
