# M01 첫 실제 응대 기록 검증

- 2026-09-23 22:05 KST 실제 고객 답변 1건 UI 발송 확인.
- 로컬 soomgo-customer-replies.jsonl 기록과 서버 POST /api/astra/chat-log의 대화 식별자·고객 시각·replySha 일치.
- 서버 응답 ok=true, duplicate=false, countedAsSent=true. summary: repliesVisible=1, question=1, unresolved open=1, uncertain=0.
- 본문·이름·연락처는 서버 메타데이터에 보내지 않음.
- 고객 답장 수신·범위 합의·결제 성과는 아직 확인되지 않음. 기록 연결 성공을 전환 개선 효과로 해석하지 않음.
- 신규 전환 분석 회차를 실행한 것이 아니라 기존 M01의 대기 중 실제 기록 대조를 완료한 것. 정기 분석 시각 23:04:41 KST 유지.
