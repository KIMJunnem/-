from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import json
from PIL import ImageFont

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'output-v4'
OUT.mkdir(exist_ok=True)
RAW='''스완은 갖고 있는 자료를 정리해 주는 브랜드로 생각하고 있다. 영상은 한국어 자막을 만들고 외국어 영상이면 한국어로 옮겨 자막을 만든다. 자막 파일과 영상에 입히는 건 구분해서 안내해야 한다. 문서는 초안이 있으면 내용이나 순서, 표현을 정리한다. 피피티는 보고서나 원고를 받아서 발표용으로 바꿔준다. 가격보다 먼저 뭘 해주는 건지 알게 하고 싶다. 흑백 위주로 단정하게 하고 네모나 동그라미 같은 장식은 안 넣었으면 한다. 샘플은 자체 제작이라고 밝히고 원본이랑 수정한 걸 같이 보여 주면 좋겠다. 고객에게 자료가 있는지랑 어디에 쓸 건지, 언제 필요한지 물어본다. 만들기 전에는 범위와 일정 확인하고 완성하고 나서는 원문 내용이 달라지지 않았는지, 실제 파일이 열리는지 확인한다. 영상이면 자막이 음성보다 늦거나 빠르지 않은지도 본다. 작업 중 배운 건 수정 이유를 기록해서 다음 작업의 체크리스트로 쓴다. 이걸 AI가 스스로 학습해서 성능이 좋아졌다고 쓰지는 않는다. 고객 이름이나 후기 같은 걸 지어내지 않는다.'''

def make(title):
 d=Document();s=d.sections[0]
 for sty in d.styles:
  rpr=sty.element.find(qn('w:rPr'))
  if rpr is not None:
   fonts=rpr.find(qn('w:rFonts'))
   if fonts is not None:
    fonts.attrib.clear()
    for key in ['ascii','hAnsi','eastAsia','cs']:
     fonts.set(qn('w:'+key),'Pretendard')
  ppr=sty.element.find(qn('w:pPr'))
  if ppr is not None:
   for border in list(ppr.findall(qn('w:pBdr'))):ppr.remove(border)
 for name in ['Normal','Title','Subtitle','Heading 1','Heading 2']:
  ppr=d.styles[name].element.get_or_add_pPr()
  wrap=OxmlElement('w:wordWrap');wrap.set(qn('w:val'),'0');ppr.append(wrap)
 s.page_width=Inches(8.5);s.page_height=Inches(11)
 s.top_margin=Inches(.70);s.bottom_margin=Inches(.68)
 s.left_margin=s.right_margin=Inches(.8)
 s.header_distance=s.footer_distance=Inches(.3)
 for name in ['Normal','Title','Subtitle','Heading 1','Heading 2']:
  sty=d.styles[name];sty.font.name='Pretendard';sty.font.color.rgb=RGBColor(0,0,0)
  sty.element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'Pretendard')
 n=d.styles['Normal'];n.font.size=Pt(10.5);n.paragraph_format.line_spacing=1.35;n.paragraph_format.space_after=Pt(8)
 for name,size in [('Title',29),('Heading 1',21),('Heading 2',13)]:
  sty=d.styles[name];sty.font.size=Pt(size);sty.font.bold=True
  sty.paragraph_format.space_before=Pt(16 if name!='Title' else 0);sty.paragraph_format.space_after=Pt(7)
  sty.paragraph_format.keep_with_next=True
 h=s.header.paragraphs[0];h.text='swan  /  DOCUMENT DESIGN';h.runs[0].font.size=Pt(8)
 f=s.footer.paragraphs[0];f.text='자체 제작 시연 자료 · 실제 고객 의뢰물이나 성과 보고가 아닙니다.   '
 f.runs[0].font.size=Pt(7.5);f.runs[0].font.color.rgb=RGBColor.from_string('666666')
 field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');f._p.append(field)
 d.core_properties.title=title;d.core_properties.author='swan';d.core_properties.subject='자체 제작 브랜드 운영안 편집 시연'
 return d

def p(d,text,bold=False,size=None):
 fontpath=Path(r'C:/Users/vdfr7/Documents/Codex/Swan-Assets/fonts/Pretendard')/('Pretendard-Bold.ttf' if bold else 'Pretendard-Regular.ttf')
 font=ImageFont.truetype(str(fontpath),int((size or 10.5)*8))
 lines=[]
 for para in text.split('\n'):
  line=''
  for word in para.split(' '):
   candidate=(line+' '+word).strip()
   if line and font.getlength(candidate)>6.9*72*8*.93:
    lines.append(line);line=word
   else:line=candidate
  lines.append(line)
 text='\n'.join(lines)
 q=d.add_paragraph();r=q.add_run(text);r.bold=bold
 if size:r.font.size=Pt(size)
 return q

d=make('Swan 브랜드 운영 메모')
d.add_heading('Swan 브랜드 운영 메모',0)
p(d,'편집 전 원문',True,12)
p(d,'비교 시연을 위해 작성한 자체 원문입니다. 아래의 의미와 조건을 유지하면서 정보의 순서와 표현을 정리합니다.')
p(d,RAW)
d.save(OUT/'Swan_01_Before.docx')

d=make('Swan 브랜드 콘텐츠 운영안')
d.add_heading('swan 브랜드 콘텐츠 운영안',0)
p(d,'고객의 원자료를 기준으로 문서와 발표 자료의 구조를 정리하고,\n영상에는 한국어 자막을 제작합니다.',True,15)
p(d,'이 운영안은 swan의 자체 제작 샘플입니다. 앞선 운영 메모를 서비스 안내와 제작 기준으로 정리한 예시이며, 실제 고객 실적을 소개하는 자료는 아닙니다.')
d.add_heading('맡길 자료와 받을 결과를 먼저 보여줍니다',1)
p(d,'추상적인 전문성이나 저렴한 가격을 앞세우기보다, 고객이 맡길 수 있는 자료와 작업 후 받을 결과를 구체적으로 설명합니다. 서비스별 작업 경계도 처음 안내할 때 함께 제시합니다.')
for h,t in [
 ('영상 자막','한국어 영상에는 한국어 자막을, 외국어 영상에는 한국어 번역 자막을 제작합니다. 자막 파일 제작과 영상에 자막을 삽입하는 작업은 구분해 안내합니다.'),
 ('일반 문서','고객이 제공한 초안의 내용과 의도를 유지하면서 순서와 표현을 정리합니다. 제목과 본문을 구분해 필요한 내용을 빠르게 찾을 수 있도록 편집합니다.'),
 ('보고서와 원고의 PPT 변환','받은 보고서나 원고를 발표 흐름에 맞춰 재구성합니다. 문장을 그대로 옮겨 넣기보다 슬라이드마다 전달할 핵심을 나눕니다.')]:
 d.add_heading(h,2);p(d,t)
d.add_heading('보여주는 방식도 단정하게 맞춥니다',2)
p(d,'흑백을 중심으로 글자의 크기와 굵기, 간격으로 중요도를 구분합니다. 상자나 원형 장식은 쓰지 않습니다. 자체 제작 샘플에는 편집 전후를 함께 보여주고 실제 고객 작업과 구분합니다.')
d.add_page_break()
d.add_heading('자료 확인부터 검수까지',0)
p(d,'작업 범위를 먼저 확인하고, 결과물은 원문과 실제 사용 환경을 기준으로 점검합니다.',True,15)
d.add_heading('시작할 때 확인할 세 가지',1)
for h,t in [('01  원자료','기존 영상이나 초안, 보고서가 있는지 확인합니다. 받은 자료가 열리는지도 먼저 살펴봅니다.'),('02  사용 목적','어디에 쓰고 누가 읽거나 볼 자료인지 확인합니다. 목적에 맞춰 정보의 순서와 밀도를 정합니다.'),('03  필요한 시점','희망 마감을 확인한 뒤 작업 범위와 일정을 합의합니다. 확정하지 않은 작업을 이미 진행 중이라고 안내하지 않습니다.')]:
 d.add_heading(h,2);p(d,t)
d.add_heading('완성 후 확인할 기준',1)
p(d,'내용  원문 대조로 의미가 달라지거나 조건이 빠진 곳이 없는지 확인합니다.')
p(d,'파일  문서와 PPT가 실제로 열리고, 글자가 잘리거나 겹치지 않는지 확인합니다.')
p(d,'자막  음성과 자막의 시각을 비교해 늦거나 빠른 구간을 점검합니다.')
d.add_heading('검수에서 배운 점을 다음 작업에 남깁니다',2)
p(d,'수정한 부분과 수정 이유를 기록해 다음 작업의 체크리스트에 반영합니다. 이 기록의 축적을 AI 모델의 자체 학습이나 성능 향상 증거로 표현하지 않습니다. 고객 이름과 후기, 실적은 지어내지 않습니다.')
d.save(OUT/'Swan_02_Edited_Report.docx')
(ROOT/'source-memo.txt').write_text(RAW,encoding='utf-8')
(ROOT/'content-map.json').write_text(json.dumps({'source':'source-memo.txt','report':'output/Swan_02_Edited_Report.docx','deckMap':{'1':'원자료 기반 브랜드 방향','2':'영상 자막·일반 문서·PPT 작업 경계','3':'원자료·사용 목적·희망 마감 확인','4':'원문·파일·싱크 검수와 수정 이유 기록'},'claims':'전후 비교용 자체 원문. 실제 고객 자료, 후기, 성과 수치 없음.','font':'Pretendard: 3종 실제 원고 렌더링 비교 후 제목의 명확한 굵기와 본문 가독성으로 선택.'},ensure_ascii=False,indent=2),encoding='utf-8')
print('Created 2 DOCX files and source map')
