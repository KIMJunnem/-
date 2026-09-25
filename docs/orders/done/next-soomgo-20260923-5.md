# 숨고 운영방 지시 5 — Astra 답장 기록 경로 (2026-09-23 19:05 감독)

> **맡은 방: 숨고 운영방(claude-ff)만.** 시작하자마자 progress.md 맨 위에 "진행 중: 숨고 운영방 · next-soomgo 지시 5 · 시각" 한 줄.
> **progress.md 쓰기 규칙(decisions.md 8번):** 쓰기 직전에 다시 읽고 맨 위에 내 칸만 끼워 바로 쓴다. 쓴 뒤 다시 읽어 다른 방 칸이 그대로인지 확인.
> 개발방이 지시 9(스크립트·문서만, relay-server.js 안 건드림)를 동시에 돌릴 수 있다. 정책·서버 파일은 고치기 직전에 다시 읽는다.

## 준희 결정 (decisions.md 6번 반영)
- 고객 채팅은 Astra가 크롬 숨고에서 직접 읽고 답한다. Relay 채팅봇은 꺼 둔다(준희).
- **B: Astra가 답을 보낼 때마다 Relay에 기록한다.** Relay는 이 기록으로 미해결 질문·전환 단계를 본다.

## 지시 4 보고 정정 (감독 확인)
- 지시 4 보고의 "대화 읽기·서버 기록·심박은 그대로"는 코드와 다르다: chat-content.js serverPaused()가 sendOff면 paused=true(약 134~136줄) → guardedLoop가 읽기 전에 멈춤(약 3569줄). 주석(127~128줄)과 반대. 채팅봇은 지금 꺼져 있으니 **고치지 말고** progress에 "지시 4 정정" 한 줄만 적는다.

## 할 일
1. 백업: backups/astra-chat-log-20260923/
2. **기록 경로** (server/relay-server.js, 로컬 전용 127.0.0.1, 헤더 `x-relay-astra: chat-log`):
   - `POST /api/astra/chat-log` — Astra가 한 건씩 보낸다. 받는 칸:
     - conversationId(숫자 문자열, 필수), at, customerMessageAt(답한 고객 메시지 시각), kind: `reply_sent` | `question_seen` | `handoff_to_owner`
     - delivery: `visible`(채팅 목록에 내 메시지가 보임) | `uncertain`(눌렀지만 안 보임) — reply_sent일 때 필수
     - resolution: `open`(답 보냄·해결 전) | `resolved`(고객이 알겠다·결제·고용 등) | `waiting_customer_files` | `owner_needed`
     - stage(아는 만큼): `quote_sent` `question` `scope_agreed` `payment_requested` `payment_confirmed` `in_production` `delivered` `deal_confirmed`
     - serviceId, quoteVersion(보낸 견적 문구 버전), replySha(답 글 sha256 앞 12자 — **본문 저장 금지**), note(120자, 이름·전화·주소 넣지 않기)
   - 같은 (conversationId, customerMessageAt, kind, replySha) 두 번 오면 한 건으로(중복 방지)
   - `delivery: uncertain`은 **보냄으로 세지 않는다.** 대시보드 주의 목록에 올린다
   - `resolution`은 `delivery`와 따로 저장 — "보냄 ≠ 해결"
   - `GET /api/astra/chat-log/summary` — 대화방별 마지막 상태, 미해결(open·uncertain·owner_needed) 목록과 경과 시간, 단계별 건수. **견적 발송·결제 요청은 문의·주문으로 세지 않는다**(단계 이름 그대로 센다)
   - 저장: server/data/astra-chat-log.json(저장소 밖·.gitignore 확인), 최근 5,000건
3. **시험** tests/astra-chat-log.cjs — 모의 데이터만: 필수 칸 없으면 400 / 로컬 아니면 403 / 중복 1건 / uncertain은 보냄 수 0 / 본문·전화번호 형태가 note에 오면 거절 / summary 미해결 목록 / 단계 집계가 결제 요청을 주문으로 안 셈. run-all에 한 줄
4. run-all 1회 → 통과하면 서버 재시작(publish). 재시작 뒤 모의 1건을 **테스트용 conversationId "test-…"로 넣지 말고**, 시험 파일 안에서만 검증(실제 기록 파일에 가짜 건 남기지 않기)
5. **Astra용 안내문** docs/astra-chat-log-guide.md — 준희가 Astra 숨고 응대 자동화에 붙여 넣을 짧은 블록:
   - 답을 보낸 뒤 채팅 목록에서 내 메시지가 보이는지 확인 → visible/uncertain
   - PowerShell 호출 예(UTF-8 바이트로 보내기, 헤더 포함), 실패하면 재시도 1번 후 "기록 실패"를 Astra 방에 남김(고객 발송과 별개)
   - 고객 이름·전화·주소·메시지 본문은 보내지 않는다
   - 결제·환불·분쟁은 handoff_to_owner

## 수정 범위
- server/relay-server.js(새 경로만), 새 파일(tests/astra-chat-log.cjs, docs/astra-chat-log-guide.md), tests/run-all.cjs 한 줄, .gitignore(필요하면 한 줄)
- 채팅봇·요청봇 코드, 정책의 다른 값, 가격·문구 수정 금지

## 멈춤 조건
- 기존 경로와 이름이 겹치거나 기존 기록 파일 형식을 바꿔야 하면 멈추고 적는다
- run-all 실패 시 1회 결과 그대로 적고 멈춤(재시작 안 함)

## 금지
- 고객 발송, 채팅봇 켜기, 숨고 페이지 조작, 유료 API, 설치, 파일 삭제, 키·.env·쿠키 읽기, git push

## 검증 (progress.md)
- 경로 2개 요청·응답 예(모의), 시험 항목 통과 목록, run-all N/N, 재시작 시각, 안내문 경로
