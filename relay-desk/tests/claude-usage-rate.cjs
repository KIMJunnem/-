'use strict';

// usageCostEstimate의 Claude 단가는 정책 claudeQuote 공식 가격을 따른다(2026-09-23 지시 4). 외부 호출 0회.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let fetchCalls = 0;
global.fetch = async () => { fetchCalls += 1; throw new Error('network_disabled_in_test'); };
const { readOperatingPolicy } = require('../server/operating-policy');
const { usageCostEstimate } = require('../server/relay-server');

const quote = readOperatingPolicy().claudeQuote;
const usage = { input_tokens: 4000, output_tokens: 4000 };
const expected = Number(((4000 / 1e6) * quote.usdPerMillionInputTokens + (4000 / 1e6) * quote.usdPerMillionOutputTokens).toFixed(6));
assert.equal(usageCostEstimate('Claude', usage, 'claude-fable-5-1'), expected);
const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
assert.doesNotMatch(source, /RELAY_CLAUDE_INPUT_USD_PER_MILLION \|\| \d/, 'Claude 단가 숫자를 코드에 두지 않음');
assert.equal(fetchCalls, 0);
console.log(`claude-usage-rate: PASS (4,000/4,000토큰 = $${expected})`);
