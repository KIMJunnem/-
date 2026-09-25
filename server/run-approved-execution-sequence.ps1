$stateApi = 'http://127.0.0.1:8787/api/state'
$runApi = 'http://127.0.0.1:8787/api/run'
$ids = @('RLY-9102','RLY-9103','RLY-9104','RLY-9105','RLY-9106')
foreach ($taskId in $ids) {
  $state = Invoke-RestMethod $stateApi
  $post = @($state.promptPosts | Where-Object { $_.taskId -eq $taskId })[0]
  $task = @($state.tasks | Where-Object { $_.id -eq $taskId })[0]
  if (-not $post -or -not $task) { Write-Output "$taskId missing"; continue }
  if ($post.status -ne '완료') {
    $post.status = '게시됨'
    $task.status = 'active'
    $task.label = '실행 대기'
    $task.tone = 'blue'
    $task.dot = 'warn'
    $task.meta = '승인됨 · 순서 실행'
    $body = @{ tasks=@($task); promptPosts=@($post); activities=@(,@([DateTime]::UtcNow.ToString('o'),'사용자 승인',$taskId,'다음 승인 과제 실행 시작')) } | ConvertTo-Json -Depth 10
    Invoke-RestMethod $stateApi -Method Post -ContentType 'application/json' -Body $body | Out-Null
    try {
      $runBody = @{ postId=$post.id; provider='OpenAI' } | ConvertTo-Json
      Invoke-RestMethod $runApi -Method Post -ContentType 'application/json' -Body $runBody -TimeoutSec 120 | Out-Null
    } catch {
      Write-Output "$taskId request returned: $($_.Exception.Message)"
    }
  }
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 5
    $check = Invoke-RestMethod $stateApi
    $currentPost = @($check.promptPosts | Where-Object { $_.taskId -eq $taskId })[0]
    $currentTask = @($check.tasks | Where-Object { $_.id -eq $taskId })[0]
    if ($currentPost.status -eq '완료' -or $currentPost.status -eq '실행 실패') {
      Write-Output "$taskId $($currentPost.status) · $($currentTask.meta)"
      break
    }
    if ($attempt -eq 29) { Write-Output "$taskId still running" }
  }
}
