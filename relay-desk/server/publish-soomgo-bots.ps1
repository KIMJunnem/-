$ErrorActionPreference = 'Stop'

$siteRoot = Split-Path -Parent $PSScriptRoot
$downloadRoot = Join-Path $siteRoot 'dist\downloads'
$requestSource = Join-Path $siteRoot 'soomgo-bot-extension'
$chatSource = Join-Path $siteRoot 'soomgo-chat-bot'
$kmongSource = Join-Path $siteRoot 'kmong-bot-extension'
$salesSource = Join-Path $siteRoot 'sales'
$requestPublished = Join-Path $downloadRoot 'relay-desk-soomgo-bot'
$chatPublished = Join-Path $downloadRoot 'relay-desk-soomgo-chat-bot'
$kmongPublished = Join-Path $downloadRoot 'relay-desk-kmong-bot'
$requestZip = Join-Path $downloadRoot 'relay-desk-soomgo-bot.zip'
$chatZip = Join-Path $downloadRoot 'relay-desk-soomgo-chat-bot.zip'
$kmongZip = Join-Path $downloadRoot 'relay-desk-kmong-bot.zip'

$resolvedSiteRoot = (Resolve-Path $siteRoot).Path
foreach ($target in @($downloadRoot, $requestPublished, $chatPublished, $kmongPublished, $requestZip, $chatZip, $kmongZip)) {
  $absolute = [IO.Path]::GetFullPath($target)
  if (-not $absolute.StartsWith($resolvedSiteRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "발행 경로가 Relay Desk 폴더 밖을 가리킵니다: $absolute"
  }
}

New-Item -ItemType Directory -Path $requestPublished -Force | Out-Null
New-Item -ItemType Directory -Path $chatPublished -Force | Out-Null
New-Item -ItemType Directory -Path $kmongPublished -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $downloadRoot 'profile') -Force | Out-Null

foreach ($name in @('content-v3.js', 'automation-guard.js', 'auto-update.js', 'manifest.json', 'README.md')) {
  Copy-Item -LiteralPath (Join-Path $requestSource $name) -Destination (Join-Path $requestPublished $name) -Force
}
foreach ($name in @('chat-content.js', 'automation-guard.js', 'auto-update.js', 'manifest.json', 'README.md')) {
  Copy-Item -LiteralPath (Join-Path $chatSource $name) -Destination (Join-Path $chatPublished $name) -Force
}
foreach ($name in @('content.js', 'auto-update.js', 'manifest.json', 'README.md')) {
  Copy-Item -LiteralPath (Join-Path $kmongSource $name) -Destination (Join-Path $kmongPublished $name) -Force
}

# 가격·설치 문서도 봇과 같은 발행 단계에서 다운로드 폴더에 동기화한다.
# 서버를 재시작하면 코드와 고객에게 제공하는 가격표가 서로 다른 버전으로
# 남지 않도록 sales 폴더를 단일 원본으로 사용한다.
foreach ($name in @(
  'document-quote-template.txt',
  'document-writing-listing.txt',
  'document-writing-post-under-1000.txt',
  'document-writing-price-card.png',
  'document-writing-price-card.svg',
  'document-writing-price-menu.txt',
  'profile-sample-copy.txt',
  'soomgo-branding-media-pack.txt',
  'relay-desk-soomgo-bot-setup.txt'
  ,'profile/merona-astra-sample-communication-review.png'
  ,'profile/merona-astra-sample-insight-cover.png'
)) {
  $source = Join-Path $salesSource $name
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $downloadRoot $name) -Force
  }
}

Compress-Archive -Path (Join-Path $requestPublished '*') -DestinationPath $requestZip -CompressionLevel Optimal -Force
Compress-Archive -Path (Join-Path $chatPublished '*') -DestinationPath $chatZip -CompressionLevel Optimal -Force
Compress-Archive -Path (Join-Path $kmongPublished '*') -DestinationPath $kmongZip -CompressionLevel Optimal -Force

$requestManifest = Get-Content -LiteralPath (Join-Path $requestPublished 'manifest.json') -Raw -Encoding utf8 | ConvertFrom-Json
$chatManifest = Get-Content -LiteralPath (Join-Path $chatPublished 'manifest.json') -Raw -Encoding utf8 | ConvertFrom-Json
$kmongManifest = Get-Content -LiteralPath (Join-Path $kmongPublished 'manifest.json') -Raw -Encoding utf8 | ConvertFrom-Json
$publishedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss K'
$versionText = @"
Relay Desk 숨고 봇 최신 발행본
업데이트: $publishedAt

요청 견적 봇: $($requestManifest.version)
폴더: relay-desk-soomgo-bot
ZIP: relay-desk-soomgo-bot.zip

고객 채팅 봇: $($chatManifest.version)
폴더: relay-desk-soomgo-chat-bot
ZIP: relay-desk-soomgo-chat-bot.zip

크몽 상담·주문 봇: $($kmongManifest.version)
폴더: relay-desk-kmong-bot
ZIP: relay-desk-kmong-bot.zip
"@
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[IO.File]::WriteAllText((Join-Path $downloadRoot 'BOT-LATEST.txt'), $versionText, $utf8Bom)

Write-Host ("봇 발행 완료 · 숨고 요청 {0} · 숨고 채팅 {1} · 크몽 {2}" -f $requestManifest.version, $chatManifest.version, $kmongManifest.version)
