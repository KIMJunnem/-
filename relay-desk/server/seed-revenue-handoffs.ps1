$ErrorActionPreference = 'Stop'
$base = if ($env:RELAY_URL) { $env:RELAY_URL } else { 'http://127.0.0.1:8787' }
$round = if ($env:RELAY_SEED_ROUND) { [int]$env:RELAY_SEED_ROUND } else { 1 }
$idBase = 7000 + ([Math]::Max(0, $round - 1) * 1000)

$work = @(
  @{ category='장기적 수익화 모델'; title='장기적 수익화 모델 확정'; priority='높음'; description='Relay Desk와 workkit을 기반으로 12개월 안에 반복 매출을 만드는 장기 수익화 모델 1개를 확정한다. 고객군, 핵심 가치, 가격, 원가, 유지율 가정, 손익분기점, 첫 90일 검증 계획을 제시한다.' }
  @{ category='수익형 아이템 회의'; title='수익형 아이템 회의 1 · 기업용 AI 운영 허브'; priority='높음'; description='기업 고객이 바로 비용을 지불할 수 있는 AI 운영 허브 상품을 정의한다. 대상 고객, 해결 문제, 제공 범위, 가격 실험, 구매 결정자를 정리한다.' }
  @{ category='수익형 아이템 회의'; title='수익형 아이템 회의 2 · 업무 자동화 패키지'; priority='높음'; description='반복 업무를 자동화하는 패키지 상품 후보를 비교한다. 구현 난이도, 판매 가능성, 고객 유지 이유, 필요한 연결 서비스와 2주 검증안을 정리한다.' }
  @{ category='수익형 아이템 회의'; title='수익형 아이템 회의 3 · 연구·리서치 대행'; priority='중간'; description='OpenAI·Gemini를 활용한 연구·리서치 대행 상품을 설계한다. 산출물, 납기, 검수 기준, 경쟁 대비 차별점, 첫 고객 확보 방법을 논의한다.' }
  @{ category='수익형 아이템 회의'; title='수익형 아이템 회의 4 · 템플릿·프롬프트 상품'; priority='중간'; description='검증된 프롬프트와 운영 템플릿을 디지털 상품으로 판매할 수 있는지 판단한다. 구매 단위, 번들 구성, 업데이트 정책, 환불·지원 방안을 제시한다.' }
  @{ category='수익형 아이템 회의'; title='수익형 아이템 회의 5 · 교육·도입 프로그램'; priority='중간'; description='개인과 팀을 대상으로 하는 AI 업무 교육·도입 프로그램의 상품 구조를 만든다. 교육 과정, 실습 결과물, 가격, 재구매 경로, 후기 확보 계획을 정리한다.' }
  @{ category='기존 아이템 수익성 강화'; title='기존 아이템 수익성 강화 1 · Workkit 가격·번들'; priority='높음'; description='현재 Workkit 수익화안을 기준으로 가격표와 번들 구성을 개선한다. 무료·기본·프로·기업 단계, 원가, 마진, 업셀 조건과 검증 지표를 확정한다.' }
  @{ category='기존 아이템 수익성 강화'; title='기존 아이템 수익성 강화 2 · Relay Desk 차별화'; priority='높음'; description='Relay Desk를 단순 AI 채팅 연결 도구와 구분하는 기능과 메시지를 정리한다. 고객이 돈을 내는 핵심 기능, 유지 비용, 유료 전환 장벽과 개선 순서를 정한다.' }
  @{ category='기존 아이템 수익성 강화'; title='기존 아이템 수익성 강화 3 · 재구매·구독 구조'; priority='중간'; description='기존 상품의 일회성 판매를 재구매·구독으로 확장하는 방안을 설계한다. 반복 사용 이유, 갱신 주기, 알림, 고객 성공 지표와 이탈 방지 방안을 제시한다.' }
  @{ category='판매 경로 논의'; title='판매 경로 논의 1 · 온라인 직접 판매'; priority='높음'; description='자체 홈페이지, 결제 페이지, 뉴스레터, 커뮤니티를 통한 직접 판매 경로를 비교한다. 유입·전환·결제·지원 흐름과 첫 실험 예산 및 목표를 정한다.' }
  @{ category='판매 경로 논의'; title='판매 경로 논의 2 · 제휴·B2B 영업'; priority='높음'; description='대행사, 교육기관, 소규모 기업과의 제휴 및 B2B 영업 경로를 비교한다. 소개 수수료, 계약 구조, 영업 자료, 파이프라인 단계와 첫 10곳 공략안을 만든다.' }
  @{ category='회사 운영 방침'; title='회사 운영 방침 1 · AI 업무·검수 기준'; priority='높음'; description='AI가 만든 결과를 회사 업무에 사용하는 기준을 정한다. 담당자, 검수 단계, 사실·추정 구분, 민감정보 처리, 외부 공개 승인과 기록 방침을 문서화한다.' }
  @{ category='회사 운영 방침'; title='회사 운영 방침 2 · 비용·권한·보안'; priority='높음'; description='API 비용, 작업 권한, 파일 보관, 백업, 장애 대응과 외부 서비스 전송 승인 방침을 정한다. 월 한도, 경고 기준, 책임자와 감사 기록 항목을 확정한다.' }
  @{ category='실제 운영 방안 및 실행'; title='실제 운영 방안 및 실행 1 · 7일 매출 실험'; priority='높음'; description='7일 안에 유료 고객 반응을 확인하는 실행 계획을 만든다. 상품 하나, 판매 문구, 접촉 대상, 매일 할 일, 성공 기준과 실패 시 수정안을 정한다.' }
  @{ category='실제 운영 방안 및 실행'; title='실제 운영 방안 및 실행 2 · 상품·제안서 제작'; priority='높음'; description='선택한 수익형 아이템의 실제 상품 설명, 가격표, 제안서, 문의 응답 문구와 구매 후 전달물을 준비한다. 담당 순서와 완료 체크리스트를 만든다.' }
  @{ category='실제 운영 방안 및 실행'; title='실제 운영 방안 및 실행 3 · 고객 확보 운영'; priority='높음'; description='잠재 고객 목록화, 접촉, 상담, 제안, 결제, 온보딩을 반복하는 운영 흐름을 설계한다. 매일 기록할 지표와 다음 담당자에게 넘길 형식을 정한다.' }
  @{ category='실제 운영 방안 및 실행'; title='실제 운영 방안 및 실행 4 · 납품·품질 관리'; priority='중간'; description='유료 작업을 받은 뒤 납품하는 실제 절차를 만든다. 인수인계, 파일 버전, 검수, 수정 요청, 완료 보고, 재구매 제안까지의 체크리스트를 확정한다.' }
  @{ category='실제 운영 방안 및 실행'; title='실제 운영 방안 및 실행 5 · 주간 수익 운영판'; priority='중간'; description='매주 매출, 원가, API 사용량, 문의, 전환, 납품, 재구매를 확인하는 운영판을 만든다. 숫자가 바뀌면 어떤 결정을 내릴지 규칙과 다음 주 실행안을 정한다.' }
)

$state = Invoke-RestMethod "$base/api/state"
$existing = @($state.tasks | ForEach-Object { $_.id })
$newTasks = @()
$newPosts = @()
$now = (Get-Date).ToUniversalTime().ToString('o')
$index = 0

foreach ($item in $work) {
  $index++
  $id = 'RLY-{0:D4}' -f ($idBase + $index)
  if ($existing -contains $id) { continue }
  $ai = if ($index % 2 -eq 1) { 'OpenAI' } else { 'Gemini' }
  $task = [pscustomobject]@{
    id=$id; title=$item.title; ai=$ai; priority=$item.priority; description=$item.description
    category=$item.category; workType='business'; status='active'; label='대기'; tone='blue'; dot=''
    meta="대기 · $ai 아이디어 확장 준비"; project='AI 수익화 운영'; createdAt=$now; updatedAt=$now
    lane='idea_development'; decisionAuthority=$false; decisionOwner='Astra (추후 연결)'; discussionRound=$round
  }
  $prompt = @"
너는 AI 수익화 운영팀의 아이디어 확장·검증 담당자다. 이 과제를 한 라운드 더 발전시키고, 이미 완료된 조사를 반복하지 마라.

프로젝트: AI 수익화 운영
작업 ID: $id
분류: $($item.category)
작업명: $($item.title)
우선순위: $($item.priority)
논의 라운드: $round
최종 판단 담당: Astra (추후 연결)

작업 설명:
$($item.description)

응답 형식:
- 확인된 사실과 추정 내용을 구분한다.
- 최종 채택·우선순위·사업 판단은 하지 말고, 새로운 아이디어 후보를 최소 2개 제시한다.
- 각 후보에 기대효과, 필요한 근거, 반례·실패 조건, 검증 실험을 적는다.
- 실제로 이번 사이클에 검증할 작업, 산출물, 측정 지표를 적는다.
- 결과 마지막에는 다음 아이디어 사이클이 다룰 질문과 방향을 적는다.
- 파일이나 코드를 수정하지 않았다면 수정했다고 주장하지 않는다.
"@
  $post = [pscustomobject]@{
    id="POST-$id"; taskId=$id; title="$id 작업 인수인계"; source='Relay Desk'; nextAI=$ai
    prompt=$prompt; status='게시됨'; mode='analysis'; followUpMode='analysis'; autoContinue=$true; cycle=1; discussionRound=$round
    lane='idea_development'; decisionAuthority=$false; decisionOwner='Astra (추후 연결)'; insightPending=$true; createdAt=$now
  }
  $newTasks += $task
  $newPosts += $post
}

if ($newTasks.Count -gt 0) {
  $payload = @{ tasks=@($state.tasks)+$newTasks; promptPosts=$newPosts+@($state.promptPosts); activities=@(@('방금 전','Relay Desk',"REVENUE-SEED-R$round","$($newTasks.Count)개 수익화 운영 과제 재논의 등록 · 자동 인수인계 시작"))+@($state.activities) } | ConvertTo-Json -Depth 30
  Invoke-RestMethod -Method Post -Uri "$base/api/state" -ContentType 'application/json' -Body $payload | Out-Null
}

[pscustomobject]@{ round=$round; registered=$newTasks.Count; firstId=if($newTasks){$newTasks[0].id}else{$null}; lastId=if($newTasks){$newTasks[-1].id}else{$null} } | ConvertTo-Json -Compress
