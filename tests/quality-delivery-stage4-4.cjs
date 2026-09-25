'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runChecks } = require('../server/quality-runner');
const { buildArtifactVerification, workflowFormatIssue } = require('../server/relay-server');

const root = path.join(__dirname, 'samples');
const sync = (...parts) => path.join(root, 'sync', ...parts);

function file(id, localPath) {
  const bytes = fs.readFileSync(localPath);
  return {
    id,
    name: path.basename(localPath),
    localPath,
    customerDeliverable: true,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length
  };
}

function gate(serviceId, localPath, request = {}) {
  const artifact = file(`F-${serviceId}`, localPath);
  const workflow = {
    id: `W-${serviceId}`,
    request: { serviceId, ...request },
    pendingDelivery: { id: `D-${serviceId}`, files: [{ id: artifact.id }], deliveredAt: null }
  };
  workflow.artifactVerification = buildArtifactVerification(workflow, { text: '검증용 결과' }, [artifact]);
  const issue = workflowFormatIssue({ files: [artifact], tasks: [], resultPosts: [] }, workflow);
  return { verification: workflow.artifactVerification, issue, deliveryBlocked: Boolean(issue?.blocked) };
}

const cases = {
  normalSrt: gate('subtitle', sync('normal', 'subtitles.srt'), { independentTranscript: sync('normal', 'independent-transcript.json') }),
  driftSrt: gate('subtitle', sync('drift', 'subtitles.srt'), { independentTranscript: sync('drift', 'independent-transcript.json') }),
  missingTranscript: gate('subtitle', sync('missing', 'subtitles.srt')),
  normalPptx: gate('presentation', path.join(root, 'pptx_empty_slide-pass.pptx'), { expectedSlides: 1 }),
  emptyPptx: gate('presentation', path.join(root, 'pptx_empty_slide-fail.pptx'), { expectedSlides: 1 }),
  hwp: gate('document_writing', path.join(root, 'doc_open-pass.hwp'), { minimumChars: 10 }),
  unknown: runChecks('not_registered', null, {})
};

assert.equal(cases.normalSrt.verification.quality.status, 'passed');
assert.equal(cases.normalSrt.deliveryBlocked, false);
assert.equal(cases.driftSrt.verification.quality.status, 'failed');
assert.equal(cases.driftSrt.deliveryBlocked, true);
assert.ok(cases.driftSrt.verification.quality.failures.some(item => item.location.includes('block:5')));
assert.equal(cases.missingTranscript.verification.quality.status, 'manual_review');
assert.equal(cases.missingTranscript.deliveryBlocked, true);
assert.equal(cases.normalPptx.verification.quality.status, 'passed');
assert.equal(cases.normalPptx.deliveryBlocked, false);
assert.equal(cases.emptyPptx.verification.quality.status, 'failed');
assert.equal(cases.emptyPptx.deliveryBlocked, true);
assert.equal(cases.hwp.verification.quality.status, 'manual_review');
assert.equal(cases.hwp.deliveryBlocked, true);
assert.equal(cases.unknown.status, 'failed');
assert.equal(cases.unknown.blocking, true);

console.log(JSON.stringify(Object.fromEntries(Object.entries(cases).map(([key, value]) => [key, value.verification ? {
  status: value.verification.quality.status,
  deliveryBlocked: value.deliveryBlocked,
  code: value.issue?.code || null,
  failures: value.verification.quality.failures
} : value])), null, 2));
console.log('quality-delivery-stage4-4: PASS');
