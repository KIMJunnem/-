$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8787'

$work = @(
  @{ id='RLY-6001'; title='현재 시스템 아키텍처와 미구현 범위 정리'; ai='OpenAI'; priority='높음'; description='현재 Relay Desk 구현 상태와 최초 요구사항을 대조해 완료·부분 완료·미구현 항목을 정리하고, 다음 개발 순서를 제안한다.' },
  @{ id='RLY-6002'; title='데이터 모델과 영속성 구조 확정'; ai='OpenAI'; priority='높음'; description='프로젝트, 작업, AI 작업자, 파일 버전, 인수인계 기록, 결과, 감사 로그를 안정적으로 저장하기 위한 데이터 구조와 마이그레이션 계획을 작성한다.' },
  @{ id='RLY-6003'; title='로그인과 권한 모델 설계'; ai='Gemini'; priority='높음'; description='관리자, 프로젝트 관리자, 작업자, 읽기 전용 사용자의 로그인·권한 범위와 프로젝트별 접근 정책을 설계한다.' },
  @{ id='RLY-6004'; title='프로젝트와 작업 CRUD 및 상태 전이 규칙'; ai='OpenAI'; priority='높음'; description='프로젝트 생성, 작업 생성·수정·보관과 대기·진행·완료·보류·차단 상태 전이 규칙을 구현 가능한 수준으로 정리한다.' },
  @{ id='RLY-6005'; title='작업 잠금과 동시성 자동 만료 검증'; ai='OpenAI'; priority='높음'; description='여러 AI가 같은 작업을 동시에 가져가지 않도록 잠금·갱신·만료·재시도 규칙을 점검하고 경계 사례를 제시한다.' },
  @{ id='RLY-6006'; title='파일 버전·SHA-256·복구 흐름 검증'; ai='Gemini'; priority='높음'; description='원본 보존, 새 버전 저장, 해시 검증, 보관·복구와 무결성 실패 처리를 실제 사용 흐름으로 검증한다.' },
  @{ id='RLY-6007'; title='브리지 수집 폴더와 중복 방지 검증'; ai='Gemini'; priority='높음'; description='OpenAI·Gemini·기타 작업 결과가 저장되는 폴더를 브리지가 감시하고 해시 중복을 막는 운영 절차와 오류 대응을 정리한다.' },
  @{ id='RLY-6008'; title='인수인계 프롬프트 품질과 민감정보 제거'; ai='Gemini'; priority='높음'; description='작업 상태·완료 내용·검증 여부·다음 단계·파일 해시를 빠짐없이 담고 API 키·쿠키·토큰을 제거하는 프롬프트 규칙을 개선한다.' },
  @{ id='RLY-6009'; title='OpenAI·Gemini 실행 큐와 자동 전환 검증'; ai='OpenAI'; priority='높음'; description='새 작업 등록부터 결과 게시글 저장까지의 실행 큐를 검증하고 잔액 부족·429·모델 오류가 발생할 때 다른 연결 AI로 자동 전환되는 조건을 점검한다.' },
  @{ id='RLY-6010'; title='결과 게시글·출처·파일 연결 구조'; ai='OpenAI'; priority='중간'; description='AI 결과를 게시글로 저장하면서 원본 AI, 작업 ID, 생성 시각, 사용량, 관련 파일과 검증 상태를 연결하는 구조를 정리한다.' },
  @{ id='RLY-6011'; title='중복 연구 탐지와 결과 비교 규칙'; ai='Gemini'; priority='중간'; description='제목·설명·파일 해시·결과 내용을 비교해 유사 작업과 중복 결과를 경고하고 감사 기록에 남기는 규칙을 제안한다.' },
  @{ id='RLY-6012'; title='사용량·잔액·지출 한도 경고'; ai='OpenAI'; priority='중간'; description='OpenAI와 Gemini의 사용량·잔액을 확인할 수 있는 범위를 정리하고 70·85·95% 경고 및 월 지출 제한 운영안을 만든다.' },
  @{ id='RLY-6013'; title='검색과 운영 대시보드 개선'; ai='Gemini'; priority='중간'; description='진행 작업, 잠금, 백업 실패, 중복 가능성, 차단, 최근 변경과 AI 상태를 빠르게 찾는 화면과 검색 조건을 설계한다.' },
  @{ id='RLY-6014'; title='백업·복구 테스트와 장애 복구 절차'; ai='OpenAI'; priority='높음'; description='상태 파일과 저장 파일의 백업·복구 테스트, 서버 재시작 후 실행 중 작업 복구, 실패 기록 보존 절차를 작성한다.' },
  @{ id='RLY-6015'; title='보안 점검과 3700X 서버 운영 패키지'; ai='Gemini'; priority='높음'; description='API 키 비노출, 로컬 쓰기·원격 읽기 분리, 공개 링크 차단, 서버 시작·중지·이사 백업 절차를 하나의 운영 체크리스트로 정리한다.' }
)

$state = Invoke-RestMethod "$base/api/state"
$existing = @($state.tasks | ForEach-Object { $_.id })
$newTasks = @()
$newPosts = @()
$now = (Get-Date).ToUniversalTime().ToString('o')

foreach ($item in $work) {
  if ($existing -contains $item.id) { continue }
  $newTasks += [pscustomobject]@{
    id=$item.id; title=$item.title; ai=$item.ai; priority=$item.priority; description=$item.description
    meta='대기 · 자동 실행 대기'; status='active'; label='대기'; tone='blue'; dot=''; project='AI 연구 운영 허브'
    createdAt=$now; updatedAt=$now
  }
  $prompt = "너는 Relay Desk 팀의 다음 담당자다. Claude는 사용하지 않는다. OpenAI와 Gemini만 사용한다. 이미 완료된 작업은 반복하지 말고, 확인된 사실과 추정 내용을 구분하라.\n\n프로젝트: AI 연구 운영 허브\n작업 ID: $($item.id)\n작업명: $($item.title)\n우선순위: $($item.priority)\n\n작업 설명:\n$($item.description)\n\n현재 기준:\n- workkit 수익화 연구는 Gemini 결과 게시글로 완료되어 있다.\n- Relay Desk는 OpenAI·Gemini 자동 실행, 결과 게시글, 파일 해시, 자동 전환을 지원한다.\n- 이 작업의 결과는 구현 가능한 결정사항, 확인할 파일·화면, 검증 방법, 다음 단계 형식으로 작성하라.\n- 실제 파일을 수정했다고 주장하지 말고, 필요한 변경과 완료 조건을 분명히 적어라."
  $newPosts += [pscustomobject]@{
    id="POST-$($item.id)"; taskId=$item.id; title="$($item.id) 작업 프롬프트"; source='Relay Desk'; nextAI=$item.ai
    prompt=$prompt; status='게시됨'; createdAt=$now
  }
}

if ($newTasks.Count -gt 0) {
  $seed = @{ tasks=@($state.tasks)+$newTasks; promptPosts=$newPosts+@($state.promptPosts); activities=@(@('방금 전','Relay Desk','TEAM-SEED','15개 팀 작업 등록 · OpenAI/Gemini 자동 실행'))+@($state.activities) } | ConvertTo-Json -Depth 20
  Invoke-RestMethod -Method Post -Uri "$base/api/state" -ContentType 'application/json' -Body $seed | Out-Null
}

$outcomes = @()
foreach ($post in $newPosts) {
  try {
    $body = @{ postId=$post.id; provider=$post.nextAI } | ConvertTo-Json
    $run = Invoke-RestMethod -Method Post -Uri "$base/api/run" -ContentType 'application/json' -Body $body
    $outcomes += [pscustomobject]@{ id=$post.taskId; provider=$run.resultPost.provider; status='완료'; fallbackFrom=$run.resultPost.fallbackFrom }
  } catch {
    $outcomes += [pscustomobject]@{ id=$post.taskId; provider=$post.nextAI; status='실패'; error=$_.ErrorDetails.Message }
  }
}

$outcomes | ConvertTo-Json -Depth 8
