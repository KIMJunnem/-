$ErrorActionPreference = 'Stop'

$port = 8787
$workDir = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $fallback = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path $fallback) { $node = $fallback }
}
if (-not $node) { throw 'Node.js를 찾을 수 없습니다. Node.js를 설치한 뒤 다시 실행하세요.' }

# 서버를 다시 시작할 때마다 최신 봇 소스와 ZIP을 다운로드 폴더에 함께 발행한다.
& (Join-Path $PSScriptRoot 'publish-soomgo-bots.ps1') | Out-Null

$ownerPids = @()
try {
  $ownerPids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess)
} catch {
  # 일부 Windows 환경에서는 Get-NetTCPConnection 조회가 거부될 수 있어 netstat로 보완한다.
  $ownerPids = @(netstat -ano -p tcp 2>$null | Select-String ":$port\s+.*LISTENING\s+(\d+)$" | ForEach-Object {
    if ($_.ToString() -match ":$port\s+.*LISTENING\s+(\d+)$") { [int]$Matches[1] }
  })
}
foreach ($ownerPid in ($ownerPids | Sort-Object -Unique)) {
  $process = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'node') { Stop-Process -Id $process.Id -Force }
}
Start-Sleep -Seconds 1

$stdout = Join-Path $PSScriptRoot 'relay-server.log'
$stderr = Join-Path $PSScriptRoot 'relay-server-error.log'
Set-Content -Path $stdout -Value '' -Encoding utf8
Set-Content -Path $stderr -Value '' -Encoding utf8
Start-Process -FilePath $node -ArgumentList @('server\relay-server.js') -WorkingDirectory $workDir -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
Start-Sleep -Seconds 2

$meta = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/reports/meta" -Method Get -TimeoutSec 10
Write-Host ("Relay Desk 재시작 완료 · 보고서 문서: {0} · 다음 정리: {1}" -f $meta.filename, $meta.nextRunAt)
