# 크몽 상품 페이지 수정안 — 초안 (2026-09-23, 크몽방)

상태: **초안만**. 크몽 상품 등록·수정·게시는 하지 않았다. 승인 후 준희가 직접 붙여 넣는다.
금액 출처: `services/subtitle.json`, `services/document_writing.json` (kmong 채널 true). 새로 만든 숫자는 없다.

## 1. 자막 제작 상품

### 패키지 금액 (subtitle.json → pricing.packages 의 saleAmount)
| 구분 | 조건 | 금액 | 출처 키 |
|---|---|---|---|
| 1 | 5분 이하 | 32,000원 | packages[0].saleAmount (regular 40,000) |
| 2 | 10분 이하 | 49,000원 | packages[1].saleAmount (regular 61,000) |
| 3 | 30분 이하 | 89,000원 | packages[2].saleAmount (regular 111,000) |
| 4 | 30분 초과 | 89,000원 + 5분당 10,000원 (45분 119,000원) | packages[3].unit · 9/23 준희 결정 |

### 추가금 (subtitle.json → pricing.additionalFees)
- 번역 자막(외국어 영상 → 한국어 자막): 자막 금액 × 1.2, 천 원 단위 반올림 — `translation`
- 영상에 자막 입히기: 5분당 15,000원 — `burn_in`
- 추가 수정 1회: 10,000원 — `revision`
- (요약 PDF 20,000원, 숏츠 1편 29,000원·3편 69,000원은 상품 페이지에 넣을지 미정 — 빈 칸)

### 수정 횟수·납기
- 기본 수정 2회 — `subtitle.json` includedRevisions (decisions.md와 같음)
- 납기: 길이와 상관없이 당일~1일 — `leadDaysRules` 기본값 (9/23 준희 결정)

### 포함/불포함 (subtitle.json scope)
- 포함: 자막 파일(SRT) 제작, 수정 2회
- 불포함: 번역(추가금), 영상 편집, 영상에 자막 입히기(추가금)

## 2. 일반 문서 상품

### 금액 (document_writing.json)
| 구분 | 조건 | 금액 | 출처 키 |
|---|---|---|---|
| 기본 | 제공 자료 기반 2쪽까지 | 21,000원 | packages[0].saleAmount (regular 24,000) · 9/23 준희 결정 |
| 추가 | A4 1쪽 추가 | 9,000원 | 9/23 준희 결정 |
| 추가 | 자료 조사 | 10,000원 | additionalFees.research |
| 추가 | 추가 수정 1회 | 10,000원 | additionalFees.revision |
| 대량 | 40쪽 초과분 | 쪽당 3,500원 | pricing.largeDocument |
| 접수 제외 | 100쪽 초과 | 접수하지 않음 | largeDocument.deleteAbovePages |

### 수정 횟수·납기
- 기본 수정 3회 — `document_writing.json` includedRevisions
- 납기: 5쪽 이하 당일~1일 / 6~15쪽 1~2일 / 16쪽 이상 2~3일 (9/23 준희 결정. "자료 받은 날 +1일, 20쪽 이상 +2일"은 폐지)

## 3. 상품 페이지 공통 문구
- 고객 문구는 `docs/kmong/reply-template-v4-draft.md` 기준으로 쓴다.
- 외부 연락처(이메일·카톡·전화)와 외부 링크는 상품 페이지·메시지 어디에도 적지 않는다.
- 사람이 전부 직접 작업한다고 쓰지 않는다. 물으면 사실대로 답한다.

## 4. 준희가 채워야 할 빈 칸
- 크몽에 이미 제출한 패키지 금액과 위 값이 다른지 (상품 페이지 확인 후 대조)
- 크몽 패키지가 3단 구성을 요구하는지, 문서 상품도 3단으로 나눠야 하는지 [추정: 카테고리마다 다를 수 있음 — 미확인]
- 요약 PDF·숏츠 옵션을 상품 페이지에 넣을지
