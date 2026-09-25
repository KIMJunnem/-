'use strict';

const assert = require('assert');
const { readOperatingPolicy, paidOrderBudget, astraLaneAllowed } = require('../server/operating-policy');

const policy = readOperatingPolicy();
assert.strictEqual(policy.trial.serviceId, 'document_writing');
assert.strictEqual(astraLaneAllowed('routine_quote'), false);
assert.strictEqual(astraLaneAllowed('routine_chat'), false);
assert.strictEqual(astraLaneAllowed('payment_state'), false);
assert.strictEqual(astraLaneAllowed('delivery_state'), false);
// 2026-09-21 사용자 결정(3-1): 제작에 API를 쓰지 않으므로 유료 제작 lane은 꺼 둔다.
assert.strictEqual(astraLaneAllowed('paid_production'), false);
assert.strictEqual(astraLaneAllowed('final_artifact_review'), true);
assert.strictEqual(paidOrderBudget({ orderAstraUsd: 0, activePaidOrders: 0 }).allowed, true);
assert.strictEqual(paidOrderBudget({ orderAstraUsd: policy.limits.maxAstraUsdPerOrder, activePaidOrders: 0 }).allowed, false);
assert.strictEqual(paidOrderBudget({ orderAstraUsd: 0, activePaidOrders: policy.limits.maxConcurrentPaidOrders }).allowed, false);
console.log('Astra Relay Desk operating policy checks passed.');
