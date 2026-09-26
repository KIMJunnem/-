# ECC에서 Relay Desk로 선별 도입한 패턴

기준일: 2026-09-27

원본 프로젝트: `affaan-m/ECC`  
검토 기준 커밋: `e482e579415fde18357cafce70f177ae19fd7f03`  
라이선스: MIT — Copyright (c) 2026 Affaan Mustafa

이 문서는 ECC 전체를 설치하거나 복제하지 않고, Relay Desk와 직접 맞는 설계 패턴만 자체 구현으로 선별 도입한 범위를 기록한다.

## 도입한 것

### 1. 신뢰도·근거 기반 학습 후보

참고한 ECC 영역:
- `skills/continuous-learning-v2/`

도입:
- 학습 후보마다 `scope`, `evidenceKinds`, `confidence`, `promotion` 기록
- 합성 시뮬레이션 반복만으로는 운영 지식으로 승격하지 않음
- 회귀 테스트·실제 고객·사람 검토 같은 독립 근거가 함께 있어야 검토 후보가 됨
- 고객응대 서비스별 scope를 분리해 다른 업무로 오염되는 것을 줄임

Relay Desk 구현:
- `server/learning-ledger.js`
- `server/customer-simulator.js`

### 2. Eval 중심 반복 측정

참고한 ECC 영역:
- `skills/eval-harness/`
- `skills/agent-harness-construction/`

도입:
- 합성 고객의 `pass@1`
- 고객 유형별 통과율
- 코드 지문별 연속 무실패 횟수
- deterministic guard probe와 고객 시나리오 평가를 분리

목적은 “많이 시뮬레이션했다”가 아니라 실제로 회귀율과 안정성이 좋아지는지 측정하는 것이다.

### 3. 반복 루프 churn 방지

참고한 ECC 영역:
- `skills/continuous-agent-loop/`
- `skills/autonomous-loops/`

도입:
- 같은 코드에서 새 문제가 없는 실행이 3회 연속이면 기본 반복 간격을 2배
- 6회 연속이면 최대 4배
- 코드 지문이 바뀌면 다시 기본 간격부터 검사
- 하드 실패나 새로운 학습 후보가 생기면 안정 streak를 중단

즉 계속 같은 테스트를 같은 빈도로 무한 반복하지 않는다.

### 4. Rollout 결정 원장

참고한 ECC 영역:
- `skills/recursive-decision-ledger/`

도입:
- 실행마다 `rolloutId`
- 직전 실행 상태
- 새 정보
- 시험 수
- 상위 학습 후보
- coherence mark
- promotion gate

를 append-only JSONL로 기록한다.

파일:
- `server/data/customer-simulation-decisions.jsonl` (Git 제외)

시뮬레이션의 자신감은 실제 운영 변경 권한이 아니다. 원장에는 `livePromotionAllowed=false`를 고정한다.

### 5. 비용 인지형 복잡도 라우팅 — shadow

참고한 ECC 영역:
- `skills/cost-aware-llm-pipeline/`

도입:
- 문맥 길이
- 첨부
- 긴급성
- 제작/납품/결제 등 고위험 lane
- 구현 작업
- 이전 실패
- 모호성

을 이용해 `cheap | mid | top` 추천 등급과 복잡도 점수를 기록한다.

현재는 **shadow metadata**일 뿐 실제 모델을 자동으로 바꾸지 않는다. 실제 작업 비용/품질 데이터를 모은 뒤 별도 검증을 통과해야 활성화한다.

### 6. 발송 직전 정확한 답변 내용 고정

참고한 ECC 영역:
- `skills/operator-approval-loop/`

Relay Desk의 기존 idempotency/claim/supersede/delivery 상태 구조는 유지하고, 안전한 일부만 적용했다.

- 고객에게 보낼 준비가 끝난 답변의 SHA-256 저장
- 대화방/메시지 좌표와 response epoch 저장
- 완료 후 답변이 변조되거나 바뀌면 outbox에서 제외
- hash binding이 깨진 상태에서는 `sent` 기록도 거절

현재 자동발송 정책 자체를 새로 승인제로 바꾼 것은 아니다. 목적은 **승인/완료된 텍스트와 실제 발송 텍스트가 달라지는 stale-draft 문제**를 막는 것이다.

## 아직 가져오지 않은 것

### ECC 전체 플러그인/Hook 설치

현재 Relay Desk에는 자체:
- 대기열
- 자동업데이트
- 안전장치
- 비용 한도
- 회귀 테스트
- 고객응대 라우팅
- 자율 시뮬레이션

이 이미 존재한다.

ECC 전체를 겹쳐 설치하면 hook/skill/agent 중복과 실행 순서 충돌 가능성이 있으므로 지금은 설치하지 않는다. 데스크톱 Work/Codex에서 실제 로컬 환경을 점검할 수 있을 때 dry-run부터 검토한다.

### GateGuard 전체

좋은 패턴이지만 현재 운영 서버에 외부 hook 시스템을 추가하지 않았다. 코드 변경은 기존 GitHub 브랜치 → 회귀시험 → 실패 시 자동 원복 경로를 유지한다.

### Content-hash 결과 캐시

Relay Desk는 이미 영상/파일 SHA를 일부 쓰고 있지만, 첨부 판독 결과 전체를 캐시하는 계층은 아직 넣지 않았다. 같은 고객 파일 재판독의 실제 비용 표본이 쌓인 뒤 추가하는 편이 낫다.

### ECC의 가격표/모델명

ECC 문서의 모델 가격과 모델 예시는 Relay Desk 운영 사실로 가져오지 않는다. 가격·모델 ID는 각 제공자의 공식 현재 문서와 Relay Desk 실제 계정 상태를 별도로 확인한다.

## 출처와 라이선스

ECC는 MIT License다. 이 구현은 ECC 문서에서 얻은 설계 아이디어를 Relay Desk 구조에 맞춰 다시 구현했다.

원 라이선스:
- `affaan-m/ECC/LICENSE`
- MIT License
- Copyright (c) 2026 Affaan Mustafa

ECC 원본 코드나 문서를 실질적으로 복사하는 변경을 이후 추가한다면 해당 소스 파일 또는 배포물에 필요한 MIT 저작권/허가 고지를 함께 유지한다.
