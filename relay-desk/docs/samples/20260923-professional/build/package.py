from pathlib import Path
from pypdf import PdfReader
from PIL import Image,ImageDraw,ImageFont
import shutil,json,zipfile
R=Path(__file__).resolve().parent.parent;O=R/'ready';B=R/'build'
pdf=B/'report-render-v3/Swan_Professional_Report.pdf';r=PdfReader(pdf)
assert len(r.pages)==4
assert all('swan · SAMPLE' in p.extract_text() for p in r.pages)
shutil.copy2(pdf,O/pdf.name)
font=ImageFont.truetype('C:/Users/vdfr7/Documents/Codex/Swan-Assets/fonts/Pretendard/Pretendard-Bold.ttf',25)
def sheet(paths,name,w,h,cols,thumb,caption):
 canvas=Image.new('RGB',(w,h),'#E8E8E8');draw=ImageDraw.Draw(canvas);draw.text((22,14),caption,font=font,fill='#111111')
 for i,path in enumerate(paths):
  im=Image.open(path).convert('RGB');im.thumbnail(thumb)
  x=20+(i%cols)*(w//cols);y=65+(i//cols)*(thumb[1]+24)
  canvas.paste(im,(x,y))
 canvas.save(O/name,quality=95)
sheet([B/f'report-render-v3/page-{i}.png' for i in range(1,5)],'Swan_Report_Preview.jpg',1400,1890,2,(660,870),'swan · 전문 보고서 샘플 / 4쪽')
sheet([B/f'slides-v2/slide-{i}.png' for i in range(1,8)],'Swan_Presentation_Preview.jpg',1400,1680,2,(660,372),'swan · 보고서 기반 발표 자료 / 7장')
for a,b,expected in [(72,120,60),(18,72,25),(12,18,66.7),(6,12,50),(6,120,5)]:assert round(a/b*100,1)==expected
readme='''# swan 전문 샘플

- 최종 보고서: Swan_Professional_Report.docx / .pdf (4쪽)
- 최종 발표 자료: Swan_Professional_Presentation_v2.pptx (7장, 편집 가능, Pretendard 포함)
- 이미지: Swan_Report_Preview.jpg / Swan_Presentation_Preview.jpg
- 모든 페이지에 swan · SAMPLE 표시. 계약 납품본은 별도 합의한 표시 사용.
- 실제 고객 실적이 아닌 자체 제작 운영 설계. 숫자는 가상 계산 사례.
- 이전 PPT 파일은 보관용 초안이다. v2가 최종본이다.
- PDF는 LibreOffice, PPT 이미지는 ArtifactTool 렌더러로 확인. Microsoft Word/PowerPoint에서 직접 열기 및 모바일 확인은 하지 않았다.
- 외부 고객 발송·게시·유료 API 호출 없음.
'''
(O/'README.md').write_text(readme,encoding='utf-8')
files=['Swan_Professional_Report.docx','Swan_Professional_Report.pdf','Swan_Professional_Presentation_v2.pptx','Swan_Report_Preview.jpg','Swan_Presentation_Preview.jpg','README.md']
with zipfile.ZipFile(O/'Swan_Professional_Samples.zip','w',zipfile.ZIP_DEFLATED) as z:
 for name in files:z.write(O/name,name)
print(json.dumps({'pages':len(r.pages),'allPageWatermarks':True,'arithmetic':'passed','zip':str(O/'Swan_Professional_Samples.zip')},ensure_ascii=False))
