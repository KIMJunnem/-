#!/usr/bin/env python3
# PPT 품질 규칙(quality-rules.json) 기계 검사 초안 (2026-09-22). 운영 미연결, 시안 자체 검사용.
# 사용: python3 check-deck.py deck.pptx <type_id> [--design ../design-types.json] [--rules ../quality-rules.json]
# 검사하는 규칙(일부만): canvas_01·03, type_02·04·05·07, color_01·02·03, msg_01, deck_01·02·03·06·07,
#   table_01·03·04, chart_03(값 축 0 시작 설정 여부), cons_01, file_05, 연속 같은 레이아웃. 나머지는 사람이 본다.
# 예외(준희 결정 D1, 2026-09-22): 페이지 번호·꼬리글·장 이름(fixed_elements)은 안전 여백 검사에서 뺀다.
# 색(D3): accentFill·accentText는 둘 다 팔레트로 본다(최대 7개 값).
import json, re, sys, os, argparse
from collections import Counter
from pptx import Presentation
from pptx.util import Emu

ap = argparse.ArgumentParser()
ap.add_argument('deck'); ap.add_argument('type_id')
here = os.path.dirname(os.path.abspath(__file__))
ap.add_argument('--design', default=os.path.join(here, '..', 'design-types.json'))
ap.add_argument('--rules', default=os.path.join(here, '..', 'quality-rules.json'))
a = ap.parse_args()
design = json.load(open(a.design, encoding='utf-8')); rules = json.load(open(a.rules, encoding='utf-8'))
t = next(x for x in design['types'] if x['type_id'] == a.type_id)
pal = {k: v.upper().lstrip('#') for k, v in t['palette'].items() if isinstance(v, str) and v.startswith('#')}
GRAYS = {'FFFFFF', 'F4F5F7', 'D9D9D9', 'E5E7EB'}
allowed = set(pal.values()) | GRAYS
lim = rules['typography']['text_limits']; scale = rules['typography']['scale_report_pt']
prs = Presentation(a.deck)
SW, SH = prs.slide_width, prs.slide_height
cm = lambda e: Emu(e).cm
margin = rules['canvas']['safe_margin_cm']['left']
res = []
def add(rid, sev, slide, msg): res.append({'rule': rid, 'severity': sev, 'slide': slide, 'msg': msg})

def lum(h):
    c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
def contrast(a_, b_):
    x, y = sorted([lum(a_), lum(b_)], reverse=True); return (x + 0.05) / (y + 0.05)

def fill_hex(shape):
    try:
        if shape.fill.type == 1: return str(shape.fill.fore_color.rgb)
    except Exception: pass
    return None

fonts = Counter(); weights = set(); titles = []; section_titles = []; labels = []; kinds = []
agenda_items = []
for si, slide in enumerate(prs.slides, 1):
    bg = str(slide.background.fill.fore_color.rgb) if slide.background.fill.type == 1 else 'FFFFFF'
    shapes = list(slide.shapes)
    fills = [(s, fill_hex(s)) for s in shapes if fill_hex(s)]
    accent_uses = 0; texts = []
    for s in shapes:
        x0, y0, x1, y1 = cm(s.left), cm(s.top), cm(s.left + s.width), cm(s.top + s.height)
        is_fixed = s.has_text_frame and s.top > SH * 0.9 or (s.has_text_frame and s.top < SH * 0.06)
        is_band = fill_hex(s) and s.top == 0 and s.left == 0 and s.width == SW
        if not is_fixed and not is_band and (x0 < margin - 0.01 or y0 < margin - 0.01 or x1 > cm(SW) - margin + 0.01 or y1 > cm(SH) - margin + 0.01):
            add('canvas_01', 'fail', si, f'안전 여백 밖: {s.name} ({x0:.2f},{y0:.2f})-({x1:.2f},{y1:.2f})cm')
        f = fill_hex(s)
        if f and f not in allowed: add('color_01', 'fail', si, f'팔레트 밖 색 {f}')
        if f and f == pal.get('accentFill') and f != pal.get('primary'): accent_uses += 1
        if s.has_text_frame:
            under = bg
            for other, of in fills:
                if other is s: continue
                if other.left <= s.left and other.top <= s.top and other.left + other.width >= s.left + s.width and other.top + other.height >= s.top + s.height: under = of
            if f: under = f
            txt = s.text_frame.text.strip()
            if txt: texts.append((s, txt))
            bullets_n = 0; slide_has_accent = False
            for p in s.text_frame.paragraphs:
                if p._p.pPr is not None and p._p.pPr.find('{http://schemas.openxmlformats.org/drawingml/2006/main}buChar') is not None: bullets_n += 1
                if (p.level or 0) >= 2: add('type_04', 'fail', si, '들여쓰기 3단계 이상')
                for r in p.runs:
                    if not r.text.strip(): continue
                    sz = r.font.size.pt if r.font.size else None
                    if sz and sz < scale['min_any_text']: add('type_02', 'fail', si, f'{sz}pt < {scale["min_any_text"]}pt: {r.text[:20]}')
                    fonts[r.font.name] += 1; weights.add('bold' if r.font.bold else 'regular')
                    if r.font.underline or r.font.italic: add('type_07', 'fail', si, f'밑줄·기울임: {r.text[:20]}')
                    col = str(r.font.color.rgb) if r.font.color and r.font.color.type is not None else pal['text']
                    if col not in allowed: add('color_01', 'fail', si, f'팔레트 밖 글자색 {col}')
                    need = 3.0 if (sz or 0) >= rules['color']['contrast']['large_text_threshold_pt'] else 4.5
                    cr = contrast(col, under)
                    if cr < need: add('color_02', 'fail', si, f'대비 {cr:.2f} < {need}: "{r.text[:16]}" {col} on {under}')
                    if col == pal.get('accentText') and col != pal.get('primary'): slide_has_accent = True
            if slide_has_accent: accent_uses += 1
            if bullets_n > lim['bullets_max']: add('type_04', 'fail', si, f'불릿 {bullets_n}개')
        if s.has_table:
            tb = s.table
            if len(tb.columns) > rules['slide_layouts']['table']['limits']['max_cols'] or len(tb.rows) - 1 > rules['slide_layouts']['table']['limits']['max_rows_report']:
                add('table_01', 'fail', si, '표 크기 초과')
            for ri, row in enumerate(tb.rows):
                for c in row.cells:
                    if ri > 0 and c.fill.type == 1 and str(c.fill.fore_color.rgb) in (pal.get('accentFill'), pal.get('accentText')): add('table_03', 'fail', si, '강조 배경 셀')
                    for p in c.text_frame.paragraphs:
                        for r in p.runs:
                            if r.font.size and r.font.size.pt < scale['table_body']: add('table_04', 'fail', si, f'표 글자 {r.font.size.pt}pt')
                            col = str(r.font.color.rgb) if r.font.color and r.font.color.type is not None else pal['text']
                            if ri > 0 and col == pal.get('accentText'): slide_has_accent = True
            if 'slide_has_accent' in dir() and slide_has_accent: accent_uses += 1
        if s.has_chart:
            xml = s.chart._chartSpace.xml
            if 'c:barChart' in xml and 'c:min val="0"' not in xml: add('chart_03', 'fail', si, '막대 차트 값 축 0 시작 아님')
            if 'view3D' in xml or 'c:bar3DChart' in xml: add('chart_02', 'fail', si, '3D 차트')
            accent_uses += xml.count(pal.get('accentFill', 'zzzz')) and 1
    # 역할 추정: 제목 = 상단 제목 영역(y 7.9~20%)에 있는 굵은 글
    tt = [s for s, x in texts if abs(s.top - SH * 0.079) < SH * 0.01 and abs(s.left - SW * 0.044) < SW * 0.01]
    page = [x for s, x in texts if s.top > SH * 0.9 and re.match(r'^\d+ / \d+$', x)]
    lab = [x for s, x in texts if s.top < SH * 0.06]
    if si == 1:
        if not any(re.search(r'\d{4}\.\d{2}\.\d{2}', x) for s, x in texts): add('deck_01', 'fail', si, '표지 날짜 없음')
    else:
        if not page: add('deck_06', 'fail', si, '페이지 번호 없음')
        is_section = any(re.fullmatch(r'\d{2}', x) for s, x in texts) and not tt
        if is_section:
            st = [x for s, x in texts if not re.fullmatch(r'\d{2}', x) and s.top < SH * 0.9 and s.top > SH * 0.06]
            section_titles.append(st[0] if st else ''); kinds.append('section')
        else:
            if not tt: add('msg_01', 'fail', si, '제목 없음')
            else:
                titles.append((si, tt[0]))
                h = tt[0].text_frame.text.strip()
                if len(h) > lim['title_max_chars_ko']: add('type_03', 'fail', si, f'제목 {len(h)}자 > {lim["title_max_chars_ko"]}')
                if h == '목차': agenda_items = [x for s, x in texts if s.top > SH * 0.25 and s.top < SH * 0.9 and not re.fullmatch(r'\d{2}', x)]; kinds.append('agenda')
                else: kinds.append('chart' if any(s.has_chart for s in shapes) else 'table' if any(s.has_table for s in shapes) else f'n{len(shapes)}')
        labels.extend(lab)
    if accent_uses > rules['color']['limits']['max_accent_uses_per_slide']: add('color_03', 'warn', si, f'강조색 {accent_uses}곳')
    if not texts: add('deck_07', 'fail', si, '빈 슬라이드')
    for s, x in texts:
        if re.search(r'lorem|제목을 입력|텍스트를 입력|click to', x, re.I): add('deck_07', 'fail', si, f'기본 문구: {x[:20]}')

if len(prs.slides) >= 6 and not agenda_items: add('deck_02', 'fail', 2, '목차 없음')
if agenda_items and agenda_items != section_titles: add('deck_03', 'fail', 0, f'목차 {agenda_items} ≠ 구분 {section_titles}')
bad_labels = [l for l in labels if l not in agenda_items + ['요약', '맺음']]
if bad_labels: add('deck_03', 'fail', 0, f'장 이름 불일치: {sorted(set(bad_labels))}')
if len({(s.left, s.top, s.width, s.height) for _, s in titles}) > 1: add('cons_01', 'fail', 0, '제목 위치 불일치')
fam = [f for f in fonts if f]
if len(fam) > rules['typography']['families']['max_families_per_deck']: add('type_05', 'fail', 0, f'글꼴 {fam}')
run = 1
for i in range(1, len(kinds)):
    run = run + 1 if kinds[i] == kinds[i - 1] else 1
    if run > rules['machine_check_summary']['checkParams_proposal']['sameLayoutRunMax']: add('anti_same_layout', 'warn', 0, f'같은 레이아웃 {run}장 연속')
cp = prs.core_properties
if cp.author and cp.author not in ('Swan',): add('file_05', 'fail', 0, f'작성자 속성: {cp.author}')
if not re.match(r'^[^_]+_\d{8}_v\d+\.pptx$', os.path.basename(a.deck)): add('file_04', 'warn', 0, f'파일명 형식: {os.path.basename(a.deck)}')
import zipfile as _zf
_z = _zf.ZipFile(a.deck); _pres = _z.read('ppt/presentation.xml').decode('utf-8')
_embedded = re.findall(r'<p:embeddedFont><p:font typeface="([^"]+)"', _pres)
_used = {f for f in fonts if f}
if not _embedded: add('file_01', 'fail', 0, '글꼴 파일이 포함되지 않음 (embed-fonts.py로 넣기)')
for _f in _embedded:
    if _f not in ('Pretendard',): add('file_01', 'fail', 0, f'허용 목록 밖 글꼴 포함: {_f}')
for _f in _used - set(_embedded): add('file_01', 'fail', 0, f'쓰였지만 포함 안 된 글꼴: {_f}')
_mb = os.path.getsize(a.deck) / 1024 / 1024
if _mb > rules['machine_check_summary']['checkParams_proposal']['fileSizeMaxMb']: add('file_07', 'warn', 0, f'파일 {_mb:.1f}MB')

fails = [r for r in res if r['severity'] == 'fail']; warns = [r for r in res if r['severity'] == 'warn']
print(json.dumps({'deck': os.path.basename(a.deck), 'slides': len(prs.slides), 'fail': len(fails), 'warn': len(warns), 'results': res}, ensure_ascii=False, indent=1))
