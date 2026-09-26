# Model Routing

## Alias

- teacher_reasoning
- teacher_creative
- worker_reasoning
- worker_writing
- worker_translation
- cheap_classifier
- cheap_writer
- local_tool

모델 이름은 `server/config/swan-model-roles.json`에서만 관리한다.

## 현재 기본 후보

Teacher는 GPT-6 Astra를 우선 후보로 두고 Claude Opus 5.5를 fallback 후보로 둔다. Worker는 GPT-5.6 계열, Gemini Flash Lite, Claude Haiku 계열을 역할별 후보로 둔다. 실제 사용 가능 여부는 API 키/쿼터/쿨다운을 기존 Relay Desk 상태에서 확인한다.

## 중앙 호출

새 부서 코드는 Provider API를 직접 호출하지 않는다.

`callModel({ role, department, jobId, prompt, flags })`

흐름:
1. 역할 후보 로드
2. 사용 가능한 Provider 필터
3. 캐시 확인
4. 모델 호출
5. retry가 아니라 Provider fallback 가능한 오류만 다음 후보로 이동
6. 실제 usage 기반 비용 기록
7. 응답 캐시 저장

## Teacher 승격

다음 플래그는 Teacher를 강제한다.

- new_task_type
- rule_conflict
- requirements_ambiguous
- price_ambiguous
- qc_failed
- student_repeat_failure
- high_value_order
- safety_or_legal
- customer_complaint
- provider_disagreement
- confidence < 0.85

고액 기준 기본값은 300,000원이며 config에서 변경한다.

## Provider 장애

429/quota/rate/timeout/5xx/key_missing/temporarily unavailable 계열만 다른 후보로 fallback한다. 의미 오류·검증 실패는 자동으로 다른 모델을 반복 호출하지 않는다.
