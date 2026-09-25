'use strict';

// 유료 제작 제공자 전환(production.provider) 회귀 검사. 외부 API는 호출하지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let fetchCalls = 0;
global.fetch = async () => { fetchCalls += 1; throw new Error('network_disabled_in_test'); };
const { productionProvider, readOperatingPolicy, finalGradeMode } = require('../server/operating-policy');
require('../server/relay-server');

const policy = readOperatingPolicy();
// 2026-09-23 지시 5: codex_room(PPT만 Codex 대화방) 추가. 이 값이면 API 제작 lane은 hold와 같다.
assert.ok(['OpenAI', 'Claude', 'hold', 'codex_room'].includes(policy.production?.provider || 'OpenAI'));
assert.equal(productionProvider(), policy.production?.provider === 'codex_room' ? 'hold' : (policy.production?.provider || 'OpenAI'));
assert.equal(finalGradeMode(), 'manual', '최종 채점은 manual 유지');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
assert.match(source, /post\?\.astraFinalReview === true \? 'OpenAI' : productionProvider\(\)/, '자동 큐는 정책 제공자 사용');
assert.match(source, /forcedClaudeProduction\s*\?\s*\{ result: await runClaude\(executionPrompt\), requestedProvider: 'Claude', fallbackFrom: null/, 'Claude 제작은 자동 전환 없음');
assert.match(source, /forcedClaudeProduction\s*\?\s*\{ result: await runClaude\(repairPrompt\), requestedProvider: 'Claude', fallbackFrom: null/, 'Claude 형식 복구도 자동 전환 없음');
assert.match(source, /if \(productionLane\) \{\s*const lane = post\.astraFinalReview === true \? 'final_artifact_review' : 'paid_production';/, '제공자와 무관하게 주문 비용 한도 적용');
assert.equal(fetchCalls, 0, '모듈 로드 중 외부 호출 없음');
console.log('production-provider-claude: PASS');
