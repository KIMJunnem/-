$api = 'http://127.0.0.1:8787/api/state'
$now = [DateTime]::UtcNow.ToString('o')
$generic = @(
  '너는 Relay Desk의 실행 검증 담당자다.',
  '이 과제는 아이디어를 판매 가능한 제안과 검증 가능한 실행물로 바꾸는 1차 실행이다.',
  '확인된 사실, 가설, 미검증 근거를 분리하라.',
  '실제 고객 연락, 결제, 광고 게시, 외부 게시, 외부 계정 변경은 하지 마라.',
  '대신 실제로 검토할 수 있는 문서, 샘플, 계산표, 실험 설계와 완료 기준을 만들어라.',
  '실행하지 않은 일은 완료했다고 표시하지 마라.',
  '마지막에는 채택 가능한 안, 보류할 안, 다음 실행 한 단계를 구분하라.'
)
$specs = @(
  @{ Id='RLY-9101'; Title='실행 검증 1 · 연구·리서치 대행 상품'; Topic='수익형 아이템 회의 3 · 연구·리서치 대행'; Prompt=(($generic + @(
    '후보 고객군을 최대 2개로 좁혀라.',
    '판매할 산출물을 조사 보고서, 경쟁 비교표, 의사결정 브리핑 중에서 구체화하라.',
    '샘플 목차와 납품 체크리스트를 만들어라.',
    '가격 가설 3개와 7일 검증 계획을 제시하라.',
    '성공 기준은 구매 의향이 아니라 요청된 산출물의 가치 이해도와 재구매 가능성까지 포함하라.'
  )) -join "`n") },
  @{ Id='RLY-9102'; Title='실행 검증 2 · 업무 자동화 패키지'; Topic='수익형 아이템 회의 2 · 업무 자동화 패키지'; Prompt=(($generic + @(
    '반복 업무 하나만 골라 자동화 패키지의 범위를 정하라.',
    '입력, 처리, 검수, 산출물, 예외 처리를 한 장의 흐름으로 작성하라.',
    '자동화 전후의 시간, 오류, 검수 부담을 비교하는 측정표를 만들어라.',
    '고객에게 보여줄 데모 시나리오와 파일럿 완료 기준을 제시하라.',
    '지원 비용과 고객별 커스터마이징 위험을 함께 계산하라.'
  )) -join "`n") },
  @{ Id='RLY-9103'; Title='실행 검증 3 · 템플릿·프롬프트 상품'; Topic='수익형 아이템 회의 4 · 템플릿·프롬프트 상품'; Prompt=(($generic + @(
    '구매자가 바로 사용할 수 있는 템플릿 또는 프롬프트 묶음 하나를 정의하라.',
    '구성품, 사용 전제, 예시 입력·출력, 실패 시 수정법을 작성하라.',
    '무료 샘플과 유료 묶음의 차이를 명확히 하라.',
    '가격 가설과 전달 방식, 환불·업데이트 정책 초안을 제시하라.',
    '복제되기 쉬운 단순 프롬프트와 업무 맥락·검수 절차가 포함된 차별화 요소를 구분하라.'
  )) -join "`n") },
  @{ Id='RLY-9104'; Title='실행 검증 4 · Workkit 가격·번들 실험'; Topic='총괄 보고서 검증 · Workkit 과금 단위와 가격 번들'; Prompt=(($generic + @(
    '역할형, 산출물형, 팀 거버넌스형 번들을 비교표로 정리하라.',
    '실제 가격을 확정하지 말고 가격 가설과 원가·지원비 계산 변수를 분리하라.',
    '가상 가격 페이지에서 비교할 문구와 선택지를 설계하라.',
    '산출물 유형별 실패·재작업·지원 비용을 반영한 손익 계산표를 만들어라.',
    '가상 구매 테스트의 성공·중단 기준과 다음 의사결정 조건을 제시하라.'
  )) -join "`n") },
  @{ Id='RLY-9105'; Title='실행 검증 5 · 교육·도입 프로그램'; Topic='수익형 아이템 회의 5 · 교육·도입 프로그램'; Prompt=(($generic + @(
    '대상 고객과 교육 후 달라져야 하는 업무 결과를 하나로 좁혀라.',
    '1회 워크숍 또는 짧은 도입 프로그램의 커리큘럼과 산출물을 작성하라.',
    '교육 전·후의 시간 절감, 오류 감소, 첫 결과물 완성 여부를 측정하라.',
    '강사 준비 비용, 지원 비용, 반복 판매 가능성을 계산하라.',
    '파일럿 참가자에게 보여줄 안내문과 완료 설문 문항을 만들어라.'
  )) -join "`n") },
  @{ Id='RLY-9106'; Title='실행 검증 6 · AI 거버넌스·감사 패키지'; Topic='회사 운영 방침 2 · 비용·권한·보안'; Prompt=(($generic + @(
    'AI 거버넌스·감사 기능 중 가장 작은 판매 단위를 하나로 좁혀라.',
    '구매자, 구매 트리거, 제공 증거, 지원 범위를 구체화하라.',
    '권한·감사 로그·보존 정책 중 현재 Relay Desk에서 실제로 확인 가능한 것과 없는 것을 구분하라.',
    '30일 검증용 소규모 PoC 범위와 성공 기준을 작성하라.',
    '법률·규제 준수를 보장한다고 과장하지 않도록 판매 문구의 금지 표현도 제시하라.'
  )) -join "`n") }
)
$tasks = @()
$posts = @()
$activities = @()
for ($i = 0; $i -lt $specs.Count; $i++) {
  $spec = $specs[$i]
  $status = if ($i -eq 0) { 'active' } else { 'blocked' }
  $label = if ($i -eq 0) { '실행 대기' } else { '승인됨 · 순서 대기' }
  $postStatus = if ($i -eq 0) { '게시됨' } else { '보류' }
  $tasks += [ordered]@{
    id=$spec.Id; title=$spec.Title; ai='OpenAI'; priority='높음'; description="승인된 판매 가능성·실행 가능성 검증 과제. 원안: $($spec.Topic)"; category='실제 운영 방안 및 실행'; workType='business'; status=$status; label=$label; tone=if($i -eq 0){'blue'}else{'amber'}; dot=if($i -eq 0){'warn'}else{''}; meta=if($i -eq 0){'승인됨 · OpenAI 실행 대기'}else{'승인됨 · 앞선 과제 완료 후 실행'}; project='AI 수익화 운영'; lane='execution'; decisionAuthority=$false; decisionOwner='사용자 승인'; autoContinue=$false; executionOrder=($i + 1); approvedBy='사용자'; createdAt=$now; updatedAt=$now
  }
  $posts += [ordered]@{
    id="POST-$($spec.Id)-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())-$i"; taskId=$spec.Id; title=$spec.Title; source='사용자 승인 실행 목록'; nextAI='OpenAI'; prompt=(($spec.Prompt) + "`n`n원안 주제: $($spec.Topic)`n실행 순서: $($i + 1) / $($specs.Count)`n승인 상태: 사용자 승인"); status=$postStatus; mode='analysis'; followUpMode='analysis'; lane='execution'; decisionAuthority=$false; decisionOwner='사용자 승인'; autoContinue=$false; createdAt=$now
  }
  $activities += ,@($now,'사용자 승인',$spec.Id,"실행 과제 등록 · 순서 $($i + 1)")
}
$body = @{ tasks=$tasks; promptPosts=$posts; activities=@($activities) } | ConvertTo-Json -Depth 12
$result = Invoke-RestMethod -Uri $api -Method Post -ContentType 'application/json' -Body $body
$result.tasks | Where-Object { $_.id -in $specs.Id } | Select-Object id,status,label,executionOrder | ConvertTo-Json -Depth 4
