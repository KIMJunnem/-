'use strict';

// 채팅이 봇처럼 보이지 않게 하는 시간·모양 규칙 (2026-09-24 개발방 지시 28, 준희 "채팅이 제일 중요").
// 1) 고객 말에 대한 답장은 받은 뒤 1분 30초~4분 사이(글이 길수록 뒤쪽). 밤·새벽도 같다(새벽 응대가 강점).
// 2) "견적 읽음" 뒤 안부 멘트는 읽은 뒤 2~4시간. 밤 12시~아침 8시에 걸리면 그날 아침 8시~9시 30분으로 미룬다.
// 3) 한 통 120자 넘으면 두 통으로(20~40초 간격). 나눌 수 없으면 보내지 않는다.
// 4) 보내기 직전 AI 티 점검. 걸리면 보내지 않고 준희 알림.
// 무작위 값은 메시지·방 ID로 정해서(같은 입력 = 같은 값) 서버를 다시 켜도 흔들리지 않게 한다.

const crypto = require('node:crypto');

const REPLY_DELAY_MIN_MS = 90 * 1000;
const REPLY_DELAY_MAX_MS = 240 * 1000;
const FOLLOWUP_MIN_MS = 2 * 3600 * 1000;
const FOLLOWUP_MAX_MS = 4 * 3600 * 1000;
const NIGHT_START_HOUR = 0; // KST 00:00
const NIGHT_END_HOUR = 8; // KST 08:00
const MORNING_WINDOW_MS = 90 * 60 * 1000; // 08:00~09:30
const SPLIT_LIMIT = 120;
const SPLIT_GAP_MIN_MS = 20 * 1000;
const SPLIT_GAP_MAX_MS = 40 * 1000;
const KST_MS = 9 * 3600 * 1000;

// 0 이상 1 미만의 고정 난수(같은 키 = 같은 값)
function unit(key, salt = '') {
  const hex = crypto.createHash('sha256').update(`${salt}|${String(key || '')}`).digest('hex').slice(0, 12);
  return parseInt(hex, 16) / 0x1000000000000;
}

// 고객 말 답장 지연: 90~240초. 글자 수가 길수록 뒤쪽(최대 150자에서 앞 60% 구간 끝), 나머지 40%는 고정 난수.
function replyDelayMs(key, text = '') {
  const span = REPLY_DELAY_MAX_MS - REPLY_DELAY_MIN_MS;
  const lengthPart = Math.min(1, String(text || '').replace(/\s+/g, '').length / 150) * 0.6;
  const randomPart = unit(key, 'reply') * 0.4;
  return Math.round(REPLY_DELAY_MIN_MS + span * (lengthPart + randomPart));
}

function kstHour(ms) { return new Date(ms + KST_MS).getUTCHours(); }
function kstMidnightUtc(ms) { const d = new Date(ms + KST_MS); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - KST_MS; }

// 우리가 먼저 거는 말(안부 멘트)만 새벽 금지. 00:00~08:00(KST)에 걸리면 그날 08:00~09:30 사이 고정 난수로 미룬다.
function deferOutOfNight(ms, key) {
  const hour = kstHour(ms);
  if (hour >= NIGHT_START_HOUR && hour < NIGHT_END_HOUR) {
    return kstMidnightUtc(ms) + NIGHT_END_HOUR * 3600 * 1000 + Math.round(unit(key, 'morning') * MORNING_WINDOW_MS);
  }
  return ms;
}

function followupReleaseAt(readAtMs, key) {
  const raw = Number(readAtMs) + FOLLOWUP_MIN_MS + Math.round(unit(key, 'followup') * (FOLLOWUP_MAX_MS - FOLLOWUP_MIN_MS));
  return deferOutOfNight(raw, key);
}

// 120자 넘는 답장을 문장 경계에서 두 통으로. 나눌 수 없으면 null(보내지 않음).
function splitReply(text, limit = SPLIT_LIMIT) {
  const value = String(text || '').trim();
  if (value.length <= limit) return [value];
  const sentences = value.match(/[^.!?。…\n]+[.!?。…]+["')\]]*\s*|[^.!?。…\n]+$/g)?.map(s => s.trim()).filter(Boolean) || [value];
  let best = null;
  for (let i = 1; i < sentences.length; i += 1) {
    const a = sentences.slice(0, i).join(' ');
    const b = sentences.slice(i).join(' ');
    if (a.length <= limit && b.length <= limit) {
      const score = Math.abs(a.length - b.length);
      if (!best || score < best.score) best = { parts: [a, b], score };
    }
  }
  return best ? best.parts : null;
}

function splitGapMs(key) { return SPLIT_GAP_MIN_MS + Math.round(unit(key, 'split') * (SPLIT_GAP_MAX_MS - SPLIT_GAP_MIN_MS)); }

// 보내기 직전 AI 티 점검. 반환: 걸린 이유 코드('' = 통과)
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/u;
const FORBIDDEN_TONE = /드릴게요|괜찮아요|들어\s*있어요|최선을\s*다하|고객님의\s*소중한|퀄리티\s*보장|빠르고\s*정확하게/;
const SYSTEM_TONE = /Relay\s*Desk|자동\s*응답|비상\s*상황을\s*감지|작업을\s*시작합니다|\[MODE:|\[DECISION:/i;
function sentencesOf(text) { return String(text || '').split(/(?<=[.!?。…])\s+|\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.replace(/\s/g, '').length >= 12); }
function aiTellCheck(text, conversationText = '') {
  const value = String(text || '');
  if (!value.trim()) return 'empty';
  if (EMOJI.test(value)) return 'emoji';
  if (/·|\*\*|^\s*[-•*]\s|^\s*\d+[.)]\s/m.test(value)) return 'list_or_dots';
  if (FORBIDDEN_TONE.test(value)) return 'tone_rule';
  if (SYSTEM_TONE.test(value)) return 'system_tone';
  const ours = String(conversationText || '').split('\n').filter(line => /^\[내 답변\]/.test(line)).join('\n').replace(/\s+/g, ' ');
  if (ours && sentencesOf(value).some(sentence => ours.includes(sentence))) return 'repeated_sentence';
  return '';
}

module.exports = {
  REPLY_DELAY_MIN_MS, REPLY_DELAY_MAX_MS, FOLLOWUP_MIN_MS, FOLLOWUP_MAX_MS, SPLIT_LIMIT, SPLIT_GAP_MIN_MS, SPLIT_GAP_MAX_MS,
  unit, replyDelayMs, kstHour, deferOutOfNight, followupReleaseAt, splitReply, splitGapMs, aiTellCheck
};
