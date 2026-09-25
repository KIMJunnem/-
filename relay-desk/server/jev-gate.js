'use strict';

// 개발방 지시 31(2026-09-25, decisions 7-17): 제브를 챗봇 "문지기"로.
// 고객이 직접 쓴 채팅 가운데 규칙이 정하지 못해 Claude로 가려는 것만, Claude를 부르기 전에 제브에 먼저 묻는다.
// 제브는 글을 쓰지 않고 보기 하나를 고르고 확률만 준다. 확률 0.9 이상일 때만:
//   system_notice → 답장 안 함 · thanks → 정해진 짧은 감사 문구 · forbidden → 준희 알림(보내지 않음)
//   proceed·question·other, 0.9 미만, 실패·시간 초과(2초)·하루 상한(500건)·스위치 꺼짐 → 지금처럼 Claude
// 제브로 견적·발송·삭제·금액을 정하지 않는다. 기록에는 보기·확률·처리만 남기고 글 본문은 남기지 않는다.

const { redact: redactCommon } = require('./jev-gate-redact');

const CHOICES = {
  system_notice: 'An automatic notice from the Soomgo platform itself (e.g. "숨고 알리미", "거래가 성사됐다면", payment system notices), not written by the customer.',
  thanks: 'A short thanks, "I will contact you later", or a polite decline/goodbye. No question and nothing to answer.',
  proceed: 'The customer says they want to go ahead / hire / start the work (e.g. "할게요", "진행해 주세요", "맡길게요").',
  question: 'A question about price, schedule, method, scope, or what to send.',
  forbidden: 'About a refund, cancellation, dispute, sending the finished file, or asking whether AI / a bot is used.',
  other: 'Anything else.'
};
const QUESTIONS = {
  intent: {
    type: 'choice',
    instructions: 'This is one chat message from a customer to a freelancer on Soomgo (a Korean marketplace). Which one best describes the message? Judge the message only.',
    criteria: CHOICES
  }
};
const ACTIONS = { system_notice: 'skip', thanks: 'thanks', forbidden: 'alert' };

function config(policy = {}) {
  const raw = policy.jevGate || {};
  return {
    enabled: raw.enabled === true,
    threshold: Number(raw.threshold ?? 0.9),
    dailyMaxCalls: Number(raw.dailyMaxCalls ?? 500),
    timeoutMs: Number(raw.timeoutMs ?? 2000)
  };
}
function kstDay(ms = Date.now()) { return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function callsToday(state = {}, now = Date.now()) {
  const day = kstDay(now);
  return (Array.isArray(state.jevGateLog) ? state.jevGateLog : []).filter(item => item.day === day && item.called).length;
}

// 반환: { action: 'skip'|'thanks'|'alert'|'claude', choice, confidence, reason, log }
// deps: { getKey, callJev, now }. state는 읽기만 한다(기록은 호출한 쪽이 log를 state.jevGateLog에 넣는다).
async function decide({ message, body = {}, policy = {}, state = {}, deps = {} }) {
  const cfg = config(policy);
  const now = typeof deps.now === 'number' ? deps.now : Date.now();
  const log = { at: new Date(now).toISOString(), day: kstDay(now), called: false };
  const claude = reason => ({ action: 'claude', reason, log: { ...log, action: 'claude', reason } });
  if (!cfg.enabled) return { action: 'claude', reason: 'switch_off', log: null };
  const key = typeof deps.getKey === 'function' ? String(deps.getKey() || '').trim() : '';
  if (!key || typeof deps.callJev !== 'function') return claude('no_key');
  if (callsToday(state, now) >= cfg.dailyMaxCalls) return claude('daily_cap');
  const text = redactCommon(message, body);
  if (!text) return claude('empty');
  log.called = true;
  let answer = null;
  try {
    const result = await deps.callJev({ key, questions: QUESTIONS, state: { message: text }, timeoutMs: cfg.timeoutMs });
    answer = result?.answers?.intent || result?.intent || null;
  } catch (error) {
    return claude(`jev_error:${String(error.status || error.name || 'error').slice(0, 40)}`);
  }
  const choice = String(answer?.choice || '');
  const confidence = Number(answer?.confidence);
  if (!CHOICES[choice] || !Number.isFinite(confidence)) return claude('jev_bad_answer');
  log.choice = choice; log.confidence = Number(confidence.toFixed(3));
  const action = confidence >= cfg.threshold ? (ACTIONS[choice] || 'claude') : 'claude';
  log.action = action;
  return { action, choice, confidence, reason: `제브 ${choice} ${confidence.toFixed(2)}`, log };
}

module.exports = { decide, config, callsToday, CHOICES, QUESTIONS, kstDay };
