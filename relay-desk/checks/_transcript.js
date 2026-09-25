'use strict';

// 독립 전사(JSON segments 또는 SRT) 읽기. sync_drift·srt_coverage가 같이 쓴다.
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('./_srt');

function seconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function wordsOf(item) {
  const source = Array.isArray(item?.words) ? item.words : null;
  if (!source) return null;
  const words = source.map(word => ({
    start: Number(word.startMs ?? seconds(word.start ?? word.startSeconds) * 1000),
    end: Number(word.endMs ?? seconds(word.end ?? word.endSeconds) * 1000),
    text: String(word.word ?? word.text ?? '')
  })).filter(word => Number.isFinite(word.start));
  return words.length ? words : null;
}

function transcriptFromJson(value) {
  const source = Array.isArray(value) ? value : value?.segments || value?.blocks || value?.utterances;
  if (!Array.isArray(source)) throw new Error('독립 전사 JSON에 segments 또는 blocks 배열이 없습니다.');
  return source.map((item, index) => ({
    number: Number(item.number ?? item.id ?? index + 1),
    start: Number(item.startMs ?? (seconds(item.start ?? item.startSeconds) * 1000)),
    end: Number(item.endMs ?? (seconds(item.end ?? item.endSeconds) * 1000)),
    text: String(item.text ?? item.transcript ?? ''),
    words: wordsOf(item),
    location: `transcript:${index + 1}`
  })).filter(item => Number.isFinite(item.start) && item.text.trim());
}

function transcriptInput(context = {}) {
  return context.independentTranscript || context.transcriptFile || context.transcript || null;
}

function readTranscript(input) {
  if (Array.isArray(input) || (input && typeof input === 'object' && !input.path && !input.filePath && (input.segments || input.blocks || input.utterances))) return transcriptFromJson(input);
  const filePath = typeof input === 'string' ? input : input?.path || input?.filePath;
  const explicitText = typeof input?.text === 'string' ? input.text : null;
  const format = String(input?.format || (filePath ? path.extname(filePath).slice(1) : '')).toLowerCase();
  const text = explicitText ?? (filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null);
  if (text == null) throw new Error('독립 전사 파일을 읽을 수 없습니다.');
  if (format === 'json' || (!format && /^\s*[\[{]/.test(text))) return transcriptFromJson(JSON.parse(text));
  const parsed = parse({ text });
  if (parsed.error) throw new Error(`독립 전사 SRT 오류: ${parsed.error}`);
  return parsed.blocks.map(block => ({ ...block, text: block.lines.join(' '), words: null }));
}

module.exports = { transcriptInput, readTranscript, transcriptFromJson };
