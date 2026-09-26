'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const ACTIONS = Object.freeze([
  'video.inspect',
  'video.transcribe',
  'video.cut',
  'video.subtitle',
  'video.render',
  'video.qc'
]);

function parseTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const text = String(value == null ? '' : value).trim();
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Number(text));
  const parts = text.replace(',', '.').split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n))) throw new Error('invalid_time:' + text);
  if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
  throw new Error('invalid_time:' + text);
}

function ensureFile(filePath, label) {
  const target = path.resolve(String(filePath || ''));
  if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error((label || 'file') + '_missing:' + target);
  }
  return target;
}

function ensureParent(filePath) {
  const target = path.resolve(String(filePath || ''));
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  return target;
}

function parseRate(value) {
  const text = String(value || '');
  if (!text) return null;
  if (text.includes('/')) {
    const pair = text.split('/').map(Number);
    if (pair.length === 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && pair[1] !== 0) {
      return Math.round((pair[0] / pair[1]) * 1000) / 1000;
    }
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function executableName(base) {
  return process.platform === 'win32' ? base + '.exe' : base;
}

function findBundledBinary(base, root, maxDepth) {
  const wanted = executableName(base).toLowerCase();
  const start = path.resolve(root);
  const queue = [{ dir: start, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(current.dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === wanted) return full;
      if (entry.isDirectory() && current.depth < maxDepth) queue.push({ dir: full, depth: current.depth + 1 });
    }
  }
  return null;
}

function resolveTools(options) {
  const opts = options || {};
  let ffmpegPath = opts.ffmpegPath ? path.resolve(String(opts.ffmpegPath)) : null;
  let ffprobePath = opts.ffprobePath ? path.resolve(String(opts.ffprobePath)) : null;

  if (!ffmpegPath) {
    try {
      const operating = require('./operating-policy');
      const transcribe = require('./transcribe');
      const cfg = transcribe.readConfig(operating.readOperatingPolicy());
      ffmpegPath = transcribe.resolveFfmpeg(cfg);
    } catch (_) {}
  }

  const bundledRoot = path.join(__dirname, '..', 'tools', 'ffmpeg');
  if (!ffmpegPath) ffmpegPath = findBundledBinary('ffmpeg', bundledRoot, 5);
  if (!ffprobePath && ffmpegPath) {
    const sibling = path.join(path.dirname(ffmpegPath), executableName('ffprobe'));
    if (fs.existsSync(sibling)) ffprobePath = sibling;
  }
  if (!ffprobePath) ffprobePath = findBundledBinary('ffprobe', bundledRoot, 5);

  return {
    ffmpegPath: ffmpegPath && fs.existsSync(ffmpegPath) ? ffmpegPath : null,
    ffprobePath: ffprobePath && fs.existsSync(ffprobePath) ? ffprobePath : null
  };
}

function runProcess(command, args, options) {
  const opts = options || {};
  const spawnImpl = opts.spawnImpl || spawn;
  const maxCapture = Number(opts.maxCapture || 1024 * 1024);
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout && child.stdout.on('data', d => {
      stdout += d.toString();
      if (stdout.length > maxCapture) stdout = stdout.slice(-maxCapture);
    });
    child.stderr && child.stderr.on('data', d => {
      stderr += d.toString();
      if (stderr.length > maxCapture) stderr = stderr.slice(-maxCapture);
    });
    child.on('error', error => reject(Object.assign(new Error('process_spawn_failed:' + error.message), { cause: error })));
    child.on('close', code => {
      if (code === 0) return resolve({ code, stdout, stderr });
      reject(new Error('process_failed_' + code + ':' + stderr.slice(-1200)));
    });
  });
}

async function inspect(input, options) {
  const opts = options || {};
  const inputPath = ensureFile(input && input.inputPath, 'input');
  const tools = resolveTools(opts);
  if (!tools.ffprobePath) throw new Error('ffprobe_unavailable');
  const result = await runProcess(tools.ffprobePath, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    inputPath
  ], opts);
  let data;
  try { data = JSON.parse(result.stdout || '{}'); } catch (_) { throw new Error('ffprobe_invalid_json'); }
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find(s => s.codec_type === 'video') || null;
  const audio = streams.find(s => s.codec_type === 'audio') || null;
  const duration = Number(data.format && data.format.duration) || Number(video && video.duration) || Number(audio && audio.duration) || 0;
  return {
    ok: true,
    action: 'video.inspect',
    inputPath,
    bytes: Number(data.format && data.format.size) || fs.statSync(inputPath).size,
    duration,
    width: Number(video && video.width) || null,
    height: Number(video && video.height) || null,
    fps: video ? parseRate(video.avg_frame_rate || video.r_frame_rate) : null,
    videoCodec: video && video.codec_name || null,
    audioCodec: audio && audio.codec_name || null,
    audioChannels: Number(audio && audio.channels) || null,
    hasAudio: Boolean(audio),
    streams: streams.map(s => ({
      index: s.index,
      type: s.codec_type,
      codec: s.codec_name,
      width: s.width || null,
      height: s.height || null,
      channels: s.channels || null,
      sampleRate: s.sample_rate ? Number(s.sample_rate) : null
    }))
  };
}

function normalizeCuts(cuts) {
  if (!Array.isArray(cuts) || !cuts.length) throw new Error('cuts_required');
  if (cuts.length > 200) throw new Error('too_many_cuts');
  return cuts.map((item, index) => {
    const start = parseTime(item && item.start);
    const end = parseTime(item && item.end);
    if (!(end > start)) throw new Error('invalid_cut_' + index);
    return { start, end };
  });
}

async function cut(input, options) {
  const opts = options || {};
  const inputPath = ensureFile(input && input.inputPath, 'input');
  const outputPath = ensureParent(input && input.outputPath);
  const cuts = normalizeCuts(input && input.cuts);
  const tools = resolveTools(opts);
  if (!tools.ffmpegPath) throw new Error('ffmpeg_unavailable');

  let hasAudio = input && typeof input.hasAudio === 'boolean' ? input.hasAudio : null;
  if (hasAudio == null) hasAudio = (await inspect({ inputPath }, opts)).hasAudio;

  const graph = [];
  const concatInputs = [];
  cuts.forEach((segment, i) => {
    graph.push('[0:v]trim=start=' + segment.start + ':end=' + segment.end + ',setpts=PTS-STARTPTS[v' + i + ']');
    concatInputs.push('[v' + i + ']');
    if (hasAudio) {
      graph.push('[0:a]atrim=start=' + segment.start + ':end=' + segment.end + ',asetpts=PTS-STARTPTS[a' + i + ']');
      concatInputs.push('[a' + i + ']');
    }
  });
  graph.push(concatInputs.join('') + 'concat=n=' + cuts.length + ':v=1:a=' + (hasAudio ? 1 : 0) + '[vout]' + (hasAudio ? '[aout]' : ''));

  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath, '-filter_complex', graph.join(';'), '-map', '[vout]'];
  if (hasAudio) args.push('-map', '[aout]');
  args.push('-c:v', 'libx264', '-preset', String(input && input.preset || 'medium'), '-crf', String(Number(input && input.crf || 20)));
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', outputPath);

  await runProcess(tools.ffmpegPath, args, opts);
  if (!fs.existsSync(outputPath)) throw new Error('cut_output_missing');
  return {
    ok: true,
    action: 'video.cut',
    inputPath,
    outputPath,
    segments: cuts,
    outputBytes: fs.statSync(outputPath).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex')
  };
}

function subtitleFilter(subtitlePath) {
  const escaped = String(subtitlePath).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  return "subtitles='" + escaped + "'";
}

function resolutionFilter(resolution) {
  if (!resolution) return null;
  const match = String(resolution).trim().match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) throw new Error('invalid_resolution');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 16 || height < 16 || width > 8192 || height > 8192) throw new Error('invalid_resolution');
  return 'scale=' + width + ':' + height + ':force_original_aspect_ratio=decrease,pad=' + width + ':' + height + ':(ow-iw)/2:(oh-ih)/2:black';
}

async function render(input, options) {
  const opts = options || {};
  const inputPath = ensureFile(input && input.inputPath, 'input');
  const outputPath = ensureParent(input && input.outputPath);
  const subtitlePath = input && input.subtitlePath ? ensureFile(input.subtitlePath, 'subtitle') : null;
  const musicPath = input && input.musicPath ? ensureFile(input.musicPath, 'music') : null;
  const tools = resolveTools(opts);
  if (!tools.ffmpegPath) throw new Error('ffmpeg_unavailable');

  const filters = [];
  const scale = resolutionFilter(input && input.resolution);
  if (scale) filters.push(scale);
  if (subtitlePath) filters.push(subtitleFilter(subtitlePath));

  let meta = null;
  if (musicPath) meta = await inspect({ inputPath }, opts);

  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath];
  if (musicPath) args.push('-stream_loop', '-1', '-i', musicPath);

  if (musicPath) {
    const complex = [];
    if (filters.length) complex.push('[0:v]' + filters.join(',') + '[vout]');
    const volume = Math.max(0, Math.min(1, Number(input && input.musicVolume != null ? input.musicVolume : 0.18)));
    const normalize = Boolean(input && input.normalizeAudio);
    if (meta && meta.hasAudio) {
      complex.push('[0:a]volume=1[a0]');
      complex.push('[1:a]volume=' + volume + '[bgm]');
      complex.push('[a0][bgm]amix=inputs=2:duration=first:dropout_transition=2' + (normalize ? ',loudnorm=I=-16:LRA=11:TP=-1.5' : '') + '[aout]');
    } else {
      complex.push('[1:a]volume=' + volume + (normalize ? ',loudnorm=I=-16:LRA=11:TP=-1.5' : '') + '[aout]');
    }
    args.push('-filter_complex', complex.join(';'));
    args.push('-map', filters.length ? '[vout]' : '0:v:0', '-map', '[aout]');
  } else {
    if (filters.length) args.push('-vf', filters.join(','));
    if (input && input.normalizeAudio) args.push('-af', 'loudnorm=I=-16:LRA=11:TP=-1.5');
  }

  args.push('-c:v', 'libx264', '-preset', String(input && input.preset || 'medium'), '-crf', String(Number(input && input.crf || 20)));
  args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', outputPath);

  await runProcess(tools.ffmpegPath, args, opts);
  if (!fs.existsSync(outputPath)) throw new Error('render_output_missing');
  return {
    ok: true,
    action: 'video.render',
    inputPath,
    outputPath,
    subtitlePath,
    musicPath,
    resolution: input && input.resolution || null,
    audioNormalized: Boolean(input && input.normalizeAudio),
    musicVolume: musicPath ? Number(input && input.musicVolume != null ? input.musicVolume : 0.18) : null,
    outputBytes: fs.statSync(outputPath).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex')
  };
}

async function subtitle(input, options) {
  const result = await render({
    inputPath: input && input.inputPath,
    outputPath: input && input.outputPath,
    subtitlePath: input && input.subtitlePath,
    resolution: input && input.resolution,
    normalizeAudio: input && input.normalizeAudio,
    preset: input && input.preset,
    crf: input && input.crf
  }, options);
  return Object.assign({}, result, { action: 'video.subtitle' });
}

async function transcribeAction(input, options) {
  const opts = options || {};
  const inputPath = ensureFile(input && input.inputPath, 'input');
  const operating = opts.operatingPolicy || require('./operating-policy');
  const transcribeModule = opts.transcribeModule || require('./transcribe');
  const policy = opts.policy || operating.readOperatingPolicy();
  const result = await transcribeModule.transcribe({
    policy,
    inputPath,
    language: input && input.language || '',
    jobId: input && input.jobId,
    checkParams: input && input.checkParams || null,
    threads: input && input.threads || null,
    model: input && input.model || null,
    terms: input && input.terms || null,
    termMode: input && input.termMode || 'hotwords'
  });
  return Object.assign({ action: 'video.transcribe' }, result);
}

async function qc(input, options) {
  const opts = options || {};
  const inputPath = ensureFile(input && input.inputPath, 'input');
  const tools = resolveTools(opts);
  if (!tools.ffmpegPath) throw new Error('ffmpeg_unavailable');
  const meta = await inspect({ inputPath }, opts);
  const errors = [];
  const warnings = [];
  const expected = input && input.expected || {};

  if (!(meta.duration > 0)) errors.push('duration_missing');
  if (!(meta.width > 0 && meta.height > 0)) errors.push('video_stream_missing');
  if (expected.resolution) {
    const m = String(expected.resolution).match(/^(\d+)x(\d+)$/);
    if (m && (meta.width !== Number(m[1]) || meta.height !== Number(m[2]))) errors.push('resolution_mismatch');
  }
  if (expected.hasAudio === true && !meta.hasAudio) errors.push('audio_missing');

  const decodeSeconds = Math.max(1, Math.min(Number(input && input.decodeSeconds || 30), Math.max(meta.duration || 1, 1)));
  try {
    await runProcess(tools.ffmpegPath, ['-v', 'error', '-i', inputPath, '-t', String(decodeSeconds), '-f', 'null', '-'], opts);
  } catch (error) {
    errors.push('decode_failed');
    warnings.push(error.message);
  }

  const frames = [];
  if (input && input.frameDir) {
    const frameDir = path.resolve(String(input.frameDir));
    fs.mkdirSync(frameDir, { recursive: true });
    const points = [0.1, 0.5, 0.9].map(ratio => Math.max(0, Math.min((meta.duration || 0) * ratio, Math.max((meta.duration || 0) - 0.05, 0))));
    for (let i = 0; i < points.length; i += 1) {
      const framePath = path.join(frameDir, 'frame-' + (i + 1) + '.jpg');
      try {
        await runProcess(tools.ffmpegPath, ['-y', '-v', 'error', '-ss', String(points[i]), '-i', inputPath, '-frames:v', '1', '-q:v', '2', framePath], opts);
        if (fs.existsSync(framePath)) frames.push(framePath);
      } catch (error) {
        warnings.push('frame_' + (i + 1) + '_failed:' + error.message);
      }
    }
  }

  return {
    ok: errors.length === 0,
    action: 'video.qc',
    inputPath,
    errors,
    warnings,
    frames,
    inspected: meta
  };
}

function status(options) {
  const tools = resolveTools(options || {});
  return {
    ok: true,
    actions: ACTIONS.slice(),
    ffmpeg: tools.ffmpegPath,
    ffprobe: tools.ffprobePath,
    ready: Boolean(tools.ffmpegPath && tools.ffprobePath)
  };
}

async function runAction(action, payload, options) {
  const key = String(action || '');
  if (!ACTIONS.includes(key)) throw new Error('unsupported_video_action:' + key);
  if (key === 'video.inspect') return inspect(payload || {}, options);
  if (key === 'video.transcribe') return transcribeAction(payload || {}, options);
  if (key === 'video.cut') return cut(payload || {}, options);
  if (key === 'video.subtitle') return subtitle(payload || {}, options);
  if (key === 'video.render') return render(payload || {}, options);
  if (key === 'video.qc') return qc(payload || {}, options);
  throw new Error('unsupported_video_action:' + key);
}

async function runPlan(plan, options) {
  const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
  if (!steps.length) throw new Error('video_plan_steps_required');
  const results = [];
  for (const step of steps) {
    const action = step && step.action;
    const payload = Object.assign({}, step && step.payload || {});
    results.push(await runAction(action, payload, options));
  }
  return { ok: results.every(r => r && r.ok !== false), results };
}

module.exports = {
  ACTIONS,
  parseTime,
  resolveTools,
  runProcess,
  inspect,
  transcribeAction,
  cut,
  subtitle,
  render,
  qc,
  status,
  runAction,
  runPlan
};
