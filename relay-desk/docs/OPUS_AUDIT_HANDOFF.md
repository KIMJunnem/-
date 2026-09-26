# Opus 5.5 Audit Handoff

기준: SWAN AI Department / Teacher-Student v1

## 오늘 실제 구현한 것

- Department Registry 및 서비스별 pipeline
- Model Role Registry / 역할 Alias
- 중앙 Model Router와 Provider fallback
- Cost Router
- per-job shared state 디렉터리
- 구조화 Handoff
- 공용 Knowledge / 기존 Relay state·artifact 색인
- AI response cache
- per-job cost ledger
- Gold Sample Store
- Shadow Simulation
- Teacher vs Student deterministic comparator
- Department Metrics
- Student Promotion Level 0~5
- 자동 승격 상한 Level 3
- Escalation flags
- 기존 Video Worker 호출 연결
- relay-server local API 통합
- 기존 OpenAI/Claude/Gemini 호출 함수 adapter 연결
- unit test 및 CI 정의
- 부서별 Playbook
- 운영 문서

## 설계 선택

기존 숨고/크몽 production flow를 한 번에 교체하지 않고 `/api/swan/*` 별도 계층으로 추가했다. 이유는 실제 매출 흐름을 깨뜨리는 migration risk가 비용 절감 효과보다 크기 때문이다.

유료 모델 호출은 local-only + admin header + allowPaid=true를 요구한다. 기존 automaticPaidCallsPaused 정책을 우회해 백그라운드에서 몰래 과금하지 않도록 수동 진입점에 한정한다.

Teacher 후보는 오늘 GPT 중심으로 GPT-6 Astra를 앞에 두고 Claude Opus 5.5를 fallback으로 등록했다. 내일 감사 결과에 따라 순서를 config만 수정해 변경할 수 있다.

## 아직 미완성

1. 기존 모든 레거시 AI 호출을 Model Router로 강제 통합하지 않았다.
2. Gold Sample에서 자동으로 deterministic rule을 생성·승격하는 기능은 없다.
3. 주관적 Shadow Evaluator는 비활성이다.
4. 생성형 미디어 provider auto-router의 실제 외부 Provider 어댑터는 미구현이다.
5. 대시보드 전용 UI는 미구현이다.
6. 실제 고객 성공/수정률을 metrics에 자동 연결하는 작업은 후속이다.
7. Gold Sample의 자유형 JSON 내부 모든 개인정보 유형을 완벽히 비식별화한다고 보장하지 않는다. 현재 이메일/휴대폰 패턴 마스킹이 구현되어 있다.

## 비용 발생 지점

- Model Router가 Local/Rule로 해결하지 못한 department call
- Teacher 실전 호출
- Student Shadow 호출
- 승격 초기 단계의 Teacher 검수

Video Worker, faster-whisper, FFmpeg, finance/delivery gate는 API 비용 0원이다.

## Teacher 호출 조건

new task type, rule conflict, ambiguous requirements/price, QC failure, repeated Student failure, high value order, safety/legal, complaint, provider disagreement, low confidence.

## Student 승격

정량 기준 + safety error 0 + rework rate를 요구하며 자동 승격은 Level 3까지만이다. Level 4/5는 수동 승인.

## Shadow

Teacher 결과와 Student 결과를 고객 전송 전에 분리 저장한다. 구조화 결과는 deterministic field comparison을 우선한다. subjective text는 자동 승격 근거로 과신하면 안 된다.

## 검수 요청 체크리스트

1. 부서가 과도하게 세분화됐는가?
2. 책임이 중복되거나 빠진 부서가 있는가?
3. local/cache/rule 전에 AI가 호출되는 경로가 있는가?
4. 같은 사실을 여러 부서가 다시 읽는가?
5. Teacher 강제 조건이 너무 넓거나 좁은가?
6. 승격 threshold가 충분히 보수적인가?
7. text Jaccard 비교가 잘못된 자신감을 만들 위험이 있는가?
8. 규칙 평가와 AI 평가의 경계가 적절한가?
9. cache TTL/context fingerprint가 잘못된 과거 판단을 재사용할 위험이 있는가?
10. Gold Sample 비식별화 범위가 충분한가?
11. Student rollout이 고객 품질을 해칠 수 있는 지점은 어디인가?
12. Provider 장애 시 fallback과 budget cap이 함께 안전하게 동작하는가?
13. Handoff 필드가 각 부서에 충분한가?
14. fallback 순서와 모델 단가가 현재 시점에 적절한가?
15. 새 모델 추가 시 config 변경만으로 충분한가?
16. 기존 relay-server manual paid trigger와 SWAN API의 결합이 과금 안전성에 문제없는가?
17. 기존 production flow를 Router로 옮길 최적 migration 순서는 무엇인가?

## 테스트 상태

CI에서 다음을 확인하도록 정의했다.

- SWAN unit test
- 기존 video worker test
- relay-server.js syntax check

최종 감사 시 GitHub Actions 결과와 실제 로컬 3700X FFmpeg/faster-whisper 환경 테스트를 함께 확인할 것.
