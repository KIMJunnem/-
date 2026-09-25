'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isRetryableRunError, isUncertainRunError } = require('../server/relay-server');

assert.equal(isUncertainRunError(new Error('The operation was aborted due to timeout')), true);
assert.equal(isUncertainRunError(new Error('openai_empty_response')), true);
assert.equal(isUncertainRunError(new Error('fetch failed ECONNRESET')), true);
assert.equal(isRetryableRunError(new Error('openai_429_rate_limit')), true);
assert.equal(isRetryableRunError(new Error('The operation was aborted due to timeout')), false);

const source = fs.readFileSync('server/relay-server.js', 'utf8');
assert.match(source, /status: '결과 확인 필요'/);
assert.match(source, /providerRequestStatus: 'uncertain'/);
assert.match(source, /자동 재호출 차단/);
assert.match(source, /x-client-request-id/);

console.log('provider-uncertain-guard: ambiguous provider results never auto-retry');
