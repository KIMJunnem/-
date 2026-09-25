from pathlib import Path
import shutil,hashlib,json,re,html,subprocess,zipfile
from PIL import Image,ImageDraw,ImageFont
from pypdf import PdfReader,PdfWriter

R=Path(__file__).resolve().parent.parent;O=R/'ready';B=R/'build'
PROJECT=R.parents[2]
PRE=PROJECT/'docs/samples/20260923-professional'
PROOF=PROJECT/'docs/samples/20260923-proof'
MULTI=Path('C:/Users/vdfr7/Documents/Codex/2026-09-13/37/swan-samples-20260923/multilingual-v2/output')
FF=PROJECT/'tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe'
FONT=Path('C:/Users/vdfr7/Documents/Codex/Swan-Assets/fonts/Pretendard/Pretendard-Regular.ttf')
FONTB=FONT.with_name('Pretendard-Bold.ttf')
items=[];copies=[]
def cp(src,name):
 dst=O/name;shutil.copy2(src,dst)
 a=hashlib.sha256(src.read_bytes()).hexdigest();b=hashlib.sha256(dst.read_bytes()).hexdigest();assert a==b
 copies.append({'from':str(src),'to':name,'sha256':b});return name

for code,title,group,desc,fit in [
 ('01_Writing_Brand_Article','일반 글 작성','문서','브랜드 소개 원고와 작성에 사용한 자체 자료를 함께 보여드립니다.','소개글·블로그 원고·제공 자료 기반 글'),
 ('02_Proofreading_Before_After','교정과 교열','문서','문장의 의미를 유지한 전후 비교와 수정 이유입니다.','기존 원고의 오탈자·띄어쓰기·문장 다듬기'),
 ('03_Formatting_Before_After','문서 양식과 편집 정리','문서','같은 원문을 제목과 본문으로 나눈 전후 비교입니다.','내용을 유지하는 가독성·양식 개선'),
 ('04_Transcription_Interview','녹취 타이핑','문서','공개 한국어 인터뷰의 시간 표시 기록과 읽기용 정리본입니다.','인터뷰·회의 기록 정리, 인증 녹취록 제외'),
 ('05_Script_60s_Brand','대본과 영상 구성안','대본','자체 브랜드 설명 영상의 장면 구성과 내레이션 원고입니다.','대본·시나리오, 별도 범위와 견적 확인')]:
  items.append({'id':code,'title':title,'group':group,'description':desc,'fit':fit,'type':'document','file':code+'.pdf','preview':code+'_p1.jpg','pages':2,'sendStatus':'ready_pdf','message':'요청하신 작업과 가까운 자체 제작 샘플을 보내드립니다. '+desc})

cp(PRE/'ready/Swan_Professional_Report.pdf','06_Professional_Report.pdf')
cp(PRE/'ready/Swan_Report_Preview.jpg','06_Professional_Report_preview.jpg')
items.append({'id':'06_Professional_Report','title':'전문 보고서','group':'문서','description':'고객 문의와 결제 흐름을 분석하는 운영 설계 보고서 4쪽입니다. 수치는 가상 계산 사례입니다.','fit':'분석 보고서·운영안·기획안','type':'document','file':'06_Professional_Report.pdf','preview':'06_Professional_Report_preview.jpg','pages':4,'sendStatus':'ready_pdf'})
cp(PRE/'ready/Swan_Professional_Presentation_v2.pptx','07_Report_to_Presentation.pptx')
cp(PRE/'ready/Swan_Presentation_Preview.jpg','07_Report_to_Presentation_preview.jpg')
for i in range(1,8):cp(PRE/f'build/slides-v2/slide-{i}.png',f'07_slide_{i}.png')
items.append({'id':'07_Report_to_Presentation','title':'보고서의 PPT 변환','group':'PPT','description':'보고서의 내용을 7장 발표 자료로 옮겼습니다. 편집 가능한 PPTX와 전체 미리보기입니다.','fit':'제공 원고·보고서의 발표 자료 변환','type':'presentation','file':'07_Report_to_Presentation.pptx','preview':'07_Report_to_Presentation_preview.jpg','pages':7,'sendStatus':'ready_preview','companion':'06_Professional_Report.pdf'})

def seconds(t):
 h,m,s=t.replace(',','.').split(':');return int(h)*3600+int(m)*60+float(s)
def srt_blocks(path):
 out=[]
 for b in re.split(r'\n\s*\n',path.read_text(encoding='utf-8-sig').strip()):
  l=b.splitlines();start,end=map(seconds,l[1].split(' --> '));out.append({'n':int(l[0]),'start':start,'end':end,'text':' '.join(l[2:]),'lines':l[2:]})
 return out
video_specs=[]
for lang,label in [('ko','한국어 영상의 한국어 자막'),('fr','프랑스어 영상의 한국어 자막'),('ja','일본어 영상의 한국어 자막'),('zh','중국어 지역어 영상의 한국어 자막')]:
 stem='08_'+lang+'_Subtitle_60s';cp(MULTI/f'Swan_{lang}_60s_v2.mp4',stem+'.mp4');cp(MULTI/f'Swan_{lang}_60s_v2_ko.srt',stem+'.srt');cp(MULTI/f'Swan_{lang}_v2_preview.jpg',stem+'_preview.jpg')
 video_specs.append((stem,60))
 items.append({'id':stem,'title':label,'group':'자막','description':('60초 수정본 v2. 한국어 인터뷰의 긴 쉼을 줄인 발췌본입니다.' if lang=='ko' else '60초 수정본 v2. 원음을 유지하고 한국어 번역 자막을 넣었습니다.')+(' 허난 지역어 소재로 표준중국어 샘플과 구분합니다.' if lang=='zh' else ''),'fit':'한국어 SRT 자막'+('' if lang=='ko' else '·한국어 번역 자막'),'type':'video','file':stem+'.mp4','srt':stem+'.srt','preview':stem+'_preview.jpg','sendStatus':'review_copy','limitation':'렌더링 시간축은 대조했으나 최종 음성 청취와 모바일 재생 승인은 별도입니다.','license':'CC BY-SA 4.0'})

stem='09_English_Korean_Compare_21s'
cp(PROOF/'ready/Swan_Subtitle_Compare_21s.mp4',stem+'.mp4');cp(PROOF/'ready/Swan_Subtitle_Compare_21s_ko.srt',stem+'.srt')
video_specs.append((stem,21))
items.append({'id':stem,'title':'영어 원문과 한국어 번역 비교','group':'자막','description':'영어 대사와 한국어 번역을 함께 보여주는 21초 비교 영상입니다.','fit':'영어 영상의 한국어 번역 자막','type':'video','file':stem+'.mp4','srt':stem+'.srt','preview':stem+'_preview.jpg','sendStatus':'review_copy','limitation':'기존 번역 교차 검수와 독립 전사 기록 보유. 모바일 최종 청취 승인은 별도입니다.','license':'CC BY 3.0'})

checks=[]
for stem,duration in video_specs:
 video=O/(stem+'.mp4');caps=srt_blocks(O/(stem+'.srt'));folder=B/stem;folder.mkdir(exist_ok=True)
 dec=subprocess.run([str(FF),'-v','error','-i',str(video),'-f','null','-'],capture_output=True,text=True)
 assert dec.returncode==0 and not dec.stderr.strip(),(stem,dec.stderr)
 assert all(c['end']>c['start'] and c['end']<=duration for c in caps)
 assert all(a['end']<=b['start'] for a,b in zip(caps,caps[1:]))
 timestamps=[(c['start']+c['end'])/2 for c in caps]+[.1,duration-.2]
 thumb=(360,640);cols=5;rows=(len(timestamps)+cols-1)//cols
 sheet=Image.new('RGB',(cols*360,rows*675),(235,235,235));draw=ImageDraw.Draw(sheet);font=ImageFont.truetype(str(FONT),19)
 for i,t in enumerate(timestamps):
  path=folder/f'frame-{i+1:02d}.jpg'
  subprocess.run([str(FF),'-y','-v','error','-ss',str(t),'-i',str(video),'-frames:v','1',str(path)],check=True,capture_output=True)
  im=Image.open(path);im.thumbnail(thumb);x=i%cols*360;y=i//cols*675
  sheet.paste(im,(x,y));draw.text((x+8,y+644),f'{i+1:02d}   {t:.2f}s',font=font,fill='black')
 sheet.save(folder/'all-captions.jpg',quality=92)
 if stem.startswith('09_'):shutil.copy2(folder/'frame-02.jpg',O/(stem+'_preview.jpg'))
 checks.append({'file':video.name,'decode':'passed','captionCount':len(caps),'allCaptionFrames':str(folder/'all-captions.jpg'),'newListeningReview':False,'timingEvidence':str(MULTI/'render-sync-verification.json') if stem.startswith('08_') else str(PROOF/'ready/verification.json')})

cp(MULTI/'README_수정내역과출처.md','Subtitle_Sources_CC_BY_SA.md')
cp(PROOF/'ready/README.md','English_Subtitle_Source_and_Review.md')
(B/'video-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf8')
(B/'copied-file-hashes.json').write_text(json.dumps(copies,ensure_ascii=False,indent=2),encoding='utf8')
(O/'catalog.json').write_text(json.dumps({'brand':'swan','version':'2026-09-24.1','items':items,'customerDataUsed':False,'paidApiCalls':0},ensure_ascii=False,indent=2),encoding='utf8')

sections=[]
for i,item in enumerate(items):
 links=f'<a href="{item["file"]}" download>파일 받기</a>'
 if 'srt' in item:links+=f' <a href="{item["srt"]}" download>SRT 받기</a>'
 if item['type']=='video':media=f'<video controls playsinline preload="none" poster="{item["preview"]}" src="{item["file"]}"></video>'
 else:media=f'<a href="{item["file"]}"><img loading="lazy" src="{item["preview"]}" alt="{item["title"]} 미리보기"></a>'
 note=f'<p class="note">{item.get("limitation", "")}</p>' if item.get('limitation') else ''
 sections.append(f'<article data-group="{item["group"]}"><div class="media">{media}</div><div class="copy"><small>{i+1:02d} / {item["group"]}</small><h2>{item["title"]}</h2><p>{item["description"]}</p><p class="fit">추천 요청 · {item["fit"]}</p><nav>{links}</nav>{note}</div></article>')
css='''*{box-sizing:border-box}body{margin:0;background:#f4f3ef;color:#151515;font:16px system-ui,sans-serif;line-height:1.7}main{max-width:1120px;margin:auto;padding:48px 32px}header{padding:20px 0 48px}h1{font-size:70px;line-height:1;letter-spacing:-4px;margin:0 0 26px;font-weight:550}h2{font-size:27px;line-height:1.35;letter-spacing:-.8px}header p{max-width:700px}small{font-size:12px;letter-spacing:1px;color:#666}button{background:none;color:#333;border:0;border-bottom:2px solid transparent;padding:10px 14px;font:inherit;cursor:pointer}button.active{border-color:#111;font-weight:700}article{display:grid;grid-template-columns:1fr 1fr;gap:52px;padding:52px 0;border-top:1px solid #ccc;align-items:start}.media{background:#e9e8e4;text-align:center;padding:18px}img{display:block;width:100%;max-height:530px;object-fit:contain}video{display:block;max-width:100%;height:480px;margin:auto}.copy{padding-top:16px}nav a{display:inline-block;margin:12px 18px 6px 0;color:#111;text-underline-offset:5px}.fit,.note{font-size:13px;color:#666}.note{margin-top:24px}footer{border-top:1px solid #aaa;padding:30px 0;font-size:13px}article[hidden]{display:none}@media(max-width:700px){main{padding:28px 20px}h1{font-size:58px}article{grid-template-columns:1fr;gap:16px;padding:32px 0}.copy{padding-top:0}h2{font-size:24px}video{height:440px}}'''
js="document.querySelectorAll('button[data-filter]').forEach(b=>b.onclick=()=>{document.querySelectorAll('button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('article').forEach(x=>x.hidden=b.dataset.filter!=='전체'&&x.dataset.group!==b.dataset.filter)});"
page='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>swan 작업별 샘플</title><style>'+css+'</style><main><header><small>WORK SAMPLES / 2026.09</small><h1>swan</h1><p>글을 정리하고, 발표 자료로 옮기고, 영상에 자막을 붙입니다.<br>작업별 결과물을 골라 확인해 보세요.</p><p class="note">문서와 대본은 자체 제작 시연 자료입니다. 영상은 재사용이 허용된 원작을 편집했으며 출처와 라이선스를 함께 제공합니다. 실제 고객 실적이나 후기 자료가 아닙니다.</p><nav>'+''.join(f'<button class="{"active" if x=="전체" else ""}" data-filter="{x}">{x}</button>' for x in ['전체','문서','PPT','대본','자막'])+'</nav></header>'+''.join(sections)+'<footer><p>흑백 구성 · swan SAMPLE 표시 · 고객 요청에 맞는 샘플 1개부터 안내</p><a href="Subtitle_Sources_CC_BY_SA.md">60초 영상 출처</a> · <a href="English_Subtitle_Source_and_Review.md">영어 비교 영상 출처</a><p>영상에는 SRT 기본 납품과 별개인 자막 삽입 시연이 포함됩니다. 삽입 옵션은 별도 범위입니다.</p></footer></main><script>'+js+'</script></html>'
(O/'index.html').write_text(page,encoding='utf8')

# A concise overview image of actual artifacts, not invented visual mockups.
canvas=Image.new('RGB',(1600,1560),'#F4F3EF');draw=ImageDraw.Draw(canvas)
draw.text((42,30),'swan / 작업별 샘플',font=ImageFont.truetype(str(FONTB),44),fill='#111111')
for i,item in enumerate(items):
 x=35+i%4*395;y=125+i//4*470
 im=Image.open(O/item['preview']).convert('RGB');im.thumbnail((350,370));canvas.paste(im,(x+(350-im.width)//2,y))
 title=item['title'].replace('영상의 한국어 자막',' → 한국어 자막')
 draw.text((x,y+380),f'{i+1:02d} {title}',font=ImageFont.truetype(str(FONTB),19),fill='#111111')
canvas.save(O/'Swan_All_Samples.jpg',quality=95)

readme='''# swan 작업별 샘플 모음

index.html을 열어 작업별로 고릅니다. 총 12개 샘플입니다.
- 신규 PDF 5종: 일반 글 작성, 교정, 양식 편집, 녹취 타이핑, 대본. 각 2쪽.
- 기존 검수본: 전문 보고서 4쪽, 보고서 기반 PPT 7장.
- 기존 자막 수정본: 한국어·프랑스어·일본어·중국어 지역어 60초, 영어 비교 21초. SRT 포함.

문서 PDF와 이미지는 고객 미리보기 후보입니다. 신규 DOCX는 내부 작성 원본이며 렌더 검증이 안 돼 이 배포 묶음에서 제외했습니다. HWP 변환 파일도 만들지 않았습니다. PPT는 기존 검수된 v2 파일입니다.

영상은 이번에 전체 디코딩과 모든 자막 표시 프레임을 점검합니다. 기존 최종 MP4의 파형 대조 기록을 유지했습니다. 이번 새 음성 청취, 모바일 재생 승인은 하지 않았으며 review_copy 상태입니다. 자동 발송하지 마세요. 자막 삽입은 기본 SRT와 별도 옵션입니다.

CC BY-SA 영상과 인터뷰 파생 기록은 출처·라이선스·변경 표시를 유지하고 동일 라이선스를 적용합니다. 다른 자체 문서나 PPT 전체에 이 라이선스를 적용한다는 뜻은 아닙니다. 영어 비교 영상은 CC BY 3.0입니다.

일반 글·교정·양식 편집을 서로 구분합니다. 인포그래픽 디자인 의뢰에 글 작성 샘플을 대응되는 결과물처럼 보내지 않습니다. 대본 문의는 원고 범위 확인 후 별도 견적입니다. 자소서·이력서 샘플은 포함하지 않았습니다.

고객에게는 요청에 가까운 1개만 먼저 첨부하세요. 로컬 경로는 공개 링크가 아닙니다. 실제 업로드·발송·공개 게시·가격 변경·유료 API 호출은 이번 작업에 없습니다.
'''
(O/'README.md').write_text(readme,encoding='utf8')
with zipfile.ZipFile(R/'Swan_All_Service_Samples.zip','w',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
 for path in O.iterdir():
  if path.suffix.lower() not in ['.docx','.zip'] and path.is_file():z.write(path,path.name)
print(json.dumps({'items':len(items),'zip':str(R/'Swan_All_Service_Samples.zip'),'videoChecks':checks},ensure_ascii=False))
