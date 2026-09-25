'use strict';

// 제작 파이프라인 A/B/C 시뮬레이션 (2026-09-22 준희 지시 "예시대로 해볼래").
// 질문: "Jev(문지기) → 하위모델 / 상위모델 → Jev 재판정 → 상위 보정 → 상위 검증" 흐름(C)이
//       하위 단독(A)·상위 단독(B)보다 평균 품질이 오르는가, 비용은 얼마인가.
// - 과제: tests/fixtures/jev-synthetic.cjs 합성 표본(정답 자동 부착). 실제 고객 자료 없음.
// - 갈래·모델·단가는 server/config/pipeline-sim.json에만 있다(코드에 박지 않음).
// - 실제 API 호출은 policy pipelineSim.enabled=true 이고 키가 있을 때만. 기본은 가짜 제공자(fake).
//   가짜 제공자는 집계·채점 로직 확인용이며, 그 결과로 품질을 판단하지 않는다.
// - 결과는 server/data/pipeline-sim/<runId>.json 에만 남는다. 봇·견적·발송에 영향 없음.
// 사용(CLI): node server/pipeline-sim.js [--n 100] [--arms A,B,C] [--real] [--cap-krw 3000]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(__dirname, 'config', 'pipeline-sim.json');
const DATA_DIR = path.join(__dirname, 'data', 'pipeline-sim');
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

function loadConfig(file = CONFIG_FILE) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// ── 과제 만들기 ───────────────────────────────────────────────
// 교정: original → 바른 문장. 정답은 오류 없는 문장(kind fix: edited / style·meaning: original 그대로). fix_meaning은 정답을 못 만들어 뺀다.
// 번역: 영어 transcript → 한국어. 정답은 합성기의 한국어 문장(aligned만).
function buildTasks({ editN = 100, translateN = 100, seed = 11 } = {}) {
  const synth = require(path.join(ROOT, 'tests', 'fixtures', 'jev-synthetic.cjs'));
  const edits = synth.editPairs(Math.max(editN * 2, 200), seed)
    .filter(row => !row.id.endsWith('fix_meaning'))
    .slice(0, editN)
    .map(row => ({ id: row.id, kind: 'edit', input: row.original, gold: row.id.endsWith('-fix') ? row.edited : row.original, goldHadError: row.gold.original_had_error }));
  const trans = synth.subtitlePairs(Math.max(translateN * 4, 400), seed + 1)
    .filter(row => row.id.endsWith('-aligned'))
    .slice(0, translateN)
    .map(row => ({ id: row.id, kind: 'translate', input: row.transcript, gold: row.srt_block.split('\n').slice(2).join(' ').trim() }));
  return [...edits, ...trans];
}

// ── 채점 ──────────────────────────────────────────────────────
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[.。!?]+$/g, '').trim();
function scoreEdit(task, output) {
  const ok = norm(output) === norm(task.gold);
  const overEdit = !task.goldHadError && norm(output) !== norm(task.input); // 멀쩡한 문장을 고침
  const missed = task.goldHadError && norm(output) === norm(task.input);   // 오류를 못 고침
  return { correct: ok, overEdit, missed };
}
// 번역은 글자 일치가 무의미해서 Jev 판정(뜻 같음·누락·보탬)으로 채점한다. judge 결과가 없으면 null.
function scoreTranslate(task, output, judged) {
  if (!judged) return { correct: null, overEdit: null, missed: null };
  const same = Number(judged.same_content?.value ?? judged.same_content) >= 0.5;
  const omit = Number(judged.omits_meaning?.value ?? judged.omits_meaning) >= 0.5;
  const add = Number(judged.adds_meaning?.value ?? judged.adds_meaning) >= 0.5;
  return { correct: same && !omit && !add, overEdit: add, missed: omit };
}

// ── 제공자 ────────────────────────────────────────────────────
function makeProviders({ real = false, keys = {}, config, fetchImpl = global.fetch, seed = 7 }) {
  const usage = { calls: {}, inputTokens: {}, outputTokens: {}, ms: {} };
  const tally = (name, u, ms) => { usage.calls[name] = (usage.calls[name] || 0) + 1; usage.inputTokens[name] = (usage.inputTokens[name] || 0) + (u.input_tokens || 0); usage.outputTokens[name] = (usage.outputTokens[name] || 0) + (u.output_tokens || 0); usage.ms[name] = (usage.ms[name] || 0) + ms; };
  let a = seed >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const estTokens = s => Math.ceil(String(s).length / 2);

  // 가짜 모델: 설정의 fakeSkill(정답률·과잉수정률)로 결과를 만든다. 품질 판단용이 아님.
  async function fakeModel(name, task, mode, prev) {
    const skill = config.models[name]?.fakeSkill || { fix: 0.7, overEdit: 0.1, translate: 0.7 };
    const started = Date.now();
    let text;
    if (task.kind === 'edit') {
      if (mode === 'verify') text = prev;
      else if (task.goldHadError) text = rnd() < skill.fix ? task.gold : task.input;
      else text = rnd() < skill.overEdit ? task.input.replace(/\s*$/, '') + ' 감사합니다.' : task.input;
    } else {
      text = mode === 'verify' ? prev : (rnd() < skill.translate ? task.gold : `${task.gold.split(' ').slice(0, -1).join(' ')}.`);
    }
    tally(name, { input_tokens: estTokens(task.input) + 120, output_tokens: estTokens(text) }, Date.now() - started);
    return text;
  }
  async function fakeJev(question, state, task) {
    const started = Date.now();
    const acc = config.jev.fakeAccuracy ?? 0.85;
    const truth = question === 'hard' ? (task.kind === 'translate' || task.goldHadError) : question === 'same_content' ? norm(state.candidate) === norm(task.gold) : question === 'omits_meaning' ? norm(state.candidate).length < norm(task.gold).length * 0.8 : question === 'adds_meaning' ? norm(state.candidate).length > norm(task.gold).length * 1.2 : question === 'meaning_changed' ? (task.kind === 'edit' && norm(state.candidate) !== norm(task.gold) && norm(state.candidate) !== norm(task.input)) : false;
    const answer = rnd() < acc ? truth : !truth;
    tally('jev', { input_tokens: estTokens(JSON.stringify(state)) + 60, output_tokens: 0 }, Date.now() - started);
    return answer ? 0.9 : 0.1;
  }

  async function realClaude(name, prompt) {
    const key = String(keys.claude || '').trim();
    if (!key) throw new Error('claude_key_missing');
    const model = config.models[name]?.id;
    const started = Date.now();
    const res = await fetchImpl(CLAUDE_URL, { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(60000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`claude_${res.status}_${String(body?.error?.type || '').slice(0, 60)}`);
    const text = (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    tally(name, body.usage || {}, Date.now() - started);
    return text;
  }
  async function realJev(question, state) {
    const key = String(keys.jev || '').trim();
    if (!key) throw new Error('jev_key_missing');
    const q = config.jev.questions[question];
    const started = Date.now();
    const res = await fetchImpl(JEV_URL, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'jev-latest', state, questions: { [question]: q } }), signal: AbortSignal.timeout(30000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`jev_http_${res.status}`);
    tally('jev', body.usage || {}, Date.now() - started);
    const ans = body.answers?.[question] || body[question] || {};
    return Number(ans.noul ?? ans.value ?? 0);
  }

  const prompts = config.prompts;
  const render = (tpl, task, prev) => String(tpl).replace('{input}', task.input).replace('{prev}', prev || '');
  return {
    usage,
    model: async (name, task, mode, prev) => real ? realClaude(name, render(prompts[task.kind][mode], task, prev)) : fakeModel(name, task, mode, prev),
    jev: async (question, task, candidate) => {
      const state = task.kind === 'edit' ? { original: task.input, edited: candidate || '' } : { transcript: task.input, srt_block: candidate || '', candidate: candidate || '', source_lang: 'en' };
      return real ? realJev(question, state) : fakeJev(question, { ...state, candidate: candidate || '' }, task);
    }
  };
}

// ── 갈래 실행 ─────────────────────────────────────────────────
// 단계 종류: gate(jev 난이도 → route), generate(model), judge(jev 질문들 → flagged), repair(flagged면 model), verify(model)
async function runArm(arm, task, P) {
  let text = '';
  let route = arm.defaultModel || null;
  const trace = [];
  let judged = null;
  for (const step of arm.steps) {
    if (step.type === 'gate') {
      const v = await P.jev(step.question, task, '');
      route = v >= 0.5 ? step.ifTrue : step.ifFalse;
      trace.push({ step: 'gate', value: v, route });
    } else if (step.type === 'generate') {
      const name = step.model === '$route' ? route : step.model;
      text = await P.model(name, task, 'generate');
      trace.push({ step: 'generate', model: name });
    } else if (step.type === 'judge') {
      judged = {};
      let flagged = false;
      // 교정 과제는 뜻 바뀜만, 번역 과제는 내용 일치·누락·보탬만 묻는다.
      const qs = step.questions.filter(q => (task.kind === 'edit' ? q === 'meaning_changed' : q !== 'meaning_changed'));
      for (const q of qs) { const v = await P.jev(q, task, text); judged[q] = v; if ((q === 'same_content' ? v < 0.5 : v >= 0.5)) flagged = true; }
      trace.push({ step: 'judge', judged, flagged });
    } else if (step.type === 'repair') {
      const last = trace[trace.length - 1];
      if (last?.flagged) { text = await P.model(step.model, task, 'repair', text); trace.push({ step: 'repair', model: step.model }); }
    } else if (step.type === 'verify') {
      text = await P.model(step.model, task, 'verify', text);
      trace.push({ step: 'verify', model: step.model });
    }
  }
  // 번역 채점용 최종 판정(모든 갈래에 같은 심판을 붙인다 — 갈래 안 judge와 별개)
  let finalJudge = null;
  if (task.kind === 'translate') { finalJudge = {}; for (const q of ['same_content', 'omits_meaning', 'adds_meaning']) finalJudge[q] = await P.jev(q, task, text); }
  const score = task.kind === 'edit' ? scoreEdit(task, text) : scoreTranslate(task, text, finalJudge);
  return { output: text, score, trace };
}

function krw(usage, config) {
  const fx = config.pricing.krwPerUsd;
  let usd = 0; const missing = [];
  for (const name of Object.keys(usage.calls)) {
    const p = name === 'jev' ? config.jev.pricing : config.models[name]?.pricing;
    if (!p || p.inputUsdPerMTok == null) { missing.push(name); continue; }
    usd += (usage.inputTokens[name] || 0) * p.inputUsdPerMTok / 1e6 + (usage.outputTokens[name] || 0) * (p.outputUsdPerMTok || 0) / 1e6;
  }
  return { usd: Number(usd.toFixed(4)), krw: Math.round(usd * fx), priceUnknownFor: missing };
}

async function runSimulation({ n = 100, arms = null, real = false, keys = {}, capKrw = null, config = loadConfig(), dataDir = DATA_DIR, fetchImpl = global.fetch, seed = 11, now = Date.now() }) {
  if (real && !config.enabled) { const e = new Error('pipeline_sim_disabled'); e.status = 403; throw e; }
  const chosen = (arms || Object.keys(config.arms)).filter(k => config.arms[k]);
  if (!chosen.length) throw new Error('no_arm');
  const tasks = buildTasks({ editN: Math.ceil(n / 2), translateN: Math.floor(n / 2), seed });
  const id = `PIPE-${new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const run = { id, mode: real ? 'real' : 'fake', startedAt: new Date(now).toISOString(), tasks: tasks.length, arms: chosen, capKrw, results: {}, summary: {}, stopReason: null };
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, `${id}.json`);
  for (const armKey of chosen) {
    const arm = JSON.parse(JSON.stringify(config.arms[armKey]));
    const P = makeProviders({ real, keys, config, fetchImpl, seed: seed + armKey.charCodeAt(0) });
    const rows = [];
    for (const task of tasks) {
      try { const r = await runArm(arm, task, P); rows.push({ id: task.id, kind: task.kind, ...r }); }
      catch (error) { rows.push({ id: task.id, kind: task.kind, error: error.message }); if (/key_missing|401|403/.test(error.message)) { run.stopReason = error.message; break; } }
      const cost = krw(P.usage, config);
      if (capKrw != null && cost.krw >= capKrw) { run.stopReason = `cap_krw_${capKrw}`; break; }
    }
    run.results[armKey] = rows;
    run.summary[armKey] = summarizeArm(arm, rows, P.usage, config);
    fs.writeFileSync(file, JSON.stringify(run, null, 2));
    if (run.stopReason) break;
  }
  run.finishedAt = new Date().toISOString();
  run.comparison = compare(run.summary, chosen);
  fs.writeFileSync(file, JSON.stringify(run, null, 2));
  return run;
}

function summarizeArm(arm, rows, usage, config) {
  const ok = rows.filter(r => r.score);
  const by = kind => {
    const list = ok.filter(r => r.kind === kind && r.score.correct !== null);
    const rate = f => list.length ? Number((list.filter(f).length / list.length).toFixed(3)) : null;
    return { n: list.length, correct: rate(r => r.score.correct), overEdit: rate(r => r.score.overEdit), missed: rate(r => r.score.missed) };
  };
  const cost = krw(usage, config);
  const calls = Object.values(usage.calls).reduce((a, b) => a + b, 0);
  const ms = Object.values(usage.ms).reduce((a, b) => a + b, 0);
  return { label: arm.label, tasks: rows.length, errors: rows.filter(r => r.error).length, edit: by('edit'), translate: by('translate'), calls, callsByProvider: usage.calls, tokens: { input: usage.inputTokens, output: usage.outputTokens }, cost, msPerTask: rows.length ? Math.round(ms / rows.length) : null };
}

function compare(summary, chosen) {
  const base = summary[chosen[0]];
  const out = {};
  for (const k of chosen) {
    const s = summary[k];
    out[k] = { label: s.label, editCorrect: s.edit.correct, translateCorrect: s.translate.correct, overEdit: s.edit.overEdit, krw: s.cost.krw, priceUnknownFor: s.cost.priceUnknownFor, vsFirst: { editCorrect: base && s.edit.correct != null && base.edit.correct != null ? Number((s.edit.correct - base.edit.correct).toFixed(3)) : null, krw: base ? s.cost.krw - base.cost.krw : null } };
  }
  return out;
}

module.exports = { CONFIG_FILE, DATA_DIR, loadConfig, buildTasks, scoreEdit, scoreTranslate, makeProviders, runArm, runSimulation, summarizeArm, compare };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const real = args.includes('--real');
  runSimulation({ n: Number(opt('--n', 100)), arms: opt('--arms', null)?.split(','), real, capKrw: opt('--cap-krw') != null ? Number(opt('--cap-krw')) : (real ? Number(loadConfig().defaultCapKrw || 3000) : null), keys: { claude: process.env.ANTHROPIC_API_KEY, jev: process.env.TYPESAFE_API_KEY } })
    .then(run => { console.log(JSON.stringify({ id: run.id, mode: run.mode, stopReason: run.stopReason, comparison: run.comparison }, null, 2)); })
    .catch(error => { console.error(error.message); process.exit(1); });
}
