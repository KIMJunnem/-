'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../server/service-registry');

const fixturesDirectory = path.join(__dirname, 'fixtures');
const baseline = JSON.parse(fs.readFileSync(path.join(fixturesDirectory, 'service-regression-baseline.json'), 'utf8'));
const stage1 = JSON.parse(fs.readFileSync(path.join(fixturesDirectory, 'service-definition-comparison.json'), 'utf8'));

function inputText(input) {
  return [input.purpose, input.format, input.volume, input.scope, input.notes, input.topic, input.deadline]
    .filter(Boolean)
    .join(' ');
}

const specifiedInputs = stage1.classificationChecks.map(expected => {
  const actual = registry.classify(expected.input);
  assert.equal(actual.id, expected.id, `Classification changed for: ${expected.input}`);
  assert.deepEqual(actual.candidates, expected.candidates, `Candidates changed for: ${expected.input}`);
  assert.equal(actual.usedPriority, expected.usedPriority, `Priority behavior changed for: ${expected.input}`);
  return { input: expected.input, expectedId: expected.id, ...actual };
});

const regressionInputs = baseline.cases.map(testCase => {
  const text = inputText(testCase.input);
  const actual = registry.classify(text);
  const expectedId = testCase.service === 'presentation' ? 'presentation' : testCase.service;
  assert.equal(actual.id, expectedId, `Regression classification changed for: ${testCase.caseId}`);
  return { caseId: testCase.caseId, text, expectedId, ...actual };
});

assert.equal(registry.classify('분류할 수 없는 요청').id, null);
assert.equal(registry.getService('presentation')?.id, 'presentation');
assert.equal(registry.getService('missing-service'), null);
assert.deepEqual(registry.listServices({ channel: 'soomgo' }).map(service => service.id).sort(), ['document_writing', 'presentation', 'subtitle']);
assert.deepEqual(registry.listServices({ channel: 'kmong' }).map(service => service.id).sort(), ['document_writing', 'presentation', 'subtitle']);

const report = {
  schemaVersion: 1,
  specifiedInputs,
  regressionInputs,
  summary: {
    specifiedInputsPassed: specifiedInputs.length,
    regressionInputsPassed: regressionInputs.length,
    priorityUsed: [...specifiedInputs, ...regressionInputs].filter(result => result.usedPriority).length,
    unknownReturnsNull: true,
    activeSoomgoServices: registry.listServices({ channel: 'soomgo' }).map(service => service.id),
    activeKmongServices: registry.listServices({ channel: 'kmong' }).map(service => service.id)
  }
};

fs.writeFileSync(path.join(fixturesDirectory, 'service-registry-stage2-1-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));

