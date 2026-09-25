from pathlib import Path
from html import escape

OUT = Path(__file__).parent
BG = '#fbfaff'; PURPLE = '#5d35d6'; DEEP = '#35206f'; MUTED = '#625b75'; LINE = '#ded2fa'

def card(title, regular, sale, lines, y):
    body = [f'<rect x="80" y="{y}" width="1040" height="300" rx="24" fill="#fff" stroke="{LINE}" stroke-width="3"/>',
            f'<text x="120" y="{y+62}" fill="{DEEP}" font-size="32" font-weight="700">{escape(title)}</text>',
            f'<text x="120" y="{y+115}" fill="{MUTED}" font-size="24">원가 {escape(regular)}원</text>',
            f'<text x="120" y="{y+165}" fill="{PURPLE}" font-size="32" font-weight="700">할인가 {escape(sale)}원</text>']
    for i, line in enumerate(lines):
        body.append(f'<text x="120" y="{y+215+i*34}" fill="{MUTED}" font-size="21">{escape(line)}</text>')
    return ''.join(body)

def page(filename, heading, subtitle, cards, footer='메로나 문서사무소 · 기본 범위 기준 · 숨고 거래 최소금액 15,000원'):
    parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600"><rect width="1200" height="1600" fill="{BG}"/><rect x="40" y="40" width="1120" height="1520" rx="34" fill="#fff" stroke="#e8ddff" stroke-width="3"/><rect x="40" y="40" width="1120" height="250" rx="34" fill="{PURPLE}"/><rect x="40" y="220" width="1120" height="70" fill="{PURPLE}"/><text x="90" y="135" fill="#fff" font-family="Malgun Gothic, sans-serif" font-size="48" font-weight="700">{escape(heading)}</text><text x="92" y="205" fill="#fff1a8" font-family="Malgun Gothic, sans-serif" font-size="24">{escape(subtitle)}</text><g font-family="Malgun Gothic, sans-serif">''']
    for i, c in enumerate(cards): parts.append(card(*c, 340 + i*350))
    parts.append(f'<text x="90" y="1510" fill="{MUTED}" font-family="Malgun Gothic, sans-serif" font-size="19">{escape(footer)}</text></g></svg>')
    (OUT / filename).write_text(''.join(parts), encoding='utf-8')

page('soomgo-price-card-01.svg', '숨고 서비스 가격표 ①', '대필 · 문서 · 교정', [
    ('이력서·자소서 대필', '40,000', '31,000', ['2,000자 이내 · 지원 회사 1곳', '고객 경험 기반 · 경험 창작 제외']),
    ('문서·글 작성', '24,000', '21,000', ['제공 자료 기반 1,500자 이내', '수정 1회 포함']),
    ('교정·교열', '28,000', '22,000', ['한글 3,000자 이내', '맞춤법 · 문장 흐름 · 변경 내역'])])
page('soomgo-price-card-02.svg', '숨고 서비스 가격표 ②', '타이핑 · 번역 · 통계', [
    ('속기·타이핑', '24,000', '19,000', ['인쇄물 5쪽 또는 음성 10분 이내', 'Word 변환 · 대조']),
    ('영어 번역', '32,000', '26,000', ['일반 영문 300단어 이내', '용어 통일 · 수정 1회']),
    ('통계분석', '80,000', '64,000', ['정리된 데이터 1개 · 단순 분석 1종', '결과표와 요약 해석'])])
page('soomgo-price-card-03.svg', '숨고 서비스 가격표 ③', '사업계획서 · 자막 · 크롤링', [
    ('사업계획서 작성', '160,000', '128,000', ['고객 자료 기반 5쪽 안팎 초안', '수정 1회 · 시장조사·재무모델 별도']),
    ('자막 제작', '32,000', '26,000', ['대본 제공 · 한국어 영상 5분 이내', '기본 SRT · 번역·삽입 별도']),
    ('데이터 크롤링', '96,000', '77,000', ['공개 정적 사이트 1곳 · 1,000행 이내', 'Excel · Python 결과물'])])
page('soomgo-price-card-04.svg', '진행 안내', '추가금 · 샘플 · 납품 원칙', [
    ('샘플 구매', '할인가 기준', '25%', ['일부 결과물 먼저 확인', '본 작업 전환 시 샘플비 전액 차감']),
    ('작업 순서', '고용·결제 확인', '제작 시작', ['초안 작성 → 교차검수 → 최종 확인', '요청 형식 파일 전달']),
    ('추가 작업', '사전 안내', '동의 후 진행', ['분량·문항·수정 초과 시 금액 안내', '15,000원 미만 거래는 제안하지 않음'])])
