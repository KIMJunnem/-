# Teacher → Student Shadow Learning

## 원칙

Shadow 결과는 고객에게 전달하지 않는다. Teacher가 실전 결과를 만든 경우 Student가 동일 구조화 입력을 받아 별도 실행하고 비교한다.

## 비교

1차는 deterministic comparator다.

구조화 JSON:
- flattened field exact match
- required field recall

비구조화 text:
- token Jaccard를 참고값으로 기록
- subjective=true로 표시

주관적 별도 Evaluator 모델은 현재 기본 비활성이다. 평가 비용이 실제 절감액을 넘지 않게 하기 위해서다.

## 승격

LEVEL 0: Shadow only
LEVEL 1: Student 실전 10%, Teacher 검수 100%
LEVEL 2: Student 실전 30%, Teacher 검수 100%
LEVEL 3: Student 실전 70%, Teacher 표본 검수
LEVEL 4: 기본 Student, 예외 Teacher
LEVEL 5: Teacher는 새 업무/예외/감사 위주

자동 승격 상한은 LEVEL 3이다. LEVEL 4/5는 사람이 명시적으로 승인해야 한다.

기본 최소 기준:
- L1: 20 samples, decision match 95%, required field recall 97%, safety error 0
- L2: 50 / 97% / 98% / safety 0
- L3: 100 / 98% / 99% / safety 0
- L4: 200 / 99% / 99.5% / safety 0
- L5: 500 / 99.5% / 99.8% / safety 0

rework rate 제한도 단계별로 적용한다.

## Gold Sample

QC passed 상태가 기본 전제다.

`learning/gold-samples/{department}/{case-id}/`
- input.json
- context.json
- teacher_output.json
- evaluation.json
- lessons.json
- optional final artifact

이메일/휴대전화 패턴은 저장 전에 마스킹한다.

## Playbook

정적 운영 기준은 `relay-desk/playbooks/*.md`에 둔다. Teacher의 lessons는 우선 candidate knowledge로 저장하고, 검증 없이 소스 Playbook을 자동 수정하지 않는다.
