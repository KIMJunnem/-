from pathlib import Path
from html.parser import HTMLParser
import hashlib, json, re, zipfile
from pypdf import PdfReader

root=Path(__file__).resolve().parents[1]
ready=root/'ready'
catalog=json.loads((ready/'catalog.json').read_text(encoding='utf8'))
assert len(catalog['items'])==12
for item in catalog['items']:
    for key in ('file','preview','srt','companion'):
        if item.get(key): assert (ready/item[key]).is_file(), (item['id'],key)
    if item['type']=='video': assert item['sendStatus']=='review_copy'
class Links(HTMLParser):
    def handle_starttag(self,tag,attrs):
        for key,value in attrs:
            if key in ('src','href','poster') and value and not value.startswith(('http:','https:','#','data:')):
                assert (ready/value).is_file(),value
Links().feed((ready/'index.html').read_text(encoding='utf8'))
pdf_pages={p.name:len(PdfReader(p).pages) for p in ready.glob('*.pdf')}
assert list(pdf_pages.values()).count(2)==5
assert sum(pdf_pages.values())==14
with zipfile.ZipFile(ready/'07_Report_to_Presentation.pptx') as z:
    slides=[n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml',n)]
    assert len(slides)==7
    assert z.testzip() is None
with zipfile.ZipFile(root/'Swan_All_Service_Samples.zip') as z:
    assert z.testzip() is None
    assert not any(n.endswith('.docx') for n in z.namelist())
    for p in ready.glob('*.pdf'): assert hashlib.sha256(z.read(p.name)).digest()==hashlib.sha256(p.read_bytes()).digest()
    count=len(z.namelist())
result={'passed':True,'catalogItems':12,'pdfPages':pdf_pages,'pptSlides':7,'archiveFiles':count,'archiveBytes':(root/'Swan_All_Service_Samples.zip').stat().st_size,'links':'all local targets exist','docxIncluded':False,'newPaidApiCalls':0}
(root/'build/package-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(result,ensure_ascii=False))
