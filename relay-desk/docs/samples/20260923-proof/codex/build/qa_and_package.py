from pathlib import Path
import json,subprocess,shutil,re
from pypdf import PdfReader,PdfWriter
from PIL import Image,ImageDraw,ImageFont
R=Path(__file__).resolve().parents[2]; C=R/'codex'; O=R/'ready';O.mkdir(exist_ok=True)
for name in ['Swan_01_Before','Swan_02_Edited_Report']:
 shutil.copy2(C/f'output-v4/{name}.docx',O/f'{name}.docx')
 shutil.copy2(C/f'build/{name}-v4/{name}.pdf',O/f'{name}.pdf')
shutil.copy2(C/'output-v3/Swan_03_Report_to_PPT.pptx',O/'Swan_03_Report_to_PPT.pptx')
for name in ['Swan_Subtitle_Compare_21s.mp4','Swan_Subtitle_Compare_21s_ko.srt','Swan_Subtitle_Compare_21s_en.srt']:
 shutil.copy2(R/'opus-output'/name,O/name)
before=PdfReader(O/'Swan_01_Before.pdf');after=PdfReader(O/'Swan_02_Edited_Report.pdf')
assert len(before.pages)==1 and len(after.pages)==2
comparison=PdfWriter();comparison.append(before);comparison.append(after);comparison.write(O/'Swan_Document_Before_After.pdf')
font=ImageFont.truetype(r'C:\Windows\Fonts\malgun.ttf',26)
canvas=Image.new('RGB',(1320,850),'#eeeeee');d=ImageDraw.Draw(canvas)
d.text((20,12),'swan · 보고서에서 PPT로 / 자체 제작 샘플',font=font,fill='black')
for i in range(4):
 im=Image.open(C/f'build/slides-v3/slide-{i+1}.png').convert('RGB');im.thumbnail((630,355));canvas.paste(im,(20+(i%2)*650,65+(i//2)*380))
canvas.save(O/'Swan_PPT_Preview.jpg',quality=94)
canvas=Image.new('RGB',(1640,1160),'#eeeeee');d=ImageDraw.Draw(canvas)
for i,(label,path) in enumerate([('편집 전 · 자체 작성 원문',C/'build/Swan_01_Before-v4/page-1.png'),('편집 후 · 2쪽 중 1쪽',C/'build/Swan_02_Edited_Report-v4/page-1.png')]):
 d.text((25+i*820,15),label,font=font,fill='black');im=Image.open(path).convert('RGB');im.thumbnail((790,1070));canvas.paste(im,(15+i*820,65))
canvas.save(O/'Swan_Document_Before_After.jpg',quality=94)
def sec(s):
 h,m,ss=re.split(':',s);return int(h)*3600+int(m)*60+float(ss.replace(',','.'))
rows=[]
for block in (O/'Swan_Subtitle_Compare_21s_ko.srt').read_text(encoding='utf-8-sig').strip().split('\n\n'):
 lines=block.splitlines();a,b=lines[1].split(' --> ');a,b=sec(a),sec(b);text=lines[2:]
 assert b>a and len(text)<=2 and max(map(len,text))<=20
 if rows:assert a>=rows[-1]['end']
 rows.append({'id':int(lines[0]),'start':a,'end':b,'cps':round(sum(map(len,text))/(b-a),2)})
assert len(rows)==5 and all(x['cps']<=15 for x in rows)
ff=r'C:\Users\vdfr7\Documents\Codex\relay-desk-site\tools\ffmpeg\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe'
check=subprocess.run([ff,'-v','error','-i',str(O/'Swan_Subtitle_Compare_21s.mp4'),'-f','null','-'],capture_output=True,text=True)
assert check.returncode==0 and not check.stderr.strip(),check.stderr
report={'documentPages':len(after.pages),'beforePages':len(before.pages),'slideCount':4,'subtitleBlocks':rows,'videoDecodeErrors':check.stderr,'externalPaidApiCalls':0,'nativeWordPowerPointTested':False,'phonePlaybackTested':False,'independentTranscription':'medium CPU int8, script not provided, all 5 dialogue groups recovered; word timestamps approximate, not exact sync proof'}
(O/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
