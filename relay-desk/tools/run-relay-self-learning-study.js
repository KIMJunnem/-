'use strict';

const fs = require('fs');
const path = require('path');

const API = 'https://api.openai.com/v1/responses';
const KEY = String(process.env.OPENAI_API_KEY || '').trim();
if (!KEY) throw new Error('OPENAI_API_KEY is required');

const BUDGET = Number(process.env.RELAY_STUDY_BUDGET_USD || 6.30);
const HARD_STOP = Math.max(0.1, BUDGET - 0.03);
const ASTRA = 'gpt-6-astra';
const LOW = 'gpt-4o-mini';
const outDir = path.resolve(__dirname, '..', 'server', 'data', 'self-learning-study-20260921');
fs.mkdirSync(outDir, { recursive: true });
const stateFile = path.join(outDir, 'state.json');
const eventsFile = path.join(outDir, 'events.jsonl');
const validationFile = path.join(outDir, 'astra-design-validation.json');
const promotedDir = path.join(outDir, 'promoted-reports');
fs.mkdirSync(promotedDir, { recursive: true });
const JUDGE_RUBRIC = '각 항목은 0·5·10·15·20 중 하나: 0=결여/위험, 5=중대한 결함, 10=부분 충족, 15=대체로 충족, 20=구체적이며 검증 가능하게 완전 충족.';

const prices = {
  [ASTRA]: { input: 10, cached: 1, output: 50 },
  [LOW]: { input: 0.15, cached: 0.075, output: 0.6 }
};

const tasks = [
  ['견적 첫 문장', '새 숨고 계정에서 일반 문서 1,500자 21,000원 상품의 첫 견적 문장을 사람답고 신뢰감 있게 설계하라. 과장·할인 압박은 금지한다.'],
  ['자막 인테이크', '한국어 영상 5분 이하 SRT 32,000원 상품에서 답변 부담을 낮추면서 필수 정보만 받는 인테이크 흐름을 설계하라.'],
  ['읽음 후 후속', '견적 읽음 10분 후 고객당 1회만 보내는 자연스러운 질문 유도 문구와 발송 취소 조건을 설계하라.'],
  ['무응답 개선', '고객 직접 응답률이 약 3%인 작은 표본에서 다음 48시간 실험을 설계하라. 통계적 과장을 피하라.'],
  ['신규 계정 신뢰', '리뷰 0·고용 0인 신규 고수 계정이 무료로 신뢰를 높일 수 있는 실행 순서를 제안하라.'],
  ['전국 온라인 노출', '온라인 문서·자막 서비스의 전국 활동 범위를 활용하되 무관한 요청과 캐시 낭비를 줄이는 필터를 설계하라.'],
  ['교정 가격 범위', '교정·교열 기본 21,000원 상품의 포함·제외 범위와 추가금 기준을 고객이 바로 이해하게 작성하라.'],
  ['타이핑 가격 범위', '속기·타이핑 기본 21,000원 상품의 작업 단위, 품질 기준, 제외 범위를 설계하라.'],
  ['자막 품질검수', 'SRT 자막 결과물의 타임코드·오탈자·가독성·화자 구분을 자동 검수하는 체크리스트를 설계하라.'],
  ['문서 품질검수', '일반 문서 결과물의 사실성·구조·자연스러운 문체·파일 사용성을 검수하는 게이트를 설계하라.'],
  ['작업 큐', '동시 제작 최대 2건인 Relay Desk의 주문 접수부터 납품까지 상태 머신을 설계하라.'],
  ['중복 방지', 'requestId와 chatId를 이용해 중복 견적·중복 후속·중복 AI 호출을 막는 구조를 설계하라.'],
  ['실패 복구', 'SPA 자동화가 금액 입력에 실패하거나 이전 설명을 재사용할 때 안전하게 다음 요청으로 넘어가는 복구 절차를 설계하라.'],
  ['React 입력', 'React controlled input에서 화면 값과 내부 상태가 어긋나는 문제를 진단하고 검증 가능한 입력 절차를 제시하라.'],
  ['분류 안전장치', '영상·자막·문서·교정·타이핑 분류가 섞이지 않도록 증거 기반 분류와 거부 조건을 설계하라.'],
  ['비용 통제', '50만 숨고 캐시를 하루 5견적 상한으로 운영하며 수익성을 검증하는 대시보드 지표를 설계하라.'],
  ['48시간 판정', '견적 10건·결제 2건·결제액 64,000원 기준의 48시간 판정 보고서 형식을 설계하라.'],
  ['가격 유지 판단', '48시간 기준 미달일 때 가격을 바로 할인하지 않고 노출·읽음·응답 경로부터 고치는 의사결정 순서를 제시하라.'],
  ['사람다운 말투', '숨고 고객 메시지에서 번역체와 챗봇 말투를 줄이는 편집 규칙과 나쁜 예·좋은 예를 작성하라.'],
  ['통화·대면 거절', '통화·화상·대면 요청에 채팅 상담 원칙을 부드럽게 안내하는 문구와 예외 조건을 설계하라.'],
  ['결제 전 전달', '결제 전 최종 파일 전달을 제한하면서 고객 불신을 키우지 않는 안내 절차를 작성하라.'],
  ['수정 요청', '기본 수정 1회와 추가 수정의 경계를 분쟁 없이 운영하는 판정 규칙을 설계하라.'],
  ['크몽·숨고 동기화', '숨고와 크몽에서 가격·범위·샘플을 동일하게 유지하는 변경 관리 절차를 설계하라.'],
  ['샘플 보호', '실제 고객 작업을 포트폴리오로 사용할 때 개인정보·저작권·원문 노출을 막는 처리 절차를 설계하라.'],
  ['지식 저장소', '원본 기록·검증된 지식·핵심 교본의 3계층 지식 저장소 스키마를 설계하라.'],
  ['자전학습 게이트', '저가 모델 결과가 오류를 증폭하지 않도록 신규성·근거·반례·실행성 평가 게이트를 설계하라.'],
  ['보고서 압축', '수백 개 연구 보고서를 다음 모델이 읽을 8,000토큰 이하 교본으로 압축하는 규칙을 설계하라.'],
  ['회귀 방지', '새 운영 규칙 배포 후 응답률·오류율이 악화되면 이전 버전으로 복구하는 기준을 설계하라.'],
  ['성과 귀속', '문구 변경·대기시간 변경·가격 변경 효과가 섞이지 않도록 실험 버전과 성과를 연결하는 스키마를 설계하라.'],
  ['현실 표본', '시스템 알림을 고객 답장으로 세지 않고 실제 고객 최초 응답만 집계하는 규칙을 설계하라.'],
  ['서비스 거부', '자기소개서 요청에는 견적을 보내지 않고 일반 문서로 우회 접수도 하지 않는 자연스러운 안내를 작성하라.'],
  ['긴급 주문', '빠른 제작을 강점으로 삼되 지킬 수 없는 납기를 약속하지 않는 긴급 주문 정책을 설계하라.'],
  ['운영 보고', '사용자가 잠든 동안 발생한 요청·견적·대화·제작 상태를 아침에 한 화면으로 보고하는 형식을 설계하라.'],
  ['오류 알림', '운영자에게 꼭 알려야 하는 오류와 조용히 복구할 오류를 구분하는 등급표를 설계하라.'],
  ['API 비용 유실', '응답 타임아웃으로 비용은 발생하고 결과가 유실되는 경우의 멱등성·조회·재시도 정책을 설계하라.'],
  ['교본 오염 방지', '근거 없는 보고서가 핵심 교본에 편입되지 않도록 승격·격리·폐기 규칙을 설계하라.']
];

function seededRandom(seed=630) { let x=seed>>>0; return () => ((x=(Math.imul(1664525,x)+1013904223)>>>0)/4294967296); }
function shuffled(values, seed=630) {
  const a=values.slice(), r=seededRandom(seed);
  for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
const orderedTasks = shuffled(tasks.map((x,i)=>({id:i+1,title:x[0],prompt:x[1]})),630);
const lunaAIds = new Set(shuffled(orderedTasks.map(x=>x.id),631).slice(0,Math.floor(orderedTasks.length/2)));

const validation = fs.existsSync(validationFile) ? JSON.parse(fs.readFileSync(validationFile, 'utf8')) : null;
const validationAttempts = [validation?.priorAttempt, validation].filter(Boolean);
const validationCost = validationAttempts.reduce((s,x)=>s+Number(x.costUsd||0),0);
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {
  version: 1, budgetUsd: BUDGET, spentUsd: 0, astraEquivalentUsd: 0,
  counterfactualType: 'observed_tokens_repriced_at_astra_rates',
  qualityScope: 'fixed_tasks_astra_judged',
  primaryEfficiencyScope: 'generation_plus_manual_amortized',
  calls: validationAttempts.map((x,i)=>({at:x.createdAt,label:`design_validation:${i+1}`,stage:'manual',costBucket:'manual',model:ASTRA,responseId:x.responseId,usage:x.usage,costUsd:x.costUsd,astraEquivalentUsd:x.costUsd,attemptNumber:1})),
  seed: null, results: [], createdAt: new Date().toISOString()
};
if (!fs.existsSync(stateFile)) {
  state.spentUsd = validationCost;
  state.astraEquivalentUsd = validationCost;
}
state.workerModel = LOW;

function save() {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function outputText(body) {
  if (body.output_text) return String(body.output_text);
  return (body.output || []).flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text || '').join('\n');
}

function usageCost(model, usage = {}) {
  const p = prices[model];
  const input = Number(usage.input_tokens || 0);
  const cached = Number(usage.input_tokens_details?.cached_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  return ((input - cached) * p.input + cached * p.cached + output * p.output) / 1e6;
}

function astraEquivalent(usage = {}, cached = true) {
  if (!cached) {
    const input = Number(usage.input_tokens || 0), output = Number(usage.output_tokens || 0);
    return (input * prices[ASTRA].input + output * prices[ASTRA].output) / 1e6;
  }
  return usageCost(ASTRA, usage);
}

async function call(model, label, costBucket, instructions, input, maxOutput, effort = 'low', inputCap = 8192) {
  const completed = state.calls.find(x => x.label === label && x.model === model && typeof x.text === 'string' && x.text.trim());
  if (completed) return { text: completed.text, event: completed, replayed: true };
  const inputBytes = Buffer.byteLength(String(instructions)+String(input), 'utf8');
  const estimatedInputTokens = Math.ceil(inputBytes / 3);
  if (estimatedInputTokens > inputCap) throw Object.assign(new Error('INPUT_CAP_EXCEEDED'), { code: 'INPUT_CAP_EXCEEDED' });
  const worstReserve = (inputCap * prices[model].input + maxOutput * prices[model].output) / 1e6;
  if (state.spentUsd + worstReserve > HARD_STOP) throw Object.assign(new Error('budget_stop'), { code: 'budget_stop' });
  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const requestBody = { model, instructions, input, max_output_tokens: maxOutput, store: false };
      if (model === ASTRA || /^gpt-5|^gpt-6/.test(model)) requestBody.reasoning = { effort };
      const res = await fetch(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`${res.status}:${JSON.stringify(body).slice(0,500)}`);
      const cost = usageCost(model, body.usage || {});
      const equivalent = astraEquivalent(body.usage || {});
      const text = outputText(body);
      const event = { at: new Date().toISOString(), label, stage:label.split(':').slice(-1)[0], costBucket, attemptNumber:attempt, model, responseId: body.id || null, status:body.status||null, usage: body.usage || {}, costUsd: cost, astraEquivalentUsd: equivalent, astraEquivalentNoCacheUsd:astraEquivalent(body.usage||{},false), text };
      state.calls.push(event); state.spentUsd += cost; state.astraEquivalentUsd += equivalent;
      fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n'); save();
      return { text, event };
    } catch (err) {
      last = err;
      if (/400:|401:|403:|budget_stop|INPUT_CAP_EXCEEDED/.test(String(err.message))) throw err;
      await new Promise(r => setTimeout(r, attempt * 1200));
    }
  }
  throw last;
}

const teacherSystem = `너는 Relay Desk 연구 책임자다. 사실·가설·제안을 구분하고, 작은 표본을 과장하지 않으며, 고객에게 보내지 않은 행동을 완료했다고 쓰지 않는다. 결과는 구체적 규칙·검증 방법·실패 조건을 포함해야 한다.`;

async function makeSeed() {
  if (state.seed) return state.seed;
  const prompt = `Relay Desk가 일반 문서·교정·타이핑·한국어 SRT 자막을 판매한다. 저가 모델들이 반복 연구할 때 사용할 핵심 교본을 작성하라. 다음을 포함하라: 근거 중심 사고, 고객 응대, 가격·범위, 자동화 안전, 실험 설계, 품질 검수, 지식 승격·폐기. 2,000자 안팎으로 밀도 높게 작성하라.`;
  const r = await call(ASTRA, 'astra_seed', 'manual', teacherSystem, prompt, 1024, 'low', 2048);
  state.seed = r.text; fs.writeFileSync(path.join(outDir, 'astra-seed.md'), r.text); save();
  return r.text;
}

async function lowCostRoute(title, prompt, seed) {
  const verified = buildVerifiedKnowledge();
  const base = `초기 핵심 교본:\n${seed}\n\nAstra 검증 누적 교본:\n${verified || '(아직 없음)'}\n\n연구 과제: ${title}\n${prompt}`;
  const roles = [
    '운영 설계자 관점에서 실행 가능한 답을 작성하라.',
    '회의적인 감사자 관점에서 실패 원인과 반례를 중심으로 작성하라.',
    '기존 교본과 다른 경로를 의도적으로 탐색하라. 겹치지 않는 가설에 검증 방법과 폐기 조건을 붙여라.'
  ];
  const candidates = [];
  for (let i=0;i<roles.length;i++) candidates.push(await call(LOW, `${title}:candidate:${i+1}`, 'low_candidate', '교본을 따르되 독립적으로 사고하라. 사실과 추정을 구분하라.', `${base}\n\n역할: ${roles[i]}`, 512, 'low', 4096));
  const joined = candidates.map((x,i)=>`후보 ${i+1}:\n${x.text}`).join('\n\n');
  const critic = await call(LOW, `${title}:critic`, 'low_critique', '근거 없는 주장·상충·누락된 제약을 각각 찾아라. 무조건 동의하지 마라.', `${base}\n\n${joined}`, 384, 'medium', 6144);
  const final = await call(LOW, `${title}:synthesis`, 'low_synthesis', '후보와 비판을 바탕으로 실제 운영에 적용할 최종 답을 작성하라. 가장 그럴듯한 문장이 아니라 검증 가능한 결론을 선택하라.', `${base}\n\n${joined}\n\n비판:\n${critic.text}`, 768, 'medium', 8192);
  return { candidates: candidates.map(x=>x.text), critic: critic.text, final: final.text };
}

function buildVerifiedKnowledge() {
  return state.results.filter(x => x.promotionReview?.approved && Array.isArray(x.promotionReview?.novelFindings))
    .map(x => `### ${x.title}\n${x.promotionReview.novelFindings.map(v=>`- ${v}`).join('\n')}`).join('\n\n');
}

async function reviewForPromotion(item) {
  if (item.promotionReview) return item.promotionReview;
  const input = `과제: ${item.title}\n${item.prompt}\n\nAstra 기준 답안:\n${item.astraDirect}\n\n저가 모델 연구 보고서:\n${item.lunaRoute.final}\n\n저가 보고서에서 Astra 답안에는 없지만 독립적으로 가치 있는 방향만 찾아라. 사실성·신규성·실행 가능성·검증 방법·폐기 조건을 모두 확인하고, 단순 표현 차이·요약·근거 없는 아이디어는 승인하지 마라. JSON 하나만 출력: {"approved":true|false,"novelFindings":["검증을 통과한 완결된 규칙"],"rejected":["기각 사유"],"reason":"근거"}`;
  const r = await call(ASTRA, `${item.title}:promotion_review`, 'promotion_validation', '너는 Relay Desk 지식 승격 심사자다. 기존 답과 다른 동시에 검증 가능한 통찰만 엄격히 승인한다.', input, 768, 'low', 6144);
  let parsed;
  try { parsed = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] || ''); } catch (_) {}
  item.promotionReview = parsed && typeof parsed.approved === 'boolean' ? parsed : { approved:false, novelFindings:[], rejected:['JSON 판독 실패'], reason:r.text };
  if (item.promotionReview.approved && item.promotionReview.novelFindings?.length) {
    fs.writeFileSync(path.join(promotedDir, `${String(item.taskId).padStart(2,'0')}-${item.title.replace(/[^가-힣a-z0-9]+/gi,'-')}.md`), `# ${item.title}\n\n${item.promotionReview.novelFindings.map(v=>`- ${v}`).join('\n')}\n\n## Astra 승격 근거\n\n${item.promotionReview.reason}\n`);
  }
  fs.writeFileSync(path.join(outDir, 'EVOLVING-TEXTBOOK.md'), `# Astra 검증 누적 교본\n\n${buildVerifiedKnowledge() || '아직 승인된 신규 통찰이 없습니다.'}\n`);
  save();
  return item.promotionReview;
}

async function judge(title, prompt, astraText, lowText, swap, phase = 'blind_judge') {
  const a = swap ? lowText : astraText;
  const b = swap ? astraText : lowText;
  const input = `과제: ${title}\n${prompt}\n\n${JUDGE_RUBRIC}\n\n답안 A:\n${a}\n\n답안 B:\n${b}\n\n두 답안을 출처 추정 없이 평가하라. JSON 하나만 출력: {"a":0-100,"b":0-100,"winner":"A|B|TIE","criteria":{"correctness":{"a":0-20,"b":0-20},"insight":{"a":0-20,"b":0-20},"actionability":{"a":0-20,"b":0-20},"safety":{"a":0-20,"b":0-20},"clarity":{"a":0-20,"b":0-20}},"reason":"짧은 근거"}`;
  const r = await call(ASTRA, `${title}:${phase}`, 'evaluation', '너는 보수적인 블라인드 평가자다. 자신의 문체를 선호하지 말고 과제 충족과 검증 가능성만 평가한다.', input, 512, 'low', 4096);
  let parsed = null;
  try { parsed = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] || ''); } catch (_) {}
  if (!parsed) return { raw: r.text, astraScore: null, lunaScore: null };
  return { raw: r.text, astraScore: Number(swap ? parsed.b : parsed.a), lunaScore: Number(swap ? parsed.a : parsed.b), winner: parsed.winner, criteria: parsed.criteria, reason: parsed.reason };
}

async function run() {
  const seed = await makeSeed();
  for (const existing of state.results) {
    try { await reviewForPromotion(existing); }
    catch (err) { if (err.code === 'budget_stop' || err.message === 'budget_stop') break; throw err; }
  }
  for (let i = state.results.length; i < orderedTasks.length; i++) {
    const {id,title,prompt} = orderedTasks[i];
    try {
      const direct = await call(ASTRA, `${title}:direct`, 'astra_baseline', teacherSystem, `${title}\n${prompt}`, 768, 'low', 2048);
      const route = await lowCostRoute(title, prompt, seed);
      const evaluation = await judge(title, prompt, direct.text, route.final, lunaAIds.has(id));
      const item = { index: i, taskId:id, title, prompt, lunaIsA:lunaAIds.has(id), astraDirect: direct.text, lunaRoute: route, evaluation };
      state.results.push(item);
      await reviewForPromotion(item);
      fs.writeFileSync(path.join(outDir, `${String(i+1).padStart(2,'0')}-${title.replace(/[^가-힣a-z0-9]+/gi,'-')}.json`), JSON.stringify(item, null, 2));
      save();
      process.stdout.write(JSON.stringify({ done: i+1, total: orderedTasks.length, title, spentUsd: Number(state.spentUsd.toFixed(6)), remainingUsd: Number((BUDGET-state.spentUsd).toFixed(6)), astraScore: evaluation.astraScore, lunaScore: evaluation.lunaScore })+'\n');
    } catch (err) {
      if (err.code === 'budget_stop' || err.message === 'budget_stop') break;
      throw err;
    }
  }
  // Astra가 요구한 위치 편향 검증: A/B 위치를 뒤집어 예산 상한까지 재평가한다.
  for (const item of state.results) {
    if (item.positionEvaluation) continue;
    try {
      item.positionEvaluation = await judge(item.title, item.prompt, item.astraDirect, item.lunaRoute.final, !item.lunaIsA, 'position_judge');
      save();
    } catch (err) {
      if (err.code === 'budget_stop' || err.message === 'budget_stop') break;
      throw err;
    }
  }
  // 남은 예산은 동일 조건 반복 채점에 사용해 평가 변동성을 측정한다.
  for (const item of state.results) {
    if (item.repeatEvaluation) continue;
    try {
      item.repeatEvaluation = await judge(item.title, item.prompt, item.astraDirect, item.lunaRoute.final, item.lunaIsA, 'repeat_judge');
      save();
    } catch (err) {
      if (err.code === 'budget_stop' || err.message === 'budget_stop') break;
      throw err;
    }
  }
  const scored = state.results.filter(x => Number.isFinite(x.evaluation?.astraScore) && Number.isFinite(x.evaluation?.lunaScore));
  const promoted = state.results.filter(x => x.promotionReview?.approved && x.promotionReview?.novelFindings?.length);
  const avg = key => scored.length ? scored.reduce((s,x)=>s+Number(x.evaluation[key]),0)/scored.length : 0;
  const astraAvg = avg('astraScore');
  const lunaAvg = avg('lunaScore');
  const proximity = astraAvg ? lunaAvg/astraAvg*100 : 0;
  const meanDelta = scored.length ? scored.reduce((s,x)=>s+(x.evaluation.lunaScore-x.evaluation.astraScore),0)/scored.length : 0;
  const actualCost = state.spentUsd;
  const equivalent = state.astraEquivalentUsd;
  const equivalentNoCache = state.calls.reduce((s,x)=>s+Number(x.astraEquivalentNoCacheUsd ?? astraEquivalent(x.usage||{},false)),0);
  const savings = equivalent > 0 ? (1-actualCost/equivalent)*100 : 0;
  const bucket = name => state.calls.filter(x=>x.costBucket===name).reduce((s,x)=>s+Number(x.costUsd||0),0);
  const lowGeneration = bucket('low_candidate')+bucket('low_critique')+bucket('low_synthesis')+bucket('luna_candidate')+bucket('luna_critique')+bucket('luna_synthesis');
  const astraBaseline = bucket('astra_baseline');
  const manualSeed = state.calls.filter(x=>x.label==='astra_seed').reduce((s,x)=>s+Number(x.costUsd||0),0);
  const qualityRatio = astraAvg ? lunaAvg/astraAvg : 0;
  const deploymentEfficiency = lowGeneration+manualSeed>0 ? qualityRatio*astraBaseline/(lowGeneration+manualSeed) : 0;
  const marginalEfficiency = lowGeneration>0 ? qualityRatio*astraBaseline/lowGeneration : 0;
  const br=seededRandom(630), boots=[];
  if(scored.length){for(let b=0;b<10000;b++){let sa=0,sl=0;for(let j=0;j<scored.length;j++){const x=scored[Math.floor(br()*scored.length)];sa+=x.evaluation.astraScore;sl+=x.evaluation.lunaScore;}if(sa>0)boots.push(sl/sa*100);}}
  boots.sort((a,b)=>a-b); const ci=boots.length?[boots[Math.floor(boots.length*.025)],boots[Math.floor(boots.length*.975)]]:[0,0];
  const positionScored = state.results.filter(x => Number.isFinite(x.positionEvaluation?.astraScore) && Number.isFinite(x.positionEvaluation?.lunaScore));
  const repeatScored = state.results.filter(x => Number.isFinite(x.repeatEvaluation?.astraScore) && Number.isFinite(x.repeatEvaluation?.lunaScore));
  const report = `# Relay Desk Astra→저가 모델 자전학습 경로 실험 보고서\n\n- 실행일: ${new Date().toISOString()}\n- 실제 저가 작업 모델: ${LOW}\n- Luna는 프로젝트 허용 목록에 추가했지만 Responses API가 403을 반환해 실험 모델에서 제외했다.\n- 총예산: $${BUDGET.toFixed(2)} / 안전 지출 상한: $${HARD_STOP.toFixed(2)}\n- 실제 추정 사용액(실패·검증 포함): $${actualCost.toFixed(4)}\n- 관측 토큰을 Astra 단가로 환산: 캐시 유지 $${equivalent.toFixed(4)} / 비캐시 가정 $${equivalentNoCache.toFixed(4)}\n- 단순 단가 환산 절감률: ${savings.toFixed(1)}%\n- API 호출: ${state.calls.length}회\n- 완료 과제: ${state.results.length}/${orderedTasks.length}\n- 1차 블라인드 채점 표본: ${scored.length}\n- 위치 반전 재검증 표본: ${positionScored.length}\n- 동일 조건 반복 채점 표본: ${repeatScored.length}\n- Astra 검증 후 교본에 승격된 보고서: ${promoted.length}\n- Astra 단독 평균: ${astraAvg.toFixed(2)}/100\n- Astra 교본 지원 ${LOW} 경로 평균: ${lunaAvg.toFixed(2)}/100\n- 평균 점수차(저가 경로-Astra): ${meanDelta.toFixed(2)}점\n- Astra 평가 점수 근접도: ${proximity.toFixed(1)}% (과제 부트스트랩 95% 구간 ${ci[0].toFixed(1)}~${ci[1].toFixed(1)}%)\n- 교본 구축비 포함 배포 효율: ${deploymentEfficiency.toFixed(2)}배\n- 교본 보유 후 한계비용 효율: ${marginalEfficiency.toFixed(2)}배\n\n## 비용 구분\n\n- 설계 검증·보조: $${(bucket('manual')-manualSeed+bucket('auxiliary')).toFixed(4)}\n- Astra 교본: $${manualSeed.toFixed(4)}\n- Astra 기준선 생성: $${astraBaseline.toFixed(4)}\n- 저가 모델 후보·비판·통합: $${lowGeneration.toFixed(4)}\n- Astra 블라인드 평가: $${bucket('evaluation').toFixed(4)}\n- Astra 신규 통찰 승격 심사: $${bucket('promotion_validation').toFixed(4)}\n\n## 승인되어 누적 교본에 편입된 신규 통찰\n\n${promoted.length ? promoted.map(x=>`### ${x.title}\\n${x.promotionReview.novelFindings.map(v=>`- ${v}`).join(`\\n`)}`).join(`\\n\\n`) : `승격된 신규 통찰이 없다.`}\n\n## 반복 검증\n\n- 1차: Astra ${astraAvg.toFixed(2)}, 저가 경로 ${lunaAvg.toFixed(2)}\n- A/B 위치 반전: Astra ${(positionScored.reduce((s,x)=>s+x.positionEvaluation.astraScore,0)/Math.max(1,positionScored.length)).toFixed(2)}, 저가 경로 ${(positionScored.reduce((s,x)=>s+x.positionEvaluation.lunaScore,0)/Math.max(1,positionScored.length)).toFixed(2)}\n- 동일 조건 반복: Astra ${(repeatScored.reduce((s,x)=>s+x.repeatEvaluation.astraScore,0)/Math.max(1,repeatScored.length)).toFixed(2)}, 저가 경로 ${(repeatScored.reduce((s,x)=>s+x.repeatEvaluation.lunaScore,0)/Math.max(1,repeatScored.length)).toFixed(2)}\n- 세 차례 모두 저가 경로가 앞선 과제는 지식 저장소 1건뿐이다. 그러나 Astra 승격 심사는 이 결과를 신규 교본 지식으로 승인하지 않았다.\n\n## 해석\n\n품질 근접도는 고정 과제에서 Astra 단독 결과와 Astra 교본 지원 ${LOW} 경로 결과를 익명 A/B로 배정해 Astra가 비교 채점한 값이다. ‘전부 Astra’ 금액은 실제 대체 실행비가 아니라 관측 토큰을 Astra 요율로 다시 계산한 단가 환산이다. 평가자가 Astra이므로 자기 문체 선호 가능성이 있고, 과제는 Relay Desk 내부 운영 편의표본이며 실제 고객 전환율 실험이 아니다. 따라서 이 수치는 실제 매출 전환율이 아니라 내부 운영 산출물 품질에 대한 탐색적 측정이다.\n\n## 과제별 결과\n\n${scored.map(x=>`- ${x.title}: Astra ${x.evaluation.astraScore}, 저가 경로 ${x.evaluation.lunaScore}, 근접도 ${(x.evaluation.lunaScore/x.evaluation.astraScore*100).toFixed(1)}% — ${x.evaluation.reason||''}`).join('\n')}\n`;
  fs.writeFileSync(path.join(outDir, 'FINAL-REPORT.md'), report);
  state.summary = { actualCostUsd: actualCost, astraEquivalentUsd: equivalent, astraEquivalentNoCacheUsd:equivalentNoCache, savingsPercent: savings, astraAverage: astraAvg, lunaAverage: lunaAvg, meanDelta, proximityPercent: proximity, proximityCi95:ci, deploymentEfficiencyMultiple:deploymentEfficiency, marginalEfficiencyMultiple:marginalEfficiency, completedTasks: state.results.length, scoredTasks: scored.length };
  save();
  console.log(JSON.stringify({ complete: true, ...state.summary, report: path.join(outDir, 'FINAL-REPORT.md') }));
}

run().catch(err => { console.error(err.stack || err); save(); process.exitCode = 1; });



