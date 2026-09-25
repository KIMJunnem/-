from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
root=Path(r'C:/Users/vdfr7/Documents/Codex/Swan-Assets/fonts')
out=Path(r'C:/Users/vdfr7/Documents/Codex/relay-desk-site/docs/samples/20260923-proof/codex/build')
im=Image.new('RGB',(1500,810),'white');d=ImageDraw.Draw(im)
for i,(name,folder,prefix) in enumerate([('Pretendard','Pretendard','Pretendard'),('SUIT','SUIT','SUIT'),('IBM Plex Sans KR','ibmplexsanskr','IBMPlexSansKR')]):
 y=35+i*265
 d.text((48,y),name,font=ImageFont.truetype(str(root/folder/(prefix+'-Regular.ttf')),23),fill='#777777')
 d.text((48,y+45),'Swan 브랜드 콘텐츠 운영안',font=ImageFont.truetype(str(root/folder/(prefix+'-Bold.ttf')),49),fill='#111111')
 d.text((48,y+127),'흩어진 자료를 정리해 읽고 쓰기 좋은 결과물로 만듭니다.',font=ImageFont.truetype(str(root/folder/(prefix+'-Regular.ttf')),29),fill='#333333')
 d.text((48,y+178),'원문 확인  →  구조 정리  →  내용 검수  |  01 / 02 / 03',font=ImageFont.truetype(str(root/folder/(prefix+'-Regular.ttf')),25),fill='#333333')
im.save(out/'font-comparison.png')
print(out/'font-comparison.png')