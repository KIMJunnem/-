# Codex 교차 검수 및 수정 반영

## Opus 결과
- opus-review.md를 읽고 21초 MP4를 ffmpeg로 전체 디코딩했다. 오류 없음. 영상·음성 각각 21초.
- 4.5초 프레임에서 영어/한국어 비교 배치, 글자 가독성, 출처 표기를 확인했다.
- 한국어 SRT 5개는 순서·중첩·2줄·20자·15CPS 검사 통과. 최고 8.33CPS(공백 포함).
- 번역 11번의 quest/hunter를 여정/사냥꾼으로 복원한 변경은 영어 원문에 부합한다.
- 로컬 small+VAD 전사는 작은 후반 대사 2개를 누락했다. medium+VAD off 재검증에서 후반 대사를 포함한 5개 대사 모두 복원. 원문 스크립트·힌트 미제공, 네트워크와 유료 API 미사용.
- 단어 시각에 조기 시작 등 추정 오차가 있으므로 ASR만으로 정밀 싱크 통과를 주장하지 않는다. 새 타임스탬프를 기존 SRT에 자동 덮어쓰지 않았다.
- 증거: codex/build/opus-independent-asr.json, opus-independent-asr-medium.json, ready/verification.json.
- 공식 Sintel Sharing 페이지 검색 결과에서 CC BY 3.0과 상업적 재사용 조건 확인. 영상 내 출처·변경 표기 유지.

## Opus의 문서·PPT 의견 반영
- DOCX 테마 글꼴·파란 제목 테두리 제거. Pretendard 적용. 자체 원문은 비교 자료로 보존.
- 한국어 단어 중간 줄바꿈: wordWrap 플래그만으로 LibreOffice 렌더는 개선되지 않아 본문을 실제 글꼴 폭 기준 어절 단위 명시 줄바꿈으로 재조판. 수정 문서 2쪽 유지.
- 보고서와 PPT 표시는 swan으로 통일. 원문 제목·문장은 비교를 위해 보존.
- PPT “바로 쓸 수 있는”을 “쓰기 좋은”으로 완화.
- “한국어 SRT 자막”을 “한국어 자막 파일(SRT)”으로 변경하고 외국어 영상의 한국어 번역을 명시.
- PPT에 Pretendard Regular/Bold 포함. 기존 서버 embedder를 재사용했으나 생성기 XML의 r 네임스페이스 선언 범위 차이로 검사가 실패했다. 이 샘플 생성 스크립트에서만 선언을 보완했다. 서버 코드 미수정.
- 최종 PPT 패키지·레이아웃·재가져오기 검사 통과. 증거: codex/build/deck-validation-v3.json.
- 최종 문서: codex/output-v4, 최종 PPT: codex/output-v3. 공개 후보 파일을 ready/에 모았다.
- native Word/PowerPoint 및 스마트폰 직접 검사는 미실시. PDF/JPG 미리보기를 함께 제공한다.

이번 결과는 제작·검수 성과이며 주문·결제 전환 성과가 아니다. 추가 유료 API 비용은 0, 고객 발송·게시 0건.

## 사용자 최종 검수 담당 지정 후 추가 확인
- Codex가 비교 영상 1.00, 4.50, 9.10, 15.00, 19.50, 20.95초 프레임을 직접 확인했다. 5개 자막 항목과 끝 장면을 포함한다.
- 증거 이미지: codex/build/visual-check/all-captions.jpg.
- 확인한 프레임에서 자막 잘림·겹침은 없다. 15초는 화면이 검은 전환 구간이므로 영상 전체가 계속 밝은 장면이라고 설명하지 않는다.
- 하단 출처 문구는 축소 화면에서 작다. 휴대폰 실물 가독성·전체 재생 싱크 검증은 여전히 미실시이며 이번 정지 프레임 확인으로 대체되지 않는다.
- 앞으로 최종 시각 검수는 Codex가 직접 수행한다. 공통 기준: docs/sample-visual-review-policy.md.
