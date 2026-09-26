# Video Director Playbook

- ffprobe/FFmpeg/faster-whisper로 메타데이터·전사·프레임을 먼저 만든다.
- 감독 모델은 사용할 장면, 제거 장면, 순서, 자막, 효과, 생성형 컷 필요 여부를 edit_plan으로 결정한다.
- 실제 컷·자막 합성·렌더는 Video Worker가 담당한다.
- 생성형 영상은 기존 원본으로 해결할 수 없는 경우에만 사용한다.
- AI에게 전체 영상을 반복 처리시키지 않는다.
