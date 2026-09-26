'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  SERVICE_TIERS,
  normalizeFutureRoutingPolicy,
  resolveRouteMetadata,
  applyProviderTier
} = require('../server/model-router');
const { futureRoutingPolicy } = require('../server/operating-policy');

assert.deepEqual(SERVICE_TIERS, ['standard', 'fast', 'ultrafast']);

const policy = futureRoutingPolicy();
assert.equal(policy.enabled, true);
assert.equal(policy.mode, 'shadow');
assert.equal(policy.serviceTier.default, 'standard');
assert.equal(policy.serviceTier.providerPassthrough.enabled, false);
assert.equal(policy.serviceTier.ultrafastEnabled, false);
assert.equal(policy.agentCapabilities.persistentAgent.enabled, false);
assert.equal(policy.agentCapabilities.externalIdentity.enabled, false);
assert.equal(policy.agentCapabilities.emailAction.enabled, false);
assert.equal(policy.agentCapabilities.emailAction.requireApproval, true);

const fast = resolveRouteMetadata({
  post: { serviceTier: 'fast', lane: 'customer_reply' },
  provider: 'OpenAI',
  policy
});
assert.equal(fast.serviceTier, 'fast');
assert.equal(fast.interactive, true);

const ultraBlocked = resolveRouteMetadata({
  post: { serviceTier: 'ultrafast' },
  provider: 'OpenAI',
  policy
});
assert.equal(ultraBlocked.serviceTier, 'fast', 'ultrafast는 공식 활성화 전 fast로 낮춘다');

const active = normalizeFutureRoutingPolicy({
  enabled: true,
  mode: 'active',
  serviceTier: {
    default: 'standard',
    allowed: ['standard', 'fast', 'ultrafast'],
    ultrafastEnabled: true,
    providerPassthrough: {
      enabled: true,
      field: 'service_tier',
      mapping: { standard: 'standard', fast: 'fast', ultrafast: 'ultrafast' }
    }
  },
  agentCapabilities: {
    emailAction: { enabled: true, read: true, draft: true, send: true, requireApproval: false }
  }
});
assert.equal(active.agentCapabilities.emailAction.requireApproval, true, '외부 이메일 전송은 승인 게이트를 해제하지 않는다');

const fastBody = applyProviderTier(
  { model: 'future-model', input: 'x' },
  'OpenAI',
  { serviceTier: 'fast' },
  active
);
assert.equal(fastBody.service_tier, 'fast');

const shadowBody = applyProviderTier(
  { model: 'future-model', input: 'x' },
  'OpenAI',
  { serviceTier: 'fast' },
  policy
);
assert.equal(Object.prototype.hasOwnProperty.call(shadowBody, 'service_tier'), false, 'shadow 모드는 실제 API payload를 바꾸지 않는다');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
assert.match(source, /resolveRouteMetadata\(/);
assert.match(source, /futureRoutingPolicy\(\)/);
assert.match(source, /serviceTier: routeMeta\.serviceTier/);
assert.match(source, /byServiceTier/);
assert.match(source, /applyProviderTier\(baseRequestBody, 'OpenAI'/);

console.log('future-routing: PASS');
