'use strict';

// G-1(2026-09-22): 파이버 채널 정의. 2026-09-23 준희: 게시 완료 → 켬(enabled:true, 초안만), 5달러 단위 $25/$45/$75, 자막 입히기 옵션은 파이버에 없음. 숨고·크몽 판매·가격은 그대로.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../server/service-registry');
const def = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'services', 'subtitle.json'), 'utf8'));
const f = def.channels.fiverr;
assert.equal(def.channels.soomgo, true); assert.equal(def.channels.kmong, true);
assert.equal(f.enabled, true); assert.equal(f.pendingApproval, false); assert.equal(f.approvedAt, '2026-09-22'); assert.equal(f.currency, 'USD'); assert.equal(f.mode, 'manual_draft_only');
assert.deepEqual(f.packages.map(p => [p.when.minutesLte, p.amountUsd]), [[5, 25], [10, 45], [30, 75]]);
assert.equal(f.includedRevisions, 2);
assert.ok(f.options.some(o => o.id === 'burn_in' && o.amountUsd === 11 && o.unit.sizeMinutes === 5 && o.pendingApproval === false && o.offeredOnFiverr === false), '자막 입히기: 금액은 남기고 파이버에는 안 올림');
assert.ok(f.packages.every(p => p.amountUsd % 5 === 0), '파이버는 5달러 단위');
assert.equal(f.scope.length, 2);
// 켜져서 파이버 채널 판매 목록에 나온다(답장은 초안만). 숨고·크몽은 그대로.
assert.ok(registry.listServices({ channel: 'fiverr' }).some(s => s.id === 'subtitle'));
assert.equal(f.mode, 'manual_draft_only');
assert.ok(registry.listServices({ channel: 'soomgo' }).some(s => s.id === 'subtitle'));
assert.ok(registry.listServices({ channel: 'kmong' }).some(s => s.id === 'subtitle'));
// 원화 가격표는 손대지 않음
assert.deepEqual(def.pricing.packages.map(p => p.saleAmount), [32000, 49000, 89000, 89000]);
console.log('fiverr-channel: PASS');
