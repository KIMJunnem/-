#!/usr/bin/env python3
# PPTX에 OFL 글꼴(Pretendard Regular·Bold)을 원본 그대로 넣는다 (2026-09-22). 글꼴을 자르거나 고치지 않는다
# (OFL 예약 이름 "Pretendard" 때문에 수정본은 같은 이름을 쓸 수 없음).
# PowerPoint 방식: ppt/fonts/*.fntdata(EOT, 압축 없음) + presentation.xml embeddedFontLst.
# 사용: python3 embed-fonts.py in.pptx out.pptx --fonts <Pretendard-Regular.ttf, Pretendard-Bold.ttf가 있는 폴더>
import argparse, os, re, struct, zipfile
from fontTools.ttLib import TTFont

ALLOWED = {'Pretendard'}  # OFL 확인된 글꼴만. 고객 지정 글꼴은 넣지 않는다.

def eot(path):
    data = open(path, 'rb').read()
    f = TTFont(path)
    os2, head, name = f['OS/2'], f['head'], f['name']
    if os2.fsType & 0x0002: raise SystemExit(f'포함 금지 글꼴(fsType): {path}')
    s = lambda i: (name.getDebugName(i) or '').encode('utf-16-le')
    panose = os2.panose
    pan = bytes([panose.bFamilyType, panose.bSerifStyle, panose.bWeight, panose.bProportion, panose.bContrast, panose.bStrokeVariation, panose.bArmStyle, panose.bLetterForm, panose.bMidline, panose.bXHeight])
    body = b''
    for idx, n in enumerate([s(1), s(2), s(5), s(4)]):
        body += struct.pack('<H', 0) + struct.pack('<H', len(n)) + n
    body += struct.pack('<HH', 0, 0)  # Padding5 + RootStringSize(0)
    fixed = struct.pack('<LLL', 0, len(data), 0x00020001) + struct.pack('<L', 0) + pan + struct.pack('<BB', 1, 1 if os2.fsSelection & 1 else 0)
    fixed += struct.pack('<L', os2.usWeightClass) + struct.pack('<HH', os2.fsType, 0x504C)
    fixed += struct.pack('<LLLL', os2.ulUnicodeRange1, os2.ulUnicodeRange2, os2.ulUnicodeRange3, os2.ulUnicodeRange4)
    fixed += struct.pack('<LL', getattr(os2, 'ulCodePageRange1', 0), getattr(os2, 'ulCodePageRange2', 0))
    fixed += struct.pack('<L', head.checkSumAdjustment) + struct.pack('<LLLL', 0, 0, 0, 0)
    total = len(fixed) + len(body) + len(data)
    return struct.pack('<L', total) + fixed[4:] + body + data, name.getDebugName(1), name.getDebugName(2)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('out'); ap.add_argument('--fonts', required=True)
    a = ap.parse_args()
    reg, reg_family, _ = eot(os.path.join(a.fonts, 'Pretendard-Regular.ttf'))
    bold, bold_family, bold_style = eot(os.path.join(a.fonts, 'Pretendard-Bold.ttf'))
    assert reg_family == bold_family and reg_family in ALLOWED and bold_style == 'Bold', (reg_family, bold_family, bold_style)
    zin = zipfile.ZipFile(a.src)
    items = {n: zin.read(n) for n in zin.namelist()}
    if any(n.startswith('ppt/fonts/') for n in items): raise SystemExit('이미 글꼴이 들어 있음')
    ct = items['[Content_Types].xml'].decode('utf-8')
    if 'Extension="fntdata"' not in ct:
        ct = ct.replace('<Default Extension="xml"', '<Default Extension="fntdata" ContentType="application/x-fontdata"/><Default Extension="xml"', 1)
    rels = items['ppt/_rels/presentation.xml.rels'].decode('utf-8')
    ids = [f'rIdSwanFont{i}' for i in (1, 2)]
    add = ''.join(f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font{i}.fntdata"/>' for i, rid in enumerate(ids, 1))
    rels = rels.replace('</Relationships>', add + '</Relationships>')
    pres = items['ppt/presentation.xml'].decode('utf-8')
    lst = f'<p:embeddedFontLst><p:embeddedFont><p:font typeface="{reg_family}" pitchFamily="2" charset="-127"/><p:regular r:id="{ids[0]}"/><p:bold r:id="{ids[1]}"/></p:embeddedFont></p:embeddedFontLst>'
    m = re.search(r'<p:notesSz[^>]*/>', pres)
    if not m: raise SystemExit('notesSz 없음')
    pres = pres[:m.end()] + lst + pres[m.end():]  # 스키마 순서: notesSz 다음, defaultTextStyle 앞
    pres = re.sub(r'<p:presentation ', '<p:presentation embedTrueTypeFonts="1" ', pres, count=1)
    items['[Content_Types].xml'] = ct.encode('utf-8'); items['ppt/_rels/presentation.xml.rels'] = rels.encode('utf-8'); items['ppt/presentation.xml'] = pres.encode('utf-8')
    items['ppt/fonts/font1.fntdata'] = reg; items['ppt/fonts/font2.fntdata'] = bold
    order = zin.namelist() + ['ppt/fonts/font1.fntdata', 'ppt/fonts/font2.fntdata']
    with zipfile.ZipFile(a.out, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in order: z.writestr(n, items[n])
    print(a.out, os.path.getsize(a.out))

if __name__ == '__main__': main()
