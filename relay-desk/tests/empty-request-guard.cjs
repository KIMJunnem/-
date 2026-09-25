'use strict';

// 요청 상세가 뜨기 전에 읽은 빈 요청은 거절(2026-09-22, PPT 요청 사례). 내용이 있으면 통과.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.fetch = async () => { throw new Error('network_disabled_in_test'); };
const { isEmptySoomgoRequestBody } = require('../server/relay-server');

assert.equal(isEmptySoomgoRequestBody({ requestId: '6ab20faea7134029d2f333dc', text: '', displayLabel: '', topic: '', volume: '', format: '', sourceUrl: 'https://soomgo.com/requests/received/x' }), true);
assert.equal(isEmptySoomgoRequestBody({ requestId: 'x', text: '   \n  ' }), true);
assert.equal(isEmptySoomgoRequestBody({ requestId: 'x', text: '요청 상세\nPPT 제작\n작업 분량\n20장 미만' }), false);
assert.equal(isEmptySoomgoRequestBody({ requestId: 'x', text: '', volume: '10장' }), false);
// 경로: 빈 요청이면 기록(buildSoomgoQuote) 전에 422로 거절
const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
const route = src.slice(src.indexOf("pathname === '/api/soomgo/quote' && req.method === 'POST'"), src.indexOf("pathname === '/api/soomgo/quote' && req.method === 'POST'") + 1200);
assert.ok(route.indexOf('isEmptySoomgoRequestBody(body)') > 0 && route.indexOf('isEmptySoomgoRequestBody(body)') < route.indexOf('buildSoomgoQuote(body)'), '분류·기록 전에 거절');
assert.match(route, /422, \{ error: 'empty_request_text', retry: true \}/);
// 요청봇은 실패 응답이면 기록 없이 대기열에 넣고 30초 뒤 다시 읽는다
const bot = fs.readFileSync(path.join(__dirname, '..', 'soomgo-bot-extension', 'content-v3.js'), 'utf8');
assert.match(bot, /if \(!response\.ok \|\| !data\.quote\) \{\s*await queueForRelayDesk\(request/);
assert.match(bot, /nextRetryAt: Date\.now\(\) \+ 30000/);
// 요청봇 0.4.17: 요청 칸이 화면에 뜰 때까지(최대 8초) 기다린 뒤 읽는다. 기다림은 서버로 보내기(fetch) 전에 있어야 한다.
const fieldsSrc = (bot.match(/const REQUEST_FIELDS = \/(.+)\/;/) || [])[1];
assert.ok(fieldsSrc, 'REQUEST_FIELDS 정의');
const FIELDS = new RegExp(fieldsSrc);
assert.equal(FIELDS.test(''), false, '빈 화면은 기다림');
assert.equal(FIELDS.test('요청 상세\n견적 보낸 고수 6명'), false, '요청 칸이 아직 없으면 기다림');
assert.ok(FIELDS.test('요청 상세\nPPT 제작\n이용 목적\n연설/강연\n제작 범위\n단순 제작\n작업 분량\n20장 미만\n예산\n5만 원 미만'), '이번 PPT 요청 화면은 바로 읽음');
assert.ok(FIELDS.test('요청 상세\n문서/글 작성\n작성 주제\n경찰서제출 반성문'), '문서 요청');
assert.ok(FIELDS.test('요청 상세\n자막\n영상 길이\n33분'), '자막 요청');
const detail = bot.slice(bot.indexOf('async function processDetail()'));
assert.ok(detail.indexOf('REQUEST_FIELDS.test(request.text)') > 0 && detail.indexOf('REQUEST_FIELDS.test(request.text)') < detail.indexOf('await fetch(ENDPOINT'), '보내기 전에 기다림');
assert.match(bot, /const DETAIL_WAIT_MS = 8000;/);
assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'soomgo-bot-extension', 'manifest.json'), 'utf8')).version, '0.4.23');
console.log('empty-request-guard: PASS');
