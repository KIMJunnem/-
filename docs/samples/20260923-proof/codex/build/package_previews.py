from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
R=Path(__file__).resolve().parent.parent
O=R/'output-v2'
font=ImageFont.truetype(r'C:\Windows\Fonts\malgun.ttf',26)
canvas=Image.new('RGB',(1320,850),'#eeeeee')
d=ImageDraw.Draw(canvas);d.text((20,12),'swan · 보고서에서 PPT로 / 자체 제작 샘플',font=font,fill='black')
for i in range(4):
 im=Image.open(R/f'build/slides/slide-{i+1}.png').convert('RGB');im.thumbnail((630,355))
 canvas.paste(im,(20+(i%2)*650,65+(i//2)*380))
canvas.save(O/'Swan_PPT_Preview.jpg',quality=94)
canvas=Image.new('RGB',(1640,1160),'#eeeeee');d=ImageDraw.Draw(canvas)
for i,(label,path) in enumerate([('편집 전 · 자체 작성 원문',R/'build/before-render-v2/page-1.png'),('편집 후 · 2쪽 중 1쪽',R/'build/report-render-v2/page-1.png')]):
 d.text((25+i*820,15),label,font=font,fill='black')
 im=Image.open(path).convert('RGB');im.thumbnail((790,1070));canvas.paste(im,(15+i*820,65))
canvas.save(O/'Swan_Document_Before_After.jpg',quality=94)
print('Created 2 preview JPGs')
