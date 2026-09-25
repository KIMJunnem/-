'use strict';

// S-3 번인 자막 위치: 아래(기본)·위·아래 여백. 기본은 예전 인자와 똑같다. 가짜 FFmpeg, 외부 호출 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const video = require('../server/video-pipeline');

const srt = 'C:\\Work\\a.srt';
// 1) 기본(위치 없음·bottom만) = 예전과 같은 인자
assert.equal(video.subtitleFilterArg(srt), "subtitles='C\\:/Work/a.srt'");
assert.equal(video.subtitleFilterArg(srt, { position: 'bottom' }), "subtitles='C\\:/Work/a.srt'");
// 2) 위, 아래 여백, 위+여백
assert.equal(video.subtitleFilterArg(srt, { position: 'top' }), "subtitles='C\\:/Work/a.srt':force_style='Alignment=6'");
assert.equal(video.subtitleFilterArg(srt, { position: 'bottom', marginV: 60 }), "subtitles='C\\:/Work/a.srt':force_style='Alignment=2,MarginV=60'");
assert.equal(video.subtitleFilterArg(srt, { position: 'top', marginV: '15' }), "subtitles='C\\:/Work/a.srt':force_style='Alignment=6,MarginV=15'");
// 3) 잘못된 값은 거절(임의 문자열이 필터에 들어가지 않게)
assert.throws(() => video.subtitleFilterArg(srt, { position: "top',x=1" }), /bad_subtitle_position/);
assert.throws(() => video.subtitleFilterArg(srt, { marginV: 999 }), /bad_subtitle_margin/);
assert.throws(() => video.subtitleFilterArg(srt, { marginV: 'abc' }), /bad_subtitle_margin/);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'burnpos-'));
  try {
    const seen = [];
    const fake = (cmd, args) => { seen.push(args); const c = new EventEmitter(); c.stderr = new EventEmitter(); setTimeout(() => { fs.writeFileSync(args[args.length - 1], 'mp4'); c.emit('close', 0); }, 5); return c; };
    const out = path.join(tmp, 'o.mp4');
    await video.renderWithFfmpeg({ inputPath: 'in.webm', outputPath: out, subtitlePath: srt, position: { position: 'top', marginV: 40 }, ffmpegPath: 'ffmpeg', spawnImpl: fake });
    assert.equal(seen[0][seen[0].indexOf('-vf') + 1], "subtitles='C\\:/Work/a.srt':force_style='Alignment=6,MarginV=40'");
    await video.renderWithFfmpeg({ inputPath: 'in.webm', outputPath: out, subtitlePath: srt, ffmpegPath: 'ffmpeg', spawnImpl: fake });
    assert.equal(seen[1][seen[1].indexOf('-vf') + 1], "subtitles='C\\:/Work/a.srt'", '위치 안 주면 예전 그대로');
    await assert.rejects(video.renderWithFfmpeg({ inputPath: 'in.webm', outputPath: out, subtitlePath: srt, position: { position: 'middle' }, ffmpegPath: 'ffmpeg', spawnImpl: fake }), /bad_subtitle_position/);
    assert.equal(seen.length, 2, '잘못된 위치면 FFmpeg를 부르지 않음');
    const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'relay-server.js'), 'utf8');
    assert.match(server, /position: body\.position && typeof body\.position === 'object'/);
    console.log('burnin-position: PASS');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
