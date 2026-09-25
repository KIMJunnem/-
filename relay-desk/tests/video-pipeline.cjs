'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const video = require('../server/video-pipeline');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-video-'));
const input = path.join(dir, 'input.mp4'); fs.writeFileSync(input, Buffer.from('fixture'));
const ready = video.createJob({ serviceCode: 'VIDEO_SHORT_EDIT_CAPTION', requestId: 'r1', customerId: 'c1', inputPath: input });
assert.equal(ready.status, 'READY'); assert.equal(ready.deliveryAllowed, false); assert.equal(ready.qaStatus, 'UNVERIFIED');
const missing = video.createJob({ serviceCode: 'VIDEO_SHORT_EDIT_CAPTION', requestId: 'r2', customerId: 'c1', inputPath: path.join(dir, 'none.mp4') });
assert.equal(missing.status, 'ASSET_BLOCKED');
assert.equal(video.validateSrt('1\n00:00:00,000 --> 00:00:01,000\n안녕하세요').ok, true);
assert.equal(video.validateSrt('1\n00:00:02,000 --> 00:00:01,000\n오류').ok, false);
console.log('video-pipeline: validation, QA gate, and subtitle checks passed');
