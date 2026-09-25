# Astra 숨고 응대 — 답장 기록 안내 (붙여 넣기용)

> 2026-09-23 숨고 운영방. 준희 결정 B: Astra가 숨고 고객에게 답을 보낼 때마다 Relay에 한 건씩 기록한다.
> 아래 "붙여 넣을 블록"을 Astra 숨고 응대 자동화 지시문 끝에 그대로 넣는다.

---

## 붙여 넣을 블록

```
[답장 기록 — 매번]
1. 숨고 고객에게 답을 보낸 뒤, 채팅 목록(또는 대화방 마지막 말풍선)에 내 메시지가 보이는지 확인한다.
   보이면 delivery = visible, 보내기를 눌렀는데 안 보이면 delivery = uncertain.
2. 바로 Relay에 기록한다(아래 PowerShell). 고객에게 보내는 일과는 별개다.
   실패하면 한 번만 다시 보낸다. 그래도 실패하면 이 방에 "기록 실패 · 대화방 번호 · 시각"을 남긴다. 고객에게 다시 보내지 않는다.
3. 보내지 않는 것: 고객 이름·전화번호·주소·이메일, 고객 메시지 본문, 내 답장 본문.
   답장 본문 대신 sha256 앞 12자(replySha)만 보낸다. note는 120자 한 줄, 개인정보 없이.
4. 결제·환불·분쟁·취소 문의는 답하지 말고 kind = handoff_to_owner, resolution = owner_needed 로 기록한 뒤 준희에게 넘긴다.

칸 고르기
- kind: reply_sent(답 보냄) | question_seen(읽었지만 아직 답 안 함) | handoff_to_owner(준희에게 넘김)
- resolution: open(답 보냄·아직 해결 전) | resolved(고객이 알겠다·결제·고용 등으로 끝남) | waiting_customer_files(고객 자료 기다림) | owner_needed(준희 확인 필요)
  ※ 답을 보냈다고 resolved가 아니다. 고객이 받아들인 것이 보일 때만 resolved.
- stage(아는 만큼, 모르면 빼기): quote_sent | question | scope_agreed | payment_requested | payment_confirmed | in_production | delivered | deal_confirmed
- customerMessageAt: 내가 답한 고객 메시지의 시각(화면 시각, 한국 시간)
- conversationId: 숨고 채팅 주소 /pro/chats/ 뒤의 숫자
```

## PowerShell 예 (UTF-8 바이트로 보내기)

```powershell
$reply = @'
(방금 보낸 답 글을 그대로 붙여 넣기 — 이 값은 Relay로 가지 않고 sha 계산에만 쓴다)
'@
$sha = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($reply))) -replace '-','').ToLower().Substring(0,12)
$record = [ordered]@{
  conversationId    = '<대화방 번호>'
  at                = (Get-Date).ToString('o')
  customerMessageAt = '2026-09-23T15:17:00+09:00'
  kind              = 'reply_sent'
  delivery          = 'visible'
  resolution        = 'open'
  stage             = 'question'
  serviceId         = 'document_writing'
  quoteVersion      = 'v7'
  replySha          = $sha
  note              = '분량 확인 질문에 답함'
}
$bytes = [Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Compress))
$send = { Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/astra/chat-log' -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{ 'x-relay-astra' = 'chat-log' } -Body $bytes }
try { & $send } catch { Start-Sleep -Seconds 3; try { & $send } catch { Write-Output "기록 실패 · <대화방 번호> · $(Get-Date -Format 'HH:mm')" } }
```

- 결과 `duplicate: true`는 같은 기록이 이미 있다는 뜻이다(정상).
- `countedAsSent: false`면 delivery가 uncertain인 것이다. Relay 주의 목록에 올라가니 숨고 화면을 한 번 더 본다.
- 400이 오면 `details`에 이유가 있다(예: `note_personal_info` = note에 전화번호·이메일 형태).

## Relay에서 보는 법

`GET http://127.0.0.1:8787/api/astra/chat-log/summary` (같은 헤더 `x-relay-astra: chat-log`)
- `unresolved`: 마지막 기록이 open·owner_needed 이거나 delivery가 uncertain인 대화, 고객 메시지가 오래된 순, 경과 분
- `attention`: 그중 uncertain·owner_needed
- `stageCounts`: 대화방별 마지막 단계를 이름 그대로 센 수(견적 발송·결제 요청을 문의·주문으로 세지 않는다)
- `totals.repliesVisible`: 보이는 답장만 센 수

저장: `server/data/astra-chat-log.json`(git 제외, 최근 5,000건). 본문은 저장하지 않는다.
