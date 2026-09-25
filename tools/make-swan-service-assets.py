from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "dist" / "downloads"
REG = r"C:\Windows\Fonts\malgun.ttf"
BOLD = r"C:\Windows\Fonts\malgunbd.ttf"

def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else REG, size)

def sample(path, label, title, scope, price, bullets, tag):
    w, h = 900, 1200
    im = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, w, 16), fill="black")
    d.text((64, 62), "SWAN", font=font(30, True), fill="black")
    d.text((64, 155), label, font=font(24, True), fill="#666666")
    d.text((64, 205), title, font=font(54, True), fill="black")
    d.line((64, 302, 836, 302), fill="#D8D8D8", width=2)
    d.text((64, 365), scope, font=font(30), fill="#333333")
    d.text((64, 425), price, font=font(62, True), fill="black")
    y = 585
    for item in bullets:
        d.ellipse((67, y+11, 77, y+21), fill="black")
        d.text((98, y), item, font=font(27), fill="#202020")
        y += 78
    d.rounded_rectangle((64, 1010, 836, 1108), radius=18, fill="black")
    tw = d.textbbox((0,0), tag, font=font(25, True))[2]
    d.text(((w-tw)//2, 1042), tag, font=font(25, True), fill="white")
    im.save(OUT / path, optimize=True)

def cover(path, title, scope, price):
    w, h = 652, 488
    im = Image.new("RGB", (w, h), "black")
    d = ImageDraw.Draw(im)
    d.text((42, 38), "SWAN", font=font(23, True), fill="white")
    d.text((42, 132), title, font=font(43, True), fill="white")
    d.text((42, 213), scope, font=font(25), fill="#D0D0D0")
    d.line((42, 280, 610, 280), fill="#555555", width=2)
    d.text((42, 325), price, font=font(43, True), fill="white")
    d.text((42, 405), "자료 확인 후 2영업일 이내", font=font(20), fill="#BEBEBE")
    im.save(OUT / path, optimize=True)

def subtitle_editorial(path):
    w, h = 1000, 1250
    im = Image.new("RGB", (w, h), "#090909")
    d = ImageDraw.Draw(im)
    white, muted, line, panel = "#F7F7F7", "#B8B8B8", "#353535", "#151515"
    d.text((60, 38), "SWAN", font=font(22, True), fill=white)
    d.text((820, 41), "가격 안내", font=font(17), fill=muted)
    d.text((60, 118), "KOREAN · SRT", font=font(17, True), fill="#CFCFCF")
    d.text((60, 160), "말의 흐름에 맞춘\n한국어 자막을 만듭니다", font=font(50, True), fill=white, spacing=5)
    d.text((60, 295), "영상의 실제 발화 시점을 확인해 타임코드와 문장을 맞춘 SRT 파일을 제작합니다.", font=font(21), fill=muted)
    d.rounded_rectangle((60, 382, 940, 610), radius=18, fill=panel, outline=line, width=2)
    d.text((88, 420), "기본형 · 한국어 영상 5분 이하", font=font(23, True), fill=white)
    d.text((88, 482), "32,000원", font=font(45, True), fill=white)
    d.text((88, 548), "SRT 파일 1개 · 수정 1회 · 2영업일 이내", font=font(19), fill=muted)
    d.text((60, 684), "포함 범위", font=font(29, True), fill=white)
    items = [
        "한국어 음성 기준 타임코드와 문장 정리",
        "합의한 범위 안의 오탈자·싱크 수정 1회",
        "번역·영상 편집·자막 삽입은 포함하지 않음",
        "5분 초과 영상은 작업 전 범위와 금액 안내",
    ]
    y = 748
    for item in items:
        d.ellipse((65, y+10, 73, y+18), fill=white)
        d.text((92, y), item, font=font(22), fill="#E7E7E7")
        y += 60
    d.line((60, 1090, 940, 1090), fill=line, width=2)
    d.text((60, 1130), "자료를 확인한 뒤 착수 가능일과 최종 금액을 먼저 안내합니다.", font=font(18), fill=muted)
    d.text((60, 1175), "빠른 제작을 목표로 하며 상담은 숨고 채팅으로 진행합니다.", font=font(18), fill=muted)
    im.save(OUT / path, optimize=True)

sample("swan-soomgo-document-sample-v2.png", "일반 문서 작성", "자료를 읽기 좋은 문서로", "1,500자 이하", "21,000원", ["DOCX 또는 PDF 1종", "합의 범위 내 수정 1회", "자료 확인 후 2영업일 이내", "자기소개서·이력서는 접수하지 않음"], "일반 문서 샘플")
sample("swan-soomgo-subtitle-sample-v2.png", "한국어 SRT 자막", "말의 흐름에 맞춘 자막", "한국어 영상 5분 이하", "32,000원", ["SRT 파일 1개", "합의 범위 내 수정 1회", "자료 확인 후 2영업일 이내", "번역·영상 편집·자막 삽입 제외"], "자막 샘플")
subtitle_editorial("swan-soomgo-subtitle-sample-v3.png")
subtitle_editorial("swan-subtitle-detail-v3.png")
cover("swan-kmong-document-cover-v2.png", "일반 문서 작성", "1,500자 이하", "21,000원")
sample("swan-kmong-document-detail-v2.png", "일반 문서 작성", "자료를 읽기 좋은 문서로", "1,500자 이하", "21,000원", ["DOCX 또는 PDF 1종", "합의 범위 내 수정 1회", "자료 확인 후 2영업일 이내", "자기소개서·이력서는 접수하지 않음"], "서비스 범위와 가격을 먼저 확인하세요")
print("created")
