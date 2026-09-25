Add-Type -AssemblyName System.Drawing

$width = 1200
$height = 1800
$outputPng = Join-Path $PSScriptRoot 'document-writing-price-card.png'
$outputSvg = Join-Path $PSScriptRoot 'document-writing-price-card.svg'

$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$bg = [System.Drawing.ColorTranslator]::FromHtml('#fbfaff')
$purple = [System.Drawing.ColorTranslator]::FromHtml('#5d35d6')
$deep = [System.Drawing.ColorTranslator]::FromHtml('#3d267f')
$muted = [System.Drawing.ColorTranslator]::FromHtml('#6d6680')
$pale = [System.Drawing.ColorTranslator]::FromHtml('#f5f1ff')
$line = [System.Drawing.ColorTranslator]::FromHtml('#d9c9ff')
$white = [System.Drawing.Color]::White
$goldBg = [System.Drawing.ColorTranslator]::FromHtml('#fff5df')
$goldLine = [System.Drawing.ColorTranslator]::FromHtml('#f2d79b')
$goldText = [System.Drawing.ColorTranslator]::FromHtml('#6f5b31')
$goldHead = [System.Drawing.ColorTranslator]::FromHtml('#8a5b00')
$footer = [System.Drawing.ColorTranslator]::FromHtml('#7b718d')

$g.Clear($bg)
$outer = New-Object System.Drawing.Rectangle(42, 42, 1116, 1716)
$g.FillRectangle((New-Object System.Drawing.SolidBrush($white)), $outer)
$g.DrawRectangle((New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#e8ddff'), 3)), $outer)
$g.FillRectangle((New-Object System.Drawing.SolidBrush($purple)), (New-Object System.Drawing.Rectangle(42,42,1116,250)))

$fontHeader = New-Object System.Drawing.Font('Malgun Gothic', 54, [System.Drawing.FontStyle]::Bold)
$fontSub = New-Object System.Drawing.Font('Malgun Gothic', 25)
$fontMeta = New-Object System.Drawing.Font('Malgun Gothic', 18)
$fontTitle = New-Object System.Drawing.Font('Malgun Gothic', 27, [System.Drawing.FontStyle]::Bold)
$fontPrice = New-Object System.Drawing.Font('Malgun Gothic', 27, [System.Drawing.FontStyle]::Bold)
$fontWas = New-Object System.Drawing.Font('Malgun Gothic', 17)
$fontDesc = New-Object System.Drawing.Font('Malgun Gothic', 16)
$fontGoldHead = New-Object System.Drawing.Font('Malgun Gothic', 24, [System.Drawing.FontStyle]::Bold)
$fontGold = New-Object System.Drawing.Font('Malgun Gothic', 19)
$fontFooter = New-Object System.Drawing.Font('Malgun Gothic', 18)

function Draw-Text($text, $font, $color, $x, $y) {
  $brush = New-Object System.Drawing.SolidBrush($color)
  $g.DrawString($text, $font, $brush, $x, $y)
  $brush.Dispose()
}

Draw-Text '문서작성·정리 대행' $fontHeader $white 90 88
Draw-Text '★★ 전 종목 샘플 구매 가능 ★★' $fontSub ([System.Drawing.ColorTranslator]::FromHtml('#fff1a8')) 92 164
Draw-Text '판매가 25%로 먼저 확인 · 본 작업 시 샘플비 전액 차감' $fontMeta ([System.Drawing.ColorTranslator]::FromHtml('#e9e2ff')) 92 218

$cards = @(
  @{title='간단 문서'; regular='기준가 10,000원'; price='오픈 30% 할인 7,000원'; lines=@('자료 정리·구성 · 수정 1회','기본 1쪽·1,000자 기준')},
  @{title='교정·교열·윤문'; regular='기준가 84,000원'; price='오픈 30% 할인 59,000원'; lines=@('맞춤법·문장·내용 흐름','전문 분야는 별도 협의')},
  @{title='문서 타이핑'; regular='기준가 49,000원'; price='오픈 30% 할인 34,000원'; lines=@('문서·녹취 분량 기준','편집·정리 범위 별도')},
  @{title='PPT 제작'; regular='기준가 35,000원'; price='오픈 30% 할인 25,000원'; lines=@('원고·자료 제공 · 기본 구성','10장 안팎 기준')},
  @{title='PPT 템플릿·디자인'; regular='기준가 84,000원'; price='오픈 30% 할인 59,000원'; lines=@('레이아웃·그래프·이미지','분량·난이도별 확정')},
  @{title='보고서'; regular='기준가 30,000원'; price='오픈 30% 할인 21,000원'; lines=@('자료 정리·구성 · 수정 1회','기본 3쪽 기준')},
  @{title='사업계획서 작성'; regular='기준가 210,000원'; price='오픈 30% 할인 147,000원'; lines=@('목표·실행·예산·성과지표','지원사업·투자용은 범위 확인')},
  @{title='리서치·설문 대행'; regular='기준가 350,000원'; price='오픈 30% 할인 245,000원'; lines=@('소주제·설문 설계·자료 정리','조사 범위와 출처 협의')},
  @{title='통계 분석'; regular='기준가 210,000원'; price='오픈 30% 할인 147,000원'; lines=@('데이터 분석·검증 기준','크롤링은 별도 견적')},
  @{title='출판·인쇄물'; regular='기준가 385,000원'; price='오픈 30% 할인 270,000원'; lines=@('출판 기준 · 인쇄물 별도','인쇄물 기준가 70,000원')}
)

for ($i = 0; $i -lt $cards.Count; $i++) {
  $row = [math]::Floor($i / 2)
  $col = $i % 2
  $x = if ($col -eq 0) { 80 } else { 620 }
  $y = 320 + ($row * 230)
  $fill = if (($i % 2) -eq 0) { $pale } else { $white }
  $brush = New-Object System.Drawing.SolidBrush($fill)
  $pen = New-Object System.Drawing.Pen($line, 2)
  $g.FillRectangle($brush, (New-Object System.Drawing.Rectangle($x,$y,500,205)))
  $g.DrawRectangle($pen, (New-Object System.Drawing.Rectangle($x,$y,500,205)))
  $brush.Dispose(); $pen.Dispose()
  Draw-Text $cards[$i].title $fontTitle $deep ($x + 28) ($y + 32)
  if ($cards[$i].regular) { Draw-Text $cards[$i].regular $fontWas $muted ($x + 28) ($y + 70) }
  Draw-Text $cards[$i].price $fontPrice $purple ($x + 28) ($y + 91)
  Draw-Text $cards[$i].lines[0] $fontDesc $muted ($x + 28) ($y + 142)
  Draw-Text $cards[$i].lines[1] $fontDesc $muted ($x + 28) ($y + 166)
}

$notice = New-Object System.Drawing.Rectangle(80, 1480, 1040, 215)
$brush = New-Object System.Drawing.SolidBrush($goldBg)
$pen = New-Object System.Drawing.Pen($goldLine, 2)
$g.FillRectangle($brush, $notice); $g.DrawRectangle($pen, $notice)
$brush.Dispose(); $pen.Dispose()
Draw-Text '샘플 구매 가능 · 판매가의 25%' $fontGoldHead $goldHead 110 1517
Draw-Text '기본 범위를 넘는 분량·추가 수정·자료조사·표/차트/이미지' $fontGold $goldText 110 1561
Draw-Text '긴급 작업·번역은 작업량에 따라 별도 비용이 발생할 수 있습니다.' $fontGold $goldText 110 1595
Draw-Text '본 작업 전환 시 결제한 샘플 기본금액을 전액 차감합니다.' $fontGold $goldText 110 1629
Draw-Text '자막 제작: 기준가 39,000원 → 오픈 30% 할인 27,000원 (건당)' $fontGold $goldText 110 1663
Draw-Text '기본 납기 당일~2일 · 제공자료 기준 작성 · 수정 1회 포함 · 최종 제출 전 사실 확인 필요' $fontFooter $footer 80 1722

$bmp.Save($outputPng, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

$svg = @'
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800">
<rect width="1200" height="1800" fill="#fbfaff"/><rect x="42" y="42" width="1116" height="1716" rx="34" fill="#fff" stroke="#e8ddff" stroke-width="3"/><rect x="42" y="42" width="1116" height="250" rx="34" fill="#5d35d6"/><rect x="42" y="220" width="1116" height="72" fill="#5d35d6"/>
<g font-family="Malgun Gothic, Noto Sans KR, sans-serif"><text x="90" y="135" fill="#fff" font-size="54" font-weight="700">문서작성·정리 대행</text><text x="92" y="198" fill="#fff1a8" font-size="25">★★ 전 종목 샘플 구매 가능 ★★</text><text x="92" y="250" fill="#e9e2ff" font-size="18">판매가 25%로 먼저 확인 · 본 작업 시 샘플비 전액 차감</text>
'@
$svgCards = @(
  @{x=80;y=320;fill='#f5f1ff';title='간단 문서';regular='기준가 10,000원';price='오픈 30% 할인 7,000원';a='자료 정리·구성 · 수정 1회';b='기본 1쪽·1,000자 기준'},
  @{x=620;y=320;fill='#fff';title='교정·교열·윤문';regular='기준가 84,000원';price='오픈 30% 할인 59,000원';a='맞춤법·문장·내용 흐름';b='전문 분야는 별도 협의'},
  @{x=80;y=550;fill='#fff';title='문서 타이핑';regular='기준가 49,000원';price='오픈 30% 할인 34,000원';a='문서·녹취 분량 기준';b='편집·정리 범위 별도'},
  @{x=620;y=550;fill='#fff';title='PPT 제작';regular='기준가 35,000원';price='오픈 30% 할인 25,000원';a='원고·자료 제공 · 기본 구성';b='10장 안팎 기준'},
  @{x=80;y=780;fill='#f5f1ff';title='PPT 템플릿·디자인';regular='기준가 84,000원';price='오픈 30% 할인 59,000원';a='레이아웃·그래프·이미지';b='분량·난이도별 확정'},
  @{x=620;y=780;fill='#f5f1ff';title='보고서';regular='기준가 30,000원';price='오픈 30% 할인 21,000원';a='자료 정리·구성 · 수정 1회';b='기본 3쪽 기준'},
  @{x=80;y=1010;fill='#fff';title='사업계획서 작성';regular='기준가 210,000원';price='오픈 30% 할인 147,000원';a='목표·실행·예산·성과지표';b='지원사업·투자용은 범위 확인'},
  @{x=620;y=1010;fill='#fff';title='리서치·설문 대행';regular='기준가 350,000원';price='오픈 30% 할인 245,000원';a='소주제·설문 설계·자료 정리';b='조사 범위와 출처 협의'},
  @{x=80;y=1240;fill='#f5f1ff';title='통계 분석';regular='기준가 210,000원';price='오픈 30% 할인 147,000원';a='데이터 분석·검증 기준';b='크롤링은 별도 견적'},
  @{x=620;y=1240;fill='#f5f1ff';title='출판·인쇄물';regular='기준가 385,000원';price='오픈 30% 할인 270,000원';a='출판 기준 · 인쇄물 별도';b='인쇄물 기준가 70,000원'}
)
foreach ($c in $svgCards) {
  $regularLine = if ($c.regular) { "<text x=`"$($c.x+28)`" y=`"$($c.y+87)`" fill=`"#6d6680`" font-size=`"17`">$($c.regular)</text>" } else { '' }
  $svg += "<rect x=`"$($c.x)`" y=`"$($c.y)`" width=`"500`" height=`"205`" rx=`"20`" fill=`"$($c.fill)`" stroke=`"#d9c9ff`" stroke-width=`"2`"/><text x=`"$($c.x+28)`" y=`"$($c.y+52)`" fill=`"#3d267f`" font-size=`"27`" font-weight=`"700`">$($c.title)</text>$regularLine<text x=`"$($c.x+28)`" y=`"$($c.y+121)`" fill=`"#5d35d6`" font-size=`"27`" font-weight=`"700`">$($c.price)</text><text x=`"$($c.x+28)`" y=`"$($c.y+161)`" fill=`"#6d6680`" font-size=`"16`">$($c.a)</text><text x=`"$($c.x+28)`" y=`"$($c.y+186)`" fill=`"#6d6680`" font-size=`"16`">$($c.b)</text>"
}
$svg += @'
</g><rect x="80" y="1480" width="1040" height="215" rx="20" fill="#fff5df" stroke="#f2d79b" stroke-width="2"/><g font-family="Malgun Gothic, Noto Sans KR, sans-serif"><text x="110" y="1522" fill="#8a5b00" font-size="24" font-weight="700">샘플 구매 가능 · 판매가의 25%</text><text x="110" y="1566" fill="#6f5b31" font-size="19">기본 범위를 넘는 분량·추가 수정·자료조사·표/차트/이미지</text><text x="110" y="1600" fill="#6f5b31" font-size="19">긴급 작업·번역은 작업량에 따라 별도 비용이 발생할 수 있습니다.</text><text x="110" y="1634" fill="#6f5b31" font-size="19">본 작업 전환 시 결제한 샘플 기본금액을 전액 차감합니다.</text><text x="110" y="1668" fill="#6f5b31" font-size="19">자막 제작: 기준가 39,000원 → 오픈 30% 할인 27,000원 (건당)</text><text x="80" y="1725" fill="#7b718d" font-size="18">기본 납기 당일~2일 · 제공자료 기준 작성 · 수정 1회 포함 · 최종 제출 전 사실 확인 필요</text></g></svg>
'@
Set-Content -LiteralPath $outputSvg -Value $svg -Encoding UTF8

