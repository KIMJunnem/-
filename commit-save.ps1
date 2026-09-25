$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

Write-Host ''
Write-Host '============================================'
Write-Host ' Relay Desk - 작업 상태 저장 (git commit) + 서버 재시작'
Write-Host '============================================'
Write-Host ''
Write-Host ("폴더: {0}" -f $projectRoot)
Write-Host ''

# git이 설치되어 있는지 먼저 확인한다.
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  Write-Host '[오류] git을 찾을 수 없습니다. git이 설치되어 있는지 확인해 주세요.' -ForegroundColor Red
  Read-Host '엔터를 누르면 닫힙니다'
  exit 1
}

# 이 폴더가 git 저장소인지 확인한다.
git rev-parse --is-inside-work-tree > $null 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host '[오류] 이 폴더는 git 저장소가 아닙니다.' -ForegroundColor Red
  Read-Host '엔터를 누르면 닫힙니다'
  exit 1
}

Write-Host '--- 저장할 변경 내용 ---' -ForegroundColor Cyan
git status --short
Write-Host ''

# 변경이 없으면 빈 저장점을 만들지 않는다. 커밋할 게 없어도 서버 재시작은 계속 진행한다
# (최신 코드가 이미 저장되어 있는데 서버만 예전 코드로 떠 있는 경우가 있기 때문).
$hasChanges = $true
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  $hasChanges = $false
  Write-Host '저장할 변경이 없습니다. 이미 최신 상태입니다.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '--- 최근 저장점 ---' -ForegroundColor Cyan
  git log --oneline -5
  Write-Host ''
}

if ($hasChanges) {
  $changedCount = (git diff --cached --name-only | Measure-Object -Line).Lines
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
  $message = "작업 상태 저장 $stamp ($changedCount개 파일)"

  git commit -m $message
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '[오류] 저장에 실패했습니다. 위 메시지를 확인해 주세요.' -ForegroundColor Red
    Read-Host '엔터를 누르면 닫힙니다'
    exit 1
  }

  Write-Host ''
  Write-Host ("저장 완료: {0}" -f $message) -ForegroundColor Green
  Write-Host ''
  Write-Host '--- 최근 저장점 ---' -ForegroundColor Cyan
  git log --oneline -5
  Write-Host ''
  Write-Host '되돌리고 싶을 때는 위 목록의 저장점 번호를 알려주시면 됩니다.'
  Write-Host ''
}

# 저장이 끝났으니 이어서 서버를 재시작해 방금 저장한 최신 코드를 바로 반영한다.
Write-Host '--- Relay Desk 서버 재시작 ---' -ForegroundColor Cyan
$restartScript = Join-Path $projectRoot 'server\restart-relay-server.ps1'
if (-not (Test-Path $restartScript)) {
  Write-Host '[오류] server\restart-relay-server.ps1 파일을 찾을 수 없습니다.' -ForegroundColor Red
  Read-Host '엔터를 누르면 닫힙니다'
  exit 1
}

try {
  & $restartScript
  Write-Host ''
  Write-Host '서버 재시작 완료. 방금 저장한 최신 코드로 다시 떠 있습니다.' -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host ("[오류] 서버 재시작에 실패했습니다: {0}" -f $_.Exception.Message) -ForegroundColor Red
  Write-Host 'server\relay-server-error.log 파일을 확인해 주세요.' -ForegroundColor Yellow
}

Write-Host ''
Read-Host '엔터를 누르면 닫힙니다'
