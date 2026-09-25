'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { finalGradeMode } = require('../server/operating-policy');
const {
  buildArtifactVerification, workflowFormatIssue, queueManualFinalReview,
  shouldRunAstraFinalGrade, createFollowUp
} = require('../server/relay-server');

assert.equal(finalGradeMode(), 'manual');
assert.equal(shouldRunAstraFinalGrade({ lane: 'soomgo_fulfillment', astraFinalReview: true }), false);

const sample = path.join(__dirname, 'samples', 'sync', 'normal', 'subtitles.srt');
const transcript = path.join(__dirname, 'samples', 'sync', 'normal', 'independent-transcript.json');
const bytes = fs.readFileSync(sample);
const artifact = {
  id: 'F-MANUAL', name: 'normal.srt', localPath: sample, customerDeliverable: true,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length
};
const workflow = {
  id: 'W-MANUAL', taskId: 'T-MANUAL', currentTaskId: 'T-MANUAL', qualityPipeline: true,
  qualityPasses: 0, qualityCompleted: 0,
  request: { serviceId: 'subtitle', purpose: '자막 제작', format: 'SRT', independentTranscript: transcript },
  pendingDelivery: { id: 'D-MANUAL', files: [{ id: artifact.id }], deliveredAt: null }
};
workflow.artifactVerification = buildArtifactVerification(workflow, { id: 'R-MANUAL', text: '검증용 자막 결과' }, [artifact]);
assert.equal(workflow.artifactVerification.quality.status, 'passed');
queueManualFinalReview(workflow, { id: 'R-MANUAL' }, '2026-09-21T00:00:00.000Z');
const issue = workflowFormatIssue({ files: [artifact], tasks: [], resultPosts: [] }, workflow);
assert.equal(issue.status, 'manual_review');
assert.equal(issue.message, '최종 확인 대기');
assert.equal(issue.blocked, true);
assert.equal(workflow.pendingAction, 'approve_manual_final');

const latest = {
  tasks: [{ id: 'T-MANUAL', lane: 'soomgo_fulfillment', qualityPipeline: true, qualityPlan: { passes: 0 }, title: '테스트' }],
  soomgoWorkflows: [workflow], promptPosts: [], activities: []
};
const followUp = createFollowUp(latest, {
  id: 'P-MANUAL', taskId: 'T-MANUAL', cycle: 1, qualityPipeline: true,
  qualityPasses: 0, autoContinue: true, lane: 'soomgo_fulfillment'
}, { id: 'R-MANUAL', provider: 'OpenAI', text: '완성 결과' });
assert.equal(followUp, null, 'manual mode must not enqueue the Astra final-grade post');

console.log(JSON.stringify({
  mode: finalGradeMode(), mechanicalStatus: workflow.artifactVerification.quality.status,
  queueStatus: issue.status, reason: issue.message, deliveryBlocked: issue.blocked,
  astraGradeCallAllowed: shouldRunAstraFinalGrade({ lane: 'soomgo_fulfillment', astraFinalReview: true }),
  astraFinalPostCreated: Boolean(followUp)
}, null, 2));
console.log('final-grade-mode: PASS');
