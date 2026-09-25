'use strict';

// 내부 영상 처리 계층. 외부 발송·결제·납품은 수행하지 않는다.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const VIDEO_SERVICES = Object.freeze({
  VIDEO_SHORT_EDIT_CAPTION: { maxInputMinutes: 10, outputs: ['MP4'] },
  VIDEO_CAPTION_ONLY: { maxInputMinutes: 60, outputs: ['SRT', 'VTT'] },
  VIDEO_LONG_EDIT: { maxInputMinutes: 180, outputs: ['MP4'] },
  VIDEO_TRANSLATE_CAPTION: { maxInputMinutes: 60, outputs: ['SRT', 'VTT', 'MP4'] }
});

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function assertService(serviceCode) { if (!VIDEO_SERVICES[serviceCode]) throw new Error('unsupported_video_service'); return VIDEO_SERVICES[serviceCode]; }

function validateRequest(input = {}) {
  const serviceCode = String(input.serviceCode || '');
  const spec = assertService(serviceCode);
  const missing = ['requestId', 'customerId', 'inputPath'].filter(k => !input[k]);
  if (missing.length) return { ok: false, status: 'NEEDS_INFO', missing };
  if (!fs.existsSync(input.inputPath)) return { ok: false, status: 'ASSET_BLOCKED', reason: 'input_missing' };
  const stat = fs.statSync(input.inputPath);
  if (!stat.isFile() || stat.size <= 0) return { ok: false, status: 'ASSET_BLOCKED', reason: 'input_invalid' };
  return { ok: true, status: 'READY', serviceCode, maxInputMinutes: spec.maxInputMinutes, inputBytes: stat.size, inputSha256: sha256(input.inputPath) };
}

function validateSrt(text, durationSeconds = Infinity) {
  const blocks = String(text || '').trim().split(/\n\s*\n/).filter(Boolean);
  const errors = [];
  let previousEnd = 0;
  blocks.forEach((block, i) => {
    const lines = block.split(/\r?\n/);
    const match = lines.find(line => /-->/.test(line));
    if (!match) { errors.push(`block_${i + 1}_timecode_missing`); return; }
    const parts = match.split('-->').map(s => s.trim().split(' ')[0]);
    const toSeconds = value => { const m = value.match(/(\d+):(\d{2}):(\d{2})[,.](\d{3})/); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : NaN; };
    const start = toSeconds(parts[0]); const end = toSeconds(parts[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) errors.push(`block_${i + 1}_invalid_timecode`);
    if (start < previousEnd) errors.push(`block_${i + 1}_overlap`);
    if (end > durationSeconds) errors.push(`block_${i + 1}_beyond_video`);
    previousEnd = Math.max(previousEnd, end || 0);
  });
  return { ok: errors.length === 0, blocks: blocks.length, errors };
}

// FFmpeg는 시스템 PATH에 없다(2026-09-22 준희 결정). 정책 transcribe.ffmpegRoot 아래 설치본을 찾아 쓴다.
function resolveFfmpegPath() {
  try {
    const { readOperatingPolicy } = require('./operating-policy');
    const transcribe = require('./transcribe');
    const raw = readOperatingPolicy().transcribe || {};
    return transcribe.resolveFfmpeg({ ffmpegRoot: String(raw.ffmpegRoot || '') });
  } catch (_) { return null; }
}

// subtitles 필터 경로: 역슬래시→슬래시, 드라이브 콜론(C:)은 \: 로 막고 작은따옴표로 감싼다(Windows 경로용).
// 자막 위치(S-3, 2026-09-23): 원본 영상에 이미 자막이 있어 겹칠 때 쓴다.
// position: 'bottom'(기본) | 'top'. marginV: 화면 끝에서 띄울 거리(0~300, 영상 높이 기준 libass 값).
// 둘 다 안 주면 예전과 똑같은 인자(스타일 지정 없음)를 만든다.
function subtitleStyle(position = {}) {
  const pos = position && typeof position === 'object' ? position : { position };
  const where = pos.position === 'top' ? 'top' : pos.position === 'bottom' || pos.position == null ? 'bottom' : null;
  if (!where) throw new Error('bad_subtitle_position');
  const hasMargin = pos.marginV !== undefined && pos.marginV !== null && pos.marginV !== '';
  const margin = hasMargin ? Math.round(Number(pos.marginV)) : null;
  if (hasMargin && !(margin >= 0 && margin <= 300)) throw new Error('bad_subtitle_margin');
  if (where === 'bottom' && !hasMargin) return null;
  // FFmpeg subtitles 필터의 force_style은 SRT에 옛 SSA 번호를 쓴다: 2 = 아래 가운데, 6 = 위 가운데(8을 주면 왼쪽 가운데로 감 — 9/23 실측)
  const parts = [`Alignment=${where === 'top' ? 6 : 2}`];
  if (hasMargin) parts.push(`MarginV=${margin}`);
  return parts.join(',');
}

function subtitleFilterArg(subtitlePath, position = null) {
  const p = String(subtitlePath).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const style = position ? subtitleStyle(position) : null;
  return style ? `subtitles='${p}':force_style='${style}'` : `subtitles='${p}'`;
}

function renderWithFfmpeg({ inputPath, outputPath, subtitlePath, position = null, ffmpegPath = resolveFfmpegPath(), spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg_unavailable'));
    let filter = null;
    try { filter = subtitlePath ? subtitleFilterArg(subtitlePath, position) : null; } catch (error) { return reject(error); }
    const args = ['-y', '-i', inputPath];
    if (filter) args.push('-vf', filter);
    args.push('-c:v', 'libx264', '-c:a', 'aac', outputPath);
    const child = spawnImpl(ffmpegPath, args, { windowsHide: true });
    let stderr = ''; child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', error => reject(Object.assign(new Error('ffmpeg_unavailable'), { cause: error })));
    child.on('close', code => code === 0 && fs.existsSync(outputPath) ? resolve({ outputPath, sha256: sha256(outputPath) }) : reject(new Error(`ffmpeg_failed_${code}: ${stderr.slice(-500)}`)));
  });
}

function createJob(input = {}) {
  const check = validateRequest(input);
  return { jobId: `VIDEO-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, serviceCode: input.serviceCode, status: check.ok ? 'READY' : check.status, validation: check, requestId: input.requestId || null, customerId: input.customerId || null, createdAt: new Date().toISOString(), qaStatus: 'UNVERIFIED', deliveryAllowed: false };
}

module.exports = { VIDEO_SERVICES, validateRequest, validateSrt, renderWithFfmpeg, createJob, resolveFfmpegPath, subtitleFilterArg, subtitleStyle };
