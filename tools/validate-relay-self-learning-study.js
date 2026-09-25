'use strict';
const fs = require('fs');
const path = require('path');

const key = String(process.env.OPENAI_API_KEY || '').trim();
if (!key) throw new Error('OPENAI_API_KEY is required');
const outDir = path.resolve(__dirname, '..', 'server', 'data', 'self-learning-study-20260921');
fs.mkdirSync(outDir, { recursive: true });
const outputFile = path.join(outDir, 'astra-design-validation.json');
const priorAttempt = fs.existsSync(outputFile) ? JSON.parse(fs.readFileSync(outputFile, 'utf8')) : null;
if (priorAttempt && String(priorAttempt.text || '').trim()) {
  console.log(fs.readFileSync(outputFile, 'utf8'));
  process.exit(0);
}

const design = `
예산: 총 $6.30. 모든 실제 호출 비용을 이 예산에 포함하고 $6.27에서 하드 스톱.
모델 단가: gpt-6-astra 입력 $10/MTok, 캐시 $1/MTok, 출력 $50/MTok. gpt-5.6-luna 입력 $0.20/MTok, 캐시 $0.02/MTok, 출력 $1.20/MTok.

실험 구조:
1) Astra 1회가 Relay Desk 연구 핵심 교본을 작성한다.
2) 36개 운영 과제를 고정한다.
3) 각 과제에서 Astra 단독 답안을 만든다.
4) Luna는 같은 과제와 교본을 읽고 서로 다른 역할의 후보 3개를 병렬 생성한다.
5) Luna 1회가 후보의 오류·중복·근거 부족을 비판한다.
6) Luna 1회가 후보와 비판을 통합하여 최종 답안을 만든다.
7) Astra가 답안 출처를 모르는 A/B 순서를 번갈아 받아 correctness·insight·actionability·safety·clarity 각 20점으로 블라인드 채점한다.
8) 실제 각 응답의 usage 입력·캐시·출력 토큰으로 실제 비용을 계산한다.
9) 모든 호출 토큰을 Astra 단가로 재계산하여 ‘전부 Astra였다면’ 비용을 추정한다.
10) Luna 경로 평균/Astra 단독 평균을 품질 근접도로, 점수/비용 비율의 상대값을 효율 배수로 보고한다.
11) 고객 발송·가격 변경·봇 조작은 하지 않고 연구 파일만 저장한다.
12) 응답 ID, 토큰, 비용, 과제별 원문, 채점 결과를 저장하며 재시작 시 완료된 과제 다음부터 이어간다.

현재 구현상 우려:
- Astra가 자신의 답안을 채점하므로 자기 문체 선호 가능성.
- budget preflight가 max_output 비용과 $0.01 입력 여유만 예약.
- 후보 3개가 같은 교본과 과제를 읽어 상관 오류 가능성.
- ‘동일 토큰 전부 Astra’는 같은 품질을 보장하는 비용이 아니라 단순 단가 환산.
- 36개 과제는 Relay Desk 설계자가 작성하여 선택 편향이 있을 수 있음.
`;

const prompt = `너는 이 실험을 실행하기 전 검증하는 연구 방법론 책임자다. 아래 설계가 사용자의 질문—“$6.30을 다 썼을 때 전부 Astra로 했으면 얼마였고, 결과는 Astra에 얼마나 근접했으며 효율이 몇 배였는가”—에 답할 수 있는지 검토하라.

${design}

반드시 다음 형식으로 답하라.
1. 실행 승인 여부: 승인 / 조건부 승인 / 거부
2. 치명적 문제
3. 실행 전 필수 수정
4. 권장 수정
5. 올바른 계산식
6. 예산 중단 조건
7. 결과 보고 시 반드시 밝힐 한계

모호한 조언 대신 바로 코드에 반영할 수 있는 값과 규칙을 제시하라.`;

(async () => {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-6-astra',
      instructions: '사실과 추정을 구분하고 연구 설계의 타당성·비용 통제·평가 편향을 보수적으로 검토한다.',
      input: prompt,
      max_output_tokens: 3500,
      reasoning: { effort: 'low' },
      store: false
    })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body).slice(0,500)}`);
  const text = body.output_text || (body.output || []).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text||'').join('\n');
  const usage = body.usage || {};
  const input = Number(usage.input_tokens || 0), cached = Number(usage.input_tokens_details?.cached_tokens || 0), output = Number(usage.output_tokens || 0);
  const costUsd = ((input-cached)*10 + cached*1 + output*50)/1e6;
  const result = { model: 'gpt-6-astra', responseId: body.id || null, usage, costUsd, text, priorAttempt, totalValidationCostUsd: costUsd + Number(priorAttempt?.costUsd || 0), createdAt: new Date().toISOString() };
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
