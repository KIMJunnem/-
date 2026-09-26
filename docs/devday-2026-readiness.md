# OpenAI DevDay 2026 대비 선행 배선

기준일: 2026-09-26

이 문서는 DevDay 전 유출·정황만으로 운영 서버가 깨지지 않도록, 아직 공식 확정되지 않은 기능을 **비활성 상태로 미리 연결**한 범위를 기록한다.

## 현재 준비된 것

### 1. 서비스 티어 라우팅
Relay Desk 내부 표준값:

- `standard`
- `fast`
- `ultrafast`

각 작업의 `promptPost`, 실행 경과, 결과물, 비용 기록에 `serviceTier`와 `routing` 메타데이터를 남길 수 있다.

현재 정책은 `futureRouting.mode = "shadow"`다. 따라서 티어를 계산·기록하지만 **OpenAI API 요청 본문은 바꾸지 않는다.**

공식 문서에서 실제 API 필드와 값이 확인된 뒤에만 아래를 전환한다.

1. `futureRouting.serviceTier.providerPassthrough.field`를 공식 필드명과 대조한다.
2. `mapping` 값을 공식 허용값과 대조한다.
3. `mode`를 `active`로 변경한다.
4. `providerPassthrough.enabled`를 `true`로 변경한다.
5. 작은 합성 요청 1건으로 API 2xx와 사용량 기록을 확인한다.
6. 그 뒤 실제 고객 작업에 적용한다.

`ultrafastEnabled`가 false인 동안 ultrafast 요청은 fast로 자동 강등된다.

## 2. 상시형 에이전트용 capability 슬롯

미리 만든 필드:

- `persistentAgent`
- `externalIdentity`
- `emailAction`

모두 기본 비활성이다.

`persistentAgent.role = "router_only"`를 기본값으로 두어, 상시형 에이전트가 나와도 처음에는 작업 생성 모델이 아니라 **감지·라우팅·상태관리 역할**만 맡기는 구조다.

`externalIdentity`는 별도 이메일/외부 정체성이 실제 제품 기능으로 확인될 경우를 위한 자리다. 현재 identifier는 null이다.

`emailAction`은 읽기/초안/전송을 따로 구분한다. 외부 전송은 설정값과 관계없이 승인 게이트를 유지한다.

## 3. 비용 계측

`usageLedger.providers.<provider>.byServiceTier`에 다음을 별도로 누적한다.

- requests
- tokens
- estimatedCostUsd
- lastAt

실제 결과물의 `productionCost`에도 `serviceTier`를 남긴다.

따라서 새 티어가 실제 출시되면 같은 업무를 standard/fast/ultrafast로 나눠 다음을 비교할 수 있다.

- 주문 1건당 AI 비용
- 주문 1건당 총 토큰
- 완료 시간
- 재시도/수정 횟수
- 최종 QA 통과율

## 4. 활성화 전 금지

공식 확인 전에는 다음을 하지 않는다.

- 미확인 `service_tier` 값을 OpenAI API에 전송
- ultrafast를 자동 기본값으로 지정
- 상시 에이전트에 고객 메시지 자동 전송 권한 부여
- 외부 이메일 전송 승인 생략
- 새 요금제/크레딧 구조를 현재 비용표에 확정값으로 반영

## 5. DevDay 직후 체크 순서

1. OpenAI 공식 API 문서에서 실제 모델 ID·서비스 티어 필드·가격 확인
2. Work/Codex/ChatGPT의 사용량 풀이 같은지 확인
3. 상시 에이전트가 앱 종료 뒤에도 지속되는지 확인
4. 외부 identity/email 권한 범위 확인
5. 컴퓨터 조작/플러그인 승인 게이트 확인
6. 합성 요청으로 standard/fast/ultrafast 벤치마크
7. 실제 주문 1건에만 제한 적용
8. 원가와 QA가 개선될 때만 범위 확대

## 6. 현재 안전 상태

- 기존 작업 라우팅 동작: 유지
- 기존 OpenAI/Claude/Gemini 호출: 유지
- 새 API 파라미터 실제 전송: 없음
- persistent agent 실행: 없음
- external identity 생성: 없음
- 이메일 외부 전송: 없음
- 추가 결제/요금제 변경: 없음

즉 현재 변경은 **실제 신제품이 발표되면 코드 구조를 다시 뜯지 않고 설정과 검증만으로 연결하기 위한 준비 단계**다.


## 7. 2026-09-27 공식 확인: Agents API

OpenAI 공식 개발자 문서에 Agents API가 공개되었고, 신규 agent application의 시작점으로 안내된다.

공식 구조:
- OpenAI-hosted Codex harness
- durable sessions
- orchestration
- context compaction
- recovery
- environment 선택: none / openai_hosted / self_hosted
- application function tools
- session events / webhooks / traces

따라서 기존 futureRouting의 persistentAgent 슬롯은 더 이상 단순 루머 대비만이 아니다. 다만 Relay Desk에서는 기존 필드를 바로 활성화하지 않고, 별도 openaiAgentsApi shadow 정책으로 공식 API 계약을 먼저 반영한다.

현재 적용:
- server/openai-agents-api.js
- read-only function tools 5개
- environment=none 기본
- 실제 Agents API 호출 0
- 고객 발송·결제·납품·코드 수정 권한 0
- self-hosted executor 0
- webhook 0

상세 설계: docs/openai-agents-api-relay-prep.md
