# 영상 제작방용 로컬 API 안내 (2026-09-24 개발방 지시 18, decisions 7-6)

- **새로 만든 API는 없다.** 전사·싱크 검사·자막 입히기는 이미 PC 서버(127.0.0.1:8787)에 있다.
  - 이번에 확인한 것: `/api/admin/transcribe/status` 응답이 enabled=true였다. ffmpeg는 `C:\RelayDeskTools\ffmpeg\…\ffmpeg.exe`, 전사는 faster-whisper(small·medium)다.
- **호출은 앱 내장 브라우저에서만 한다.** `http://127.0.0.1:8787` 탭에서 부른다. 다른 곳에서 부르면 403이다(로컬 전용).
- **돈이 들지 않는다.** 유료 API가 없고 외부로 올리는 것도 없다. 영상은 PC 밖으로 나가지 않는다.

## 0. 영상 둘 곳 (허용 폴더만 읽는다)

- 고객 영상은 relay-desk-site 폴더 아래 **`server\storage\video-work\<건 이름>\`**에 둔다. 폴더는 처음 쓸 때 만든다.
- 허용 폴더는 세 곳뿐이다: `server/storage`, `server/data/transcripts`, `C:\RelayDeskTools\samples`. 다른 경로는 `input_not_allowed`로 거절된다.
- 결과(전사 JSON·SRT 초안·싱크 결과·입힌 MP4)는 `server\data\transcripts\` 아래에 저장된다. 이 폴더는 git에 올라가지 않는다.
- 경로는 PC 전체 경로로 적는다. 예: `C:\\Users\\vdfr7\\Documents\\Codex\\relay-desk-site\\server\\storage\\video-work\\A건\\원본.mp4`

## 1. 전사 (말 → 글자·시각, SRT 초안)

```js
window.__tr = null;
fetch('/api/admin/transcribe', { method: 'POST', headers: { 'x-relay-admin': 'transcribe', 'content-type': 'application/json' },
  body: JSON.stringify({ path: '<영상 전체 경로>', language: 'ko', model: 'small' }) })
  .then(r => r.json()).then(j => { window.__tr = j; });
```

- 한 번에 1건만 돈다. 길면 오래 걸린다(33분 영상 기준 수십 분 [추정]).
- 기다리는 동안 `GET /api/admin/transcribe/status`로 확인한다. `running`이 작업 id, `waiting`이 대기 수다.
- 끝나면 `window.__tr`에 `transcriptPath`(전사 JSON)·`srtPath`(SRT 초안)·`jobId`가 들어 있다.
- 외국어 영상은 `language`에 원어를 넣는다(예: `en`, `fr`). 번역은 이 API에 없다(Codex 대화방 경로).
- `model: 'medium'`은 더 정확하지만 더 느리다.

## 2. 싱크 검사 (자막이 어디서부터 밀리는지)

한국어 자막일 때는 글자를 대조한다. 1번의 전사를 기준으로 쓴다.

```js
fetch('/api/admin/sync-check', { method: 'POST', headers: { 'x-relay-admin': 'transcribe', 'content-type': 'application/json' },
  body: JSON.stringify({ srt: '<검사할 SRT 경로>', transcript: '<1번 transcriptPath>', label: 'A건' }) }).then(r => r.json())
```

- 응답에는 판정 숫자만 온다(summary). 자막·전사 글자 전체는 `savedPath` 파일에만 남는다.

번역 자막처럼 글자를 대조할 수 없을 때는 시각으로 맞춘다. 말하는 구간·쉬는 구간과 자막 시각만 본다.

```js
fetch('/api/admin/timing-check', { method: 'POST', headers: { 'x-relay-admin': 'transcribe', 'content-type': 'application/json' },
  body: JSON.stringify({ srt: '<SRT 경로>', media: '<영상 경로>', transcript: '<1번 transcriptPath>' }) }).then(r => r.json())
```

- 응답의 `summary.windows`에서 [시작 블록, 시작 초, 밀림(초), 불확실(초), 일치 점수]를 구간별로 보여 준다.

## 3. 자막 입히기 (MP4 만들기)

```js
fetch('/api/admin/burn-in', { method: 'POST', headers: { 'x-relay-admin': 'transcribe', 'content-type': 'application/json' },
  body: JSON.stringify({ input: '<영상 경로>', srt: '<완성 SRT 경로>' }) }).then(r => r.json())
```

- 결과는 `outputPath`(…\transcripts\burnin-…\burned.mp4)로 온다. 크기·sha256·걸린 시간도 함께 온다.
- 자막 위치는 `position`으로 바꿀 수 있다(tests/burnin-position.cjs 참고). 기본은 아래쪽이다.

## 4. 순서 (영상 편집 한 건)

1. 영상을 `server\storage\video-work\<건>\`에 둔다.
2. 전사(1)를 돌린다.
3. 전사 SRT 초안을 다듬고 컷을 편집한다(영상 제작방 작업).
4. 싱크 검사(2)를 돌리고, 밀린 구간을 고친다.
5. 자막 입히기(3)로 MP4를 만든다.
6. **준희 승인 뒤에만 고객에게 보낸다**(finalGrade manual). 이 API들은 발송하지 않는다.

## 없는 것 (필요하면 개발방 지시로)

- 작업 id로 나중에 결과를 다시 찾는 `GET /api/video/jobs/:id`는 없다. 전사 결과 폴더 이름이 jobId다(`server\data\transcripts\<jobId>\`).
- 영상 길이만 재는 ffprobe API는 없다. 지시 20에서 만든다.
