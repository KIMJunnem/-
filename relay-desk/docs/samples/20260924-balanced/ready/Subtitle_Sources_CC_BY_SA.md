# Swan 자막 샘플 수정본 v2

기존 파일과 구별되도록 영상과 SRT 이름에 v2를 넣었습니다. 각 60초, 1080×1920, 30fps입니다.

## 이번 수정
- 이전 영상은 음성이 자막·영상에 비해 약 1.95초 먼저 재생됐습니다. 원본 WebM의 오디오 시간 단위를 변환하는 과정에서 지연 구간의 타임스탬프가 잘못 반영됐습니다.
- 음성 지연을 2초로 명시하고, 오디오 타임베이스와 PTS를 샘플 수 기준으로 다시 만들었습니다.
- 수정 후 최종 MP4에서 직접 음성을 추출해 원본과 앞·중간·뒤 파형을 비교했습니다. 12개 지점 모두 예상 위치와 0.05초 이내 일치했습니다. 이는 렌더링 시간축 검사이며 단어별 전사 오차가 0이라는 뜻은 아닙니다.
- 기존 검사는 SRT와 원본 전사만 비교하여 최종 인코딩 오류를 놓쳤습니다. 이번에는 실제 MP4의 음성 검사를 추가했습니다.
- 한국어 원본을 Hanbid 인터뷰로 교체하고 긴 쉼을 줄였습니다. 프랑스어·일본어·중국어의 영상 화면과 번역 자막 내용은 유지했습니다.
- Relay Desk의 자막 검사 7종 × 4편 통과. 60초 길이와 전체 디코딩 통과. 검증 내역은 quality-results.json 및 render-sync-verification.json에 있습니다.
- 유료 API 호출 없음. 한국어 원문 전사는 로컬 Whisper medium을 사용했습니다.

## 게시 시 함께 표시할 출처
원본은 저작권이 없는 영상이 아니라 상업적 재사용이 허용된 CC BY-SA 4.0 자료입니다.
원 제작자·원본 링크·라이선스·편집 사실을 함께 표시하고, 편집본에도 CC BY-SA 4.0을 적용합니다.
영상의 출처 화면과 아래 원본 정보를 유지하세요. 원 제작자의 Swan 추천이나 실제 고객 의뢰를 의미하지 않는 자체 편집 샘플입니다.
Swan 워터마크는 자막·편집 작업을 표시합니다.
폰트는 앞선 3종 비교에서 선택한 Pretendard를 유지했습니다.

## 한국어 → 한국어
- 원본: [Hanbid speaking Korean](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Hanbid_speaking_Korean.webm)
- 제작자: Wikitongues / Teddy Nee
- 원본 발췌 구간: [[7.2, 9.35], [10.65, 20.65], [22.13, 26.33], [28.08, 48.96], [51.5, 66.85]]
- 출처·라이선스: CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/
- 변경: 발췌 편집, 한국어 자막, 세로 화면, Swan 워터마크, 싱크 재조정
- 참고: 한국어 인터뷰 · 긴 쉼을 줄인 발췌 편집

## 프랑스어 → 한국어
- 원본: [Maxime speaking Québecois French](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Maxime_speaking_Qu%C3%A9becois_French.webm)
- 제작자: Wikitongues / Maxime Rioux
- 원본 발췌 구간: [[19.15, 73.25]]
- 출처·라이선스: CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/
- 변경: 발췌 편집, 한국어 자막, 세로 화면, Swan 워터마크, 싱크 재조정
- 참고: 퀘벡 프랑스어 · 여행 이야기 발췌

## 일본어 → 한국어
- 원본: [Emoji](https://commons.wikimedia.org/wiki/File:Emoji.webm)
- 제작자: Simpleshow Japan
- 원본 발췌 구간: [[2.3, 54.2]]
- 출처·라이선스: CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/
- 변경: 발췌 편집, 한국어 자막, 세로 화면, Swan 워터마크, 싱크 재조정
- 참고: 이모지 설명 영상 발췌

## 중국어 → 한국어
- 원본: [Ying speaking Henan Chinese](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Ying_speaking_Henan_Chinese.webm)
- 제작자: Wikitongues / Ying Li
- 원본 발췌 구간: [[6.54, 57.65]]
- 출처·라이선스: CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/
- 변경: 발췌 편집, 한국어 자막, 세로 화면, Swan 워터마크, 싱크 재조정
- 참고: 중국어 허난 지역어 · 고향 이야기
