# progress 옛 기록 (2026-09-24 16시 전) — 2026-09-25 감독이 progress.md에서 옮김, 내용 수정 없음

## 2026-09-24 15:42 · 영상 제작방(Cowork) · 준희 직접 요청(next-video 지시 아님) — swan 홍보 영상 "콘티 → 영상" 제작, 외부 게시 없음
- 결과: outputs/video-room/20260924-swan-storyboard-promo/swan-storyboard-to-video.mp4 (1920x1080 · 30fps · 21.2초 · 636프레임 · 무음 AAC 트랙 · 3,543,417바이트) + 다시 만들 때 쓰는 원본 storyboard-promo-source.html·storyboard-promo-render.js
- 내용: 홈카페 라떼 4컷 콘티(연필 스케치) → 편집 화면(콘티 썸네일·모니터·자막.srt·타임라인 컷 4개/자막 4줄) → 엔드카드 "swan. 말하는 영상 컷편집 · 한국어 자막 입히기 / 콘티대로 자르고, 말에 맞춰 자막을 붙입니다." 가격·플랫폼 이름·후기 문구 없음
- 검사: 자막 4줄 모두 화면 표시 시작·끝이 SRT 표시값과 1프레임 안에서 일치(시작 1프레임 전 없음·1프레임 뒤 있음, 끝 동일), 초당 글자 6.3~10자. 프레임 12장+원본 크기 잘라 보기로 글자 깨짐·겹침 확인. PC 파일 3개 크기 일치 확인
- 만든 방법: 클라우드 작업 공간에서 코드로 그린 일러스트 애니메이션(Playwright 프레임 캡처 + ffmpeg). 고객 자료·유료 API·외부 전송 없음. 설치 없음
- 준희 판단 필요: ① 게시 여부·위치(숨고 포트폴리오 등) ② 일러스트 애니메이션이라 판매 범위 밖인 모션그래픽을 파는 것으로 보일 수 있음 [추정]

## 2026-09-24 15:25 · 개발방(Cowork claude-04) · next-dev.md (지시 16) — 영상 편집 정의·견적 계산 추가(자동 발송 없음) · run-all 79/79 · 재시작 15:24:28
- 새 파일: services/video_edit.json(7-4절 가격·범위·안 하는 것·옵션·경험 문장·견적 문구 v1, matchKeywords 비움·channels.soomgo=false → 글자 분류·자동 판매 목록·Claude 견적 판단에 안 들어감), server/video-edit-quote.js(원본 길이로 계산, 길이 모름·쇼츠 원본 10분 초과는 금액 없이 범위 확인), tests/video-edit-quote.cjs(합성 12건)
- 바꾼 파일: server/soomgo-auto-rules.js(영상 편집 retain_review 분기에 견적값만 붙임 — autoSend false·manualReview true 그대로, videoEdit.manualSendOnly=true), scripts/build-astra-brief.cjs(영상 편집 칸·대표 요청 5건), tests/run-all.cjs(시험 1줄), docs/astra-brief.md(재생성)
- 백업: backups/video-edit-service-20260924/ (soomgo-auto-rules.js, build-astra-brief.cjs, run-all.cjs, astra-brief.md). PC 파일·백업 모두 올린 파일과 같음 확인
- 합성 입력별 금액: 5분 69,000(1~2일) · 10분 69,000(1~2일) · 25분 129,000(2~3일) · 30분 129,000(2~3일) · 33분 144,000(날짜는 영상 확인 후) · 45분 174,000(같음) · 1시간 219,000(같음) · 쇼츠(원본 8분) 39,000(당일~1일) · 쇼츠 원본 20분 금액 없음(범위 확인) · 길이 모름 금액 없음(길이부터 질문) · 번역 10분 83,000 · 배경음악 10분 79,000. 12건 모두 retain_review·autoSend false·Claude 판단 대상 아님
- 기존 서비스 견적 변화 0: astra-brief 대조값 기존 20건 전부 같음(추가 5건만), service-regression-baseline·자막/문서/PPT 시험 모두 통과
- 견적 문구 v1(수동 발송용): 인사/주제 → "말하는 영상에서 필요 없는 부분을 잘라 내고, 한국어 자막을 입혀 MP4로 보내드립니다." → 견적 금액·작업 기간·수정 2회 → 숨고페이 → 경험 문장(7-4 그대로) → 질문 하나. 할인·추가금·제외 조건 없음. 30분 초과는 "작업 기간은 영상을 받아 본 뒤 날짜로 알려드립니다"
- run-all: 샌드박스 79/79 → **PC 79/79**(147초). 재시작 **15:24:28 KST**(봇 버전 그대로: 요청 0.4.21·채팅 0.3.24·크몽 0.1.3, 봇 파일 변경 없음 확인). definitionsVersion 9dadda9471fb12ef → 503fb20c1964835e. chatSendEnabled=false 그대로, 채팅봇 "일시 정지"
- astra-brief: sha256 fd413a5d043a(12,201바이트), video_edit.json sha 43bd5528119b, decisions sha ce354a02dbf9. tests/astra-brief 통과
- 금지 사항: 숨고 발송·고객 연락·채팅봇 켜기·8791·Codex 예약·다른 서비스 가격/문구 변경·유료 API·설치·삭제·git push 없음

## 2026-09-24 14:36 · 개발방(Cowork claude-04) · next-dev.md (지시 15) — 조건 4개 통과 → run-all 78/78 → 재시작 14:35:11
- 0.3.23 → 0.3.24 차이(기준: dist 발행본·backups/customer-wake-20260924-115908): manifest 버전, host_permissions에 http://127.0.0.1:8791/* 추가, content_scripts에 customer-observer.js 추가 / auto-update.js 첫 줄 importScripts('customer-wake-background.js') 1줄 / 새 파일 customer-observer.js(숨고 채팅 목록·방 화면을 읽기만, 클릭·입력·이동·발송 없음, 화면 왼쪽 아래 "문의 감지 ON · 감지 전용" 표시) · customer-wake-background.js(읽은 내용을 확장 저장소에 쌓고 127.0.0.1:8791/observe로 전달). chat-content.js는 바이트 단위로 같음
- 조건: ① soomgoChat.sendEnabled=false 그대로·발송/첨부/결제 버튼 누르는 새 코드 없음 — 통과 ② 새 외부 호출은 127.0.0.1:8791뿐 — 통과 ③ 채팅봇 켜짐 기본값을 바꾸는 코드 없음(chat-content.js 변경 0) — 통과 ④ customerRoomFallback.enabled=false(claudeEnabled=false) — 통과
- 시험 기대 버전 0.3.23→0.3.24: tests/chat-send-off.cjs 49줄 + **tests/ppt-design-sample.cjs 51줄**(같은 버전 확인 줄이 하나 더 있어 1차 PC run-all이 55/78에서 멈춤, 버전 값만 바꿈). 백업 backups/chatbot-0324-test-20260924/tests/(2개)
- run-all: 샌드박스 78/78 → **PC 78/78 통과**(137초). 재시작(발행 포함) **14:35:11 KST** — 숨고 요청 0.4.21 · 숨고 채팅 0.3.24 · 크몽 0.1.3
- 영상 편집 규칙 반영 확인: 서버 definitionsVersion e6d637d55765221e → 9dadda9471fb12ef(soomgo-auto-rules.json 포함 해시 → 새 규칙 읽음). PC와 같은 파일의 샌드박스에서 합성 영상편집 요청 3건 → retain_review·autoSend false·manualReview true·deleteRequest false(PC 서버에 합성 요청은 보내지 않음 — 기록이 남으므로)
- 채팅봇 OFF 유지(읽기만): control chatSendEnabled=false, 채팅봇 마지막 상태 "일시 정지"(12:09, 재시작 뒤 새 심박 없음). 켜기·끄기 조작 0
- 알아 둘 것: ① 발행으로 확장이 0.3.24를 불러오면 감지 전용 표시("문의 감지 ON")가 숨고 채팅 화면에 뜰 수 있음 — 발송 봇 ON이 아님 ② 8791 중계가 꺼져 있는 동안 감지 내용(고객 메시지 미리보기 포함)이 확장 저장소에 쌓임(상한 없음 [추정: 코드상 개수 제한 없음]) ③ definitionsVersion이 바뀌어 요청봇이 전에 건너뛴 요청을 한 번씩 다시 판정함(설계대로)
- 금지 사항: 채팅봇 켜기·8791 켜기·Codex 예약 재가동·숨고 발송·고객 연락·가격·문구 변경·유료 API·설치·삭제·git push 없음

## 2026-09-24 13:50 · 개발방(Cowork claude-04) · next-dev.md (지시 14) — 읽기·수정안만, 코드 수정 없음
- 활성 요청봇: **v3(content-v3.js) 0.4.21** — 근거: manifest content_scripts가 automation-guard.js+content-v3.js뿐(발행본과 동일), 서버 심박 version 0.4.21(getManifest 값)·13:47 "새 요청 확인 중", bot-version 요청봇 0.4.21
- **v2 활성 아님 [추정, 근거 강함]**: v2 형식 기록 마지막 9/19 05:53, 9/20 이후 0건(채팅방 PAGE- 형식도 9/19 06:30 이후 0). 옛 확장이 꺼진 채 설치돼 있는지는 chrome://extensions 확인 필요 → 준희
- 수정안 4개: ① 서버가 v2 헤더·-quote- 요청번호 거절(410) ② 채팅방 주소·PAGE- 기록 안 함(422) ③ -quote- 꼬리 떼어 같은 요청번호로 합침 ④ 기존 기록 통계용 읽기 집계(시험·PAGE 제외, 요청번호 기준 중복 제거). 적용은 준희 승인 뒤
- 기록 현황: soomgoLeads 403건 중 서로 다른 실제 요청 약 276건(최대 285) — 채팅방 66, v2 중복 14, 시험·진단 36(출처 "Soomgo"로 섞임), SOOMGO-지문 9, 번호 오인 2
- 합성 입력 21번 전/후: 기록 20건 → 11건(v2 4·채팅방 5 거절), 통계용 집계 10건 → 10건
- 바꾼 파일(새 파일만): docs/audit/bot-active-and-lead-quality-20260924.md, docs/progress.md(이 칸)
- 코드·설정·데이터 수정 0, 재시작·확장 조작·숨고 화면 0, 고객 정보 기록 0(건수·시각·형식만), run-all 안 함
- 외부 발송·유료 API·설치·삭제·git push: 없음

## 2026-09-24 13:46 · 개발방(Cowork claude-04) · 준희 직접 지시 "그때 뺀 걸 다시 넣어"(영상 편집, 선택: 둘 다) — 규칙 반영, **재시작 안 함(run-all 실패, 원인은 다른 변경)**
- 서버 규칙: 미판매 카테고리 삭제(unsold_category)에 예외 reviewCategories ["영상 편집"] 추가 → 영상 편집 요청은 삭제하지 않고 기록·준희 확인 알림(autoSend false, manualReview true, deleteRequest false, unsupportedService로 Claude 견적 판단 제외). 견적은 안 나감. 판매 여부·가격은 안 정함
- 바꾼 파일: services/_common/soomgo-auto-rules.json, server/soomgo-auto-rules.js(예외 분기 1곳), 시험 3개 기대값(tests/unsold-category-block.cjs, tests/soomgo-auto-rules.cjs — 대표 미판매 카테고리를 통계 분석으로, tests/jev-simulation.cjs R2 delete→human_review)
- 백업: backups/video-edit-review-20260924/ (5개 원본). PC 파일·백업 모두 올린 파일과 같음 확인
- 샌드박스 전체 78개 중 78 통과(jev-simulation 기대값 고친 뒤). 합성 영상편집 요청 3건 → retain_review·견적 안 나감 확인
- **PC run-all: 52/78에서 멈춤** — 첫 실패 tests/chat-send-off.cjs 49줄: soomgo-chat-bot/manifest.json 버전 0.3.24 ≠ 기대 0.3.23. 채팅봇 폴더가 오늘 12:01에 다른 작업(customer-wake)으로 바뀐 것이 원인, 이번 변경과 무관. 이번에 바꾼 시험 3개는 PC에서도 PASS
- **재시작 안 함**: 재시작이 봇 발행을 같이 해서, 검토 안 된 채팅봇 0.3.24가 확장에 자동 반영될 수 있음. 그래서 새 규칙은 아직 서버에 안 올라감(재시작 전까지 영상 편집은 기존대로 삭제 대상). 준희 결정 필요
- 숨고 설정(받는 서비스에 영상 편집 다시 넣기): **못 함** — 내장 브라우저·Chrome 둘 다 숨고 로그인 안 된 상태(로그인은 내가 못 함). 준희가 숨고 앱에서 직접 확인·추가 필요. 숨고 화면에서 누른 버튼 0
- 외부 발송·유료 API·설치·삭제·git push: 없음. 가격·문구 변경: 없음

## 2026-09-24 13:33 · 숨고 운영방(Cowork claude-ff) · next-soomgo.md (지시 8) — 프로필 게시용 최종 복붙본(문서만)
- 결과 파일: docs/soomgo/profile-post-ready-20260924.md (11,700바이트, sha256 94704e846a8c) — 맨 위 "먼저 할 것 3개"(사진 1번 내리기·사진 2번 내리기·Q2 교체), 칸마다 찾기용 첫 10자·코드블록 하나·글자 수
- 칸 수: 16(한 줄 소개·리뷰 이벤트·상세설명 5문단·경력·Q1~Q5·포트폴리오 제목 2·사진 2번 자리 글자). 숨고 칸별 글자 제한은 확인 안 됨. 칸 순서는 미리보기 기준 [추정]
- astra-brief(03:12)와 다른 숫자 0건. 숫자 아닌 차이 1건 고침: 문서 파일 형식에 한글(HWP) 추가. 지시 6 수정안의 Q4 "가장 많이 맡기시는 일"(확인 안 된 실적) → "주로 하는 일"로 바꿈. Q2 판매 안 함에 논문·학위 추가(brief 목록)
- 금지 표현 0건(원가·정상가·할인·긴급·최고·최저·영상편집·수정 1회·2영업일·1,500자·저작권 없음·안전결제 검사. "수정 1회"는 2번 리뷰 혜택 '수정 1회를 더' 1곳 — 기본 조건 아님). 경력 기간은 빈칸. "반영 전" 주석 뺌. 포트폴리오 영상 안내 한 줄(4번 칸) — 영상 재생·판 확인 뒤 게시 메모
- 숨고 화면 열지 않음 · 누른 버튼 0 · 바꾼 파일: 새 파일 1개와 progress.md

## 2026-09-24 13:20 · 숨고 운영방(Cowork claude-ff) · next-soomgo.md (지시 7 이어서) — 준희 결정 "(다) 아스트라에 맡기기". 붙여 넣기용 지시 docs/soomgo/video-edit-astra-handoff-20260924.md 새로 만듦(목록 화면만·안 연 요청 열지 않기·버튼 금지·개인정보 없이, 결과는 docs/soomgo/video-edit-list-astra-20260924.md). 준희가 아스트라 방에 붙여 넣으면 결과 파일로 3·5절을 채움. 바꾼 파일: 새 파일 1개와 progress.md

## 2026-09-24 13:14 · 개발방(Cowork claude-04) · next-dev.md (지시 13) — 읽기·진단만, 코드 수정 없음
- 1 기록 끊김: [추정] 숨고 쪽에서 영상편집 요청이 목록에 안 뜸(받는 서비스 설정 추정). 요청봇 v1·v2·content.js·v3와 서버 /api/soomgo/quote에 분야로 기록 전에 거르는 곳 없음(미판매 분야도 기록 뒤 삭제). 9/19 17:43 뒤에도 기록은 매일 있고, 영상편집 0·이력서/자소서도 약 108→5로 같이 줄고 전체 요청량도 하루 60~117→4~33. 9/19 06:38~17:43 기록 0(봇 꺼짐 [추정]). 94건 중 실제 요청은 약 14~15건(채팅방 화면을 요청으로 읽은 PAGE-해시 60, v2가 같은 요청 1건을 14번 계산)
- 2 9/19 발송: 확정 못 함 → 숨고 "보낸 견적" 9/18~19 확인 필요. 기록상 발송 결과 0·작업 기록은 "요청 분석"만. v1 계열은 누르면 결과를 보고하는 코드라 안 나갔을 가능성 높음 [추정]. **v2(content-v2.js)는 보고 없이 보내기를 바로 누르는 코드 → 요청 1건(48,000원 "간단 영상편집·자막 추가")은 나갔을 수 있음**
- 3 채팅봇 ON: 03:08·03:16 재시작·발행이 켠 것 아님(ON은 확장 저장값, 재시작은 안 건드림, 발행 reload는 저장값 유지). 원인 모름 — 탭·Chrome만 닫아 저장값 ON이 남았고 확장이 채팅 탭을 자동으로 다시 연 경우가 가장 그럴듯 [추정]. ON이어도 정책 soomgoChat.sendEnabled=false로 발송·첨부·결제 버튼은 안 누름(코드)
- 준희 확인 3가지: 숨고 받는 서비스 설정에 영상 편집 여부 / 보낸 견적 9/18~19에 48,000원 영상편집 견적 여부 / 채팅봇을 패널 버튼으로 껐는지 탭·Chrome을 닫았는지
- 근거 파일 17개(요청봇 6·채팅봇 5·서버 3·설정 2·decisions). Relay 기록은 PC 브라우저 탭에서 셈만(건수·시각·시스템 필드), state.json을 PC 밖으로 옮기지 않음. **고객 정보 기록 0**. 권한 검사 거절 없음
- 바꾼 파일(새 파일만): docs/audit/lead-gap-and-autosend-20260924.md(16,072바이트, sha256 d66937a21493), docs/progress.md(이 칸)
- 백업: 없음(기존 파일 수정 없음)
- run-all: 안 함(수정 없음). 코드·설정·데이터 수정 0, 재시작·확장 재로드·채팅봇 켜기/끄기 0, 숨고 화면 안 엶
- 외부 발송·유료 API 호출·설치: 없음. 파일 삭제·git push 없음
- 가격·문구·수정 횟수·납기 변경: 없음

## 2026-09-24 12:56 · 숨고 운영방(Cowork claude-ff) · next-soomgo.md (지시 7 이어서) — 준희 "(나) 읽기 허락" 받고 다시 시도 → 권한 검사가 또 거절(3번째, "PII Data Handling"). 요청 본문은 꺼내지 않고 편집 종류 표시·예산 숫자만 뽑는 방식이었음. 이 방에서는 영상편집 요청 내용 분류 불가로 확정. 남은 길: (가) 준희가 숨고 목록에서 직접 세기 / (다) 아스트라에 맡기기. 바꾼 파일: progress.md만

## 2026-09-24 12:37 · 숨고 운영방(Cowork claude-ff) · next-soomgo.md (지시 7) — 영상편집 문의 분류 · **부분 완료, 멈춤(준희 필요)**
- 자료원·기간: 로컬 Relay `GET /api/state`의 soomgoLeads(읽기 전용, server/data/state.json). 401건 중 시험·로컬 46건 빼고 실제 355건. Relay 기록 기간 2026-09-15 19:38 ~ 09-24 12:14 KST(약 9일, 60일 치 없음). 숨고 화면은 열지 않음
- 전체 요청 수: 355 — 영상편집 87(24.5%) / 자막 8 / 문서 83 / PPT 19 / 기타 158(이 중 이력서·자소서 113 = 31.8%로 가장 많음)
- 영상편집 87건 모두 9/19 03:21~06:38 KST 3시간 사이에만 기록되고 그 뒤로 0건 → Relay 숫자로는 "압도적"을 판단할 수 없음(요청봇 기록 경로 확인 필요 [추정])
- 잘못 견적: 영상편집을 다른 서비스로 계산 3건(문서 28,000원 2 · 자소서 대필 48,000원 1), 나머지 84건은 옛 카탈로그 "간단 영상편집·자막 추가" 48,000원(원가·할인가 문구). 87건 모두 발송 확인 기록 0건(발송 결과·채팅 답장·진행 카드 없음) → 실제로 나갔는지는 숨고 "보낸 견적"에서 준희 확인 필요. 자막으로 잘못 본 건 0
- 컷+자막 범위 N건: 알 수 없음. 영상편집 요청을 한 건씩 읽는 조회(분량 칸)가 이 세션의 자동 권한 검사에서 2번 거절됨("Production Reads", "PII Data Handling"). 같은 내용을 숨고 목록 화면으로 읽는 것도 우회라 하지 않음. 본문 있는 영상편집 기록은 87건 중 2건뿐이기도 함
- 새로 연 요청 0건 · 누른 버튼 0건 · 바꾼 파일: docs/soomgo/video-edit-demand-20260924.md(새 파일, 6,429바이트, sha256 665cddb065ed)와 progress.md만
- 준희 결정 필요: 영상편집 요청 내용을 누가 어떻게 읽을지((가) 준희가 숨고 목록에서 직접 종류만 세기 / (나) 이 방에 읽기 명시 허락 / (다) 아스트라에 맡기기). 결정 전까지 지시 7 나머지는 하지 않음

## 2026-09-24 12:06 · 숨고 운영방(Cowork claude-ff) · next-soomgo.md (지시 6) — 숨고 프로필·서비스 소개 점검(읽기만)
- 한 일: 준희 크롬 새 탭 하나(내 탭)에서 숨고 프로필 미리보기(고객 화면)·사진/동영상 원본 2장·포트폴리오 이미지·영상 상세를 읽음. Codex 탭(채팅·요청 목록)은 건드리지 않음. 끝나고 내 탭만 닫음(문구 전체 옮겨 적으려 같은 미리보기를 한 번 더 열었다 닫음 — 탭은 한 번에 하나)
- 결과 파일: docs/soomgo/profile-audit-20260924.md (21,185바이트, sha256 a2692f51fc3a) — 항목별 지금 문구 그대로, decisions 1~3·7절·astra-brief 대조 라벨, 이미지 글자·이름·순서, 수정안, 준희 할 일
- 검증: 본 항목 20개(+대시보드에만 보인 포트폴리오 1) · 옛 조건 9건(상세설명 PPT 수정 1회 / 상세설명 자막 "SRT와 삽입본 32,000원부터" / 상세설명 문서 1,500자·수정 1회 / Q1 수정 1회 / Q2 번역·자막 삽입 안 함 / Q3 1,500자 / Q4 2영업일 / Q5 수정 1회 / 사진 2번 SRT 이미지 수정 1회·2영업일·번역/삽입 안 함) · 판매 안 함 잔재 1건(사진 1번 자소서·이력서 대필 이미지 720444c5 — 원가 50,000 취소선·긴급 30% 할증도 같이 있음) · 확인 안 되는 실적 2건(경력 "총 1년" vs "2개월", 숨고 표시 "평균 1시간 내 응답") · 수정안 16개 · 준희 할 일 11개 · 누른 버튼 0건(저장·수정·게시·삭제·견적·채팅). 보기용으로 미리보기 1회·포트폴리오 카드 열기, 재생 버튼만 누름
- 포트폴리오 영상 재생: 확인 못 함. 재생 버튼 눌렀으나 시작 안 됨(readyState 0, 오류 없음). 내 탭이 화면 뒤(visibilityState hidden)라 크롬이 미룬 것으로 [추정]. 준희 휴대폰 확인 필요 — 올라간 판이 자막 4초 밀린 shorts-clean.mp4인지도 구분 못 함(할 일 9)
- 가격은 decisions 2절 기준. 서버 반영(개발방 지시 11) 전이라 견적과 다를 수 있어 게시는 서버 반영 확인 뒤(할 일 3)
- 가장 급한 것: 사진 1번(자소서 대필 이미지) 내리기, Q2 "번역·자막 삽입 접수 안 함"이 포트폴리오 영상(영어→한국어 자막 삽입)과 정면으로 어긋남
- 적지 않은 것: 대시보드의 정산 계좌 정보

## 2026-09-24 12:01 · 개발방(Cowork claude-04) · next-dev.md (지시 12) — 수정안만, 코드 수정 없음
- 한 일: 견적 작업 종류 오판정 수정안 작성(자동 대기 v2로 지시 확인 11:56, 준희 사전 승인 범위). pricing-table.js documentWorkType·isSchoolAssignment·documentQuote, relay-server.js 문서 분기·사람 확인 경로, soomgo-auto-rules, claude-quote eligible 읽음
- 수정안: 인포그래픽·포스터·카드뉴스·도식 등 시각 제작 → 범위 확인(금액 없음·자동 발송 안 함·준희 알림) / 기존 문서+디자인·보기 좋게는 내용 유지 말이 있으면 formatting, 불분명하면 범위 확인 / 학교 과제는 학생 단서가 있을 때만, 연구·기업·정부·국책 등 "○○ 과제" 제외. 확인 질문 초안 2줄(자동 문구 아님)
- 검증: 합성 입력 **26건**(M03 4건 포함, 실제 고객 원문 안 씀) → 결과 바뀜 **13건**: 범위 확인 8 · formatting 1 · 학교 과제 해제 5(1건 겹침) · 학교 과제 새로 지정 0 · 같은 작업 종류에서 금액 변동 0. **가격 숫자 변경 0**. 기존 회귀 기준 15건·기존 시험 판정 입력 12개는 수정안에서도 결과 같음. 외부 호출 0
- 남은 결정(준희): claude-quote.js eligible에서 범위 확인 건 제외 여부, "리포트"(회사 시장 리포트) 학생 단서 유지 여부. 적용은 별도 지시 필요
- 바꾼 파일(새 파일만): docs/audit/work-type-fix-proposal-20260924.md, docs/audit/work-type-probe-20260924/(work-type-proposal.cjs, probe.cjs, probe-results.json), docs/progress.md(이 칸)
- 백업: 없음(새 파일만, 기존 파일 수정 없음)
- run-all: 실행 안 함(server/·services/·tests/ 수정 0). 재시작 없음
- 외부 발송·유료 API 호출·설치: 없음. 파일 삭제·git push 없음
- 가격·문구·수정 횟수·납기 변경: 없음

## 2026-09-24 11:40 · Codex 전환 점검
- docs/conversion-reviews/20260924-1140-M03-followup.md: 새 질문·발송 관측 0건, 새 읽음 1건(질문 없음). 기존 M03 관찰 유지, 추가 실험 없음.
- 개발방 지시 12/프로필 점검의 결과 파일·진행 증거 미확인. 기존 배정 유지. 코드·가격·상품·예약 변경 및 고객 발송 없음.
- 다음 전환 점검: 14:40:37 이후. 감독 수신은 별도 확인.
## 2026-09-24 08:25 · M03 관찰 및 실제 PPT 응대 확인
- 보고서: docs/conversion-reviews/20260924-0825-M03-followup.md.
- 기간 중 PPT 실제 질문 1건, 06:44 답장 1건 및 로컬/서버 기록 일치. 자료·희망 마감 대기, 재답장 관측 0건. 합의·결제·입금 미확인.
- M03 적격 문서 상담 0건이라 기존 관찰 유지. 새 할인·고객 재연락·문구 실험 없음.
- 미열람 보상 2건은 고객 문의/매출에서 제외. 06:57 채팅봇 ON 표시를 Pause로 OFF 복구, 이후 유지.
- 개발방 지시 12 결과 파일·진행 기록 없음. 감독 UI는 자체 점검 중단을 명시. 기존 과제를 중복 시작하거나 예약을 재개하지 않음.
- 가격/코드/상품 변경·유료 API 0건. 감독 직접 전달과 수신은 별도 기록.
## 2026-09-24 05:20 · M03 후속 점검
- 보고서: docs/conversion-reviews/20260924-0520-M03-followup.md.
- 적격 새 상담 0건으로 효과 판단 보류. 기존 M03 유지, 새 고객 문구 실험 없음. 합의·결제·입금은 미확인.
- 지시 11 완료 뒤에도 문서 디자인의 writing 오판정과 기관 연구과제의 학교 판정이 로컬 합성 3건에서 재현됨. 자동 코드/가격 미수정.
- 개발방 지시 12가 이미 배정돼 중복 작업 안 함. 결과 파일·시작 기록은 아직 없음. 기존 과제 진행 확인은 감독 담당.
- Codex는 새 astra-brief/correction을 직접 읽음. 이 방에는 가격 정정 재붙여넣기 불필요. 다른 방 적용 여부 미확인.
# 진행 기록

## 2026-09-24 02:15 · Codex 숨고 메인 채널 · 전환 점검 M03
- 실제 요청 2건과 견적 대조: 디자인 요청이 글 작성 견적과 어긋남. 현재 pricing-table 함수로 합성 입력 4건 재현. 둘 다 안읽음이어서 전환 실패 원인 확정은 아님.
- 한 가지 적용: Codex 상담의 요청 범위 대조 지침. 견적봇/서버/가격/상품 변경 없음. 세 채널 이번 실제 고객 발송 0건.
- 수정: customer-channel-integration.md, conversion-reviews/M03 보고·재현 스크립트·결과, latest.md, astra-supervisor-handoff-20260923.md, progress.md, Codex 회차 상태.
- 백업: backups/conversion-review-20260924-0215/. run-all 미실행(운영 코드 미수정), 현재 가격 함수 합성 호출 4건 완료, 외부 API 0회.
- 파이버 9/23 23:53 게시 성공을 기록. 신원 확인 대기는 지난 상태이며 현재 CAPTCHA 접속 장애와 다름. 검색 노출/주문/입금 미확인.
- 신규 샘플 모음은 docs/sample-catalog-20260924.md. 문서 5종 신규 및 기존 자료 7종. 자막은 최종 청취 확인 전 고객 발송 보류.
- 남은 일: 감독에 직접 보고 후 실제 수신 확인, 다음 적격 고객 답장에서 적용 검증. 자동 견적 분류 수정은 감독 개발 검토 대상, 이번에 안 고침.

## 2026-09-23 23:15 · Codex 숨고 메인 채널 · 3시간 전환 점검 M02
- M01 첫 실제 응대 로컬/서버 기록 대조 완료. 현재 서버 visible 1건, question 1건; 전체 매출 수치 아님.
- 파이버 실제 UI 확인: ID verification 미완료, Publish your service 잠금, 첫 서비스 생성 체크 완료. 본인 확인이 선행 조건 중 하나로 보이며 인증만으로 자동 노출된다고 단정하지 않음.
- 세 채널 신규 질문 없음. 고객 발송·유료 API·계정/상품 변경 0건. 신분증 제출 등은 수행하지 않음.
- 상세: docs/conversion-reviews/20260923-2315-M02.md. 최신 링크와 감독 전달 문서 갱신. 백업 backups/conversion-review-20260923-2315/.
- run-all 미실행: 코드 변경 없이 운영 보고만 갱신. 다음 단계는 사용자 본인 확인 후 게시 상태 확인.

## 2026-09-23 20:00 이후 · Codex 숨고 메인 채널 · 전환 개선·감독 연결 (준희 직접 결정)
- 준희 직접 결정: 숨고·크몽·파이버 상담과 직접 답장은 메인 채널 담당, 납기는 실제 제작 상황을 보고 자체 판단. 할인은 먼저 꺼내지 않고 반복 요청 때만 부담 적은 추가 서비스 1개 검토. 주기적으로 무응답/무주문 원인을 확인하고 개선 1개씩 실행, Claude 감독과 연결.
- 감독이 읽을 문서: **docs/astra-supervisor-handoff-20260923.md**. 운영 규칙: docs/conversion-review-protocol.md. 회차: docs/conversion-reviews/latest.md. 감독이 읽으면 supervisor-ack.md로 확인·분담을 남겨 달라는 요청. 공용 파일 전달 등록이며, Claude 대화방 직접 전달·수신 확인은 아직 없음(링크 요청 중).
- 첫 관측: 파이버 UI 19:49경 'You're not visible yet', 수신함 0. 크몽 UI 수신함 없음/감지 심박 정상. 서버 chat-log summary 20:00경 기록 0이지만 Codex 로컬에는 실제 UI 확인 발송 1건. 노출 부족·기록 분리와 고객 문구 문제를 구분해야 함.
- 첫 개선 M01: 앞으로 숨고 응대 메타데이터를 기존 서버 chat-log에 기록하도록 지침 연결. 고객 본문·이름은 전송하지 않음. 과거 시각을 지어내 소급하지 않음. 첫 실제 응대 후 서버 기록 대조는 대기.
- 바꾼 파일: 위 공용 문서 4개와 이 기록, Codex 작업폴더 customer-channel-integration.md. 예약 설정은 automation_update로 갱신. 서버 코드·가격·상품·확장프로그램 변경 없음.
- 백업: backups/conversion-review-20260923-200013/ (progress.md, customer-automation.toml, review-automation.toml, customer-channel-integration.md).
- run-all: 실행 안 함(문서·예약만 변경). API 키·비밀정보 읽기 없음. 고객 발송·결제·유료 API 호출·설치 없음.
- 남은 문제: Claude 감독 실제 수신 확인, M01 실제 첫 수신 검증, 파이버 게시/노출의 정확한 선행 조건 확인. 성과 개선이 입증됐다고 하지 않음.

> 각 방은 작업이 끝나면 **맨 위에** 아래 양식으로 한 칸을 추가하고 멈춘다. 이전 기록은 고치지 않는다.

```
## 2026-09-24 13:35 · 크몽방 · next-kmong.md (지시 5)
- 한 일: 준희 크롬 새 탭 1개로 크몽 내 서비스 목록과 판매 중 상품 3건 공개 페이지를 읽고 탭을 닫았다. docs/kmong/listing-audit-20260924.md 새로 작성.
- 검증 수치:
  - 상품 수: 전체 45(승인 전 6 / 판매중 3 / 비승인 36 / 판매 중지 0). 점검 대상은 판매중 3건
  - 판매중: #822405 AI 업무 자동화 설계(99,000/299,000/590,000, 작업일 3·5·7일, 수정 1·2·2회) / #822608 AI마케팅 템플릿(19,000/29,000/39,000) / #822596 소상공인 월손익 엑셀(19,000/29,000/39,000)
  - 심사 중: #825055 문서 21,000원~ · #824799 자막 32,000원~ → decisions 2절 값과 일치
  - **옛 조건 0건** ("자료 받은 날 +1일", "30분 이상 +2일" 같은 표기 없음)
  - **결정에 없는 서비스 1건**: #822405 업무 자동화 설계 — decisions 1·2·3절과 astra-brief에 없는 서비스·가격·수정 횟수
  - **확인 안 된 실적 표현 5문장(상품 2건)**: 수식 오류 0건·19개 손검산 일치·275개 수식(#822596), 수식 재계산 확인 완료·파일 구성 목록 대조 완료(#822608). 저장소에 있는 2026-09-14 template_product 점검 기록에는 "실제 Excel 엔진 검증 미확인"으로 적혀 있음
  - 확인 필요 3건: 필수 기재 ③ 폰트 표현 2건(#822596 "무료 폰트", #822608 "해당 없음"), 상세 이미지 안 글자 1건(공개 페이지 텍스트로 안 읽힘)
  - 경미한 차이: 필수 기재 ② 문구에 decisions 7절의 "공유"가 빠짐(두 상품)
  - 최저가·1위 같은 최상급 표현 0건. FAQ 등록 0건(세 상품 모두), 리뷰 0건
  - 수정안: 5개 칸(검증 문장 2, 필수 기재 ② 공통 1, #822608 폰트 1, #822405는 판매 여부 결정 필요라 문장 수정안 없음). 준희 할 일 6개
  - **누른 버튼 0.** 편집 화면·메시지함 열지 않음. 저장·수정·게시·삭제·가격 변경·메시지 발송 0건. 탭은 닫음
- 바꾼 파일: docs/kmong/listing-audit-20260924.md (새 파일), docs/progress.md(이 칸)
- 백업: backups/progress.md.pre-kmong-order5.bak(진행 중 줄 전), backups/progress.md.pre-kmong-order5-done.bak(이 칸 전)
- run-all: 실행 안 함(문서만 변경)
- 외부 발송·유료 API 호출·설치: 없음
- 가격·문구·수정 횟수·납기 변경: 없음(점검·수정안만)
- 멈춘 이유 또는 남은 문제:
  - #822405 업무 자동화 설계 판매 여부는 준희 결정 필요. 팔면 decisions 1·2·3절에 추가해야 함
  - "검증" 문장 근거 기록 확인 필요. 없으면 수정안 문장으로 교체
  - 템플릿 원본 파일 글꼴 확인 필요(#822608 "해당 없음" 표현 교체)
  - 상세 이미지 안 글자는 준희가 확인해야 함

## 2026-09-24 03:17 · 개발방(Cowork claude-04) · next-dev.md (지시 11) — 1·2부 끝
- 시작: 준희 채팅 "지시 11을 실행해"(02:57). 지시 10-A가 채팅 승인이 없어 막혔던 부분을 이번 승인으로 진행.
- **1부 (10-A 가격 반영)**
  - 바꾼 값 2개(그 밖의 가격 숫자는 안 건드림):
    1. services/subtitle.json 30분 초과 5분당 20,000 → **10,000**원 (regularAmount·saleAmount, `_note` "9/23 준희 결정, 이전 20,000")
    2. services/document_writing.json extra_1000_chars_or_a4_page 10,000 → **9,000**원 (`_note` 추가). 서버 견적 계산은 이 값을 읽지 않음(숨고 계산의 추가 1쪽 9,000원에 맞춘 표기)
  - 기대값 변경(승인된 값에서만 나온 것): service-regression-baseline subtitle-long-35m 109,000→99,000(견적 문장 포함) · soomgo-auto-rules 33분 109,000→99,000 · subtitle-translation-pricing 33분 [99,000, 119,000], 입히기 119,000+7×15,000=224,000 · **claude-quote.cjs 99줄 33분+입히기 214,000→204,000** (10-A 목록에 빠져 있던 4번째 기대값. 새 숫자 아님)
  - 샌드박스 대조: 대표 요청 20건 중 자막 33분(109,000→99,000)·45분(149,000→119,000)만 바뀌고 18건 그대로 → 멈춤 조건 해당 없음
  - run-all(PC): **78/78 통과**. 재시작(봇 발행 포함): **03:08:51 KST**
  - 미리보기 5건(재시작 뒤, 기록 안 남김): 자막 33분 99,000원 당일~1일 · 자막 45분 119,000원 당일~1일 · 번역 자막 33분 119,000원 당일~1일 · 문서 3쪽 30,000원 당일~1일 · 문서 6쪽 57,000원 1~2일 (모두 v8)
  - astra-brief 1차 재생성 03:04: subtitle sha 9ac4c9d93fac · document_writing sha 0fde083f55f0
- **2부 (문구 수정 제안 1~17 적용, 8번 건너뜀)**
  - 적용: 1~7, 9~17. **8번 건너뜀**: 크몽방이 이미 반영함(product-page-draft 2쪽까지 21,000 · A4 1쪽 추가 9,000원)
  - 1~4 services/subtitle.json: scope(번역·입히기 미포함 문장 뺌, "영상 편집은 하지 않습니다"), scopeTranslated, optionLines ②③, extraScope(5분마다 10,000원)
  - 5~7 services/document_writing.json: packages.scope "A4 2쪽 이내·…수정 3회", quoteText 끝 문장(숨고페이·확인 후 거래 확정), optionLines 3줄(문서 2쪽 21,000/추가 1쪽 9,000 · 교정 4쪽 21,000/5,000 · 녹취 10분 21,000/1,800, 각 수정 3회)
  - 9 server/global-reply.js: "block by block" → "against the audio from start to finish"
  - 10 server/config/swan-astra-operations-room-prompt.md: 옛 서비스·가격 절(33~53줄)을 docs/astra-brief.md를 따르라는 2줄로 바꿈, 자소서 검수 줄 삭제, "90점 이상 검수 기록" → "준희 승인 기록"
  - 11 swan-resume-channel-prompt.md 맨 위 폐기 표시 · 12 kmong-automation.js 자소서 결정형 답장을 불가 문장으로
  - 13 dist 자소서 상세 3개(resume-writing-service·kmong-resume-writing-service·kmong-resume-cover) 맨 위 폐기 주석
  - 14 dist/subtitle-service.html·kmong-subtitle-service.html: 수정 2회, SRT 자막 파일, 번역 20%, 30분 넘으면 5분마다 10,000원, 긴급 줄·원가 표시 뺌. **곁 수정 1곳**: "SRT와 영상 자막 삽입본, 기본 수정 1회를 포함합니다." → "SRT 자막 파일과 기본 수정 2회를 포함합니다." (같은 항목 취지, 제안서에 줄 번호는 없던 곳)
  - 15 dist/document-writing-service.html·kmong-document-writing-service.html·brand-detail.html: A4 2쪽, 수정 3회, 추가 1쪽 9,000원, 긴급·기준가/원가 뺌
  - 16 dist/downloads 옛 게시글 3개(document-writing-listing·price-menu·post-under-1000) 맨 위 폐기 표시
  - 17 profile-sample-copy.txt(5분 32,000원·10분 49,000원, 자막 수정 2회·문서 3회), presentation-conversion-listing.txt(수정 2회)
  - 기대값 1곳: tests/subtitle-translation-pricing.cjs 54줄 — 바뀐 범위 문장에 맞춤(`영상 편집은 하지 않습니다`)
  - run-all(PC): **78/78 통과** (136초). 재시작(봇 발행 포함): **03:16:17 KST**, 숨고 요청 0.4.21 · 숨고 채팅 0.3.23 · 크몽 0.1.3, /api/health 200
  - astra-brief 2차 재생성 03:12: subtitle sha **aadbcfe49a6a** · document_writing sha **cbcc1ad1d0af** (presentation 82fd537777a6 · translation_en f8337214a993 · decisions f2dad45a0939). tests/astra-brief 통과
- 바꾼 파일: services/subtitle.json, services/document_writing.json, tests/fixtures/service-regression-baseline.json, tests/soomgo-auto-rules.cjs, tests/subtitle-translation-pricing.cjs, tests/claude-quote.cjs, server/global-reply.js, server/kmong-automation.js, server/config/swan-astra-operations-room-prompt.md, server/config/swan-resume-channel-prompt.md, dist/ 상세 html 8개(위 13~15), dist/downloads/ txt 5개(위 16~17), docs/astra-brief.md, docs/progress.md(이 칸)
- 백업: backups/price-decision-20260923/ (1부 7개), backups/copy-fix-20260924/ (2부 원본 20개, 같은 상대 경로)
- 외부 발송·유료 API 호출·설치: 없음. PNG 재생성·게시, 플랫폼 화면 수정, 고객 발송, git push, 파일 삭제, 키 읽기 0건
- 가격·문구·수정 횟수·납기 변경: 있음 — 가격은 승인된 2개 값만, 문구는 제안 1~17(8 제외)만
- 남은 문제:
  - 상세 이미지 PNG는 다시 만들지 않았다(html 원본만 고침). 올라가 있는 이미지는 옛 조건 그대로
  - 이미 열려 있는 Astra 방은 새 지시를 자동으로 읽지 않는다. 바뀐 기준(자막 30분 초과 5분마다 10,000원 등)을 그 방에 알리려면 준희가 정정 메모를 붙여야 함

## 2026-09-23 20:33 · 크몽방 · next-kmong.md (지시 4)
- 한 일: docs/kmong/ 초안 4개에서 준희 9/23 20시 결정과 어긋나는 숫자·납기 문장만 고쳤다. 문장 틀, 자막 30분 이하 금액, 번역 가산, 수정 횟수, 첫 줄은 건드리지 않았다.
- 고친 곳 6곳 (전 → 후):
  1. product-page-draft.md 14행: `| 4 | 30분 초과 | 89,000원 + 5분당 20,000원 | packages[3].unit |` → `| 4 | 30분 초과 | 89,000원 + 5분당 10,000원 (45분 119,000원) | packages[3].unit · 9/23 준희 결정 |`
  2. product-page-draft.md 35행: `| 기본 | 제공 자료 기반 1,500자 이내 | 21,000원 | …(regular 24,000) |` → `| 기본 | 제공 자료 기반 2쪽까지 | 21,000원 | …(regular 24,000) · 9/23 준희 결정 |`
  3. product-page-draft.md 36행: `| 추가 | 1,000자 또는 A4 1쪽 추가 | 10,000원 | additionalFees.extra_1000_chars_or_a4_page |` → `| 추가 | A4 1쪽 추가 | 9,000원 | 9/23 준희 결정 |`
  4. product-page-draft.md 44~45행: `납기: 답변틀 v3.1 그대로 (자료 받은 날 +1일, 20쪽 이상 +2일)` + 숨고와 표현이 다르다는 참고 줄 → `납기: 5쪽 이하 당일~1일 / 6~15쪽 1~2일 / 16쪽 이상 2~3일 (9/23 준희 결정. 옛 규칙 폐지)` (참고 줄은 결정으로 정리돼 삭제)
  5. reply-template-v4-draft.md 9행: `3. 문서 납기는 v3.1 그대로 (자료 받은 날 +1일 / 20쪽 이상 +2일)` → `3. 문서 납기: 5쪽 이하 당일~1일 / 6~15쪽 1~2일 / 16쪽 이상 2~3일 (9/23 준희 결정. v3.1 규칙 폐지)`
  6. reply-template-v4-draft.md 20행: `- {납기}: 자막 = 당일~1일 / 문서 = {납기일}까지 (자료 받은 날 +1일, 20쪽 이상 +2일)` → `- {납기}: 자막 = 당일~1일 / 문서 = 5쪽 이하 당일~1일, 6~15쪽 1~2일, 16쪽 이상 2~3일`
- 검색 결과: 살아 있는 규칙 중 "+1일"·"20쪽 이상 +2일"·"5분당 20,000"·"1,000자" **0건**. 남은 것은 "폐지"라고 적은 이력 문장 3곳뿐(product-page 44행, v4 7행·9행).
- template-reply-draft.md와 video-intake.md에는 고칠 숫자·납기 문장이 없어 그대로 뒀다.
- 바꾼 파일: docs/kmong/product-page-draft.md, docs/kmong/reply-template-v4-draft.md, docs/progress.md(이 칸)
- 백업: backups/progress.md.pre-kmong-order4.bak(진행 중 줄 전), backups/progress.md.pre-kmong-order4-done.bak(이 칸 전)
- run-all: 실행 안 함(문서만 변경). services/*.json은 읽지도 고치지도 않음
- 외부 발송·유료 API 호출·설치: 없음. 크몽 로그인·상품 수정·메시지 0건
- 가격·문구·수정 횟수·납기 변경: 크몽 초안 문서 안의 숫자·납기만 준희 결정대로 반영. 서버 가격표는 그대로
- 멈춘 이유 또는 남은 문제: 지시 4 완료, 멈춤. 남은 35건 템플릿 파일 경로는 준희 답 대기(지시와 별개). services/subtitle.json·document_writing.json에는 아직 옛 값(5분당 20,000, 추가 10,000, leadDaysRules)이 있어 크몽 초안과 다르다 — 서버 반영은 개발방 몫이라 이 방에서는 건드리지 않았다.

## 2026-09-23 20:32 · 해외 채널방(Cowork claude-06) · next-global.md (지시 6) — 1번 실행 안 함(규칙 충돌), 준희 결정 필요
- 한 일: docs/global/fiverr-visibility-20260923.md 작성 — 준희가 화면에서 볼 6가지(읽기만), 흔한 원인표(전부 [추정]), 참고 링크(커뮤니티·블로그)
- 실행 안 한 것: 1번(크롬에서 파이버 대시보드·상품 상태 읽기)과 2번의 공식 도움말 열람. 이 방의 준희 절대 규칙 "파이버·업워크 페이지를 봇이 읽거나 누르지 않는다(페이지 수집 포함)"과 부딪힘. decisions.md 77번(파이버 답장 Codex 담당)은 발송 담당을 바꾼 것이지 이 방의 읽기 금지를 푼 것은 아니라고 봄. 준희가 이 방에 직접 풀어 주면 실행
- 안 보이는 이유 문구(원문): 확인 못 함(화면 안 봄). 19:49 Codex 기록의 "You're not visible yet"만 있음
- 끝나지 않은 항목 목록: 확인 못 함
- 준희 조치 필요: 예 — 화면에서 6가지 읽어 이 방에 붙여 넣기(파일 참고)
- 참고: decisions.md 77번은 "준희가 Codex 방에서 승인했다고 Codex가 감독방에 전달"한 것이 근거. 준희 본인 확인이 따로 있는지 감독이 확인하면 좋음 [추정 아님, 근거 문구 그대로]
- 버튼 누름 0건, 파이버 페이지 열람 0건, 로그인 0건
- 바꾼 파일: docs/global/fiverr-visibility-20260923.md(새), docs/progress.md(이 칸)
- 백업: 없음(새 파일)
- run-all: 실행 안 함(코드 변경 없음)
- 외부 발송·유료 API 호출·설치: 0건 (웹 검색 1회, 파이버 밖 결과만)
- 가격·문구·수정 횟수·납기 변경: 없음

## 2026-09-23 20:40 · 개발방(Cowork claude-04) · next-dev.md (지시 10) — B 끝, A(가격 반영)는 멈춤
- 한 일:
  - **A 멈춤**: services/subtitle.json(30분 초과 5분마다 20,000→10,000)·document_writing.json(extra_1000_chars_or_a4_page 10,000→9,000) 수정이 이 세션의 자동 실행 안전장치에 "공유 자원 수정"으로 막힘. 우회하지 않음. **가격 값·시험 기대값·기준표 모두 안 바꿈**, run-all·재시작·미리보기·astra-brief 재생성도 안 함
  - 준비해 둔 것(적용 안 함): 바뀔 기대값은 3곳뿐으로 확인 — tests/fixtures/service-regression-baseline.json 자막 35분 109,000→99,000(금액·견적 문장 두 곳), tests/soomgo-auto-rules.cjs 33분 109,000→99,000, tests/subtitle-translation-pricing.cjs 33분 [109,000·131,000]→[99,000·119,000]·번역+삽입 131,000+7×15,000→119,000+7×15,000. extra_1000_chars_or_a4_page는 서버 계산이 읽지 않아(검색 0건) 금액 변화 없음
  - **B 끝**: docs/audit/copy-fix-proposal-20260923.md — 수정안 17개(지금 고객 경로 예 3 / 아니오 7 / 모름 7). 대조표 6·7·8·9·13·16, 문서 packages.scope, 잔재 높음 9곳 모두 포함. 적용 안 함
- 바꾼 파일: docs/audit/copy-fix-proposal-20260923.md(새 파일), docs/progress.md
- 백업: 없음(가격 파일을 바꾸지 않았으므로)
- run-all: 실행 안 함
- 외부 발송·유료 API 호출·설치: 없음
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제: A는 준희가 개발방 대화에서 직접 적용을 확인해 주면 진행(decisions.md 2절에는 이미 반영됨). B는 감독 검토 → 준희 승인 뒤 다음 지시

## 2026-09-23 19:24 · 숨고 운영방(Cowork claude-ff) · next-soomgo.md (지시 5 — Astra 답장 기록 경로)
- 지시 4 정정: 지시 4 보고의 "대화 읽기·서버 기록·심박은 그대로"는 틀렸다. chat-content.js serverPaused()가 sendOff면 paused=true로 돌려주고, guardedLoop가 이 값으로 읽기 전에 멈춘다(주석 127~128줄과 반대). 채팅봇은 꺼져 있으므로 고치지 않았다.
- 한 일:
  - 새 모듈 server/astra-chat-log.js(검사·기록·요약) + relay-server.js에 경로 2개 연결(기존 `/api/astra/` 처리보다 앞, 로컬 전용·origin 검사·헤더 `x-relay-astra: chat-log`). 이름 겹침 없음(기존은 /api/astra/chat·balance·debate·ops-audit). 기존 기록 파일 형식은 건드리지 않음(새 파일).
  - `POST /api/astra/chat-log`: 필수 conversationId(6자리 이상 숫자)·customerMessageAt·kind(reply_sent|question_seen|handoff_to_owner)·resolution(open|resolved|waiting_customer_files|owner_needed). reply_sent면 delivery(visible|uncertain)·replySha(16진수 12자) 필수. 선택 at·stage(8종)·serviceId·quoteVersion·note(120자 한 줄). 본문 칸(text·message·body·reply·replyText·customerMessage·customerText·content)이 오면 거절, note에 전화번호·이메일 형태면 거절. 같은 (conversationId, customerMessageAt, kind, replySha)는 한 건(duplicate:true). 응답에 countedAsSent(visible일 때만 true)·attention(uncertain 또는 owner_needed).
  - `GET /api/astra/chat-log/summary`: totals(entries·conversations·repliesVisible·repliesUncertain·handoffs), stageCounts(대화방별 마지막 단계를 이름 그대로 — 주문·문의 칸 없음), unresolved(마지막 기록이 open·owner_needed 또는 uncertain, 고객 메시지 오래된 순, 경과 분), attention(uncertain·owner_needed), conversations.
  - 저장 server/data/astra-chat-log.json(최근 5,000건, 원자적 저장). .gitignore에 이 파일·.tmp 두 줄 추가.
  - 안내문 docs/astra-chat-log-guide.md: 붙여 넣을 블록(보낸 뒤 목록에서 확인 → visible/uncertain, 기록은 고객 발송과 별개, 실패 시 재시도 1번 후 "기록 실패"를 Astra 방에, 이름·전화·주소·본문 금지, 결제·환불·분쟁은 handoff_to_owner) + PowerShell 예(UTF-8 바이트, 헤더, sha256 앞 12자 계산, 재시도 1번).
- 경로 요청·응답 예(재시작 뒤 실제 서버, 기록 파일에 아무것도 안 남김):
  - `GET /api/astra/chat-log/summary` 헤더 없음 → 403 `{"error":"astra_chat_log_header_required"}`
  - 같은 요청 헤더 있음 → 200 `totals {entries:0, conversations:0, repliesVisible:0, repliesUncertain:0, handoffs:0}`, unresolved 0
  - `POST /api/astra/chat-log` `{kind:"reply_sent"}` → 400 details [conversationId_numeric_required, customerMessageAt_required, delivery_required_for_reply_sent, resolution_invalid, replySha_required_for_reply_sent]
  - 정상 모의 기록 예(시험 파일 안 임시 폴더에서만): `{conversationId:"235999001", customerMessageAt:"…09:48Z", kind:"reply_sent", delivery:"visible", resolution:"open", stage:"question", replySha:"a1b2c3d4e5f6"}` → 200 `{ok:true, duplicate:false, countedAsSent:true, attention:false}`; 같은 것 다시 → `duplicate:true`
- 새 시험 tests/astra-chat-log.cjs(모의·임시 폴더) 통과 항목: 로컬 아님·다른 origin·헤더 없음 403(POST·GET) / 필수 칸 6종 각각 없으면 400 / 숫자 아닌 대화번호(test-1)·모르는 단계·sha 형식 400 / 본문 칸·전화번호·이메일·120자 초과·여러 줄 note 거절, 거절 시 파일 안 생김 / 중복 1건, 저장 파일에 본문 없음 / uncertain은 보냄 수 0·주의 / summary 미해결 목록(owner_needed·uncertain, 오래된 순, 경과 분) / 단계는 이름 그대로 — 결제 요청 1이 payment_requested에만, orders·inquiries 칸 없음 / 같은 대화 나중 기록이 마지막 상태 / 서버 연결 정적 검사·.gitignore.
- 바꾼 파일: server/relay-server.js(require 한 줄 + 경로 10줄), server/astra-chat-log.js(새), tests/astra-chat-log.cjs(새), tests/run-all.cjs(한 줄), .gitignore(세 줄), docs/astra-chat-log-guide.md(새), docs/progress.md(이 칸)
- 백업: backups/astra-chat-log-20260923/ (relay-server.js, run-all.cjs, gitignore.bak), backups/progress.md.pre-soomgo-order5-20260923.bak
- run-all: 전체 77개 중 77개 통과, 실패 없음 (PC, 144초, 19:19~19:22)
- 재시작·심박: 19:22:32 재시작(publish:true, 숨고 요청 0.4.21·숨고 채팅 0.3.23·크몽 0.1.3). 요청봇 0.4.21 "새 요청 확인 중". 채팅봇은 꺼 둔 상태(마지막 심박 15:34, 준희 결정).
- 외부 발송·유료 API 호출·설치: 없음. 숨고 발송 0건, 채팅봇 안 켬.
- 가격·문구·수정 횟수·납기 변경: 없음.
- 멈춘 이유 또는 남은 문제: 지시 5 완료. 여기서 멈춘다. Astra 자동화에 안내문 블록을 붙이는 것은 준희. 첫 실제 기록이 들어오면 summary로 확인 가능.

## 2026-09-23 19:17 · 크몽방 · next-kmong.md (지시 3)
- 한 일:
  1. v4 초안: 무료 샘플 문장을 "2026-09-23 준희 승인됨"으로 표시. 첫 줄 B("문의 주셔서 감사합니다. 보내주신 내용 확인했습니다.")는 14:20에 이미 반영돼 있어 그대로 유지. 템플릿 답변 초안도 같은 첫 줄로 이미 반영됨.
  2. docs/kmong/template-required-info.md 새로 작성 — 비승인 36건(9/15 6건 + 9/17 30건, 819824는 메일 2회) 목록과 gig 번호, 대응 파일, 필수 기재 문구.
  3. 9/9 비승인 1건은 카테고리 변경 요청이라 별도 한 줄로만 적음(추천 카테고리 "문서·글쓰기 > AI 콘텐츠 생산", 준희 판단 필요).
- 검증 수치:
  - 문구를 만든 상품: **1건** (gig 819315 카페 재료 원가 연동 엑셀 템플릿)
  - [파일 없음]: **35건**
  - [글꼴 확인 필요]: 0건 (유료·출처 불명 글꼴은 발견되지 않음)
  - 발견한 글꼴: 01_연습용.xlsx·02_입력용.xlsx = 맑은 고딕(셀 전체) + Carlito(엑셀 기본 글꼴 슬롯, SIL OFL 무료), 테마 정의에 Calibri·Calibri Light(실제 셀 미사용). 03_사용설명서.pdf = 맑은 고딕(Malgun Gothic, Bold 포함) + Helvetica(PDF 기본)
  - 파일 출처: Documents\Codex\2026-09-14\3700x-new-template-product-20260914\work\qa-cafe\ (읽기만 함). 이 폴더와 2026-09-15·2026-09-16·Swan-Assets 폴더 접근 권한을 준희에게 요청해 받았다.
  - 외부 작업 0건: 크몽 로그인·수정·재등록·메시지 없음. Gmail은 읽기만.
- 바꾼 파일: docs/kmong/reply-template-v4-draft.md, docs/kmong/template-required-info.md(새 파일), docs/progress.md(이 칸)
- 백업: backups/progress.md.pre-kmong-1917.bak
- run-all: 실행 안 함(문서만 변경)
- 가격·문구·수정 횟수·납기 변경: 없음(문구는 초안 파일 안에서만)
- 멈춘 이유 또는 남은 문제:
  - 나머지 35건 템플릿 파일 위치 미확인 → 준희가 경로를 알려주면 같은 방식으로 글꼴 확인 후 문구를 채운다.
  - 사용설명서 PDF에 맑은 고딕 부분 글꼴이 포함돼 있다. 시스템 글꼴을 PDF에 넣어 배포해도 되는지 확인 필요.
  - 9/22 18:31 알림톡 비승인 건은 여전히 미확인(크몽 로그인 필요). 단, 9/15·9/17 비승인은 전부 템플릿 상품이고 자막·문서 서비스 상품은 메일 기록에 없다.

## 2026-09-23 19:26 · 개발방(Cowork claude-04) · next-dev.md (지시 9)
- 한 일:
  1. **Astra 기준 자동 생성** — scripts/build-astra-brief.cjs(새 파일, 서버 코드 수정 없음) → docs/astra-brief.md, 시험 tests/astra-brief.cjs.
     - 금액·기간·수정 횟수 20건은 서버 buildSoomgoQuote·pricing-table 계산값이다. 문서 납기 구간도 가격표 함수로 계산했다.
     - 판매 안 함 5개는 decisions.md 1절에서 뽑았다(논문·학위·학술 / 문서 번역 / 자소서·이력서 대필 / 도장 속기 / 외국어 자막 납품). translation_en은 "판매 안 함(문서 번역)"으로만 표시.
     - 시험 내용: 파일 금액 = 지금 계산값, 판매 안 함 목록, 고객 안내용 줄에 "할인" 없음. 가격을 바꿔 보면 실패하는 것도 확인했다.
     - 머리 그대로:
       > **이 파일은 생성물 — 직접 고치지 말 것.** 값을 바꾸려면 services/*.json을 준희 승인으로 고친 뒤 `node scripts/build-astra-brief.cjs`로 다시 만든다.
       > 생성 시각: 2026-09-23 19:14 KST · 만든 것: scripts/build-astra-brief.cjs · 금액·기간·수정 횟수는 서버 견적 함수(buildSoomgoQuote, server/pricing-table.js) 계산값
       > - services/subtitle.json · quoteMessageVersion v8 · 수정 2026-09-23 18:35 KST · sha256 69c6e6f01472
       > - services/document_writing.json · quoteMessageVersion v8 · 수정 2026-09-23 18:35 KST · sha256 51771eefbedf
       > - services/presentation.json · quoteMessageVersion v6 · 수정 2026-09-23 18:35 KST · sha256 82fd537777a6
       > - services/translation_en.json · quoteMessageVersion 없음 · 수정 2026-09-22 03:25 KST · sha256 f8337214a993
       > - docs/decisions.md (1·2·3·7-1절 읽기만) · 수정 2026-09-23 18:56 KST · sha256 381bbc90fe9a
  2. **가격·범위 대조표** — docs/audit/price-scope-audit-20260923.md.
     - 계산: 숨고 견적 함수로 17건, 영문 교정 1건, 파이버 priceFor 6건. 기록 안 남는 방식: PC와 같은 바이트의 사본에서 네트워크 끊고 실행, 실행 전후 파일 목록이 같음.
     - **대조 18건 / 불일치 항목 16개**
     - 가격 충돌 5개 — 고르지 않음, **준희 결정 필요**:
       ① 문서 추가 쪽 9,000(숨고) ↔ 10,000(크몽·additionalFees). 3쪽 30,000 ↔ 41,000, 6쪽 57,000 ↔ 71,000
       ② 문서 기본 포함: decisions "1쪽(1,500자) 21,000" ↔ includedPages 2
       ③ 문서 납기: 숨고 분량 구간 ↔ 크몽 "자료 받은 날 +1일"
       ④ 33분 실거래 94,000 ↔ 계산 109,000
       ⑤ PPT 자료조사가 필요하다고 적혀도 금액 39,000, 10,000은 질문 줄에서만 안내
     - 문구·범위 11개:
       ⑥ 자막 범위 문장 "입히는 작업 포함 안 됨"이 입히기 견적에도 붙음
       ⑦ 번역 자막 범위가 "한국어 영상"
       ⑧ "5분 넘으면 확인 후 금액"이 실제와 다름
       ⑨ 파이버 서버 문구 "block by block" ↔ 게시본 "from start to finish"
       ⑩ 상세 이미지·프로필 원본에 수정 1회·삽입 포함·번역 5분당 20,000·긴급 30%·자료조사 15,000
       ⑪ Astra 첫 지시가 옛 기준
       ⑫ 납품 형식표가 pdf·hwp·pptx·mp4를 "지원 안 함"으로 둠
       ⑬ 문서 정의 파일 quoteText에 옛 본문("안전결제")
       ⑭ 크몽 답변틀 v3.1의 "30분 이상 +2일"
       ⑮ 크몽 PPT 문구 없음
       ⑯ 문서 optionLines "원가 40,000 → 할인가 28,000"
     - 지시에 적힌 후보 6개 모두 맞음. 파이버 서버는 독일어 10분에도 $45 줄을 넣는다(원어를 안 봄).
  3. **잔재 목록** — docs/audit/residue-20260923.md, 읽기만. **잔재 25곳, 고객 노출 높음 9곳**:
     - Astra 첫 지시 34~46줄
     - swan-resume-channel-prompt.md 전체
     - 크몽 결정형 답장 illegal_or_false_resume_request("…작성은 가능하지만")
     - dist 자소서 상세 2개·크몽 자소서 표지
     - 게시용 글 원본 3개(자소서 가격·"기준가→할인")
     - 자막·문서 상세 원본의 "긴급 기본가의 30%·원가"
     - 게시 여부는 확인 못 함
  4. run-all 1회 **78/78**. 서버 재시작 안 함.
- 바꾼 파일:
  - 새 파일: scripts/build-astra-brief.cjs, tests/astra-brief.cjs, docs/astra-brief.md, docs/audit/price-scope-audit-20260923.md, docs/audit/residue-20260923.md
  - tests/run-all.cjs 한 줄 추가. 19:19에 다른 방이 넣은 astra-chat-log 줄은 살림
  - docs/progress.md
- 백업: backups/astra-brief-20260923/run-all.cjs(시작 때판), run-all.cjs.at1933(이름의 시각은 잘못, 실제 19:19 — 다른 방이 줄을 더한 뒤판)
- run-all: 78/78 (PC, 144초)
- 외부 발송·유료 API 호출·설치: 없음
- 가격·문구·수정 횟수·납기 변경: 없음(프롬프트·확장·services 수정 없음)
- 멈춘 이유 또는 남은 문제:
  - 준희 결정 5건(위 ①~⑤)
  - docs/astra-brief.md를 Astra 방에 넘기는 것과 옛 프롬프트 교체는 지시 밖이라 하지 않음
  - **progress 사고**: 19:17 크몽방·19:24 숨고 운영방이 쓸 때 개발방 단계 줄이 두 번 빠짐. 옛 사본을 통째로 쓴 것으로 보임 [추정, 다른 방 칸 자체는 지워지지 않음]. 그때마다 다시 적었고 이 칸으로 합침
  - **정정(19:28)**: 19:26에 이 칸을 쓴 직후(19:27) PC 파일이 개발방이 3단계 줄을 넣은 판으로 되돌아가 숨고 운영방 19:24 칸과 이 칸이 빠졌다. 같은 출력 경로(outputs/pd/progress.md)를 여러 번 고쳐 올린 개발방 쪽 원인으로 보인다 [추정 — 해외방 18:51 사고 기록과 같은 모양]. 그래서 위의 "다른 방이 옛 사본으로 썼다"는 판단도 틀렸을 수 있다. 새 경로로 다시 올려 두 칸을 되살림
  - **시각 정정(19:31)**: 이 칸과 단계 줄의 시각을 처음에 짐작으로 적어 실제보다 11~15분 늦게 썼다. PC 파일 수정 시각 기준으로 고침: 1단계 19:14, 2단계 19:20, 3단계 19:22, run-all 19:23~19:26, 이 칸 19:26

## 2026-09-23 18:53 · 해외 채널방(Cowork claude-06) · next-global.md (지시 5)
- 한 일: 새 파일 docs/global/fiverr-custom-offer-drafts.md — 맞춤 견적 틀 3가지(1. MP4 요청 / 2. 30분 초과 / 3. 영어·프랑스어 아닌 원어: 앞부분 1분 확인 → 가능하면 견적, 어려우면 거절 답장). 각 경우 ① 첫 답장(영어) ② Custom Offer 칸(설명·납기·수정 2회·가격). AI 물으면 덧붙일 한 줄 포함. server/global-reply.js 읽고 대조(코드 안 고침)
- 지시 4(한 줄): 16:54에 초안 머리말 "게시본 = 이 초안(9/23 17시대 게시)" 추가, 지시 3 기록 복구 — 완료
- 만든 경우 수: 3 (+ 3번의 "어려울 때" 거절 답장 1개)
- 준희가 채울 칸: 1번 가격·납기 / 2번 가격·납기 / 3번 가격(30분 이하는 기본 날수, 초과는 납기도)
- 서버 초안과 어긋남(개발방 몫, 코드 안 고침): ① 서버 프롬프트 "checks timing block by block" ↔ 게시본 "from start to finish" ② 서버는 영어·프랑스어 아닌 원어도 패키지 금액 줄을 넣음 ↔ 이 틀은 1분 확인 먼저
- 사고 기록: 18:51 이 방이 "진행 중" 줄을 쓸 때 progress.md 옛 사본(16:54판)이 PC에 들어가 개발방 17:12·18:39 칸이 잠시 사라짐. 같은 출력 경로를 다시 쓴 탓으로 보임 [추정]. 18:51에 읽은 최신본으로 되돌리고 이 칸을 넣음(새 파일 이름으로 올림). 그사이 다른 방 쓰기는 없었음(수정 시각 확인)
- 바꾼 파일: docs/global/fiverr-custom-offer-drafts.md(새), docs/progress.md(이 칸)
- 백업: 새 파일이라 없음. progress 되돌림 근거 사본은 이 방 작업 공간에 있음
- run-all: 실행 안 함(코드 변경 없음)
- 외부 발송·유료 API 호출·설치: 0건 (파이버 로그인·메시지·견적 발송 없음)
- 가격·문구·수정 횟수·납기 변경: 없음(가격·납기 전부 빈칸)
- 멈춘 이유 또는 남은 문제: 지시 5 완료. 파이버 메시지로 구매 전 영상 파일을 받을 수 있는지는 [추정] — 화면 확인 필요


## 2026-09-23 18:39 · 개발방(Cowork claude-04) · next-dev.md (지시 8)
- 한 일:
  1. 백업: backups/quote-new-copy-20260923/ (지시 8 직전 = 되돌린 상태 9개 파일)
  2. 새 문구 다시 적용(원본 backups/quote-revert-20260923/ — 지시 7 직전 상태와 바이트 비교로 같음 확인, 섞인 다른 차이 없음):
     - services/presentation.json quoteText·quoteMessageVersion **v6**
     - services/document_writing.json quoteMessageVersion **v8**
     - server/pricing-table.js 문서·속기 message(quoteRequestIntro·작업 설명 줄·새 safeLine·"작업 기간"), module.exports의 quoteRequestIntro
     - server/relay-server.js `requestIntro: pricingTable.quoteRequestIntro(parsed, label),` 한 줄 다시 넣음(지시 7에서 뺀 그 줄만 차이)
     - tests/school-assignment-revisions.cjs·thanks-copy.cjs 새 문구판, tests/hired-detection-quote-text.cjs("거래를? 확정하시면" — 새 문구 "거래를 확정하시면"도 고용 안내로 오판하지 않는지 계속 검사)
     - 살림: channels.fiverr(켬·$25/$45/$75), 지시 7의 customerRoomFallback 시험 3개 기대값, 채팅 발송 끔(정책 그대로)
  3. services/subtitle.json 숨고 quoteText = 새 문구 + "결제는 숨고페이로 진행하고, 결과물을 확인하신 뒤 거래를 확정하시면 됩니다." 다음·{{question}} 앞에 한 줄(문장 그대로): "자막이 말과 어떻게 맞는지는 제 프로필의 포트폴리오 영상에서 먼저 보실 수 있습니다." quoteMessageVersion **v8**. 기준표는 새 문구판에서 **자막 5건에 이 한 줄만** 늘어난 것 확인 후 반영(다른 10건 동일).
  4. run-all(PC) **76/76** → **18:38:15 재시작**(publish, 숨고 요청 0.4.21·숨고 채팅 0.3.23·크몽 0.1.3). 파이버 enabled true 유지. 채팅봇은 켜지 않음.
  5. 미리보기 4건(서버와 바이트가 같은 파일로 buildSoomgoQuote, 기록 안 남음). 금액·기간·수정 횟수는 지시 7 미리보기와 같음(PPT 39,000·1~2일·2회 / 문서 21,000·당일~1일·3회 / 자막 49,000·당일~1일·2회):
    [PPT 제작 / 주제:제공 원고를 발표자료로 변환] v6 · 39000원 · 1~2일
    안녕하세요. 문의 주신 ‘제공 원고를 발표자료로 변환’ 건으로 연락드립니다.
    원고의 흐름을 정리하고, 제목과 본문이 잘 구분되도록 PPT로 구성해 드립니다.
    견적 39,000원 · 작업 기간 1~2일 · 수정 2회 포함
    결제는 숨고페이로 진행하고, 결과물을 확인하신 뒤 거래를 확정하시면 됩니다.
    장수가 늘어나면 작업 전에 먼저 여쭤보겠습니다.
    PPT로 옮길 원고나 자료가 있으신가요? 자료 없이 내용 조사부터 필요하시면 10,000원이 추가됩니다.
    
    [문서 / 글 작성 / 주제:서비스 소개문 정리] v8 · 21000원 · 당일~1일
    안녕하세요. 문의 주신 ‘서비스 소개문 정리’ 건으로 연락드립니다.
    A4 1쪽 분량으로 보내주실 자료를 바탕으로 글을 정리해 드립니다. 별도 자료조사는 포함되지 않습니다.
    견적 21,000원 · 작업 기간 당일~1일 · 수정 3회 포함
    결제는 숨고페이로 진행하고, 결과물을 확인하신 뒤 거래를 확정하시면 됩니다.
    분량이 늘어나면 작업 전에 먼저 여쭤보겠습니다.
    참고할 자료는 준비되어 있으신가요? 자료 없이 내용 조사부터 필요하시면 알려주세요.
    
    [자막 제작 / 주제:한국어 강의 영상 자막] v8 · 49000원 · 당일~1일
    안녕하세요. 문의 주신 ‘한국어 강의 영상 자막’ 건으로 연락드립니다.
    영상의 말소리에 맞춰 자막을 정리하고, 읽기 편하게 줄을 나눠 드립니다.
    견적 49,000원 · 작업 기간 당일~1일 · 수정 2회 포함
    결제는 숨고페이로 진행하고, 결과물을 확인하신 뒤 거래를 확정하시면 됩니다.
    자막이 말과 어떻게 맞는지는 제 프로필의 포트폴리오 영상에서 먼저 보실 수 있습니다.
    자막 파일(SRT)만 필요하신가요, 영상에 자막을 입혀 드릴까요?
    
    [자막 제작 / 주제:없음] v8 · 49000원 · 당일~1일
    안녕하세요. 자막 제작 작업으로 문의 주셔서 감사합니다.
    영상의 말소리에 맞춰 자막을 정리하고, 읽기 편하게 줄을 나눠 드립니다.
    견적 49,000원 · 작업 기간 당일~1일 · 수정 2회 포함
    결제는 숨고페이로 진행하고, 결과물을 확인하신 뒤 거래를 확정하시면 됩니다.
    자막이 말과 어떻게 맞는지는 제 프로필의 포트폴리오 영상에서 먼저 보실 수 있습니다.
    자막 파일(SRT)만 필요하신가요, 영상에 자막을 입혀 드릴까요?
    
- 바꾼 파일: services/presentation.json, services/document_writing.json, services/subtitle.json, server/pricing-table.js, server/relay-server.js, tests/school-assignment-revisions.cjs, tests/thanks-copy.cjs, tests/hired-detection-quote-text.cjs, tests/fixtures/service-regression-baseline.json, docs/progress.md
- 백업: backups/quote-new-copy-20260923/, backups/progress.md.pre-dev8.bak
- run-all: 76/76 (PC)
- 외부 발송·유료 API 호출·설치: 없음
- 가격·문구·수정 횟수·납기 변경: 숨고 견적 문구(준희 결정: 16:16 새 문구 최종 + 자막 포트폴리오 줄). 숫자 변경 없음. 크몽·파이버 문구 없음.
- 멈춘 이유 또는 남은 문제: 없음(지시 8 끝).

## 2026-09-23 17:12 · 개발방(Cowork claude-04) · next-dev.md (지시 7) — 1~5 끝, 6에서 멈춤(7 안 함)
- 한 일:
  1. 백업: backups/quote-revert-20260923/ (되돌리기 전 presentation·document_writing·subtitle·pricing-table·relay-server·시험 2개·기준표·paid-api-guard·chat-send-off)
  2. **되돌림**(해당 값만, 원본 = backups/quote-copy-20260923-161608/):
     - services/presentation.json quoteText·quoteMessageVersion **v6→v5**
     - services/document_writing.json quoteMessageVersion **v8→v7**
     - services/subtitle.json quoteText·quoteMessageVersion **v7→v6** (channels.fiverr는 그대로: 켬·$25/$45/$75)
     - server/pricing-table.js 문서·속기 견적 message(첫 줄·작업 설명 줄·safeLine·"안에 납품") — 16:16 백업과 차이가 문구뿐이라 그 값 그대로
     - server/relay-server.js `requestIntro: pricingTable.quoteRequestIntro(parsed, label),` 한 줄 삭제
     - 같이 바뀌었던 시험 2개(tests/school-assignment-revisions.cjs·thanks-copy.cjs)와 기준표(tests/fixtures/service-regression-baseline.json)도 16:16 이전 값으로
     - (지시 6 중 16:48에 준희 "지금꺼로 해"로 기준표를 새 문구로 바꾸고 재시작했던 것도 이걸로 되돌려짐)
  3. 변경 주체: progress·decisions에 기록 없음. git 마지막 커밋 9/16(작성자 Codex). 16:16:08 백업 폴더 이름 형식과 16:19 서버 로그 갱신으로 보아 **Cowork 방이 아닌 Codex 쪽 세션** [추정]. 방 이름은 못 찾음.
  4. run-all(PC) **76/76** → 17:08:52 서버 재시작(publish, 숨고 요청 0.4.21·숨고 채팅 0.3.23·크몽 0.1.3). 지시 6 남은 확인: `/api/global/reply-usage` fiverr **enabled:true, $25/$45/$75**.
     - run-all을 통과시키려고 **다른 방 정책 변경(16:26 customerRoomFallback.enabled=false, "답장은 아스트라만")에 맞춰 시험 3개 기대값만 고침**: tests/customer-room-fallback.cjs(모델 확인은 켠 복사본으로), tests/chat-send-off.cjs(합치기 꺼지면 가져간 사건 0), tests/paid-api-guard.cjs(enabled는 정책이 정함). 코드·정책은 안 건드림.
  5. 재시작 뒤 견적 미리보기(서버와 바이트가 같은 파일로 buildSoomgoQuote 실행 — 라이브 /api/soomgo/quote는 기록이 남아서 안 씀):
     - PPT v5: "요청 주셔서 감사합니다. 요청서 확인했습니다." / "결제는 숨고페이 안전결제라, …" ✓
     - 문서 v7: 같은 첫 줄 / 안전결제 ✓
     - 자막 v6: 같은 첫 줄 / 안전결제 ✓
     - **16:16 이후 새 문구로 나간 실제 견적: 2건**(문서, v8, 16:24·16:58). 고객 연락 안 함.
  6. 숨고 채팅 탭: 새 탭으로 숨고 채팅 목록을 열어 봄 → 패널이 **"일시 정지"·OFF**, "발송 끔 · 기록만" 표시 없음, 버전 표시 없음, 심박도 안 옴(96분째). 0.3.23 확인 불가 → **탭 닫고 멈춤**. 켜지 않음.
  7. **안 함**(1~6이 모두 확인된 뒤에만 하라는 조건). 자막 포트폴리오 문장·v7은 대기.
- 바꾼 파일: services/presentation.json, services/document_writing.json, services/subtitle.json, server/pricing-table.js, server/relay-server.js, tests/school-assignment-revisions.cjs, tests/thanks-copy.cjs, tests/fixtures/service-regression-baseline.json, tests/customer-room-fallback.cjs, tests/chat-send-off.cjs, tests/paid-api-guard.cjs, docs/progress.md
- 백업: backups/quote-revert-20260923/, backups/soomgo-copy-baseline-20260923/, backups/progress.md.pre-dev7.bak
- run-all: 76/76 (PC)
- 외부 발송·유료 API 호출·설치: 없음. 숨고 채팅 탭을 열었다 닫음(메시지·버튼 조작 없음).
- 가격·문구·수정 횟수·납기 변경: 숨고 견적 문구를 16:16 이전으로 되돌림(준희 결정 B). 가격 숫자 없음.
- 멈춘 이유: 채팅봇 버전 확인 불가(패널 OFF·심박 없음). 준희가 채팅 탭의 봇을 켜거나 확장을 새로 불러와야 0.3.23 확인 가능 → 그 뒤 7번.

> 감독 복구(16:58): 아래 개발방 16:47·16:40 두 칸은 16:54 progress.md 덮어쓰기로 지워져 감독 사본(16:44)에서 글자 그대로 되살림.

## 2026-09-23 16:47 · 개발방(Cowork claude-04) · next-dev.md (지시 6, 다시 확인) — 여전히 멈춤
- 한 일: 지시 파일 그대로(지시 6). run-all 다시 1회 → **같은 실패(첫 실패 service-regression-baseline, 0/76)**. 원인 확인:
  - 15건 모두 **숨고 견적 문구(quoteText)만** 바뀜. 금액·납기·분류는 그대로.
  - 기준표(= decisions.md 7번): 첫 줄 "요청 주셔서 감사합니다. 요청서 확인했습니다." / "견적 32,000원 · 당일~1일 안에 납품 · 수정 2회 포함" / "결제는 숨고페이 안전결제라, 받아보시고…"
  - 지금 코드: 첫 줄 "안녕하세요. 문의 주신 ‘(요청 주제)’ 건으로 연락드립니다." + 작업 설명 한 줄 추가 + "작업 기간 당일~1일" + "결제는 숨고페이로 진행하고, 결과물을 확인하신 뒤…"
  - 16:17~16:18에 server/relay-server.js·server/pricing-table.js·services/presentation.json·subtitle.json·document_writing.json이 바뀐 결과로 보임. **decisions.md에 이 문구 변경 결정이 없음**(7번 첫 줄 규칙·"20건 쌓이기 전 문구 안 바꿈"과 부딪힘). 누가 바꿨는지 progress 기록 없음.
- **서버 재시작 안 함**: 재시작하면 이 문구가 숨고 자동 견적에 바로 쓰인다. 지금 돌고 있는 서버는 16:12(내 재시작) 코드라 옛 문구 [추정: 그 뒤 재시작 기록 없음].
- 기준표(fixture)를 새 문구로 다시 쓰지 않음(승인 안 된 문구를 기준으로 굳히게 됨).
- 바꾼 파일: docs/progress.md(이 칸)
- 백업: backups/progress.md.pre-dev6b.bak
- run-all: 0/76 (첫 실패 service-regression-baseline)
- 외부 발송·유료 API 호출·설치: 없음
- 멈춘 이유: 준희 결정 필요 — 새 숨고 문구를 승인할지(→ decisions.md 반영 + 기준표 갱신 + 재시작), 되돌릴지(→ 바꾼 방이 원복).

## 2026-09-23 16:40 · 개발방(Cowork claude-04) · next-dev.md (지시 6) — run-all 실패로 멈춤(원인은 이번 변경 아님)
- 한 일:
  1. services/subtitle.json `channels.fiverr`: 패키지 $27/$43/$77 → **$25/$45/$75**. burn_in 옵션은 지우지 않고 `offeredOnFiverr: false` + 사유 메모(파이버 Gig Extra 목록에 없음 → 맞춤 견적, 금액 $11은 참고로 남김). `_note` 새로 씀(9/23 변경·이유, 이전 값). 숨고·크몽 원화 가격 줄은 손대지 않음(파일 안 다른 부분 JSON 비교로 동일 확인).
  2. 값 쓰는 곳 맞춤: server/global-reply.js — 자막 입히기 요청이면 금액 대신 **맞춤 견적**(`custom_offer`, burnIn:true), 옵션이 없으면 모델 지시문에서 "선택: MP4 삽입" 문장과 질문 우선순위의 "MP4냐 SRT냐"를 뺌. dist/global-reply.html — 맞춤 견적 이유 표시에 "자막 입히기 → 맞춤 견적(파이버 옵션 없음)" 추가. server/service-registry.js — 채널 값이 `{enabled:true}` 객체여도 판매 목록에 넣음(지금까지는 true만 인정해서 파이버를 켜도 목록에 안 나왔음. 부르는 곳은 숨고·크몽뿐이라 영향 없음).
  3. `channels.fiverr.enabled = true`(pendingApproval false 유지, mode manual_draft_only 그대로 — 자동 발송 경로 새로 안 만듦).
  4. 테스트 기대값: tests/fiverr-channel.cjs(켬·25/45/75·5달러 단위·옵션 미제공·파이버 목록에 나옴), tests/global-reply.cjs(25/45/75, $45 문구, 삽입 요청 = 맞춤 견적, 옵션 다시 켜면 5분당 계산 그대로, 지시문에 삽입 옵션 문장 없음). 클라우드에서 두 시험 PASS.
- 바꾼 파일: services/subtitle.json, server/global-reply.js, server/service-registry.js, dist/global-reply.html, tests/fiverr-channel.cjs, tests/global-reply.cjs
- 백업: backups/fiverr-price-20260923/ (6개 원본), backups/progress.md.pre-dev6-done.bak
- run-all: **실패 1회 그대로 적음 — 첫 실패 `tests/service-regression-baseline.cjs`(회귀 15건), 결과 표시 0/76**(run-all은 첫 실패에서 멈춤)
  - 원인 확인: 같은 시험을 **바꾸기 전 subtitle.json으로 돌려도 똑같이 실패**(클라우드, PC 최신 relay-server·pricing-table·presentation·document_writing 사용). 실패 내용은 숨고 PPT 견적(분류·금액·견적 문구) 차이 — 16:18에 다른 방이 services/presentation.json·services/subtitle.json·server/pricing-table.js를 고친 뒤 기준표(tests/fixtures/service-regression-baseline.json)를 안 맞춘 것으로 보임 [추정]. progress에 그 변경 기록은 아직 없음.
- 서버 재시작: **안 함**(run-all 실패 시 멈춤 규칙). 그래서 "파이버 켜진 상태로 읽히는지"는 재시작 뒤 확인 필요(서버가 서비스 정의를 시작할 때 읽음).
- 외부 발송·유료 API 호출·설치: 없음
- 가격·문구·수정 횟수·납기 변경: 파이버 USD 가격만(준희 결정 decisions.md 2번). 숨고·크몽 원화 없음.
- 멈춘 이유 또는 남은 문제: 16:18 변경을 한 방이 회귀 기준표를 맞추면 run-all → 재시작 → `/api/global/reply-usage`의 fiverr.enabled 확인.

## 2026-09-23 16:35 · 해외 채널방(Cowork claude-06) · next-global.md (지시 3, 지시 2 기록 포함)
- 한 일:
  - 지시 3-1: 가격을 $25 / $45 / $75로(준희 9/23 등록가, 파이버는 5달러 단위만 받음). 자막 삽입 옵션 줄은 "등록 안 함 — 맞춤 견적"으로. 게시 전 확인 2곳도 새 가격으로
  - 지시 3-2: 체크리스트 2번 패키지 밑에 "파이버 가격은 5달러 단위" 한 줄 추가
  - 지시 2 기록(14:40 파일 완료분, 이 방이 14:4x에 progress에 적었지만 지금 파일에 없음 — 다른 방이 같은 때 progress.md를 덮어쓴 것으로 보임 [추정]): 초안 싱크 항목 [x], 체크리스트 0번 해제 + 맨 위 붙여 넣을 순서표(초안 문구 그대로), 초안 7번에 문구↔동작 대조표 추가
  - 지시 3-3, 지시 2 대조 요약(근거: 개발방 13:45 기록, 이 방은 검사를 직접 돌리지 않음):
    - 맞음: "from start to finish"(전 구간 대조), "check timing against the audio"(1단계 시각 맞춤), "full sync check"
    - 해석 조건: "fix drift where it starts" — 자동 보정 없음, 수정안만 나오고 사람이 고침
    - 어긋남 가능: "where it starts" — 3블록 이상 밀림만 잡음, 1~2블록은 못 잡고 시작점을 늦게 잡을 수 있음(33분 건 178~193초). 시작점은 사람이 확인해야 사실
    - 절차 조건: "Before delivery, the timing is checked…"/FAQ Q1 — 검사가 납품 흐름에 안 붙음. 주문마다 사람이 돌려야 사실
    - 미확인: 한국어 영상→한국어 자막에 같은 검사가 도는지
- 바꾼 줄:
  - fiverr-gig-draft.md: 4번째 줄(가격 안내 → $25/$45/$75, 옵션 등록 안 함), 패키지 표 가격 줄, Gig Extra 3줄 → "등록 안 함 — 맞춤 견적" 1줄
  - fiverr-listing-checklist.md: 순서표 패키지 표 3줄, ④ 옵션 4줄 → 1줄, 게시 전 확인 가격 줄 2곳, 2번 패키지 3줄 가격 + "파이버 가격은 5달러 단위" 추가, 2번 옵션 줄
- 백업: backups/fiverr-gig-draft.md.pre-order3.bak, backups/fiverr-listing-checklist.md.pre-order3.bak, backups/progress.md.pre-global-order3.bak
- run-all: 실행 안 함(코드 변경 없음)
- 외부 발송·유료 API 호출·설치: 0건
- 가격·문구·수정 횟수·납기 변경: 가격만 준희 결정값으로 옮김($25/$45/$75, 옵션 없음). 새로 정한 가격 없음. 수정 횟수·납기 그대로
- 멈춘 이유 또는 남은 문제:
  - 초안 설명 "Optional: subtitles burned into your video (MP4)"와 요구사항 5번(MP4 또는 SRT)은 그대로 둠. 옵션 없이 맞춤 견적이면 문구가 맞는지 준희 판단 필요(수정 범위 밖이라 안 고침)
  - subtitle.json의 fiverr 가격(27/43/77/11)은 개발방 몫
  - progress.md 동시 쓰기로 기록이 사라지는 일이 있었음 — 방마다 쓰기 직전에 다시 읽기 권장

## 2026-09-23 16:13 · 개발방(Cowork claude-04) · next-dev.md (지시 5) + 준희 직접 지시("번역 경로 먼저")
- 한 일:
  0. **번역 자막 Codex 대화방 경로(준희 직접 지시, 지시 5 전에).** 외국어 영상 흐름이 만든 번역 대기열(translationQueue)의 원어 SRT를 200블록씩 `subtitle_translation_draft` 사건으로 브리지에 올림 → 대화방이 `[MODE:SUBTITLE_TRANSLATION]` + `[SUBTITLES_JSON]` `[{"i","ko"}]`로 블록별 한국어만 돌려줌 → 조각이 다 오면 **원어 블록 시각 그대로** 한국어 SRT(`server/data/transcripts/translations/<jobId>/ko_vN.srt`, 저장소 밖) + 기계 검사(번역 자막 싱크 포함) → 대기열 상태 `ko_draft_ready`, "준희 확인 대기". 시각을 서버가 쥐므로 번역 때문에 밀릴 수 없음. 블록 수·번호가 하나라도 안 맞으면 완료 거절. Jev 내용 대조(유료)는 기존 관리자 경로로 따로. **꺼 둠**: 정책 `transcribe.translationProvider: "hold"`. 경로 `/api/admin/codex-translation/{request,assemble,status}`(헤더 `x-relay-admin: codex-translation`).
  1. 찌꺼기 2개(server/production-codex-room.js, tests/codex-room-production.cjs): 어디서도 안 부름 확인(run-all·서버 모두 0), backups/leftover-20260923/에 복사. **삭제는 못 함** — 이 세션에 PC 셸이 없어 파일 삭제 도구가 없음. 준희가 탐색기에서 두 파일 삭제 필요.
  2. **python-pptx·fontTools 설치 → 막힘**(PC 셸 없음, 클라우드에서 PyPI 403). 대신 **embed-fonts.py를 Node로 옮김**(server/pptx-embed-fonts.js, jszip 묶음 파일 추가). 파이썬판과 결과 바이트가 같음(fntdata sha256 일치, 시험에 기록값 대조). codex-production 흐름에 연결 → **Pretendard가 들어간 PPTX**가 나옴. 제작 기계 검사(pptx_open·장수·빈 슬라이드)도 붙임. check-deck.py는 python-pptx가 필요해 PC에서 못 돌림 — 같은 파일을 클라우드에서 돌린 결과: **fail 0**(파일명 형식 warn 1은 시험 파일명 때문). 미리보기 PDF는 안 함(승인 범위 밖).
     - 사건 지시문에 "플러그인을 적극 활용해서 만들 것" 넣음(서버가 사건 본문에 넣음).
  3. **아스트라 자동화 만들기 → 못 함.** ~/.codex/automations에 설정 파일을 쓰려 하자 이 세션의 안전 장치가 "지속 설정 생성"으로 막음. 우회하지 않음. 같은 형식의 내용은 채팅으로 준희에게 드림(Codex 앱에서 만들면 됨). 이름 "아스트라 · PPT 제작 건 처리", 10분, 대상 방 01a0b890-…(아스트라), production_draft만(번역 조각도 같이 읽게 적어 둠 — 번역은 꺼져 있어 지금은 없음).
  4. 방 이름 의존: 브리지는 방 **ID**(targetThreadId)로만 연결. 이름은 기본 표시값 한 줄뿐 → 고칠 것 없음.
  5. **켬**: `production.provider = "codex_room"`(백업 후, changedAt·reason 갱신). 다른 spendControls 그대로. 재시작 뒤 `/api/admin/codex-production/status` = provider hold·reason codex_room(API 제작 lane은 막힌 채).
  6. 시험 1건(POST-SOOMGO-26c8fb976391) → **안 함**: 서버에 원고 글이 없음(게시물 지시문 777자는 요청 요약뿐 — "내부 회의 자료, 10장", 워크플로·첨부 없음, 결제 기록 없음). 고객 발송 0.
  7. run-all → 재시작(publish).
- 바꾼 파일:
  - 새: server/codex-subtitle-translation.js, tests/codex-subtitle-translation.cjs, server/pptx-embed-fonts.js, tests/pptx-embed-fonts.cjs, node_modules/jszip/(index.js·package.json·LICENSE)
  - 고침: server/astra-room-bridge.js(번역 사건·모드, 사건↔모드 짝 검사 일반화), server/relay-server.js(번역 경로·조립 함수·complete 뒤 조립, PPT 만들기에 기계 검사 넘김), server/codex-production.js(글꼴 넣기·기계 검사·플러그인 문구), server/config/astra-relay-operating-policy.json(transcribe.translationProvider "hold" 추가, production.provider → codex_room), tests/run-all.cjs(2줄), tests/codex-production.cjs, tests/presentation-design-types.cjs(pptx-embed-fonts.js 허용), tests/production-provider-claude.cjs(codex_room 허용 — 이 값이면 API lane은 hold)
- 백업: backups/codex-translation-20260923/, backups/dev5-20260923/, backups/leftover-20260923/, backups/progress.md.pre-dev5-done.bak
- run-all: 번역 경로 뒤 75/75, 지시 5 뒤 **76/76** 통과 (PC)
- 재시작·심박: 16:12 publish 재시작(숨고 요청 0.4.21·숨고 채팅 0.3.23·크몽 0.1.3). 40초 뒤: 숨고 요청봇 0분 전, **크몽 healthy(새 문의 대기)**, **크몽 탭의 "검증된 답장 자동 전송" 꺼짐으로 바뀐 것 화면에서 확인**. 숨고 채팅봇은 39분째 신호 없음(stopped) — 채팅 탭이 안 살아남(숨고방 16:57 칸에 적힌 "탭 새로고침 필요"와 같은 건, 손대지 않음).
- 외부 발송·유료 API 호출·설치: 발송 0, 유료 호출 0. 설치 = jszip 묶음 파일 복사(글꼴 넣기용). python 설치 0.
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제:
  - **아스트라 자동화를 준희가 Codex 앱에서 만들어야 PPT 경로가 돈다**(지금은 켜져 있지만 가져갈 작업자가 없음).
  - 찌꺼기 2개 삭제는 준희 손으로.
  - check-deck(디자인 규칙 검사)는 PC에서 자동으로 못 돌림 — python-pptx 설치는 셸 있는 방에서.
  - 번역 경로는 꺼져 있음. 켜려면 `transcribe.translationProvider`를 codex_room으로 + 자동화가 번역 조각도 읽게.

## 2026-09-23 16:57 · 숨고 운영방(Cowork claude-ff) · next-soomgo.md (지시 4)
- 한 일:
  1. **Relay Desk 채팅봇 자동 발송 끔 (설정 + 최소 코드).** 정책에 `soomgoChat.sendEnabled=false`를 새로 넣었다(changedAt 9/23 16:05, reason "9/23 준희 결정(decisions.md 6번): 숨고 고객 채팅 답장은 아스트라만…"). 서버 `GET /api/soomgo/control`이 `chatSendEnabled`를 정책에서 읽어 함께 준다(paused는 그대로 → 감시 탭 재로드 watchdog은 계속 돈다). 채팅봇 0.3.22→**0.3.23**: `serverPaused`가 `chatSendEnabled:false`면 닫힌 것으로 본다. 이 관문을 지나야 하는 곳 = 글 보내기(sendChatText, 모든 자동 답장·P4 A·B·C·정해진 문구·납품 안내가 여기로)·파일 첨부·숨고페이 요청 누르기·거래 취소 누르기. 막히면 패널에 "발송 끔 · 기록만". 대화 읽기·서버 기록(/api/soomgo/reply)·심박은 그대로 — 서버 답장 판단·고객응대실 이벤트도 그대로 쌓인다(아스트라 쪽이 읽을 수 있게).
  2. **Claude 대체 끔**: `customerRoomFallback.claudeEnabled=false`, changedAt 9/23 16:05, reason "9/23 준희 A — 답장은 아스트라 전담…". 15:30의 좁은 예외 코드는 그대로(꺼져 있으면 통과 안 함).
  - 정책 파일은 고치기 직전 다시 읽었다(mtime 1790145106731 그대로, 다른 방 값 덮지 않음). 바꾼 키: soomgoChat(새), customerRoomFallback.claudeEnabled·changedAt·reason만.
- 바꾼 파일: server/config/astra-relay-operating-policy.json, server/relay-server.js(control GET 몇 줄), soomgo-chat-bot/chat-content.js(controlState·serverPaused·sendChatText 몇 줄), soomgo-chat-bot/manifest.json(0.3.23), tests/chat-send-off.cjs(새), tests/paid-api-guard.cjs(claudeEnabled 기대값 false), tests/ppt-design-sample.cjs(채팅봇 버전 고정값 0.3.21→0.3.23 — 개발방이 0.3.22로 올린 뒤 이 값이 안 바뀌어 있었음), tests/run-all.cjs(한 줄), docs/progress.md(이 칸)
- 백업: backups/chat-send-off-20260923/ (위 7개 원본), backups/progress.md.pre-soomgo-order4-20260923.bak
- 새 테스트: tests/chat-send-off.cjs — 정책 두 값, 서버 control이 chatSendEnabled를 정책에서 읽음, 채팅봇 관문(끔→닫힘/켬→열림/옛 서버 값 없음→예전대로/전체 정지→닫힘), 글·첨부·결제 누르기 전 관문, 감시 탭 재로드는 paused만 봄, 실제 정책으로 Claude 대체 tick → Claude 호출 0회(키가 있어도, 사유 claude_disabled).
- run-all: 전체 74개 중 74개 통과, 실패 없음 (PC, 134초, 15:52~15:54)
- 재시작·심박: 15:54:31 재시작(publish:true, 배포 버전 숨고 요청 0.4.21·숨고 채팅 0.3.23·크몽 0.1.3). 재시작 뒤 `/api/soomgo/control` = `{ paused:false, chatSendEnabled:false }`. 요청봇 0.4.21 심박 정상(15:55:11). **채팅봇은 15:34:22부터 심박 없음**(마지막 보고 버전 0.3.21, 상태 "방 체류 제한 복귀 · 체류 60초 초과(잠금 없는 대기 탭)") — 0.3.23이 실제로 올라왔는지는 채팅 탭이 살아나야 확인된다.
- 외부 발송·유료 API 호출·설치: 없음. 숨고 발송 0건.
- 가격·문구·수정 횟수·납기 변경: 없음.
- 멈춘 이유 또는 남은 문제:
  - 지시 4 완료. 여기서 멈춘다.
  - **채팅봇 탭 새로고침 필요.** 살아난 뒤 심박 버전이 0.3.23인지, 패널이 "발송 끔 · 기록만"인지 확인해야 한다. 0.3.22 이하가 살아나면 발송 끔을 모른다.
  - **확인 필요(값 충돌 가능)**: 고객응대실 합치기(customerRoomFallback.enabled=true)는 Claude를 꺼도 60초 뒤 이벤트를 가져가 정해진 문구로 SEND/ESCALATE 완료 처리한다. 채팅봇이 발송을 막으니 고객에게 나가지는 않지만, 아스트라가 같은 고객응대실 이벤트를 받아 쓰는 방식이라면 60초 뒤 이벤트가 먼저 '완료'로 닫힐 수 있다. 아스트라가 이벤트를 어디서 읽는지 이 방은 모른다 → enabled도 끌지 감독방·준희 결정.

## 2026-09-23 15:48 · 개발방(예약) · next-dev.md (지시 5) — 실행 못 함
- 한 일: decisions.md·next-dev.md(지시 5)·progress.md 읽음. 지시 5는 아직 실행 기록 없음 확인. **이 예약 세션에는 PC 셸(device_bash)이 없어** 파일 읽기/쓰기만 가능하고 명령 실행·삭제·설치·서버 호출을 할 수 없음 → 1단계(찌꺼기 2개 삭제)부터 막혀 순서대로 진행 불가. 순서를 건너뛰어 5단계(provider=codex_room)만 켜면 가져갈 자동화 없이 켜지므로 하지 않음. "진행 중" 줄도 쓰지 않음(실행 안 하므로 다른 개발방이 지시 5를 가져가도 됨).
- 바꾼 파일: docs/progress.md(이 칸)
- 백업: backups/progress.md.pre-dev-20260923-1547.bak
- run-all: 실행 안 함(코드 변경 없음, 셸 없음)
- 외부 발송·유료 API 호출·설치: 없음. 삭제 0, 설치 0, 자동화 생성 0, 정책 변경 0, 재시작 0.
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제: 지시 5 전체 미실행. PC 셸이 붙은 개발방(Cowork claude-04 등, 준희가 연 세션)에서 실행해야 함. 예약 개발방이 계속 셸 없이 뜨면 같은 결과가 반복됨 [추정] — 예약 세션에 PC 셸 연결 여부 확인 필요.

## 2026-09-23 15:50 · 숨고 운영방(Cowork claude-ff) · (지시 파일 없음 — 준희: 채팅봇·고객응대는 Astra 전담으로 넘김)
- 한 일: 코드 변경 없음. 채팅봇·고객응대가 Astra 전담이 되어, 이 방이 찾은 문제를 넘겨 적고 손을 뗀다. 이 방은 채팅봇 코드를 더 고치지 않는다.
- 넘기는 것(라이언 고객 …919723, 9/23 15:17 부고 사정 글 → 답 없이 고객 이탈):
  1. **공감 먼저 원칙이 없다.** 부고·장례·입원·수술·사고·아픔 같은 개인 사정 글에도 작업 규칙이 먼저 걸린다. 준희 기준: 첫 문장은 위로, 다음은 "어떤 도움이 필요하신지", 금액·조건은 그다음.
  2. **'연락' 한 단어로 연락처 요청 판정**: relay-server.js의 auto_contact 규칙 `/전화|연락|통화|카톡|카카오|문자/`가 "연락드렸습니다"에도 걸린다.
  3. **긴 고객 글이 '전체보기'에서 잘린 채로 읽힌다**(채팅봇이 펼치지 않음).
  4. 이 방이 제안했지만 적용 안 한 첫 답 초안(준희 미승인): "삼가 고인의 명복을 빕니다. 경황이 없으실 텐데 연락 주셔서 감사합니다. 어떤 부분을 도와드리면 될지 편하게 말씀해 주세요. 일정은 사정에 맞춰 최대한 맞춰 보겠습니다."
- 지금 켜져 있는 것(오늘 이 방이 바꿈, 준희 결정): 고객응대실이 60초 안에 안 받으면 Claude(Opus 5.5)가 대신 답(customerRoomFallback.claudeEnabled=true, model claude-opus-5-5, 하루 30건·3,000원). Astra 전담이 60초 안에 받으면 호출되지 않는다. P4 후속 답장 A·B·C(followup_*) 연결됨.
- 바꾼 파일: docs/progress.md(이 칸)
- 백업: backups/progress.md.pre-soomgo-handoff-20260923.bak
- run-all: 실행 안 함(코드 변경 없음)
- 외부 발송·유료 API 호출·설치: 없음
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제: 고객응대는 Astra 전담. 이 방은 견적·요청 쪽 지시가 오면 이어서 한다. 채팅봇은 15:34 뒤 심박이 끊겨 있었다(탭 새로고침 필요).

## 2026-09-23 15:41 · 개발방(Cowork claude-04) · 준희 허가("허가") — Codex 자동화 확인
- 한 일: `~/.codex/automations` 읽기만(준희 허가로 폴더 연결). 인증·비밀값 파일은 열지 않음(.run-jitter-salt 안 읽음).
  - 자동화 2개뿐: ① "숨고 고객 응대 · 메인 채널"(ACTIVE, 2분마다, 9/23 15:31 생성, 숨고 메인 채널 대화방) — 크롬 숨고 채팅에 직접 답장하는 작업. 브리지(astra-room)는 보지 않음. ② "Relay Desk 운영·거래·비용 점검"(PAUSED).
  - **Astra 운영·고객대응실(브리지 연결 방)을 도는 자동화는 지금 없음.** 브리지 기록상 예전 `heartbeat-swan-astra`·`automation:swan-astra` 작업자가 6건 처리했지만 그 자동화는 폴더에 없음. 최근 고객 사건은 서버의 claude-fallback이 처리(customer_message만 봄 → production_draft는 안 건드림).
  - 결론: 지금 production_draft를 올려도 **아무도 가져가지 않는다.** Codex 대화방용 자동화를 하나 새로 만들어야 함(준희 승인 필요, 만들지 않음).
- 바꾼 파일: docs/progress.md(이 칸)
- 백업: backups/progress.md.pre-dev6.bak
- run-all: 실행 안 함(코드 변경 없음)
- 외부 발송·유료 API 호출·설치: 없음. 자동화 설정 변경 없음.
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제: PPT 초안 자동화 생성 여부 준희 결정 대기(안은 채팅에 제시).

## 2026-09-23 15:39 · 숨고 운영방(Cowork claude-ff) · (지시 파일 없음 — 준희 직접 지시: 고객응대 Claude 모델을 Fable 대신 Opus 5.5로)
- 한 일: 고객응대실 합치기의 Claude 모델을 정책에서 정하게 하고 Opus 5.5로 바꿈. customer-room-fallback.js가 정책 `customerRoomFallback.model`을 읽어 runClaude에 넘긴다(없으면 서버 기본 모델). 정책: model "claude-opus-5-5", 단가 입력 $4·출력 $20 /100만 토큰(platform.claude.com 모델 표에서 9/23 확인, 전 값은 Fable 5.1 $10·$50), 출력 한도 400→1200(Opus 5.5는 생각 단계가 항상 켜져 있어 답이 잘리지 않게). 하루 30건·3,000원 한도 그대로.
- 바꾼 파일: server/customer-room-fallback.js(readConfig에 model, runClaude 호출에 model), server/config/astra-relay-operating-policy.json(customerRoomFallback.model·단가·maxOutputTokens·changedAt·reason), tests/customer-room-fallback.cjs(모델 값·전달 검사 3줄), docs/progress.md(이 칸)
- 백업: backups/claude-fallback-opus-20260923/ (customer-room-fallback.js, astra-relay-operating-policy.json, customer-room-fallback.cjs), backups/progress.md.pre-soomgo-opus-20260923.bak
- run-all: 전체 73개 중 73개 통과 (PC, 135초, 15:32~15:34)
- 재시작·심박: 15:35:50 재시작. 요청봇 0.4.21 심박 정상("다른 숨고 탭에서 요청봇 실행 중 · 이 탭은 대기"). **채팅봇 0.3.21은 15:34:22부터 심박 없음**(상태 "방 체류 제한 복귀 · 체류 60초 초과(잠금 없는 대기 탭)", 마지막 위치 라이언 고객 방) — 재시작 전부터 멈춤. 이 방에서 여는 Chrome 탭에는 봇이 붙지 않아 살리지 못함.
- 외부 발송·유료 API 호출·설치: 없음(아직 Claude 호출 0건).
- 가격·문구·수정 횟수·납기 변경: 없음.
- 멈춘 이유 또는 남은 문제: 채팅봇 탭 새로고침 필요(PC Chrome의 숨고 채팅 탭). 1건 비용 약 40~60원 [추정].

## 2026-09-23 15:30 · 숨고 운영방(Cowork claude-ff) · (지시 파일 없음 — 준희 직접 지시: 채팅봇이 못 정한 답을 Claude가 대신)
- 한 일:
  - 발단: 라이언 고객(…919723, 텀블러 기획안 A4 6쪽 57,000원 견적 발송 뒤) 15:17·15:18 메시지 2개에 답이 안 나감. ① "…연락드렸습니다" 속 '연락'이 연락처 요청 규칙(auto_contact: /전화|연락|통화|카톡|카카오|문자/)에 걸려 "상담은 숨고 채팅으로…" 초안 ② 긴 글이 '전체보기'에서 잘림 ③ 두 번째는 auto_process 초안 → 둘 다 고객응대실로 갔고, 받는 곳이 없어 1분 뒤 fallback이 ESCALATE(정해진 문구 자동 발송 대상 아님). 고객은 채팅방을 나감.
  - 준희 결정(15:2x): 고객응대실 합치기의 Claude 단계 다시 켬. 정책 customerRoomFallback.claudeEnabled false → true.
  - 공용 자동 유료 차단(spendControls.automaticPaidQuotesPaused=true)은 그대로 둔다. 이 차단이 fallback의 Claude 호출까지 막고 있어서, assertPaidCallAllowed에 좁은 예외 하나를 넣었다: trigger 'customer_room_fallback' + provider Claude + 정책 enabled·claudeEnabled 둘 다 true일 때만 통과. fallback deps의 runClaude가 이 표시를 붙인다(서버에서 한 곳). 하루 30건·3,000원 한도와 숫자 일치 검사는 기존 customer-room-fallback.js 그대로.
- 바꾼 파일: server/relay-server.js(assertPaidCallAllowed 예외 몇 줄·fallback deps 한 줄), server/config/astra-relay-operating-policy.json(customerRoomFallback.claudeEnabled·changedAt·reason), tests/paid-api-guard.cjs(기본값 기대치 claudeEnabled true로, 예외가 한 곳뿐인지 정적 검사 추가), docs/progress.md(이 칸)
- 백업: backups/claude-fallback-on-20260923/ (relay-server.js, astra-relay-operating-policy.json, paid-api-guard.cjs), backups/progress.md.pre-soomgo-claude-fallback-20260923.bak
- run-all: 전체 73개 중 73개 통과, 실패 없음 (PC, 135초, 15:26~15:28)
- 재시작·심박: 15:28:33 재시작(publish:false). 뒤 요청봇 0.4.21 "감시 중"(15:28:59), 채팅봇 0.3.21 "감시 중"(15:29:00). /api/attention customerRoomFallback 오늘 호출 0건·0원.
- 외부 발송·유료 API 호출·설치: 이 작업 중 없음. 앞으로 Claude 자동 호출이 생긴다(1건 약 100원 [추정], 하루 최대 30건·3,000원). 숨고 발송 0건.
- 가격·문구·수정 횟수·납기 변경: 없음(정해진 문구·견적 그대로). 단 Claude가 쓴 답장이 고객에게 나갈 수 있다(금액·기간 숫자는 서버 초안과 같아야 통과).
- 멈춘 이유 또는 남은 문제:
  - decisions.md의 9/22 "Claude 단계 끔" 내용과 달라졌다. decisions.md는 준희만 고치므로 손대지 않았다.
  - Claude 키가 서버에 설정돼 있는지는 키를 읽지 않는 원칙상 확인하지 않았다. 첫 호출 때 customerRoomFallbackLog에 결과가 남는다(키 없으면 claude_key_missing → 정해진 문구/사람 확인).
  - 남은 문제(고치지 않음): '연락' 한 단어로 연락처 요청 판정, 긴 고객 글 '전체보기' 잘림, 고객응대실(Astra 방) 쪽에서 받는 곳이 없음.

## 2026-09-23 15:03 · 개발방(예약) · next-dev.md (지시 4)
- 한 일:
  1. **숨고 봇 켜기.** 시작 시점(14:46) `/api/health`: 채팅봇 0.3.21 이미 "감시 중"(심박 14:46:08, 계정 swan) — 이 방이 켠 것 아님, 누가 켰는지 모름. 요청봇 0.4.21은 "정지"(심박 14:46:05). 준희 크롬(Claude in Chrome)에 숨고 받은 요청 탭을 새로 열어 요청봇 패널 OFF→ON 클릭 → 패널 "감시 중" 확인(14:47경). 로그인 화면 없었음. ON 값은 chrome.storage에 저장되고 기존 요청 탭도 같은 값을 따라감(content-v3.js onChanged). 새로 연 탭은 닫음. 견적·채팅 직접 발송 0.
     - 확인(15:02:43): `/api/attention` bots.request·chat 모두 lastSeenMinutesAgo 0, stopped false. bot-version 요청 0.4.21·채팅 0.3.21. 요청봇의 상태 글자("감시 중")는 15:02 서버 기록으로는 확인 못 함(아래 남은 문제) — 패널 화면으로만 확인.
  2. **크몽 "검증된 답장 자동 전송" 끄기 — 절반만 됨.** 크몽 받은편지함 탭을 새로 열어 SWAN 창의 체크를 해제 → 새 탭 창 상태: ON · 새 문의 대기 · 자동 전송 체크 해제. 저장값(relayKmongBotSettingsV1.autoSend)은 false가 됨.
     - **그러나 기존 크몽 탭(14:12에 연 것)은 설정을 시작할 때 한 번만 읽고 바뀐 값을 따라가지 않는다**(kmong content.js에 onChanged 없음). 그래서 기존 탭은 새로고침 전까지 **메모리상 자동 전송 켜짐 그대로** [추정 아님: 코드 확인]. 기존 탭은 이 방이 닿을 수 없는 탭이라 새로고침 못 함. 서버 재시작(publish, 확장 자동 새로고침)으로 풀려 했으나 이 세션의 권한 판정에서 거절됨. 새로 연 탭은 닫음. 봇 ON·탭은 그대로.
  3. **Codex 대화방 제작 경로 — 이 방은 반영 안 함(중복).** 코드 작성 중 14:49~14:53에 개발방(Cowork claude-04)이 준희 직접 결정으로 같은 일을 먼저 PC에 반영함(14:53 칸: codex-production.js, 브리지 production_draft, codex_room, run-all 72/72). 이 방의 relay-server.js·astra-room-bridge.js·operating-policy.js·run-all.cjs 덮어쓰기는 수정 시각 검사로 거절됐고, 덮어쓰지 않았다.
     - **남은 찌꺼기 파일 2개(이 방이 만든 것, 어디서도 안 부름):** `server/production-codex-room.js`, `tests/codex-room-production.cjs`. run-all 목록에 없음. 삭제 금지라 그대로 둠 → 준희가 지워도 됨.
     - 지시의 "재요청 상한(예: 3회)"은 claude-04 쪽에 "같은 원고는 사건 1번만"으로 들어감. 다른 원고로 다시 요청하는 횟수 상한은 [확인 필요].
  4. **usageCostEstimate Claude 단가 교정.** 코드 기본값 `|| 2` / `|| 10` 삭제. `claudeUsageRates()`가 정책 `claudeQuote.usdPerMillionInputTokens/OutputTokens`(지금 10/50)를 읽음. 정책을 못 읽으면 환경변수, 그것도 없으면 비용 null(숫자 박지 않음). 환경변수보다 정책이 먼저. `usageCostEstimate`를 module.exports에 추가(시험용).
     - 새 테스트 `tests/claude-usage-rate.cjs`: 4,000/4,000토큰 = $0.24(정책 값으로 계산한 값과 일치), 코드에 `RELAY_CLAUDE_INPUT_USD_PER_MILLION || 숫자` 없음, 외부 호출 0.
     - **서버 재시작 안 함 → 돌고 있는 서버에는 아직 반영 안 됨.** 다음 재시작 때 반영.
  5. run-all 1회(PC `/api/admin/run-tests`): **73개 중 73개 통과**, 135초, node v24.21.0 / win32, 15:00:01~15:02:17. (그 전 14:57 한 번 호출했으나 브라우저 쪽 45초 시간 초과로 결과를 못 받음 — 서버에서 한 번 더 돌았을 수 있음 [추정])
- 바꾼 파일: server/relay-server.js (단가 함수·exports 1곳, 17줄), tests/run-all.cjs (1줄), tests/claude-usage-rate.cjs (새), server/production-codex-room.js·tests/codex-room-production.cjs (새, 안 씀), docs/progress.md (이 칸)
- 백업: backups/claude-rate-20260923/ (relay-server.js·run-all.cjs, claude-04 반영 뒤 원본), backups/codex-room-20260923/ (claude-04 반영 전 원본 4개 — 쓰이지 않음), backups/progress.md.pre-dev-20260923-1500.bak, backups/progress.md.pre-dev-20260923-1505.bak
- run-all: 전체 73개 중 73개 통과 / 실패 없음
- 외부 발송·유료 API 호출·설치: 없음. 숨고 견적·채팅 0, 크몽 메시지 0, 유료 API 0, 설치 0. 크롬 조작: 숨고 요청봇 ON 클릭 1회, 크몽 자동 전송 체크 해제 1회(새 탭에서).
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제:
  - **크몽 기존 탭은 아직 자동 전송이 켜진 채로 돈다.** 준희가 그 크몽 받은편지함 탭을 한 번 새로고침(F5)하면 꺼진다(저장값은 이미 false). 또는 다음 서버 재시작을 publish로 하면 확장이 탭을 새로고침한다.
  - 서버 재시작과 `/api/health` 읽기가 이 예약 세션에서는 권한 판정으로 막혔다 → 단가 교정은 다음 재시작 때 반영, 요청봇 상태 글자는 준희 화면 또는 다음 방에서 `/api/health`로 확인.
  - 같은 지시를 두 방이 동시에 한 것: next-dev.md 지시 4를 claude-04가 이미 하고 있었는데 progress에 시작 표시가 없어서 겹침. 시작할 때 progress에 "진행 중" 한 줄을 먼저 쓰는 규칙이 있으면 막을 수 있음.

## 2026-09-23 14:53 · 개발방(Cowork claude-04) · 준희 직접 결정("코덱스 대화방", "1단계 + 설치까지")
- 한 일: PPT 제작을 Codex 대화방(ChatGPT 구독) 경로로 만드는 1단계 + PPTX 만들기용 pptxgenjs 설치. **켜지 않음**(production.provider는 hold 그대로).
  - 흐름: 관리자 경로에 결제 확인된 PPT 제작 게시물 + 원고 글 → astra-room 브리지에 `production_draft` 사건 → Codex 대화방이 `[MODE:PRODUCTION_DRAFT]` + `[SLIDES_JSON]`로 슬라이드 내용만 돌려줌 → 서버가 T1 보고형 템플릿으로 PPTX를 `server/data/productions/<postId>/제목_YYYYMMDD_vN.pptx`에 만듦 → "준희 확인 대기". 고객에게는 아무것도 안 보냄(finalGrade manual 그대로).
  - 켜는 법: 정책 `production.provider`를 `codex_room`으로. 이 값이면 API 제작 lane은 hold와 똑같이 막힘(대기 알림 사유 `codex_room`). 켜기 전에는 요청 경로가 `provider_not_codex_room`(409)으로 거절.
  - 막는 것: PPT가 아닌 게시물, 최종 채점 게시물, 원고 200자 미만·6만 자 초과, T2 유형(제안서·강의·소상공인·학교 — 템플릿 없음). 같은 원고는 사건 1번만. 대화방 답 모드가 사건과 안 맞거나 JSON이 깨지면 완료 처리 안 됨. 고객 사건에는 PRODUCTION_DRAFT 모드를 못 씀. 제작 사건은 발송함(outbox)에 안 올라감.
  - 새 경로(로컬 전용, 헤더 `x-relay-admin: codex-production`): `POST /api/admin/codex-production/request {postId, manuscript, typeId?}`, `POST .../render {eventId}`(다시 만들기), `GET .../status`. `/api/astra-room/complete`는 production_draft가 완료되면 바로 PPTX를 만들어 응답에 `production`으로 붙임. `/api/attention`에 `codexProduction`(확인 대기 수) 추가.
  - pptxgenjs 설치: npm 설치가 막혀 있어 클라우드에서 pptxgenjs 4.0.1 + 의존 모듈을 한 파일로 묶어 `node_modules/pptxgenjs/`에 넣음(`BUNDLED.txt`에 모듈·버전·라이선스 — 전부 MIT/ISC, jszip은 MIT 선택). PC(node v24)에서 실제 PPTX 생성 확인(run-all 안 codex-production 시험).
  - 확인한 결과물: 가상 샘플(기업 보고형)로 12장 PPTX, 작성자 Swan, check-deck.py 결과 fail 2개 모두 "글꼴 미포함"뿐(그 외 규칙 통과).
- 바꾼 파일:
  - server/codex-production.js (새 파일)
  - server/astra-room-bridge.js (사건 종류 production_draft, 모드 PRODUCTION_DRAFT, 모드 불일치 거절)
  - server/operating-policy.js (PRODUCTION_PROVIDERS에 codex_room — hold로 동작)
  - server/relay-server.js (require 1줄, 저장 폴더 상수, 관리자 경로, complete 뒤 PPTX 만들기, attention 키 1개)
  - server/config/swan-astra-operations-room-prompt.md (출력 계약에 E. PRODUCTION_DRAFT 추가 — 새 방용)
  - tests/codex-production.cjs (새 파일), tests/run-all.cjs (1줄), tests/production-hold.cjs (codex_room도 API 0회·hold 확인), tests/presentation-design-types.cjs ("서버는 presentationDesign 1곳만" → 2곳, codex-production.js 허용 — 오늘 결정 반영)
  - .gitignore (`server/data/productions/`)
  - node_modules/pptxgenjs/ (index.js·package.json·LICENSE·BUNDLED.txt)
- 백업: backups/codex-production-20260923/ (바꾼 8개 원본), backups/progress.md.pre-dev5.bak
- run-all: 전체 72개 중 72개 통과 (PC, node v24.21.0, 135초)
- 서버 재시작: 서버만(publish:false) 1회. 재시작 뒤 status 경로 응답·헤더 없으면 403·켜기 전 요청 409 확인. 멈춰 있는 PPT(POST-SOOMGO-26c8fb976391) 건드리지 않음.
- 외부 발송·유료 API 호출·설치: 발송·유료 호출 0. 설치 = pptxgenjs 묶음 파일 복사(준희 승인 "1단계 + 설치까지").
- 가격·문구·수정 횟수·납기 변경: 없음 (services/*.json 안 건드림)
- 멈춘 이유 또는 남은 문제:
  - **지금 대화방은 새 모드를 모름.** 시작 프롬프트 파일은 새 방을 열 때 보내는 글이라, 이미 열린 "Swan Astra 운영·고객대응실"에는 반영 안 됨. 사건 안에 규칙·예시를 같이 넣었지만, 대화방 첫 줄 규칙(네 모드만)과 부딪힐 수 있음 → 켜기 전 준희가 그 방에 E 절을 한 번 붙여 넣어야 함.
  - **대화방이 새 사건 종류를 가져가는지 모름.** 사건을 가져가는 Codex 자동화 설정(~/.codex/automations)은 이 세션에 연결 안 된 폴더라 확인 못 함. 고객 메시지만 골라 가게 돼 있으면 production_draft는 안 가져감 [확인 필요].
  - 글꼴 넣기·검사(embed-fonts.py·check-deck.py)는 PC Python에 python-pptx·fontTools가 없어서 연결 안 함 → 지금 PPTX는 Pretendard가 포함 안 됨(받는 쪽에 글꼴 없으면 대체 글꼴). 미리보기 PDF도 PC에 변환 프로그램이 없어 안 만듦 → 준희가 PowerPoint로 열어 확인.
  - 원고는 글로 넘겨야 함(고객 파일에서 글을 뽑는 건 연결 안 함). PPT 결제 확인 여부도 이 경로가 스스로 보지 않음 → 요청하는 사람이 확인.
  - node_modules/는 .gitignore에 없음(git에서 추적 안 된 폴더로 보임). 새 PC에서는 이 폴더를 복사하거나 npm install pptxgenjs 필요.

## 2026-09-23 14:29 · 숨고 운영방(Cowork claude-ff) · next-soomgo.md (지시 2 추가 4 — P4 A·B·C 연결)
- 한 일:
  - 지시 2의 1~3은 14:15 칸에 적었다. 이번 칸은 14:30 추가분 4번(P4 답장 A·B·C 연결)이다.
  - 연결 전 준희에게 두 가지를 물어 정했다: ① 초안의 `{deliveryDate}까지` → 서버에 날짜가 없어 **'고용 확정 후 {견적 소요일} 안에'**로 씀(이미 보낸 견적과 같은 말) ② 초안의 '수정 1회'는 이 방의 잘못된 숫자 → **견적의 수정 횟수(includedRevisionsFor)** 그대로.
  - server/relay-server.js에 `soomgoFollowupReply` 추가:
    - A `followup_price_confirm` (messageId soomgo.followup.price_confirm, v1): 고객 글에 금액이 있고 묻는 말이며 그 금액이 보낸 견적과 같을 때. '장당·쪽당·분당…' 단위 금액 질문 → `manual_unit_price_question`(사람 확인), 다른 금액 → `manual_price_mismatch`(사람 확인).
    - B `followup_customer_waiting` (soomgo.followup.customer_waiting, v1): 기존 '준비 늦어짐' 가드(guard_customer_waiting)가 잡은 말을 견적 보낸 대화에서만 B로 바꾼다. '견적 금액 유지' 문장은 뺐다. '나중에 연락드릴게요'류는 기존 감사 답장 그대로. 자료 이름: 문서 '초안'·자막 '영상'·PPT '원고'·그 외 '자료'.
    - C `followup_quote_recap` (soomgo.followup.quote_recap, v1): 견적·얼마·비용·언제까지·며칠·납기를 묻는 60자 이하 질문. 부분·추가·파일·첨부·범위·분량·쪽·장 같은 새 범위 말이 있으면 쓰지 않고 기존 흐름. `{oneQuestion}`은 새 문장을 만들지 않으려고 초안의 마지막 줄 '이대로 진행을 원하시면 고용 요청을 눌러 주세요.'로 고정.
    - 공통 조건: 견적 발송 확인(lead.quoteEvidence.status='sent'), 견적 금액 있음, 고용 확정 아님, 결제·환불·취소·분쟁·쿠폰·계좌·입금·할인 말 없음, 같은 종류는 대화당 1회(두 번째는 `manual_followup_repeat` 사람 확인). 이를 위해 contextualizeSoomgoReplyBody에 `quoteSent`·`priorTemplateKeys`(이 대화에서 자동 발송한 답장 종류)를 싣는다.
    - 세 문구는 AI 다듬기 제외 목록(shouldUseSoomgoAiReply)에 넣어 채택 문구 그대로 나간다.
  - 연결 전 같은 말의 기존 답: '51,000원 맞나요?'·'견적이 어떻게 되나요?' → auto_price(고객응대실 대기), '언제까지 가능하신가요?' → duration_needs_source_check(문서 견적인데 '음질' 이야기), '아직 초안이 안나와서' → '네, 준비되시면 편하게 보내주세요.'
  - docs/soomgo/p4-reply-drafts.md 맨 위 상태 줄 아래에 '연결 완료·연결하며 바뀐 점' 한 줄 추가(초안 본문은 그대로).
- 바꾼 파일: server/relay-server.js, tests/p4-followup-replies.cjs(새), tests/run-all.cjs(한 줄), docs/soomgo/p4-reply-drafts.md(상태 한 줄), docs/progress.md(이 칸)
- 백업: backups/p4-followup-20260923/ (relay-server.js, run-all.cjs), backups/progress.md.pre-soomgo-order2-p4-20260923.bak
- 새 테스트: tests/p4-followup-replies.cjs — 유형별(A 1·B 3·C 3) 문구 전문 일치, 새 숫자 없음, 제외 조건 각각(단위 금액·다른 금액·결제·환불·취소·새 범위·분량 추가·발송 미확인 A/B·견적 없음·고용 확정 C/B·나중 연락), 1회 제한 3종, state에서 발송 확인·보낸 답장 종류 싣기.
- run-all: 전체 71개 중 71개 통과, 실패 없음 (PC /api/admin/run-tests, 129초, node v24.21.0 / win32, 14:24~14:26)
- 재시작·심박: 서버 재시작 14:27:07(publish:false). 재시작 뒤 요청봇 0.4.21 심박 14:27:59(상태 "정지"). 채팅봇 0.3.21은 14:02:02 뒤로 심박 없음(상태 "일시 정지") — 14:15 칸과 같다. 두 봇 모두 이 방이 켜거나 끄지 않았다.
- 외부 발송·유료 API 호출·설치: 없음. 숨고 발송 0건, 요청 삭제 0건, 유료 API 0건.
- 가격·문구·수정 횟수·납기 변경: 고객 문구 **추가 3개(준희 채택 P4 A·B·C, v1)**. 기존 견적 문구·금액·수정 횟수·납기 값은 바꾸지 않았다. 새 문구 안의 금액·소요일·수정 횟수는 보낸 견적 값 그대로.
- 멈춘 이유 또는 남은 문제:
  - 지시 2(추가 4 포함) 완료. 여기서 멈춘다.
  - **채팅봇이 꺼져 있어 A·B·C가 실제로 나가려면 채팅봇을 켜야 한다.** 요청봇도 "정지". 켤지는 준희가 정한다.
  - C에서 '빈칸 질문 하나'(분량·마감·형식 중 없는 것)는 새 문장이 필요해 넣지 않았다. 필요하면 문구를 정해 주면 붙인다.
  - 효과 확인: messageId별 답장률을 20건 쌓일 때까지 본다(깔때기 byQuoteVersion과 별도).

## 2026-09-23 14:20 · 크몽방 · next-kmong.md (지시 2 갱신분)
- 한 일: 감독이 14:31에 지시 2에 추가한 첫 줄 변경(준희 결정 B)을 반영. 크몽 첫 줄을 "문의 주셔서 감사합니다. 보내주신 내용 확인했습니다."로 바꿈. reply-template-v4-draft.md 2곳, template-reply-draft.md 4곳. 숨고 문구(services/*.json의 quoteText)는 건드리지 않음.
- 지시 2의 나머지 항목(싱크·무료 샘플 문장 복원, 첨부 한도 기재, 심사 상태 확인, 템플릿 답변 틀 초안)은 14:17 칸에 기록됨.
- 바꾼 파일: docs/kmong/reply-template-v4-draft.md, docs/kmong/template-reply-draft.md, docs/progress.md(이 칸)
- 백업: backups/progress.md.pre-kmong-1420.bak
- run-all: 실행 안 함(문서만 변경)
- 외부 발송·유료 API 호출·설치: 없음. 크몽 로그인·등록·수정·메시지 0건
- 가격·문구·수정 횟수·납기 변경: 크몽 초안 문구의 첫 줄만 변경(준희 결정). 가격·납기·수정 횟수 변경 없음
- 멈춘 이유 또는 남은 문제:
  - 9/22 비승인 건 확인은 크몽 로그인 필요 → 여전히 멈춤. 준희가 "내 서비스"에서 상품명·사유를 알려주면 이어서 정리한다.
  - 무료 샘플 문장 원문 승인 대기.
  - 결제 후 대용량 파일 안내를 우리가 먼저 해도 되는지 미결.
  - 템플릿 상품 [확인 필요] 값(파일 형식·호환 범위, 저작권/상업적 이용/폰트 문구, 환불 기준) 대기.

## 2026-09-23 14:19 · 개발방(예약) · next-dev.md — 새 지시 없음 (지시 3·추가 4·5는 14:17 개발방 claude-04가 이미 실행·기록. 중복 실행 안 함)

## 2026-09-23 14:17 · 개발방(Cowork claude-04) · next-dev.md (지시 3 + 14:30 추가 4·5)
- 한 일:
  1. **두 단계 싱크 검사 사전 비용 추정 교체.** 글자 수÷3 대신 정책 파일 `jevSimulation.translatedSyncTokensPerCall`(367, 33분 건 실측 428,075÷1,165) × 호출 수. 코드에는 숫자 없음(테스트가 확인). 값이 없거나 잘못되면 예전 방식으로 돌아가고 응답 `estimateMethod`에 어느 방식인지 적힘. 응답이 없는 호출·오류 호출의 토큰 합산도 같은 값으로.
     - 테스트(가짜 호출): 389블록 → 1,165호출, 추정 427,555토큰 = **26.94원**(25~30원 안). 가짜 실측과 차이 0.5원 미만. 실제 Jev 호출 0.
  2. **크몽 봇 다시 켬.** 원인: 크몽 확장은 크몽 받은편지함/주문 목록 탭이 열려 있어야 신호를 보낸다(content script). 서버·확장 발행은 이미 오늘 13:35 것(0.1.3)이라 재시작 없이 준희 크롬에 `kmong.com/inboxes` 탭 하나를 열었음. 로그인 상태였고(로그인·비밀번호 입력 없음) 화면의 SWAN·크몽 창 "ON · 새 문의 대기".
     - **heartbeat healthy=true, 2026-09-23 14:12:08 KST** (직전 마지막 신호 9/20 13:51). 메시지 0·주문 0. 발송·상품 수정 0.
     - 이 탭을 닫으면 다시 멈춘다. 탭은 열어 둠.
     - 참고: 창의 "검증된 답변 자동 전송"이 켜져 있음(기존 설정, 건드리지 않음).
  3. run-all(PC, 1 반영 후): **70/70 통과**.
  4. **git 추적 해제 확인 → 안 됐음.** `.git/index` 수정 시각이 9/16 20:42 그대로이고(항목 95개), 4개 모두 아직 index에 있음: state.json.pre-audit-cleanup, state.json.pre-final-audit, relay-desk-report-for-astra.txt, relay-desk-report-manifest.json. index.lock 없음. 파일 4개는 모두 디스크에 남아 있음.
     - [추정] 명령이 다른 폴더에서 실행됐거나 오류로 끝남. `C:\Users\vdfr7\Documents\Codex\relay-desk-site`에서 `git rm --cached ...` 뒤 `git status`로 "deleted"(staged) 4줄이 보이는지 확인 필요.
     - relay-desk-report-manifest.json은 오늘 14:09에도 새로 쓰였음(무언가 계속 갱신 중).
  5. **PPT 자동 제작 준비 — 조사만(켜지 않음).**
     - a) **지금 코드로는 PPT 파일이 안 나온다.** 산출 형식 표에 `pptx: supported:false("PPTX 생성기가 연결되어 있지 않습니다")`. 제작 lane은 AI가 쓴 글(텍스트)만 남긴다. 로컬 템플릿(`services/presentation-design/templates/t1-report.cjs`·embed-fonts.py·check-deck.py)은 제작 흐름 어디에도 연결 안 됨(presentation-design.js 주석 "부르는 곳 없음"). 게다가 t1-report.cjs가 쓰는 `pptxgenjs`가 PC 저장소에 설치돼 있지 않음(node_modules 없음) → 연결하려면 **설치 필요 → 멈춤**.
       - 호출 수(현재 코드): 기본 검수 회수 0 + 최종 채점 manual → **1건당 제작 호출 1회**, 고객 수정 1회마다 +1. 단, 작업 상세에서 추가 검수 회수를 지정하면 최대 20회까지 늘어남.
       - 실측 기록: PPT는 9/15 1건뿐 — OpenAI gpt-5.6-luna 1회(입력 479·출력 3,569토큰) + Gemini 검토 1회, 서버 기록 합계 $0.0084(약 12원). 결과는 텍스트, 파일 없음.
       - 참고 실측(문서 주문 2건, 9/16~17): 검토 순환이 돌아 각 39회 호출, 서버 기록 $8.0·$12.9(약 1.1만·1.8만 원). 순환 상한이 없으면 이렇게 커진다.
       - 예상 [추정: 입력 4,000·출력 4,000토큰, 원고→슬라이드 JSON. 샘플 JSON이 약 3,200자]:
         - OpenAI gpt-5.6-luna: 코드의 단가식이 이 모델을 $4/$20로 잡음 → $0.096(약 140원). 9/15 기록 당시 단가로는 약 10원. 실제 단가 [확인 필요].
         - Claude claude-fable-5-1: 정책 claudeQuote의 공식 가격 $10/$50 → $0.24(약 360원). **코드 기본 단가는 $2/$10이라 5배 낮게 기록됨**(고쳐야 함).
     - b) 키 상태(`/api/providers`, 키 값은 안 읽음): OpenAI·Claude·Gemini 모두 `configured:true`(server_env). 오늘 사용 0. 잔액·유효 여부는 모름 [확인 필요]. claudeQuote 사유에 "충전 전까지 끔"이 있음.
     - c) 켜려면 바꿀 곳:
       1. `production.provider`: hold → OpenAI 또는 Claude
       2. `astraGate.paidProduction`: false → true (지금 false라 /api/run이 `astra_lane_disabled`로 막음)
       3. `spendControls.automaticPaidQuotesPaused`: true면 모든 자동 유료 호출이 막힘. false로 바꾸면 제작 외 자동 호출도 전부 풀리므로 **제작만 예외를 두는 새 키 + 코드 수정이 필요**(예: `spendControls.productionAutoAllowed`, runOpenAI/runClaude에서 제작 lane만 통과)
       4. 상한 자리: 1건당은 이미 `limits.maxAstraUsdPerOrder`(0.35달러)·`maxConcurrentPaidOrders`(2)가 제작 lane에 걸림. 하루 상한은 환경변수 `RELAY_DAILY_COST_CAP_USD`=0(무제한)뿐 → 정책 파일에 `production.dailyBudgetKrw` 같은 자리 새로 필요. 검수 회수 상한(`production.maxCallsPerOrder`)도 두는 게 맞음.
       5. PPT 파일을 만들려면: 제작 결과(슬라이드 JSON) → t1-report.cjs → 글꼴·검사 → 미리보기 PDF 연결 + pptxgenjs 설치(와 python 쪽 도구 확인).
       6. `usageCostEstimate`의 Claude 단가 교정.
     - d) 구독(Codex) 경로:
       - Codex CLI 유무(`codex --version`)는 **확인 못 함** — 이 방에 PC 명령 창이 없음. 홈에 `.codex` 폴더는 있음(안에 sessions·automations·worktrees 등, Codex 앱 자료로 보임 [추정]). 로그인 여부는 인증 파일을 안 읽는 조건이라 모름.
       - `.codex-ppt-build`는 비어 있음. `.codex-ppt-render*` 8개 폴더는 슬라이드 PNG·몽타주만(9/21 02:11 등) — Codex 대화에서 손으로 렌더해 본 흔적으로 보임 [추정]. 서버가 `codex exec`를 부르는 코드는 저장소에 없음.
       - **이미 있는 구독 경로**: `astra-room-bridge`(사건 줄 세우기 → Codex 대화방 "Swan Astra 운영·고객대응실"이 가져가 처리 → 완료 보고). 연결됨, 완료 47건, 마지막 기록 9/23 00:37. 지금은 고객 답장·운영 진단·제작 검토(production_review)만 받고 제작은 안 받음.
       - 최소 수정안 [추정]: ① 브리지 사건 종류에 `production_draft` 추가(원고 → 슬라이드 JSON만 받음) ② `PRODUCTION_PROVIDERS`에 `codex_room` 추가, 이 값이면 API 대신 브리지에 올림 ③ 완료 결과를 5-c-5의 로컬 렌더로 넘김 ④ finalGrade manual 유지. `codex exec` 직접 호출보다 이 방식이 기존 구조와 맞음.
       - 1건 시간·구독 소모 [추정]: 대화방 1턴(슬라이드 JSON 생성) + 로컬 렌더 1~2분. 대화방이 사건을 얼마나 자주 가져가는지는 기록에서 확인 못 함. 구독 한도 소모는 1건당 1턴이라 작을 것으로 보지만 수치 근거 없음. 구독을 자동 판매 제작에 쓰는 것이 약관상 괜찮은지 [확인 필요].
     - 멈춰 있는 PPT 1건(POST-SOOMGO-26c8fb976391)은 그대로.
- 바꾼 파일:
  - server/transcribe/translated-sync.js
  - server/config/astra-relay-operating-policy.json (`jevSimulation.translatedSyncTokensPerCall: 367` 한 줄)
  - tests/translated-sync.cjs
  - docs/progress.md (이 칸)
- 백업: backups/estimate-20260923/ (위 3개 원본), backups/progress.md.pre-dev4.bak
- run-all: 전체 70개 중 70개 통과 (PC, 14:12경)
- 외부 발송·유료 API 호출·설치: 없음. Jev 실호출 0. 크롬에 크몽 받은편지함 탭 1개 연 것 외 조작 없음.
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제:
  - git 추적 해제가 index에 반영 안 됨 → 준희가 저장소 폴더에서 다시 실행·확인 필요.
  - PPT 자동 제작: 파일 생성기 미연결 + pptxgenjs 설치 필요 → 멈춤. 켜려면 5-c 1~6 중 무엇을 할지(API 경로 vs Codex 대화방 경로) 준희 결정 필요.
  - Codex CLI 확인은 PC 명령 창이 있는 방에서 `codex --version`, `codex login status`(인증 내용은 출력 안 함) 실행 필요.
  - 크몽 봇은 크롬 탭에 달려 있음. 탭이 닫히거나 PC가 재부팅되면 다시 멈춘다 → 재부팅 후 자동으로 여는 방법은 따로 정해야 함.

## 2026-09-23 14:40 · 크몽방 · next-kmong.md (지시 2)
- 한 일:
  1. 답변틀 v4 초안에 자막 A·B 싱크 설명과 무료 샘플 문장을 되살림. 문서(C-1·C-2)의 당연한 설명은 계속 뺀 상태. 확정된 두 가지(자막 납기 기간 표현 예외, 첫 줄 유지)를 "확정된 것"으로 옮겨 적음.
  2. video-intake.md에 첨부 한도 채움: 1회 6개, 파일당 500MB (출처: 크몽 가이드 kmong.com/article/1833, 감독 확인). 500MB 초과는 거래 성립 뒤 이메일·공유 프로그램. v3.1의 "외부 링크 먼저 안내 금지"와 겹치는 지점을 표시만 하고 정하지 않음.
  3. 심사 상태 확인(읽기만, Gmail 기록): 아래 정리.
  4. 템플릿 상품 문의 답변 틀 초안 작성(T-1 상황 적합, T-2 프로그램·버전, T-3 수정·상업적 이용, T-4 환불). 상품 페이지 본문을 못 봐서 값은 [확인 필요]로 비움.
- 되살린 문장 원문:
  - A 한국어: "스크립트 시간이 영상 중간부터 조금씩 밀리는 경우가 있어서, 그대로 옮기지 않고 실제 말하는 부분과 처음부터 끝까지 맞춰 보면서 작업합니다."
  - A 외국어: "스크립트 시간이 영상 중간부터 조금씩 밀리는 경우가 있어서, 말한 내용을 한국어로 옮긴 뒤 말하는 시점과 처음부터 끝까지 맞춰 봅니다."
  - B 한국어: "말한 내용을 받아 적은 뒤, 자막이 말하는 시점과 맞는지 처음부터 끝까지 확인하고 보내드립니다. 고유명사나 전문용어가 있으면 미리 알려주시면 정확해집니다."
  - B 외국어: "말한 내용을 한국어로 옮긴 뒤 말하는 시점과 맞춰 봅니다. 처음부터 끝까지 확인하고 보내드리며, 고유명사나 전문용어가 있으면 미리 알려주시면 정확해집니다."
  - 무료 샘플(20분 이상): "영상이 기니 결제 전에 앞부분 1~2분을 먼저 자막으로 만들어 보내드리겠습니다. 보시고 진행하시면 됩니다." — v3.1에는 규칙만 있고 원문이 없어 이 문장은 새로 옮긴 것. 준희 승인 필요.
- 심사 상태 (Gmail no-reply@kmong.com 기록, 읽기만):
  - 9/23 04:55 UTC(13:55 KST) 승인 2건: 소상공인 월손익 자동정리 엑셀 템플릿 / AI마케팅 입문자 템플릿 패키지("수정 권장 사항 없음").
  - 9/17 09:12~09:31 UTC 비승인 다수(엑셀·문서 템플릿, gig 819588·819591·819593·819597·819601·819603·819606·819610·819611·819614·819749·819768·819772·819775·819779·819782·819783·819785·819823·819824·819830·819832·819836·819840·819843·819845·819847·819849·819851·819853). 사유는 전부 같음 — 서비스 설명에 '3가지 필수기재 사항'을 기재하라: ① 저작권 귀속 여부(전문가 귀속 vs 고객 귀속) ② 고객의 상업적 이용 가능 여부 ③ 폰트 사용 정보(무료 vs 유료+다운로드 링크).
  - 9/15 09:23~09:24 UTC 비승인 5건(엑셀 템플릿) — 같은 '3가지 필수기재 사항' 사유.
  - 9/9 05:32 UTC 비승인 1건: "PDF 엑셀 문서 자료정리 깔끔하게 해드립니다"(문서·글쓰기 > 문서 편집) — 사유는 카테고리 수정 요청(추천: 문서 글쓰기 > AI 콘텐츠 생산).
  - **자막 제작·일반 문서 작성 서비스의 승인/비승인 메일은 없음.** 9/22 18:31 알림톡 "비승인 사유 확인"에 해당하는 9/22자 크몽 메일도 없음. 어느 상품인지는 크몽 판매자 화면(내 서비스)에서 확인해야 하고, 로그인이 필요해 이 방에서는 멈춤.
- 바꾼 파일:
  - docs/kmong/reply-template-v4-draft.md (수정)
  - docs/kmong/video-intake.md (수정)
  - docs/kmong/template-reply-draft.md (새 파일)
  - docs/progress.md (이 칸)
- 백업: backups/progress.md.pre-kmong-1440.bak
- run-all: 실행 안 함 (코드·json 변경 없음)
- 외부 발송·유료 API 호출·설치: 없음. 크몽 로그인·등록·수정·메시지 0건. Gmail은 읽기만 했고 메일을 보내거나 라벨을 바꾸지 않음.
- 가격·문구·수정 횟수·납기 변경: services/*.json 변경 없음. 문구는 초안 파일에만 반영.
- 멈춘 이유 또는 남은 문제:
  - 9/22 비승인 건 확인은 크몽 로그인 필요 → 멈춤. 준희가 "내 서비스"에서 비승인 상품명과 사유를 알려주면 이어서 고칠 곳을 정리한다.
  - 무료 샘플 문장 원문 승인 대기.
  - 결제 후 대용량 파일 안내를 우리가 먼저 해도 되는지 확인 필요.
  - 템플릿 상품 [확인 필요] 값: 파일 형식·권장 프로그램·호환 범위, 저작권/상업적 이용/폰트 문구 원문, 환불 기준.

## 2026-09-23 14:06 · 크몽방 · next-kmong.md (지시 1, 이미 실행함)
- 한 일: 지시 파일을 다시 읽었으나 13:30에 실행한 "크몽방 지시 1"과 같은 파일이다(12:10 감독본, 내용·수정시각 동일). done/에 next-kmong-20260923-1.md로 보관본이 있다. 새로 실행한 것 없음.
- 바꾼 파일: docs/progress.md(이 칸)
- 백업: backups/progress.md.pre-kmong-1406.bak
- run-all: 실행 안 함
- 외부 발송·유료 API 호출·설치: 없음
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제:
  - 크몽방 지시 2가 올라오면 실행한다.
  - 새 사실(9/23 13:55 크몽 알림톡): 승인된 상품은 "소상공인 월손익 자동정리 엑셀 템플릿", "AI마케팅 입문자 템플릿 패키지" 두 건이다. 자막·문서 상품이 아니다. 9/22 18:31 "비승인 사유 확인" 알림도 있었다. 자막·문서가 비승인인지 심사 중인지는 미확인.
  - 13:30 초안(답변틀 v4·상품 페이지)은 자막·문서 기준이라 승인된 템플릿 상품에는 맞지 않는다. 템플릿은 파일을 바로 받는 상품이라 문의가 작업 범위·납기가 아니라 "내 상황에 맞는지, 어떤 버전에서 열리는지, 고쳐 써도 되는지"로 온다. 템플릿용 문의 답변 틀이 따로 필요한지 감독 결정 대기.
  - 기존 대기 2건 유지: 자막 납기 기간 표현(당일~1일) 예외 확정 여부, 첫 줄 "요청서 확인했습니다" vs "보내주신 문의".

## 2026-09-23 13:45 · 개발방(Cowork claude-04) · next-dev.md (지시 2)
- 한 일:
  - A. 고객 자료 git 제외
    - .gitignore에 추가: server/data/state.before-*.json, state.json.pre-*, astra-chat.json, case-study-log.json, relay-desk-report-for-astra.txt, relay-desk-report-manifest.json
    - outputs/는 통째로 넣지 않았다. ask-astra 스크립트, 보고서, 영상 시험 파일 같은 코드·시험 결과가 섞여 있어서다. 고객 이름이 든 것만 넣었다: outputs/astra-kimgukeun-20260917/, outputs/kimgeunguk_astra_12000_results.zip
    - 고객 관련으로 보이는데 이름이 없어 넣지 않은 것(준희 판단 필요): outputs/fashionplus-order-downloader/(추적 중), outputs/fashionplus_downloader_corrected.py, outputs/FashionPlus_통합주문내역_템플릿.xlsx, outputs/soomgo-corrected/, outputs/astra-qa-recap-20260918.*·astra-conversion-chat*·astra-pricing-chat*(고객 대화가 들었을 수 있음 [추정])
    - 이미 추적 중인 4개 추적 해제(셸이 필요해 실행 안 함):
      git rm --cached server/data/state.json.pre-audit-cleanup server/data/state.json.pre-final-audit server/data/relay-desk-report-for-astra.txt server/data/relay-desk-report-manifest.json
  - B. PPT 제작 막힘: 코드가 받는 production.provider 값은 OpenAI·Claude·hold 셋뿐이다(server/operating-policy.js PRODUCTION_PROVIDERS). "수동 제작" 값이 없어 바꾸지 않고 멈췄다.
    - 지금 hold는 사실상 "유료 호출 0, 게시물은 대기"라서 수동 제작과 같은 효과다. 빠진 것은 준희 확인 목록에 "수동 제작 대기"라고 뜨는 표시와, 만든 결과물을 넣는 경로다.
    - 최소 수정안:
      ① PRODUCTION_PROVIDERS에 'manual' 추가. 동작은 hold와 같게(API 호출 0) 하고 사유만 manual_production으로 둔다.
      ② attention의 production_hold 항목 문구를 "수동 제작 대기(구독으로 제작 후 결과 등록)"로 바꾼다.
      ③ 결과 등록 경로 POST /api/soomgo/production/result(로컬 전용)를 추가한다. /api/run과 같은 후처리를 거치고 finalGrade manual은 유지한다. 테스트로 유료 호출 0건을 확인한다.
    - 멈춰 있는 PPT 1건: POST-SOOMGO-26c8fb976391 (task SOOMGO-26c8fb976391, PPT 제작, 납기 3~4일, policy_hold, 2026-09-21 18:26Z부터). 고객에게 연락하지 않았다.
  - 1. 용어 목록 재시험(small, 10분 공개 샘플, 스레드 4). 용어: SSG, 구단주, 문학야구장, 팬서비스
    | 방식 | 처리 | SSG | 구단주 | 문학야구장 | 팬서비스 | 남은 오류 |
    |---|---|---|---|---|---|---|
    | 없음 | 196초 | 7 | 0 | 0 | 0 (펜서비스 3) | 부담주님·야부 |
    | hotwords | 180초 | 7 | 1 | 1 | 3 | 야부 1 |
    | prompt | 180초 | 7 | 0 ("부단윤님") | 0 ("문학냐고") | 3 | 야부 1 |
    → hotwords가 낫다. 기본값 hotwords 유지. 결과: TR-20260923023531-3ea76f(hotwords), TR-20260923042904-f3d226(prompt)
  - 2. S-3 번인 자막 위치: 아래(기본), 위, 아래·위 여백(marginV 0~300) 추가
    - 위치를 안 주면 예전 인자와 똑같다. 잘못된 값은 FFmpeg를 부르기 전에 거절한다.
    - PC 실측(공개 샘플 ko-burnin-30s): 위(Alignment=6), 아래+여백 60 모두 MP4 디코딩이 끝까지 된다. 위 자막은 원본 하단 자막과 겹치지 않는다.
    - 처음 Alignment=8을 썼더니 왼쪽 가운데로 가서, 6(위 가운데)으로 고쳤다. FFmpeg는 SRT에 옛 SSA 번호를 쓴다.
    - 테스트: tests/burnin-position.cjs
  - 3. 크몽 봇 상태(읽기만): heartbeat healthy=false. 마지막 신호 2026-09-20 13:51(KST), 약 72시간 전. 상태 "새 문의 대기", 계정 swan, mode astra_room, paused=false. 주문·메시지·발송·초안 모두 0
  - 4. 번역 자막 두 단계 싱크 검사
    - 새 파일 server/transcribe/translated-sync.js
    - 경로: POST /api/admin/translated-sync-check. 로컬 전용이고 전용 헤더가 필요하다. 사람이 부를 때만 돌고, 납품 흐름에는 붙이지 않았다.
    - 참고용이다. 납품을 막지 않고 자동 보정도 하지 않는다. 수정안("k번을 한 칸 뒤로")만 만든다.
    - 상한: 1회 1,500호출·50원. 넘을 것 같으면 부르지 않고, 도중에 넘으면 멈춘다.
    - 이름은 가리고 파일명은 보내지 않는다.
    - 테스트: tests/translated-sync.cjs(가짜 Jev)
  - 5. 33분 건 실측(준희 승인분)
    - 비용: 1,165호출, 428,075토큰, 26.97원, 110초, 오류 0
    - 1단계 시각 맞춤: ok(편차 0.00, 최저 점수 0.469)
    - 판정: 사람 확인. "셋 다 안 맞음"이 39%로 30%를 넘었다. 집계는 맞음 171, 앞섬 26, 늦음 33, 안 맞음 152, 애매 7
    - 내용 밀림 구간 7개(5블록 중 3블록 규칙), 수정안 35개
    | 12:01 수동 확인 구간 | 두 단계 검사 결과 |
    |---|---|
    | 150초(31번, 1블록) | 못 잡음(1블록이라 규칙에 안 걸림) |
    | 178~218초 | 194~218초(40~45번) 잡음. 178~193초는 "안 맞음"이라 빠짐 |
    | 331~351초 | 331~351초(66~71번) 잡음 |
    | 370~380초(2블록) | 못 잡음(2블록뿐) |
    | (400초 이후, 처음 확인) | 늦음 559~621·670~686·860~888·1327~1359초, 앞섬 980~1010초 |
- 바꾼 파일:
  - .gitignore
  - server/video-pipeline.js, server/transcribe/t5-tools.js, server/relay-server.js(관리자 경로·burn-in 인자만)
  - server/transcribe/translated-sync.js(새)
  - tests/burnin-position.cjs(새), tests/translated-sync.cjs(새), tests/run-all.cjs(2줄 추가)
  - docs/progress.md
- 백업: backups/customerdata-20260923/, backups/s3-20260923/, backups/translated-sync-20260923/, backups/progress.md.pre-dev3.bak
- run-all: 전체 68개 중 68개 통과(2026-09-23 13:39 KST, PC win32·Node v24.21.0, /api/admin/run-tests). S-3 위치 번호를 고친 뒤와 두 단계 검사 추가 뒤에 돌린 결과다.
- 외부 발송·유료 API 호출·설치:
  - Jev 1,165건, 26.97원. 준희 승인분(5번)이고 테스트에서는 실제 호출 0이다.
  - 전사 1회(로컬), 번인 3회(로컬).
  - 설치·다운로드는 없음.
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제:
  - B는 코드에 "수동 제작" 값이 없어 멈췄다. 위 최소 수정안을 할지 준희가 정해야 한다.
  - 비용 추정이 실제의 절반이다(추정 12.5원, 실제 27원). 글자 수÷3 방식이 한국어 토큰을 적게 센다. 도중 멈춤이 실제 토큰으로 막으므로 최대 50원은 지켜진다. 사전 추정은 실측 건당 367토큰으로 바꾸는 게 맞다(다음 지시에서).
  - "셋 다 안 맞음" 39%: 한국어 블록이 원어 두 블록에 반씩 걸쳐 있는 경우가 많다 [추정]. 1~2블록짜리 어긋남은 5블록 중 3블록 규칙으로는 못 잡는다. 규칙을 바꿀지는 정답 SRT로 확인한 뒤 정한다.
  - 크몽 봇은 3일째 신호가 없다. 켜기·재시작은 이번 범위 밖이다.
  - medium 설치는 준희 승인 대기.
  - 이 칸의 시각(13:45)은 대략이다.

## 2026-09-23 13:37 · 숨고 운영방(Cowork claude-ff) · next-soomgo.md (지시 1)
- 한 일:
  - **P3 요청봇 쪽 절반 (완료)**: 견적 결과 보고(quote-result)를 sessionStorage 예약함(`relaySoomgoQuoteResultOutboxV1`)에 먼저 적고, 서버에 닿으면 지운다. 발송 버튼을 누르기 **전에** '발송 확인 필요(uncertain)'로 예약하고, 결과가 확인되면 같은 요청번호의 예약을 실제 결과로 바꾼다. 새 문서가 뜰 때 남은 예약을 **한 번만** 다시 보낸다(원래 시각·원래 URL 그대로, 채팅방 URL이면 대화번호 연결도 유지). 재전송도 실패하면 예약함에서 빼고 서버 quote_result_missing(24시간) 알림에 맡긴다. 24시간 넘은 예약은 버린다. 기존 채팅방 복귀 흐름은 그대로.
    - 이전에는 발송 후 30초 안에 채팅방으로 이동한 경우만 보고를 살렸고, 그 밖의 이동·서버 꺼짐에서는 보고가 사라져 '발송 결과 대기'로 남았다.
  - 봇 0.4.20 → **0.4.21**. 서버 재시작(publish:true, 13:35:19) 뒤 자동 재로드 → 요청봇 심박 **0.4.21**(13:35:56 확인). 채팅봇 0.3.21 그대로.
  - **P4 분석·초안 (초안까지만)**: docs/soomgo/p4-reply-drafts.md
    - emergency_astra_review 36건 분류: 캐시 보상 알리미 19 · 견적 읽음 시스템 문구 14 · 요청사항 추가 알리미 1 · 채팅방 나감 1 · 우리 견적 문구 되돌아옴 1 → **고객이 직접 쓴 글 0건**, 전부 9/17~9/19(9/22 비상 판정 수정 전). 그래서 이 36건에서는 자동 답변 유형을 고를 수 없었다.
    - 대신 고객이 직접 쓴 메시지 99건 중 사람 확인으로 빠진 24건을 분류해 3유형을 골랐다: A 금액 확인 질문(1건) · B 고객 쪽 준비 지연(2건 — 그중 1건은 "어떤 결과물이 필요하신지 알려주세요"가 엉뚱하게 나감) · C 견적·납기 다시 묻기(3건). 표본이 작다.
    - 문구 초안 3개(금액·날짜는 `{quoteAmount}`·`{deliveryDate}` 자리표시), 적용 조건(견적 보낸 대화만, 결제·환불·취소·새 범위·고용 확정은 제외, 같은 유형 1회).
- 바꾼 파일: soomgo-bot-extension/content-v3.js, soomgo-bot-extension/manifest.json, tests/quote-result-recovery.cjs(새), tests/run-all.cjs(줄 추가), tests/request-bot-priority.cjs·tests/soomgo-bot-smartquote-exit.cjs·tests/empty-request-guard.cjs(버전 고정값 0.4.20→0.4.21만), docs/soomgo/p4-reply-drafts.md(새), docs/progress.md(이 칸)
- 백업: backups/quote-result-recovery-20260923/ (content-v3.js, manifest.json, run-all.cjs, 버전 테스트 3개), backups/progress.md.pre-soomgo-p3p4-20260923.bak
- 새 테스트: tests/quote-result-recovery.cjs — 정상 보고 후 재전송 없음 · 이동으로 끊김 → 1회만 재전송 · sent 보고 실패 → 원래 시각·URL로 sent 재전송 · 재전송 실패 → 더 안 보냄 · 도중 끊김 표시 → 다시 안 보냄 · 24시간 지난 예약 버림 · 버튼 클릭 전 예약 위치 · 금액·문구 필드 안 건드림. 서버 쪽 24시간 알림 1회는 기존 tests/quote-result-missing.cjs.
- run-all: 전체 67개 중 67개 통과, 실패 없음 (PC /api/admin/run-tests, 115초, node v24.21.0 / win32, 13:31~13:33)
- 외부 발송·유료 API 호출·설치: 없음. 숨고 견적·채팅 발송 0건, 요청 삭제 0건, 유료 API 0건. P4 집계는 PC 브라우저 안에서 로컬 서버 자료로만 했다.
- 가격·문구·수정 횟수·납기 변경: 없음. 기존 견적 문구·금액 그대로. P4 문구는 파일 초안일 뿐 서버에 연결 안 함.
- 멈춘 이유 또는 남은 문제:
  - 지시 1 완료. 여기서 멈춘다.
  - 준희 결정 필요(P4): A·B·C 초안 채택, B의 "견적 금액 유지" 문장(유지 기간 미정), B와 later_contact_thanks 합칠지.
  - [추정] …8113 "장당 39,000원인가요?"는 우리 견적이 전체 금액인지 장당인지 확인이 필요해 자동 대상에서 뺄 수 있다.
  - 문구 아닌 문제 2개(지시 범위 밖이라 고치지 않음): ① 숨고 알리미 3종("고용을 요청해 주세요", "캘린더에 자동으로 입력", "숨고페이 안전결제 잊지 않으셨죠?")이 고객 글로 읽혀 자동답장·결제 확인으로 빠짐(6건) ② customerRoomFallbackLog 0건 — 9/22 연결 뒤 대상 이벤트가 없었는지, 안 도는지 미확인.
  - 서버 quote-result는 늦게 온 'uncertain'이 먼저 온 'sent'를 덮을 수 있다. 봇은 요청번호마다 최신 결과 하나만 남겨서 이런 순서가 생기지 않게 했지만, 서버 쪽 막음은 없다(범위 밖).

## 2026-09-23 13:30 · 크몽방 · next-kmong.md
- 한 일:
  - 0번 답변틀 v4 초안 작성. 바뀐 곳은 두 가지뿐: 자막 납기를 길이 무관 "당일~1일"로(30분 이상 +2일 폐지), 문서 C-1·C-2 문구를 자막 v6 구조(요청 확인 → 견적 한 줄 → 안전결제 → 질문 하나)로 통일. v3.1에 있던 "20분 이상 무료 샘플" 문장과 당연한 작업 설명은 뺐다. 프로젝트의 v3.1 문서는 고치지 않았다.
  - 1번 상품 페이지 수정안 초안 작성. 금액은 json 값만 옮겼고 새로 만든 숫자는 없다.
  - 2번 영상 파일 받는 방법: 크몽 공식 도움말 3건을 찾았으나 이 방에서 본문을 열지 못했다(사이트 접근 차단). 용량 한도·개수·허용 형식은 빈 칸으로 두고, 준희가 채우도록 적었다. 확인 안 된 내용은 [추정]으로 표시.
  - 3번(봇 상태)은 지시대로 하지 않았다.
- 초안에 들어간 금액의 출처:
  - 자막: services/subtitle.json → pricing.packages[].saleAmount (5분 32,000 / 10분 49,000 / 30분 89,000 / 30분 초과 89,000 + packages[3].unit 5분당 20,000), additionalFees(translation ×1.2 천원 반올림, burn_in 5분당 15,000, revision 10,000), includedRevisions 2, leadDaysRules 기본 "당일~1일"
  - 문서: services/document_writing.json → pricing.packages[0].saleAmount 21,000(1,500자 이내), additionalFees(extra_1000_chars_or_a4_page 10,000, research 10,000, revision 10,000), pricing.largeDocument(40쪽 초과 쪽당 3,500 / 100쪽 초과 미접수), includedRevisions 3
- 바꾼 파일:
  - docs/kmong/reply-template-v4-draft.md (새 파일)
  - docs/kmong/product-page-draft.md (새 파일)
  - docs/kmong/video-intake.md (새 파일)
  - docs/progress.md (이 칸)
- 백업: backups/progress.md.pre-kmong-1330.bak
- run-all: 실행 안 함 (코드·json 변경 없음, 이 방에는 준희 PC 셸 없음)
- 외부 발송·유료 API 호출·설치: 없음. 크몽 로그인·등록·수정·메시지 0건. 웹 검색으로 크몽 고객센터 문서 제목만 확인(본문 열람 실패).
- 가격·문구·수정 횟수·납기 변경: services/*.json 값은 바꾸지 않음. 문구는 새 초안 파일에만 썼고 운영 반영은 안 함.
- 멈춘 이유 또는 남은 문제:
  - 크몽 첨부 용량 한도·파일 개수·허용 형식 미확인. 준희가 크몽 고객센터 문서(4406941308313, 4404205823001)를 열어 값을 주면 답변틀에 한 줄 넣는다.
  - 감독 확인 2건: ① 납기 표기 원칙은 "날짜"인데 자막만 기간 표현(당일~1일)을 쓴다. 자막 예외로 확정할지 ② 첫 줄을 숨고와 같은 "요청서 확인했습니다"로 둘지, 크몽에 맞게 "보내주신 문의"로 바꿀지
  - 문서 납기: 크몽 v3.1(+1일 / 20쪽 이상 +2일)과 숨고 document_writing.json(기본 "당일~1일", 6쪽 이상 "1~2일")이 다르다. 통일 여부 미결.
  - 크몽 상품 페이지 실제 패키지 금액과의 대조표는 상품 승인 후로 보류.

## 2026-09-23 13:27 · 해외 채널방(Cowork claude-06) · next-global.md (지시 1)
- 한 일:
  - 파이버 대표 이미지 초안 2장 제작(Pillow로 직접 그림, 단색·추상 배경 + 새로 지은 한국어 자막 예시). 고객 영상·공개 샘플 사용 안 함
  - 체크리스트 대표 이미지 줄을 "초안 있음 — 준희 확인 대기 + 경로"로 갱신
- 만든 이미지(검증):
  - docs/global/gallery/fiverr-gallery-01.png — 1280×769, 155KB
    - 문구: "Korean SRT subtitles" / "Full sync check" / 자막 예시 "오늘은 집에서 간단하게 만들 수 있는" "방법을 차근차근 보여 드릴게요."
  - docs/global/gallery/fiverr-gallery-02.png — 1280×769, 129KB
    - 문구: "Korean SRT subtitles" / "Timing checked from start to finish" / SRT 예시 12 "00:01:04,200 --> 00:01:06,900" "먼저 재료를 준비해 주세요." · 13 "00:01:07,100 --> 00:01:10,400" "순서대로 하나씩 넣으면 됩니다." · 14 "00:01:10,800 --> 00:01:13,500" "마지막으로 한 번만 더 확인해 볼게요." / 하단 자막 "마지막으로 한 번만 더 확인해 볼게요."
  - 영어 문구는 초안에 있는 표현만 씀("Full sync check" = 패키지 설명, "from start to finish" = 설명·FAQ Q2). 새 약속·경력·"100% human" 없음
  - 파이버 권장 크기 1280×769는 [추정] — 등록 화면에서 확인
- 바꾼 파일: docs/global/gallery/fiverr-gallery-01.png(새), docs/global/gallery/fiverr-gallery-02.png(새), docs/global/fiverr-listing-checklist.md(대표 이미지 줄만), docs/progress.md(이 칸)
- 백업: backups/fiverr-listing-checklist.md.pre-gallery.bak, backups/progress.md.pre-global-gallery.bak
- run-all: 실행 안 함(코드 변경 없음)
- 외부 발송·유료 API 호출·설치: 0건 (이미지는 클라우드 작업 공간의 기존 Pillow·Noto 글꼴로 그림)
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제: 지시 1 완료. 이미지 채택 여부는 준희 확인 대기. 파이버 등록은 내용 밀림 확인 전까지 보류 유지

## 2026-09-23 12:10 · 숨고 운영방(Cowork claude-ff) · (이 방 몫 next 파일 없음 — next-dev.md는 개발방·알림방이 이미 실행해서 다시 하지 않음)
- 한 일:
  - docs/orders/에는 next-dev.md 하나뿐이다. 같은 지시를 네 번째로 적지 않으려고 **겹치지 않는 것만** 적는다. 코드·설정은 고치지 않았다.
  - run-all 대조: /api/admin/run-tests로 1회 실행 → **65개 중 65개 통과**, 약 170초, node v24.21.0 / win32, 12:04~12:07. 아래 칸들과 같다.
  - 정정: 오늘 이 방이 준희에게 "jev-quality-experiments·global-reply·sync-drift-v3 실패는 다른 방 작업 탓"이라고 보고했는데 틀렸다. 이 방은 클라우드에 복사한 파일로 돌렸고, 복사본에 빠진 파일(jev 설정 파일 옛판, kmong-bot-extension 폴더 등) 때문에 난 실패였다. PC에서는 전부 통과한다.
  - git 출처 확인용 — 오늘(9/22 밤~9/23) 이 방이 준희 지시로 바꾼 파일(커밋 안 된 변경에 섞여 있음):
    - server/relay-server.js: 매출 깔때기(자체 점검·숨고 자동 알림 제외, 발송 확인된 견적만, 문구 버전별 답장률), 견적 발송 결과 미기록 알림, 짧은 승낙('해주세요·할게요·맡길게요')→고용 요청 안내, 거절 감사 답장, 나중 연락 감사 답장, 알림방 중복 방지(dedupe=1), 고객응대실 합치기 연결
    - server/attention-dedupe.js(새), server/customer-room-fallback.js(새)
    - soomgo-bot-extension/content-v3.js·manifest.json → 0.4.20 (목록에서 PPT→문서→자막 순으로 먼저 열기), soomgo-chat-bot/chat-content.js(심박에 버전 추가)
    - services/document_writing.json(대본/시나리오 카테고리를 문서에 연결), services/_common/soomgo-categories.json(대본/시나리오를 미판매 목록에서 뺌), services/presentation.json·subtitle.json·document_writing.json 견적 첫 줄 감사 인사(9/22 밤)
    - server/config/astra-relay-operating-policy.json: customerRoomFallback 항목 추가(9/22)
    - tests: funnel-synthetic-filter, quote-result-missing, funnel-human-replies, hire-path, request-bot-priority, unsold-category-block, attention-dedupe, customer-room-fallback, thanks-copy (+run-all.cjs 줄 추가)
- 바꾼 파일: docs/progress.md (이 칸). 위 목록은 이 칸 이전 작업.
- 백업: backups/progress.md.pre-soomgo-20260923.bak / 이전 작업분: backups/funnel-synthetic-20260923, quote-result-missing-20260923, funnel-human-replies-20260923, hire-path-20260923, bot-0.4.19, script-sellable-20260923, thanks-20260923, attention-dedupe-20260922, customer-room-fallback-20260922
- run-all: 전체 65개 중 65개 통과, 실패 없음 (위와 같음)
- 외부 발송·유료 API 호출·설치: 이 칸 작업은 없음. 오늘 이 방 이전 작업: 숨고 견적 1건(애니메이션 대본 30,000원, 1,790캐시, 준희 지시), 숨고 채팅 1건(하재준 고객 감사 답장, 준희 승인). 유료 API 호출 0건, 설치 없음.
- 가격·문구·수정 횟수·납기 변경: 이 칸 작업은 없음. 오늘 이 방 이전 작업(준희 지시): 견적 첫 줄 "요청 주셔서 감사합니다." 추가(PPT v5·자막 v6·문서 v7), 새 문구 2개(later_contact_thanks, decline_thanks), 대본/시나리오를 판매로 전환(자동 견적 없이 견적 판단 알림 → 준희가 가격 결정). 가격·수정 횟수·납기는 바꾸지 않음.
- 멈춘 이유 또는 남은 문제:
  - decisions.md와 다른 곳(값은 고치지 않고 적기만):
    1. 6항 "숨고 요청 삭제는 준희 허락, 예외는 고수 10명 마감만" ↔ 실제로는 9/21 준희 승인 D' 규칙(services/_common/soomgo-auto-rules.json)이 판매 안 하는 카테고리·자소서·논문·위조·CAD 물량산출·100쪽 초과를 자동 삭제한다.
    2. 6항 "숨고 신규 견적은 하루 최소 20건" ↔ 정책 limits.maxDailyNewQuotes=20은 상한이다.
    3. 1항 서비스 범위에 대본/시나리오가 없다. 9/23 준희가 "빼자(판매)"로 정했다.
    4. 7항 "버전별 20건 전에는 문구를 바꾸지 않음" ↔ 오늘 새 문구 2개를 추가했다(기존 문구 변경은 아님).
  - 여기서 멈춘다. 감독방에 직접 알리지 못했다(이 PC에서 도는 다른 세션 없음). 이 칸으로 대신한다.

## 2026-09-23 12:06 · 알림방(Cowork claude-ea) · next-dev.md (대조 실행)
- 한 일:
  - 준희 지시로 next-dev.md를 실행했는데, 같은 지시를 개발방(claude-04)이 11:56과 12:01에 이미 실행해 적어 두었다. 같은 내용을 세 번 적지 않으려고, 이 칸에는 **겹치지 않는 것만** 적는다.
  - 코드·설정은 한 줄도 고치지 않았다. 쓴 파일은 이 progress.md 하나뿐이다.
  - run-all 대조(지시의 검증 항목): 이 방에서 따로 1회 더 돌렸고 **65개 중 65개 통과, 123초**였다. 바로 아래 12:01 칸의 65/65와 같다. 숫자는 맞다.
  - 설정값도 따로 읽어 같은 값을 얻었다: finalGrade.mode=manual / automaticPaidQuotesPaused=true / production.provider=hold / subtitle channels.fiverr.enabled=false.
  - git 항목은 12:01 칸이 더 자세하다(바뀐 파일 52개, 추적 안 된 파일 1,003개 이상, 고객 자료로 보이는 파일 목록). 그쪽을 기준으로 보면 된다. 이 방도 PC 셸이 없어 git 명령 자체는 못 돌렸다.
  - decisions.md 대조에서 한 가지 덧붙인다: decisions.md 1항은 PPT를 "판매 중(9/22 보류 해제)"으로 적는데 production.provider=hold라 제작이 돌지 않는다. 값은 고치지 않았다. 9/23 진찰 P7과 같은 건이다.
- 바꾼 파일: docs/progress.md (이 칸)
- 백업: 없음 (next-dev.md가 "쓰기 허용: docs/progress.md 한 파일만"이라 백업 파일을 만들지 않았다. 12:01 칸은 backups/progress.md.pre-dev2-20260923.bak을 남겼다)
- run-all: 전체 65개 중 65개 통과, 실패 없음. /api/admin/run-tests로 1회, 123초, node v24.21.0 / win32, 12:01~12:03
- 외부 발송·유료 API 호출·설치: 없음 (run-tests는 이 PC 안에서만 돌았고 Jev 호출 0건, 0원)
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제:
  - 지시 5번대로 여기서 멈춘다.
  - **감독이 볼 것**: 한 지시 파일(next-dev.md)을 두 방이 거의 동시에 실행했다(11:56, 12:01, 12:06). 지시를 누가 가져갔는지 표시하는 자리가 없어서 생긴 일이다. 다음 지시부터는 파일 이름을 방마다 나누거나, 맨 위에 "맡은 방" 한 줄을 넣는 편이 낫겠다.
  - 감독방에 직접 알리지 못했다. 이 PC에서 도는 다른 세션이 없다고 나온다. 이 칸으로 알림을 대신한다.

## 2026-09-23 12:01 · 개발방(Cowork claude-04) · next-dev.md (다시 실행)
- 한 일: next-dev.md를 처음부터 다시 실행했다. 이번 실행에서는 코드를 고치지 않았다.
  1. run-all 1회 실행.
  2. git 상태 확인. 이 방에는 PC 셸이 없어서 git 명령 대신 .git/index·.git/logs/HEAD를 읽기만 하고, 작업 폴더 목록과 크기를 비교했다. 그래서 아래 숫자는 근사값이다 [추정].
     - 마지막 커밋은 b882ec0 "작업 상태 저장 2026-09-16 19:17"이다. logs/HEAD 최근 15개는 9/15~9/16 커밋이다(대시보드·큐·보고서 관련). 그 뒤로는 커밋이 없다.
     - 추적 중인 파일 95개 중 52개가 바뀌었다(크기 기준). 예: dist/downloads 19개, sales/ 10개, soomgo-bot-extension·soomgo-chat-bot 8개, server/relay-server.js, tests 5개, .gitignore·README.md. 모든 방의 9/16 이후 작업이 섞여 있다 [추정].
     - 추적 안 된 파일은 1,003개 이상이다(목록이 2,000개에서 잘림). services/·server/transcribe/·tests/fixtures/·backups/·artifacts/·outputs/ 등.
     - 스테이징: index가 9/16 커밋 시각 그대로라, 그 뒤 스테이징한 것은 없어 보인다 [추정].
     - 고객 자료로 보이는데 추적 중인 파일(이름만 적고 열지 않음):
       - server/data/state.json.pre-audit-cleanup
       - server/data/state.json.pre-final-audit
       - server/data/relay-desk-report-for-astra.txt (수정됨)
       - server/data/relay-desk-report-manifest.json (수정됨)
     - 고객 자료로 보이는데 .gitignore에 안 걸리는 추적 안 된 파일(이름만):
       - server/data/state.before-*.json 여러 개 (예: state.before-kimgeunguk-9900-*.json)
       - server/data/astra-chat.json
       - server/data/case-study-log.json
       - outputs/astra-kimgukeun-20260917/
       - 이 파일들은 "git add ."를 하면 들어간다.
     - 33분 건 영상·SRT는 저장소 밖(C:\RelayDeskTools\samples)에 있다. 전사·검사 결과는 server/data/transcripts/(무시 대상)에만 있다.
  3. 설정값(키 안 읽음): finalGrade.mode=manual, spendControls.automaticPaidQuotesPaused=true, production.provider=hold
  4. services/subtitle.json channels.fiverr.enabled=false
- 바꾼 파일: docs/progress.md (이 칸)
- 백업: backups/progress.md.pre-dev2-20260923.bak
- run-all: 전체 65개 중 65개 통과, 실패 없음. PC(win32, Node v24.21.0)에서 /api/admin/run-tests로 1회 실행, 116초.
- 외부 발송·유료 API 호출·설치: 없음 (이번 실행)
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제:
  - decisions.md와 대조: finalGrade manual·자동 유료 차단 true·fiverr.enabled false는 같다. production.provider=hold는 decisions.md에 항목이 없다. 값은 고치지 않았다.
  - decisions.md 8번 "고객 자료를 저장소 밖으로 보내지 않음"과 관련해 알린다. 오늘 33분 건 130~400초의 한국어 자막·프랑스어 전사 글자를 Jev(외부)로 보냈다(156건). 준희가 이 건만 명시해서 승인한 것이고, 이름은 가렸다.
  - 정확한 git status가 필요하면 PC 셸이 있는 방이 git status --short를 한 번 돌려야 한다.
  - [33분 내용 밀림] 원인은 확인됐다. 자막 시각은 말에 맞고, 한국어 문장이 구간별로 "한 칸 앞섬"이다(150초 첫 이상, 178~218·331~351·370~380초).
    - 관련 파일: server/transcribe/jev-probe.js, timing-align.js
    - 관련 테스트: jev-probe.cjs·timing-align.cjs, run-all 통과
    - 두 단계 검사(시각 맞춤 + Jev 대조)는 제안만 했고, 준희 결정을 기다린다.

## 2026-09-23 11:56 · 개발방(Cowork claude-04) · next-dev.md
- 한 일:
  - next-dev.md를 받기 전, 같은 날 준희 지시로 이미 코드를 고친 상태였다. 그래서 이 기록은 "고치기 전 기준선"이 아니라 "그 변경들이 들어간 뒤의 현재 상태"다.
  - 오늘 이 방이 한 코드 작업:
    - 싱크 검사 교체(S-1)
    - PC에서 run-all 돌리는 관리자 경로(/api/admin/run-tests)
    - 전사 모델 고르기·용어 목록(S-2)
    - 시각 맞춤(timing-align)
    - 33분 건 블록표·Jev 내용 대조(jev-probe)
  - 문서 작업: docs/decisions-sources-20260923.md 새로 작성(항목마다 날짜·출처를 붙인 대조본). docs/decisions.md는 "준희만 바꾼다"고 적혀 있어 건드리지 않았다.
  - 설정값 읽기(키 없음): finalGrade.mode=manual / spendControls.automaticPaidQuotesPaused=true / production.provider=hold / services/subtitle.json channels.fiverr.enabled=false
  - decisions.md와 대조: finalGrade manual·자동 유료 차단 true는 같다. production.provider는 decisions.md에 항목이 없다(9/23 진찰 P7 "hold 이유 확인·준희 결정" 미결).
  - git status·git log: **실행 못 함.** 이 방에는 준희 PC 셸이 없다(파일 읽기·쓰기와 서버 HTTP만 가능). 커밋 안 된 변경 목록과 고객 자료 추적 여부는 셸이 있는 방이 확인해야 한다. 참고로 .gitignore에 server/storage/*, server/data/transcripts/가 들어 있다.
- 바꾼 파일(오늘 이 방, next-dev.md 이전 준희 지시분 포함):
  - checks/sync_drift.js
  - server/relay-server.js (관리자 경로 추가만): /api/admin/t5-sample, burn-in, sync-check, timing-check, run-tests, jev-pair-probe, transcribe·subtitle-draft의 threads/model/terms 인자
  - server/transcribe/index.js, pipeline.js, transcribe.py, t5-tools.js, timing-align.js(새), jev-probe.js(새)
  - server/config/astra-relay-operating-policy.json (transcribe.modelDirs 추가만)
  - tests: sync-drift-v3.cjs, timing-align.cjs, transcribe-terms.cjs, jev-probe.cjs, t5-tools.cjs, run-all.cjs(줄 추가), fixtures/sync-v3/
  - docs/decisions-sources-20260923.md(새), docs/progress.md(이 칸)
- 백업:
  - backups/s2-20260923/
  - backups/jevprobe-20260923/
  - backups/*.pre-sync3.bak, *.pre-s1.bak, *.pre-33.bak, *.pre-timing.bak, *.pre-runtests.bak
  - backups/progress.md.pre-dev-20260923.bak
- run-all: 전체 65개 중 65개 통과, 실패 없음. PC(win32, Node v24.21.0)에서 /api/admin/run-tests로 1회 실행, 115초. 11:5x 결과.
- 외부 발송·유료 API 호출·설치:
  - Jev 호출 있음: 33분 건 130~400초, 156건, 57,255토큰, 약 3.61원. 준희 승인분이고, 글자만 보냈으며 이름은 가림.
  - 위키미디어 공개 샘플 2개 내려받음(9/22, 준희 승인).
  - 설치는 없음. medium 모델 설치 명령은 아직 드리지 않음.
- 가격·문구·수정 횟수·납기 변경: 없음
- 멈춘 이유 또는 남은 문제:
  - [33분 내용 밀림] 시각 맞춤으로는 0.00초(자막 시각은 말에 맞음) → Jev 대조로 내용 밀림 확인. "한 칸 늦음"이 아니라 "한 칸 앞섬"이 구간별로 나타난다.
    - 150초 첫 이상, 178~218초, 331~351초, 370~380초
    - 결과 문서: 프로젝트 claude/33분-실거래-시각맞춤-결과-20260923.md
    - 관련 파일: server/transcribe/jev-probe.js, timing-align.js
    - 관련 테스트 jev-probe.cjs·timing-align.cjs는 run-all 통과
  - 두 단계 검사(시각 맞춤 + Jev 대조) 방안은 제안만 하고 미실행. 준희 결정 대기.
  - S-2 medium 비교는 준희의 설치 대기. 용어 목록 small 시험은 hotwords 1회 완료, prompt 방식 1회는 중간에 끊겨 다시 해야 한다.
  - S-3(번인 자막 위치)은 미착수.
  - 감독방에 직접 알리지 못했다. 지금 이 PC에서 도는 다른 세션이 없다고 나온다. 이 칸으로 알림을 대신한다.

## 2026-09-23 11:51 · 해외 채널방 · (next-global.md 없음 — 준희 메시지대로 실행)
- 한 일: 파이버 등록 체크리스트 작성. 초안 싱크 문구 7곳 "블록마다"→"처음부터 끝까지"로 수정. 받는 언어(영어·프랑스어)와 등록 보류 표시는 감독방이 이미 반영해서 확인만 함. 업워크 공식 API 조사(키 발급 조건: 누적 거래 $25,000·작업 성공 점수 90% → 지금은 불가) 후 결정대로 보류
- 바꾼 파일: docs/global/fiverr-gig-draft.md, docs/global/fiverr-listing-checklist.md(새 파일), docs/progress.md
- 백업: backups/fiverr-gig-draft.md.pre-sync-wording.bak, backups/progress.md.pre-global-20260923.bak
- run-all: 실행 안 함(문서만 바뀜, 이 방에서는 준희 PC 셸 없음)
- 외부 발송·유료 API 호출·설치: 없음 (업워크 메일은 읽기만 함, 링크는 누르지 않음)
- 가격·문구·수정 횟수·납기 변경: 가격·수정 횟수·납기는 없음 / 싱크 문구만 바꿈
- 멈춘 이유 또는 남은 문제: 파이버 등록은 번역 자막 내용 밀림 확인(개발방)이 끝날 때까지 보류. 대표 이미지 미준비. 업워크는 파이버 첫 판매 전까지 보류




