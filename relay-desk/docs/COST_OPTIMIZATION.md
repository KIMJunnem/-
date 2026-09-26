# Cost Optimization

## Cost Router 순서

1. Local tool 가능 여부
2. 동일 컨텍스트 캐시
3. 검증된 규칙/Playbook
4. 승격된 Student
5. Worker
6. Teacher

현재 구현은 local/rule/student/teacher 선택과 모델 응답 캐시를 제공한다. Gold Sample 자체를 deterministic answer로 바로 실행하는 자동 룰 변환은 다음 단계다.

## Job 예산

기본:
- job budget: USD 5
- max provider calls: 12
- high value escalation: KRW 300,000

Job 생성 시 덮어쓸 수 있다.

`costs.jsonl`에는 department/role/provider/model/tokens/cost/cache/shadow/response id를 기록한다.

## 핵심 지표

현재 장부에서 계산:
- total cost
- provider calls
- teacher calls
- shadow calls
- department cost

Shadow Metrics에는:
- samples
- decision match
- required field recall
- safety errors
- rework rate
- level

향후 고객 결과 데이터와 연결해 cost per successful/delivered job, customer revision rate까지 계산한다.

## 캐시 안전장치

cache key에는 registry version, role, department, provider/model, prompt hash, context fingerprint가 포함된다. safety/legal, payment/refund dispute, new task type 플래그는 캐시 금지 대상으로 설정한다. TTL 기본 24시간이다.

## 비용 절감이 실패인 경우

단순 호출비가 낮아져도 rework/수정/승격률이 증가하면 Student 승격 조건을 통과하지 못한다.
