from pathlib import Path
import html,json,subprocess,shutil
from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph as WordParagraph
from docx.table import Table as WordTable
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,PageBreak,Table,TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor,black,white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader
from PIL import Image

R=Path(__file__).resolve().parent.parent;O=R/'ready';B=R/'build'
F=Path('C:/Users/vdfr7/Documents/Codex/Swan-Assets/fonts/Pretendard')
for name,file in [('Body','Pretendard-Regular.ttf'),('BodyBold','Pretendard-Bold.ttf')]:pdfmetrics.registerFont(TTFont(name,str(F/file)))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='BodyBold',italic='Body',boldItalic='BodyBold')
styles={
 'Normal':ParagraphStyle('body',fontName='Body',fontSize=11,leading=17,spaceAfter=11,wordWrap='CJK'),
 'Title':ParagraphStyle('title',fontName='BodyBold',fontSize=29,leading=35,spaceBefore=5,spaceAfter=18,wordWrap='CJK',keepWithNext=True),
 'Heading 2':ParagraphStyle('h2',fontName='BodyBold',fontSize=14,leading=20,spaceBefore=14,spaceAfter=7,wordWrap='CJK',keepWithNext=True),
 'Cell':ParagraphStyle('cell',fontName='Body',fontSize=9.4,leading=14,wordWrap='CJK'),
 'CellHead':ParagraphStyle('cellHead',fontName='BodyBold',fontSize=9.4,leading=14,textColor=white,wordWrap='CJK')}
POP=Path('C:/Users/vdfr7/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe')
def markup(p):
 parts=[]
 for run in p.runs:
  t=html.escape(run.text).replace('\n','<br/>')
  parts.append('<b>'+t+'</b>' if run.bold else t)
 return ''.join(parts)
def cell_markup(text,width,font):
 lines=[]
 for para in text.split('\n'):
  line=''
  for word in para.split():
   candidate=(line+' '+word).strip()
   if line and pdfmetrics.stringWidth(candidate,font,9.4)>width-19:
    lines.append(line);line=word
   else:line=candidate
  lines.append(line)
 return '<br/>'.join(html.escape(x) for x in lines)
def page(canvas,doc):
 canvas.setFont('BodyBold',18);canvas.setFillColor(HexColor('#B0B0B0'));canvas.drawRightString(A4[0]-55,A4[1]-35,'swan · SAMPLE')
 canvas.setFont('Body',8);canvas.setFillColor(HexColor('#666666'));canvas.drawString(55,28,'swan  /  자체 제작 시연 샘플');canvas.drawRightString(A4[0]-55,28,f'{doc.page:02d}')

results=[]
for src in sorted(O.glob('0*.docx')):
 d=Document(src);story=[]
 for elem in d.element.body:
  if elem.tag==qn('w:p'):
   p=WordParagraph(elem,d)
   if any(br.get(qn('w:type'))=='page' for br in elem.iter(qn('w:br'))):story.append(PageBreak());continue
   if not p.text.strip():continue
   base=styles.get(p.style.name,styles['Normal'])
   size=p.runs[0].font.size.pt if p.runs and p.runs[0].font.size else base.fontSize
   if p.style.name=='Normal':
    base=ParagraphStyle('inline',parent=base,fontSize=size,leading=size*1.45,spaceAfter=11)
   story.append(Paragraph(markup(p),base))
  elif elem.tag==qn('w:tbl'):
   wt=WordTable(elem,d)
   widths=[c.width.pt for c in wt.columns];factor=(A4[0]-110)/sum(widths);widths=[w*factor for w in widths]
   rows=[]
   for ri,row in enumerate(wt.rows):rows.append([Paragraph(cell_markup(c.text,widths[ci],'BodyBold' if ri==0 else 'Body'),styles['CellHead' if ri==0 else 'Cell']) for ci,c in enumerate(row.cells)])
   t=Table(rows,colWidths=widths,repeatRows=1,hAlign='LEFT')
   t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#222222')),('ROWBACKGROUNDS',(0,1),(-1,-1),[white,HexColor('#F5F5F5')]),('GRID',(0,0),(-1,-1),.35,HexColor('#D9D9D9')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9)]))
   story.extend([t,Spacer(1,12)])
 pdf=O/(src.stem+'.pdf')
 SimpleDocTemplate(str(pdf),pagesize=A4,leftMargin=55,rightMargin=55,topMargin=65,bottomMargin=53,title=src.stem,author='swan').build(story,onFirstPage=page,onLaterPages=page)
 reader=PdfReader(pdf);texts=[p.extract_text() for p in reader.pages]
 assert len(texts)==2,(src.name,len(texts))
 assert all('swan' in text and 'SAMPLE' in text for text in texts)
 target=B/src.stem;target.mkdir(exist_ok=True)
 subprocess.run([str(POP),'-scale-to','1550','-png',str(pdf),str(target/'page')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 for i,path in enumerate(sorted(target.glob('page-*.png'))):
  im=Image.open(path).convert('RGB');im.save(O/(src.stem+f'_p{i+1}.jpg'),quality=94)
 results.append({'file':pdf.name,'pages':len(texts),'watermarks':True,'renderer':'reportlab PDF + bundled Poppler; not a DOCX rendering','docxStatus':'authoring draft only; not customer deliverable'})
(B/'pdf-checks.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(results,ensure_ascii=False,indent=2))
