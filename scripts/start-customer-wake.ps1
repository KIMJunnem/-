$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$port = Get-NetTCPConnection -LocalPort 8791 -State Listen -ErrorAction SilentlyContinue
if ($port) {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8791/health' -TimeoutSec 5
    if ($health.ok -and $health.customerSending -eq $false) { Write-Output 'Customer wake relay already running'; exit 0 }
    throw 'Port 8791 is in use by an unverified process'
}
$nodePath = (Get-Command node).Source
$scriptPath = Join-Path $projectDir 'server/customer-wake.js'
$logDir = Join-Path $projectDir 'server/data'
$process = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $scriptPath + '"')) -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'customer-wake.stdout.log') -RedirectStandardError (Join-Path $logDir 'customer-wake.stderr.log') -PassThru
Write-Output ('Customer wake relay PID: ' + $process.Id)
