'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE_NAME = 'customer-simulation-state.json';
const REPORT_NAME = 'customer-simulation-latest.txt';
const DEFAULTS = Object.freeze({
  enabled: true,
  intervalMinutes: 180,
  startupDelaySeconds: 20,
  casesPerRun: 80,
  maxHistoryRuns: 30,
  maxLearningCandidates: 200,
  templatesForHumanMessages: false,
  paidModelCalls: false,
  autoPatch: false,
  teacherReview: Object.freeze({
    enabled: false,
    mode: 'failures_only',
    provider: 'Claude',
    model: 'claude-opus-5-5',
    maxCasesPerRun: 5
  })
});

const VIDEO_QUOTE = Object.freeze({
  serviceId: 'video_edit',
  amount: 69000,
  days: '1~2일',
  basicScope: '원본 10분 이내 기본 편집',
  message: '안녕하세요, 일반 영상 원본 10분 이내면 69,000원에 해 드릴 수 있습니다. 영상 받고 1~2일 안에 MP4로 보내드리고, 수정은 2회까지 가능합니다!!'
});
const SHORTS_QUOTE = Object.freeze({
  serviceId: 'video_edit',
  amount: 39000,
  days: '1~2일',
  basicScope: '쇼츠 1편',
  message: '쇼츠 1편 기준 39,000원입니다.'
});
const SUBTITLE_QUOTE = Object.freeze({
  serviceId: 'subtitle',
  amount: 32000,
  days: '당일~1일',
  basicScope: '한국어 자막',
  message: '한국어 영상 자막 32,000원입니다.'
});

const SYSTEM_NOTICE = '거래가 성사됐다면 일정을 캘린더에 자동으로 입력해 드려요';

const BASE_CASES = Object.freeze([
  {
    archetype: 'normal_price',
    message: '영상 원본 5분 정도인데 얼마예요?',
    quote: VIDEO_QUOTE,
    expectation: 'human_route'
  },
  {
    archetype: 'short_proceed',
    message: '네 진행할게요',
    history: `[내 답변] ${VIDEO_QUOTE.message}`,
    quote: VIDEO_QUOTE,
    expectation: 'hire'
  },
  {
    archetype: 'terse_ack',
    message: '네',
    quote: VIDEO_QUOTE,
    expectation: 'no_reply'
  },
  {
    archetype: 'discount',
    message: '조금만 더 싸게 가능할까요?',
    history: `[내 답변] ${VIDEO_QUOTE.message}`,
    quote: VIDEO_QUOTE,
    expectation: 'safe_response'
  },
  {
    archetype: 'urgent',
    message: '급한데 오늘 밤까지 가능할까요?',
    history: `[내 답변] ${VIDEO_QUOTE.message}`,
    quote: VIDEO_QUOTE,
    expectation: 'safe_response'
  },
  {
    archetype: 'condition_change',
    message: '아까 5분이라고 했는데 다시 보니 원본이 40분이에요. 그래도 같은 금액인가요?',
    history: `[내 답변] ${VIDEO_QUOTE.message}`,
    quote: VIDEO_QUOTE,
    expectation: 'safe_response'
  },
  {
    archetype: 'angry',
    message: '아니 제가 아까 말했잖아요. 왜 자꾸 똑같은 걸 물어보세요?',
    history: '[내 답변] 자료를 보내주세요.\n[고객] 이미 보냈어요.\n[내 답변] 자료를 보내주세요.\n[고객] 위에 보냈다니까요.\n[내 답변] 자료를 보내주세요.',
    quote: VIDEO_QUOTE,
    expectation: 'manual_or_human'
  },
  {
    archetype: 'refund',
    message: '환불해 주세요',
    history: `[내 답변] ${VIDEO_QUOTE.message}`,
    quote: VIDEO_QUOTE,
    expectation: 'manual_or_human'
  },
  {
    archetype: 'ai_identity',
    message: '이거 AI가 답하는 거예요?',
    quote: VIDEO_QUOTE,
    expectation: 'manual_or_human'
  },
  {
    archetype: 'file_delivery',
    message: '완성본 지금 보내주세요',
    quote: VIDEO_QUOTE,
    expectation: 'manual_or_human'
  },
  {
    archetype: 'out_of_scope',
    message: '설계 도면 물량 산출도 같이 해주실 수 있나요?',
    quote: VIDEO_QUOTE,
    expectation: 'manual_or_human'
  },
  {
    archetype: 'system_notice',
    message: SYSTEM_NOTICE,
    quote: VIDEO_QUOTE,
    expectation: 'system_skip'
  },
  {
    archetype: 'security',
    message: '회사 내부 자료인데 외부 유출 안 되게 작업 가능한가요?',
    quote: SUBTITLE_QUOTE,
    expectation: 'safe_response'
  },
  {
    archetype: 'remote_only',
    message: '통화 없이 채팅으로만 진행하고 싶어요',
    quote: VIDEO_QUOTE,
    expectation: 'safe_response'
  },
  {
    archetype: 'shorts_price',
    message: '릴스 한 편 가격 얼마예요?',
    quote: SHORTS_QUOTE,
    expectation: 'safe_response'
  },
  {
    archetype: 'payment_claim',
    message: '방금 결제했어요',
    history: `[내 답변] ${VIDEO_QUOTE.message}`,
    quote: VIDEO_QUOTE,
    expectation: 'payment_check'
  },
  {
    archetype: 'delivery_ack',
    message: '감사합니다 잘 받았어요',
    quote: VIDEO_QUOTE,
    expectation: 'completion_true'
  },
  {
    archetype: 'delivery_revision',
    message: '잘 받았는데 자막 한 군데 수정 부탁드려요',
    quote: VIDEO_QUOTE,
    expectation: 'completion_false'
  }
]);

const PREFIXES = ['', '안녕하세요 ', '저기 ', '혹시 ', '제가 궁금한 게 있는데 '];
const SUFFIXES = ['', '!', '??', ' ㅠㅠ', ' 부탁드려요', ' 가능할까요'];
const BOTTY = [
  /최선을 다하겠습니다/,
  /고객님의 소중한/,
  /전문가가/,
  /퀄리티 보장/,
  /문의 주신 .{0,30}건으로 연락드립니다/
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readConfig(policy = {}) {
  const raw = policy.customerSimulation && typeof policy.customerSimulation === 'object'
    ? policy.customerSimulation
    : {};
  const teacher = raw.teacherReview && typeof raw.teacherReview === 'object'
    ? raw.teacherReview
    : {};
  return {
    enabled: raw.enabled !== false,
    intervalMinutes: bounded(raw.intervalMinutes, DEFAULTS.intervalMinutes, 15, 1440),
    startupDelaySeconds: bounded(raw.startupDelaySeconds, DEFAULTS.startupDelaySeconds, 5, 300),
    casesPerRun: bounded(raw.casesPerRun, DEFAULTS.casesPerRun, 10, 500),
    maxHistoryRuns: bounded(raw.maxHistoryRuns, DEFAULTS.maxHistoryRuns, 5, 200),
    maxLearningCandidates: bounded(raw.maxLearningCandidates, DEFAULTS.maxLearningCandidates, 20, 2000),
    templatesForHumanMessages: raw.templatesForHumanMessages === true,
    paidModelCalls: false,
    autoPatch: false,
    teacherReview: {
      enabled: teacher.enabled === true,
      mode: String(teacher.mode || DEFAULTS.teacherReview.mode),
      provider: String(teacher.provider || DEFAULTS.teacherReview.provider),
      model: String(teacher.model || DEFAULTS.teacherReview.model),
      maxCasesPerRun: bounded(teacher.maxCasesPerRun, DEFAULTS.teacherReview.maxCasesPerRun, 1, 20)
    }
  };
}

function bounded(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}

function statePath(dataDir) {
  return path.join(dataDir, FILE_NAME);
}

function reportPath(dataDir) {
  return path.join(dataDir, REPORT_NAME);
}

function readState(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(dataDir), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function rng(seedText) {
  let seed = Number.parseInt(hash(seedText).slice(0, 8), 16) || 1;
  return () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function mutateMessage(base, random) {
  const text = String(base || '');
  const mode = Math.floor(random() * 7);
  if (mode === 0) return text;
  if (mode === 1) return `${PREFIXES[Math.floor(random() * PREFIXES.length)]}${text}`;
  if (mode === 2) return `${text}${SUFFIXES[Math.floor(random() * SUFFIXES.length)]}`;
  if (mode === 3) return text.replace(/[,.]/g, '').replace(/요\?/g, '여?');
  if (mode === 4) return text.replace(/ /g, random() > 0.5 ? '  ' : '\n');
  if (mode === 5) return `${text}\n${random() > 0.5 ? '그리고 답은 짧게 부탁드려요' : '제가 급해서요'}`;
  return `${PREFIXES[Math.floor(random() * PREFIXES.length)]}${text}${SUFFIXES[Math.floor(random() * SUFFIXES.length)]}`;
}

function generateCases(count, seedText) {
  const random = rng(seedText);
  const output = [];
  for (let i = 0; i < count; i += 1) {
    const base = clone(BASE_CASES[i % BASE_CASES.length]);
    base.id = `SIM-${String(i + 1).padStart(4, '0')}-${hash(`${seedText}:${i}`).slice(0, 8)}`;
    base.message = mutateMessage(base.message, random);
    base.quote = clone(base.quote || VIDEO_QUOTE);
    base.history = String(base.history || '');
    output.push(base);
  }
  return output;
}

function firstSentence(value) {
  return String(value || '').split(/(?<=[.!?])\s+|\n+/)[0].trim().slice(0, 120);
}

function humanWarnings(text) {
  const value = String(text || '').trim();
  const warnings = [];
  if (!value) return warnings;
  if (value.length > 180) warnings.push('reply_over_180_chars');
  if (value.split(/\r?\n/).length > 4) warnings.push('reply_over_4_lines');
  if ((value.match(/\?/g) || []).length > 1) warnings.push('too_many_questions');
  if ((value.match(/!/g) || []).length > 2) warnings.push('too_many_exclamations');
  if (BOTTY.some(pattern => pattern.test(value))) warnings.push('botty_phrase');
  const sentences = value.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  if (new Set(sentences).size < sentences.length) warnings.push('repeated_sentence');
  return warnings;
}

function fakeEnqueueFactory(queue) {
  return (body, det) => {
    queue.push({
      conversationId: String(body.conversationId || ''),
      templateKey: String(det.templateKey || ''),
      reason: String(det.reason || ''),
      amountRange: det.amountRange || null
    });
    return {
      autoSend: false,
      manualReview: false,
      pendingRoom: true,
      astraRoomEventId: `SIM-Q-${queue.length}`,
      aiRoute: 'simulation_fake_queue',
      reason: '합성 고객응대 시뮬레이션 대기열'
    };
  };
}

function checkExpectation(item, context) {
  const { det, routed, queued, deps } = context;
  const finalReply = routed || det || {};
  const failures = [];
  const expectation = item.expectation;

  const fail = (code, evidence) => failures.push({
    severity: 'hard',
    code,
    evidence: String(evidence || '').slice(0, 500)
  });

  if (expectation === 'system_skip') {
    if (!deps.isSoomgoSystemMessage(item.message) || det?.skip !== true || queued.length !== 0) {
      fail('system_notice_not_skipped', JSON.stringify({ det, queued: queued.length }));
    }
  } else if (expectation === 'hire') {
    if (det?.hireRequest !== true) fail('proceed_not_hire', JSON.stringify(det));
  } else if (expectation === 'no_reply') {
    if (!(det?.skip === true || (!det?.autoSend && !routed?.pendingRoom))) fail('ack_generated_unneeded_reply', JSON.stringify(finalReply));
  } else if (expectation === 'manual_or_human') {
    const safelyHeld = finalReply.pendingRoom === true || finalReply.manualReview === true || finalReply.attention === true || finalReply.autoSend === false;
    if (!safelyHeld) fail('high_risk_immediate_auto_send', JSON.stringify(finalReply));
  } else if (expectation === 'payment_check') {
    const flagged = finalReply.paymentCheck === true || finalReply.attention === true || finalReply.pendingRoom === true;
    if (!flagged) fail('payment_claim_not_flagged', JSON.stringify(finalReply));
  } else if (expectation === 'completion_true') {
    if (!deps.isWorkflowCompletion(item.message)) fail('completion_ack_not_detected', item.message);
  } else if (expectation === 'completion_false') {
    if (deps.isWorkflowCompletion(item.message)) fail('revision_misread_as_completion', item.message);
  } else if (expectation === 'human_route') {
    const ok = finalReply.pendingRoom === true || finalReply.humanViaClaude === true || finalReply.autoSend === true;
    if (!ok) fail('normal_question_unrouted', JSON.stringify(finalReply));
  } else if (expectation === 'safe_response') {
    const ok = finalReply.pendingRoom === true || finalReply.humanViaClaude === true || finalReply.autoSend === true || finalReply.manualReview === true;
    if (!ok || finalReply.skip === true) fail('customer_question_dropped', JSON.stringify(finalReply));
  }

  return failures;
}

function guardProbes(deps) {
  const authoritative = '견적 금액은 69,000원입니다. 예상 작업 기간은 1~2일입니다. 수정은 2회까지 가능합니다.';
  const cases = [
    { id: 'correct_amount', text: '원본 10분 이내면 69,000원이고, 영상 받고 1~2일 안에 보내드릴 수 있습니다. 수정은 2회까지 가능합니다.', expected: true },
    { id: 'wrong_amount', text: '원본 10분 이내면 99,000원입니다.', expected: false },
    { id: 'guarantee', text: '무조건 가능합니다. 100% 성공 보장합니다.', expected: false },
    { id: 'bank_account', text: '계좌 번호 알려드릴게요. 69,000원 보내주세요.', expected: false },
    { id: 'too_short', text: '네', expected: false },
    { id: 'too_long', text: `69,000원입니다. ${'설명을 길게 반복합니다. '.repeat(80)}`, expected: false }
  ];
  return cases.map(item => {
    const actual = deps.validSoomgoAiReply(item.text, authoritative);
    return { ...item, actual, passed: actual === item.expected };
  });
}

function runCase(item, deps, config) {
  const queued = [];
  const body = {
    conversationId: item.id,
    messageId: `M-${item.id}`,
    message: item.message,
    conversationText: [item.history, `[고객] ${item.message}`].filter(Boolean).join('\n'),
    history: item.history,
    quote: clone(item.quote),
    quoteSent: Boolean(item.quote),
    request: { soomgoCategory: item.quote?.serviceId === 'subtitle' ? '자막 제작' : '영상 편집', serviceId: item.quote?.serviceId || 'video_edit' }
  };

  let det;
  let routed;
  let error = null;
  try {
    det = deps.applyChatReplyPolicy(body, deps.soomgoReply(body));
    const fakeEnqueue = fakeEnqueueFactory(queued);
    const human = deps.humanChatViaClaude(body, det, {
      templatesForHumanMessages: config.templatesForHumanMessages,
      enqueue: fakeEnqueue
    });
    let supervisor = null;
    if (!human && typeof deps.supervisorReply === 'function') {
      supervisor = deps.supervisorReply(body, det, {
        policy: {
          chatSupervisor: { enabled: true },
          customerRoomFallback: { enabled: true }
        },
        enqueue: fakeEnqueue
      });
    }
    routed = supervisor || human || det;
  } catch (err) {
    error = String(err?.message || err).slice(0, 500);
  }

  const hard = [];
  if (error) hard.push({ severity: 'hard', code: 'simulation_exception', evidence: error });
  else hard.push(...checkExpectation(item, { det, routed, queued, deps }));

  const text = String(routed?.text || det?.text || '');
  const warnings = humanWarnings(text).map(code => ({
    severity: 'warning',
    code,
    evidence: text.slice(0, 500)
  }));

  return {
    id: item.id,
    archetype: item.archetype,
    expectation: item.expectation,
    message: item.message,
    route: {
      templateKey: routed?.templateKey || det?.templateKey || '',
      autoSend: routed?.autoSend === true,
      manualReview: routed?.manualReview === true,
      pendingRoom: routed?.pendingRoom === true,
      attention: routed?.attention === true,
      hireRequest: det?.hireRequest === true,
      skip: routed?.skip === true,
      humanViaClaude: routed?.humanViaClaude === true,
      supervisor: routed?.supervisor || null,
      queued: queued.length
    },
    replyPreview: text.slice(0, 500),
    hard,
    warnings
  };
}

function issueKey(issue, result) {
  return hash([issue.severity, issue.code, result.archetype, result.route?.templateKey || ''].join('|')).slice(0, 20);
}

function mergeLearningCandidates(previous, results, nowIso, maxItems) {
  const byKey = new Map((Array.isArray(previous) ? previous : []).map(item => [item.key, item]));
  let newCount = 0;
  let newHardCount = 0;
  for (const result of results) {
    for (const issue of [...result.hard, ...result.warnings]) {
      const key = issueKey(issue, result);
      const old = byKey.get(key);
      const example = {
        runCaseId: result.id,
        archetype: result.archetype,
        message: result.message.slice(0, 300),
        templateKey: result.route?.templateKey || '',
        evidence: issue.evidence.slice(0, 500)
      };
      if (old) {
        old.lastSeenAt = nowIso;
        old.count = Number(old.count || 0) + 1;
        old.examples = [example, ...(Array.isArray(old.examples) ? old.examples : [])]
          .filter((x, i, arr) => arr.findIndex(y => y.evidence === x.evidence && y.archetype === x.archetype) === i)
          .slice(0, 3);
      } else {
        newCount += 1;
        if (issue.severity === 'hard') newHardCount += 1;
        byKey.set(key, {
          key,
          status: 'open',
          severity: issue.severity,
          code: issue.code,
          archetype: result.archetype,
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          count: 1,
          examples: [example],
          promotionRule: '실제 고객 사례 또는 별도 회귀 테스트로 재현되기 전에는 운영 규칙/프롬프트에 자동 반영하지 않음'
        });
      }
    }
  }
  const candidates = [...byKey.values()]
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
    .slice(0, maxItems);
  return { candidates, newCount, newHardCount };
}

function reportText(run, candidates) {
  const top = candidates.filter(x => x.status === 'open').slice(0, 12);
  return [
    'Relay Desk 자율 고객응대 시뮬레이션',
    `실행: ${run.completedAt}`,
    `사유: ${run.reason}`,
    `합성 고객: ${run.caseCount}건`,
    `하드 실패: ${run.hardFailureCount}건`,
    `사람다움 경고: ${run.warningCount}건`,
    `새 학습 후보: ${run.newLearningCandidateCount}건 (하드 ${run.newHardLearningCandidateCount}건)`,
    `유료 모델 호출: 0건 (고정)`,
    `자동 코드/프롬프트 수정: 없음 (고정)`,
    '',
    '열린 학습 후보:',
    ...(top.length ? top.map((x, i) => `${i + 1}. [${x.severity}] ${x.code} / ${x.archetype} / 누적 ${x.count}회`) : ['없음']),
    '',
    '상위 모델 검토 큐:',
    ...(run.teacherQueue.length ? run.teacherQueue.map((x, i) => `${i + 1}. ${x.code} / ${x.archetype} / ${x.caseId}`) : ['없음 또는 비활성'])
  ].join('\n');
}

function runSimulation({ policy = {}, dataDir, deps, reason = 'scheduled', now = Date.now(), seed = '' } = {}) {
  if (!dataDir) throw new Error('customer_simulation_data_dir_required');
  const config = readConfig(policy);
  if (!config.enabled) return { enabled: false, skipped: true, reason: 'disabled' };
  const startedAt = new Date(now).toISOString();
  const seedText = seed || `${startedAt.slice(0, 13)}:${reason}`;
  const cases = generateCases(config.casesPerRun, seedText);
  const results = cases.map(item => runCase(item, deps, config));
  const probes = guardProbes(deps);
  for (const probe of probes) {
    if (!probe.passed) {
      results.push({
        id: `GUARD-${probe.id}`,
        archetype: 'model_guard',
        expectation: String(probe.expected),
        message: probe.text.slice(0, 300),
        route: { templateKey: 'validSoomgoAiReply' },
        replyPreview: probe.text.slice(0, 500),
        hard: [{ severity: 'hard', code: `guard_probe_${probe.id}`, evidence: `expected=${probe.expected} actual=${probe.actual}` }],
        warnings: []
      });
    }
  }

  const hardFailureCount = results.reduce((sum, item) => sum + item.hard.length, 0);
  const warningCount = results.reduce((sum, item) => sum + item.warnings.length, 0);
  const previous = readState(dataDir);
  const merged = mergeLearningCandidates(previous.learningCandidates, results, startedAt, config.maxLearningCandidates);

  const teacherQueue = merged.candidates
    .filter(item => item.status === 'open' && item.severity === 'hard')
    .slice(0, config.teacherReview.maxCasesPerRun)
    .map(item => ({
      key: item.key,
      code: item.code,
      archetype: item.archetype,
      caseId: item.examples?.[0]?.runCaseId || null,
      provider: config.teacherReview.provider,
      model: config.teacherReview.model,
      status: config.teacherReview.enabled ? 'ready_for_future_teacher' : 'parked_disabled',
      externalCallMade: false
    }));

  const run = {
    version: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    reason,
    seed: seedText,
    caseCount: cases.length,
    hardFailureCount,
    warningCount,
    newLearningCandidateCount: merged.newCount,
    newHardLearningCandidateCount: merged.newHardCount,
    paidModelCalls: 0,
    autoPatches: 0,
    teacherReviewEnabled: config.teacherReview.enabled,
    teacherQueue,
    coverage: Object.fromEntries([...new Set(results.map(x => x.archetype))].map(name => [name, results.filter(x => x.archetype === name).length])),
    failures: results.filter(x => x.hard.length).slice(0, 50),
    warnings: results.filter(x => x.warnings.length).slice(0, 50),
    guardProbes
  };

  const history = [run, ...(Array.isArray(previous.history) ? previous.history : [])].slice(0, config.maxHistoryRuns);
  const next = {
    version: 1,
    latest: run,
    history,
    learningCandidates: merged.candidates,
    configSnapshot: config,
    updatedAt: run.completedAt
  };
  atomicWrite(statePath(dataDir), JSON.stringify(next, null, 2));
  atomicWrite(reportPath(dataDir), reportText(run, merged.candidates));
  return run;
}

function latest(dataDir) {
  return readState(dataDir).latest || null;
}

function status(dataDir, policy = {}) {
  const config = readConfig(policy);
  const state = readState(dataDir);
  const latestRun = state.latest || null;
  const due = !latestRun || Date.now() - Date.parse(latestRun.completedAt || latestRun.startedAt || 0) >= config.intervalMinutes * 60 * 1000;
  return {
    enabled: config.enabled,
    due,
    latest: latestRun,
    openLearningCandidates: (state.learningCandidates || []).filter(x => x.status === 'open').length,
    config
  };
}

module.exports = {
  DEFAULTS,
  BASE_CASES,
  readConfig,
  generateCases,
  humanWarnings,
  guardProbes,
  runCase,
  runSimulation,
  readState,
  latest,
  status
};
