# Astra API 운영 감사

Relay Desk는 고객 응답이나 결과물 납품과 분리된 운영 감사 주기를 사용합니다. 기본 주기는 6시간이며 `RELAY_ASTRA_AUDIT_INTERVAL_MS` 환경변수로 조정할 수 있습니다(최소 1시간). 서버 재시작 때마다 무조건 호출하지 않고, 마지막 감사가 만료된 경우에만 시작 후 5초 뒤 1회 실행합니다.

감사 요청에는 고객명, 대화 본문, 첨부파일, 쿠키, API 키를 넣지 않습니다. 봇의 마지막 신호 나이, 대기열·워크플로 단계별 개수, 제공자 연결 상태, 일일 사용량과 비용 추정치, 자동화 안전정책만 요약해 Astra(`gpt-6-astra`, OpenAI Responses API)에 전달합니다. `store:false`와 `prompt_cache_key=relay-astra-ops-audit:v1`를 사용해 저장과 반복 프롬프트 비용을 줄입니다.

응답은 JSON으로 제한하고 `status`, `findings`, `recommendedChanges`, `requiresHumanApproval`, `nextAuditHours`를 저장합니다. 감사 결과는 다음 파일에 남습니다.

- `server/data/astra-ops-audit.json`: 원본 감사 결과, 응답 ID, 사용량, 입력 해시
- `server/data/astra-ops-audit.txt`: 사람이 읽는 요약

운영 감사는 임의의 코드·프롬프트·고객 메시지·결제·파일 전송을 직접 바꾸지 않습니다. Astra의 변경 제안은 `safeToAutoApply=false`로 기록되며, 실제 코드 수정은 검토·테스트·재시작 증거가 있는 실행 단계에서만 반영합니다. 이를 통해 잘못된 감사 응답 하나가 고객에게 중복 답장하거나 결제를 요청하는 일을 막습니다.

## 확인 API

- `GET /api/astra/ops-audit`: 최신 감사, 다음 실행 시각, 모델, 주기, 보고서 경로
- `POST /api/astra/ops-audit/run`: 로컬 Relay Desk에서 즉시 1회 실행

수동 실행은 고객 채팅이나 거래 상태를 변경하지 않습니다. API 키가 없거나 쿼터가 부족하면 `critical` 감사 결과와 원인만 저장하고 자동 재전송하지 않습니다.
