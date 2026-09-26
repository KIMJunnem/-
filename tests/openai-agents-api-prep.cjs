'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../server/openai-agents-api');
const { openaiAgentsApiPolicy } = require('../server/operating-policy');

assert.equal(A.AGENTS_API.baseUrl, 'https://api.openai.com');
assert.equal(A.AGENTS_API.betaHeader, 'agents=v1');
assert.equal(A.AGENTS_API.sessionsPath, '/v1/agents/sessions');
assert.deepEqual(A.AGENTS_API.permissionsRequired, ['api.agents.read', 'api.agents.write', 'api.responses.write']);

const shadow = A.normalizePolicy({
  enabled: true,
  mode: 'shadow',
  executePaidCalls: true,
  environment: { type: 'self_hosted', selfHostedEnabled: false },
  externalActions: { customerSend: true, payment: true, delivery: true, codePatch: true, requireApproval: false },
  tools: { allowed: ['relay_status', 'relay_alerts', 'not_real'] }
});
assert.equal(shadow.mode, 'shadow');
assert.equal(shadow.executePaidCalls, false, 'shadow 모드에서는 유료 Agents API 실행을 켤 수 없음');
assert.equal(shadow.environment.type, 'none', 'self-hosted는 별도 허용 전 none으로 강등');
assert.deepEqual(shadow.tools.allowed, ['relay_status', 'relay_alerts']);
assert.deepEqual(shadow.externalActions, {
  customerSend: false, payment: false, delivery: false, codePatch: false, requireApproval: true
});

const active = A.normalizePolicy({
  mode: 'active',
  executePaidCalls: true,
  environment: { type: 'openai_hosted', openaiHostedEnabled: true },
  sessionPersistence: { enabled: true, storeSessionIds: true },
  webhooks: { enabled: true, signatureVerificationRequired: false }
});
assert.equal(active.executePaidCalls, true);
assert.equal(active.environment.type, 'openai_hosted');
assert.equal(active.webhooks.signatureVerificationRequired, true);
assert.equal(active.sessionPersistence.storeSessionIds, true);

const tools = A.toolDefinitions({});
assert.deepEqual(tools.map(x => x.name), A.READ_ONLY_TOOL_NAMES);
assert.ok(tools.every(x => x.type === 'function'));
assert.ok(!tools.some(x => /send|payment|delivery|patch/i.test(x.name)));

const payload = A.sessionCreatePayload({
  input: 'Relay Desk 상태 확인',
  policy: shadow,
  metadata: { source: 'test' }
});
assert.equal(payload.agent.model, 'gpt-6-astra');
assert.equal(payload.agent.reasoning.effort, 'low');
assert.equal(payload.environment.type, 'none');
assert.equal(payload.input, 'Relay Desk 상태 확인');
assert.equal(payload.stream, false);
assert.equal(payload.metadata.source, 'test');
assert.ok(payload.agent.instructions.includes('Do not send customer messages'));
assert.deepEqual(payload.agent.tools.map(x => x.name), ['relay_status', 'relay_alerts']);

assert.deepEqual(A.sessionMessageEvent('계속 확인'), {
  events: [{
    type: 'agent.session.input.message',
    input: [{ role: 'user', content: [{ type: 'input_text', text: '계속 확인' }] }]
  }]
});
assert.deepEqual(A.sessionCancelEvent(), { events: [{ type: 'agent.session.input.cancel' }] });

const paths = A.sessionPaths('sess_abc123');
assert.equal(paths.events, '/v1/agents/sessions/sess_abc123/events');
assert.equal(paths.items, '/v1/agents/sessions/sess_abc123/items');
assert.equal(paths.traces, '/v1/agents/sessions/sess_abc123/traces');
assert.throws(() => A.sessionPaths('../bad'), /session_id_invalid/);

const action = {
  type: 'function_call',
  turn_id: 'turn_1',
  call_id: 'call_1',
  name: 'relay_learning_candidates',
  arguments: { limit: 2 }
};

(async () => {
  const output = await A.executeReadOnlyFunction(action, {
    status: async () => ({ ok: true }),
    alerts: async () => ({ alerts: [] }),
    usage: async () => ({ usage: {} }),
    simulationStatus: async () => ({ latest: null }),
    learningCandidates: async limit => [{ id: 1 }, { id: 2 }, { id: 3 }].slice(0, limit)
  }, { tools: { allowed: ['relay_learning_candidates'] } });

  assert.equal(output.events[0].type, 'agent.session.input.tool_result');
  assert.equal(output.events[0].turn_id, 'turn_1');
  assert.equal(output.events[0].call_id, 'call_1');
  assert.equal(output.events[0].success, true);
  assert.deepEqual(JSON.parse(output.events[0].output), [{ id: 1 }, { id: 2 }]);

  await assert.rejects(
    () => A.executeReadOnlyFunction({ ...action, name: 'relay_send_customer' }, {}, {}),
    /tool_not_allowed/
  );

  const readyShadow = A.readiness({ policy: shadow, hasOpenAIKey: true });
  assert.equal(readyShadow.prepared, true);
  assert.equal(readyShadow.active, false);
  assert.ok(readyShadow.blockers.includes('shadow_mode'));
  assert.ok(readyShadow.blockers.includes('paid_execution_disabled'));
  assert.equal(readyShadow.recommendedInitialEnvironment, 'none');

  const realPolicy = openaiAgentsApiPolicy();
  assert.equal(realPolicy.mode, 'shadow');
  assert.equal(realPolicy.executePaidCalls, false);
  assert.equal(realPolicy.environment.type, 'none');
  assert.equal(realPolicy.externalActions.requireApproval, true);

  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
  assert.match(server, /\/api\/openai-agents\/status/);
  assert.match(server, /\/api\/openai-agents\/preview/);
  assert.match(server, /\/api\/openai-agents\/tool-preview/);
  assert.match(server, /externalCallMade:\s*false/);
  assert.doesNotMatch(server, /fetch\([^\n]*\/v1\/agents\/sessions/, '선행 배선 단계에서 서버가 Agents API를 실제 호출하면 안 됨');

  console.log('openai-agents-api-prep: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
