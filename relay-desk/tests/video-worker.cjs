'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const worker = require('../server/video-worker');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-video-worker-'));
const input = path.join(dir, 'input.mp4');
const subtitle = path.join(dir, 'final.srt');
const ffmpeg = path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobe = path.join(dir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
fs.writeFileSync(input, Buffer.from('fixture'));
fs.writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:01,000\n안녕하세요\n');
fs.writeFileSync(ffmpeg, '');
fs.writeFileSync(ffprobe, '');

const metaJson = JSON.stringify({
  format: { duration: '12.5', size: '12345' },
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' }
  ]
});

function fakeSpawn(command, args) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    if (path.resolve(command) === path.resolve(ffprobe)) child.stdout.emit('data', Buffer.from(metaJson));
    const last = args[args.length - 1];
    if (path.resolve(command) === path.resolve(ffmpeg) && last && last !== '-' && /\.(?:mp4|jpg)$/i.test(last)) {
      fs.mkdirSync(path.dirname(last), { recursive: true });
      fs.writeFileSync(last, Buffer.from('rendered'));
    }
    child.emit('close', 0);
  });
  return child;
}

const deps = { ffmpegPath: ffmpeg, ffprobePath: ffprobe, spawnImpl: fakeSpawn };

(async () => {
  assert.equal(worker.parseTime('00:01:02.500'), 62.5);
  assert.equal(worker.parseTime('01:02'), 62);

  const inspected = await worker.inspect({ inputPath: input }, deps);
  assert.equal(inspected.ok, true);
  assert.equal(inspected.duration, 12.5);
  assert.equal(inspected.width, 1920);
  assert.equal(inspected.height, 1080);
  assert.equal(inspected.hasAudio, true);

  const cutOut = path.join(dir, 'cut.mp4');
  const cut = await worker.cut({
    inputPath: input,
    outputPath: cutOut,
    hasAudio: true,
    cuts: [
      { start: '00:00:01.000', end: '00:00:03.000' },
      { start: 5, end: 8.5 }
    ]
  }, deps);
  assert.equal(cut.ok, true);
  assert.equal(fs.existsSync(cutOut), true);
  assert.equal(cut.segments.length, 2);

  const subOut = path.join(dir, 'sub.mp4');
  const sub = await worker.subtitle({
    inputPath: input,
    outputPath: subOut,
    subtitlePath: subtitle,
    resolution: '1080x1920',
    normalizeAudio: true
  }, deps);
  assert.equal(sub.action, 'video.subtitle');
  assert.equal(fs.existsSync(subOut), true);

  const transcribed = await worker.transcribeAction({
    inputPath: input,
    language: 'ko',
    jobId: 'TEST-1'
  }, {
    transcribeModule: {
      transcribe: async args => ({ ok: true, jobId: args.jobId, transcriptPath: '/tmp/transcript.json', srtPath: '/tmp/draft.srt' })
    },
    operatingPolicy: { readOperatingPolicy: () => ({ transcribe: { enabled: true } }) }
  });
  assert.equal(transcribed.ok, true);
  assert.equal(transcribed.action, 'video.transcribe');

  const qc = await worker.qc({
    inputPath: input,
    expected: { resolution: '1920x1080', hasAudio: true },
    decodeSeconds: 5
  }, deps);
  assert.equal(qc.ok, true);
  assert.deepEqual(qc.errors, []);

  const plan = await worker.runPlan({
    steps: [
      { action: 'video.inspect', payload: { inputPath: input } },
      { action: 'video.qc', payload: { inputPath: input, expected: { resolution: '1920x1080' } } }
    ]
  }, deps);
  assert.equal(plan.ok, true);
  assert.equal(plan.results.length, 2);

  const status = worker.status(deps);
  assert.equal(status.ready, true);
  assert.equal(status.actions.includes('video.render'), true);

  console.log('video-worker: inspect/transcribe/cut/subtitle/render/qc dispatcher tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
