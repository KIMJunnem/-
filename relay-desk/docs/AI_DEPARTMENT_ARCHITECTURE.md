# Relay Desk SWAN AI Department Architecture v1

## 목적

상위 모델을 상시 작업자로 사용하지 않고 Teacher/Director/감사관으로 제한하면서, 검증된 업무를 Student·규칙 엔진·로컬 도구로 단계적으로 이관한다.

## 구현된 계층

- `server/config/swan-teams.json`: Department Registry, 파이프라인, 기본 예산.
- `server/config/swan-model-roles.json`: 모델 역할 Alias, Shadow/승격/캐시/승격 조건.
- `server/swan-ai-os.js`: 부서 오케스트레이터.
- `server/swan-model-router.js`: 중앙 모델 호출·fallback·사용량 원가 기록.
- `server/swan-cost-router.js`: local/cache/rule/student/teacher 선택 규칙.
- `server/swan-team-store.js`: Job Shared State와 공용 지식·아티팩트 색인.
- `server/swan-handoff.js`: 부서 간 구조화 Handoff.
- `server/swan-learning.js`: Gold Sample, Shadow 비교, 부서 Metrics, Student 승격.
- `server/swan-ai-cache.js`: 입력/역할/모델/컨텍스트 지문 기반 캐시.
- `server/swan-cost-ledger.js`: job/department/provider별 비용 장부.
- 기존 `server/video-worker.js`: 영상 로컬 실행 계층.

## Job 저장 구조

`server/data/swan-ai-os/jobs/{JOB_ID}/`

- job.json
- intake.json
- facts.json
- requirements.json
- unknowns.json
- risk.json
- decisions.json
- handoff.json
- artifacts.json
- qc.json
- history.json
- costs.jsonl

전역 공유 자산은 `server/data/swan-ai-os/` 아래 knowledge/artifacts/cache/learning으로 분리한다.

## 부서

접수(intake), 견적·상담(sales), 문서(document), 자막·번역(subtitle), 영상(video), 크리에이티브(creative), 개발(engineering), 조사(research), 비용(finance), 품질(qa), 납품준비(delivery), 운영총괄(ops).

## 핵심 원칙

1. raw conversation은 접수에서만 읽고 후속 부서는 구조화 상태를 사용한다.
2. 코드/규칙/캐시/Gold/Student/Teacher 순서로 비싼 호출을 늦춘다.
3. 영상 메타데이터·전사·컷·렌더·기계 QC는 로컬 Video Worker 우선이다.
4. 외부 고객 전달은 SWAN AI OS가 하지 않는다. 기존 결제/승인/중복 방지 흐름을 유지한다.
5. 새 업무 유형은 Teacher가 먼저 수행한다.
6. Gold Sample은 QC 통과 후에만 기본적으로 생성된다.

## 기존 Relay Desk 통합

`relay-server.js`에 로컬 `/api/swan/*` API를 추가했다. 기존 숨고/크몽/queue 흐름을 즉시 교체하지 않고 별도 계층으로 도입한다. 유료 모델 실행은 로컬 요청 + `x-relay-admin: swan-ai-os` + `allowPaid:true`를 요구한다.

## 아직 미완성

- 기존 모든 provider 호출을 강제로 SWAN Router로 통과시키는 전면 마이그레이션은 하지 않았다. 기존 운영 경로를 깨지 않기 위한 점진 전환 상태다.
- UI 관리 화면은 아직 없다.
- 주관적 Shadow 평가용 별도 Evaluator 호출은 기본 비활성이다.
- 생성형 미디어 Provider Router는 인터페이스 설계 단계이며 실제 Higgsfield/Runway 호출은 기존 Video Worker 범위 밖이다.
