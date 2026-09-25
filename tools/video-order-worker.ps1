param(
  [Parameter(Mandatory=$true)][string]$InputVideo,
  [Parameter(Mandatory=$true)][string]$OutputVideo,
  [string]$SubtitleFile,
  [string]$Watermark,
  [double]$StartSeconds = 0,
  [double]$DurationSeconds = 0,
  [ValidateSet('source','16:9','9:16','1:1')][string]$Aspect = 'source',
  [switch]$NormalizeAudio
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ff=(Get-ChildItem (Join-Path $PSScriptRoot 'ffmpeg') -Filter ffmpeg.exe -Recurse|Select-Object -First 1).FullName
$probe=(Get-ChildItem (Join-Path $PSScriptRoot 'ffmpeg') -Filter ffprobe.exe -Recurse|Select-Object -First 1).FullName
if(!$ff -or !$probe){throw 'FFmpeg가 설치되지 않았습니다.'}
if(!(Test-Path -LiteralPath $InputVideo)){throw "입력 영상이 없습니다: $InputVideo"}
New-Item -ItemType Directory -Force -Path (Split-Path $OutputVideo -Parent)|Out-Null
$meta=& $probe -v error -show_entries format=duration:stream=codec_type,width,height -of json -- $InputVideo|ConvertFrom-Json
if(!$meta.format.duration){throw '영상 길이를 확인할 수 없습니다.'}
$filters=@()
switch($Aspect){
 '16:9'{$filters+='scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black'}
 '9:16'{$filters+='scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black'}
 '1:1'{$filters+='scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:black'}
}
if($SubtitleFile){if(!(Test-Path -LiteralPath $SubtitleFile)){throw '자막 파일이 없습니다.'};$escaped=$SubtitleFile.Replace('\','/').Replace(':','\:').Replace("'","\'");$filters+="subtitles='$escaped':force_style='FontName=Malgun Gothic,FontSize=18,Outline=2,Shadow=0,MarginV=28'"}
$args=@('-y','-hide_banner','-loglevel','error')
if($StartSeconds -gt 0){$args+=@('-ss',"$StartSeconds")}
$args+=@('-i',$InputVideo)
if($Watermark){if(!(Test-Path -LiteralPath $Watermark)){throw '워터마크 파일이 없습니다.'};$args+=@('-i',$Watermark);$base=if($filters.Count){'[0:v]'+($filters -join ',')+'[base];'}else{'[0:v]null[base];'};$args+=@('-filter_complex',"${base}[1:v]scale=120:-1[wm];[base][wm]overlay=W-w-24:H-h-24:format=auto[v]",'-map','[v]','-map','0:a?')}elseif($filters.Count){$args+=@('-vf',($filters -join ','))}
if($DurationSeconds -gt 0){$args+=@('-t',"$DurationSeconds")}
if($NormalizeAudio){$args+=@('-af','loudnorm=I=-16:LRA=11:TP=-1.5')}
$args+=@('-c:v','libx264','-preset','medium','-crf','20','-c:a','aac','-b:a','192k','-movflags','+faststart',$OutputVideo)
& $ff @args
if($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $OutputVideo)){throw '렌더링에 실패했습니다.'}
$outMeta=& $probe -v error -show_entries format=duration,size:stream=codec_type,width,height -of json -- $OutputVideo|ConvertFrom-Json
[pscustomobject]@{ok=$true;inputDuration=[double]$meta.format.duration;outputDuration=[double]$outMeta.format.duration;outputBytes=[long]$outMeta.format.size;output=$OutputVideo;aspect=$Aspect;subtitles=[bool]$SubtitleFile;watermark=[bool]$Watermark;audioNormalized=[bool]$NormalizeAudio}|ConvertTo-Json -Compress
