'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSoomgoQuote, soomgoQuoteResponseMetadata } = require('../server/relay-server');
const messageRegistry = require('../server/message-registry');

const root = path.join(__dirname, '..');
const extensionPath = path.join(root, 'soomgo-bot-extension', 'content-v3.js');
const source = fs.readFileSync(extensionPath, 'utf8');
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'service-regression-baseline.json'), 'utf8'));

assert.doesNotMatch(source, /let purpose = \(text\.match/);
assert.doesNotMatch(source, /purpose = '영상 편집'/);
assert.match(source, /return \{ requestId: requestKey\(\), text, displayLabel:/);
assert.match(source, /Relay Desk 연결 대기 · 발송하지 않음/);

const inactive = JSON.parse(fs.readFileSync(path.join(root, 'services', '_common', 'messages.json'), 'utf8')).messages
  .filter(item => item.id.startsWith('legacy.self_intro_followup_'));
assert.equal(inactive.length, 2);
assert.ok(inactive.every(item => item.active === false));
assert.equal(messageRegistry.getMessage('legacy.self_intro_followup_a.v1'), null);
assert.equal(messageRegistry.getMessage('legacy.self_intro_followup_b.v1'), null);
const inactiveSelection = messageRegistry.selectFollowup({ serviceId: 'document_writing', rawText: '자기소개서 초안', eventId: 'resume-a' });
assert.doesNotMatch(inactiveSelection.messageId, /self_intro/);
assert.doesNotMatch(inactiveSelection.followupMessage, /자기소개서 초안/);

for (const fixture of baseline.cases) {
  const input = fixture.input;
  const text = [
    '요청 상세',
    '이용 목적', input.purpose,
    input.volume ? `작업 분량\n${input.volume}` : '',
    input.topic ? `작성 주제\n${input.topic}` : '',
    input.format ? `파일 형식\n${input.format}` : '',
    input.deadline ? `완료 희망일\n${input.deadline}` : ''
  ].filter(Boolean).join('\n');
  const payload = { requestId: `EXT-${fixture.caseId}`, text, displayLabel: input.purpose, topic: input.topic || '', volume: input.volume || '', format: input.format || '', deadline: input.deadline || '', sourceUrl: `https://soomgo.test/requests/received/${fixture.caseId}` };
  const { parsed, quote } = buildSoomgoQuote(payload);
  const metadata = soomgoQuoteResponseMetadata(parsed, quote);
  assert.equal(metadata.serviceId, fixture.service, `${fixture.caseId}: classification`);
  assert.equal(quote.amount, fixture.output.amount, `${fixture.caseId}: amount`);
  assert.equal(quote.days, fixture.output.leadDays, `${fixture.caseId}: lead days`);
  assert.equal(quote.message, fixture.output.quoteText, `${fixture.caseId}: quote text`);
  assert.ok(Array.isArray(metadata.classificationMatched));
  assert.ok(Array.isArray(metadata.classificationCandidates));
  assert.ok(metadata.messageId);
  assert.ok(metadata.messageVersion);
}

const unknown = buildSoomgoQuote({ text: '요청 상세\n이용 목적\n분류할 수 없는 작업' });
const unknownMetadata = soomgoQuoteResponseMetadata(unknown.parsed, unknown.quote);
assert.equal(unknownMetadata.serviceId, null);
assert.equal(unknownMetadata.autoSend, false);
assert.equal(unknownMetadata.manualReview, true);

// 서버 단절·오류 분기는 폼 탐색·입력 코드에 닿기 전에 대기열에
// 저장하고 return해야 한다. 실제 외부 화면에 입력·클릭하지 않고 제어 흐름을 검증한다.
const processStart = source.indexOf('  async function processDetail()');
const processEnd = source.indexOf('  async function loop()', processStart);
const processSource = source.slice(processStart, processEnd);
const inputIndex = processSource.indexOf('const amount = findField');
const fetchFailure = processSource.match(/catch \(error\) \{\s*await queueForRelayDesk\(request, error(?:, true)?\);\s*return;\s*\}/);
const responseFailure = processSource.match(/if \(!response\.ok \|\| !data\.quote\) \{\s*await queueForRelayDesk[\s\S]*?\s*return;\s*\}/);
assert.ok(fetchFailure);
assert.ok(responseFailure);
assert.ok(fetchFailure.index < inputIndex);
assert.ok(responseFailure.index < inputIndex);
assert.match(source, /state\.pending\.set\(request\.requestId, pending\)/);
assert.match(source, /chrome\.storage\.local\.set\(\{ \[PENDING_KEY\]: \[\.\.\.state\.pending\.entries\(\)\]/);
assert.match(source, /draw\('Relay Desk 연결 대기 · 발송하지 않음'\)/);

console.log('2-4-1 extension payload, server classification and disconnected-send guard passed.');
