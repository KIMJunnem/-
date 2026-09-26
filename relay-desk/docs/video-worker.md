# Relay Desk Video Worker

Relay Desk에서 AI(Astra/Claude)는 편집 결정을 내리고, 실제 미디어 처리는 로컬 FFmpeg/전사기가 수행한다.

## 제공 액션

- `video.inspect`: 길이, 해상도, FPS, 비디오/오디오 코덱 확인
- `video.transcribe`: 기존 로컬 faster-whisper 전사 큐 사용
- `video.cut`: 지정한 구간을 이어 붙여 MP4 생성
- `video.subtitle`: SRT를 영상에 번인
- `video.render`: 해상도 변환, 자막, 음량 정규화, 선택적 BGM 합성
- `video.qc`: ffprobe 메타 검사 + FFmpeg 디코드 스모크 테스트 + 선택적 프레임 추출

## 서버 API

모든 영상 Worker API는 로컬 전용이며 아래 헤더가 필요하다.

```
x-relay-admin: video-worker
```

상태:

```
GET /api/admin/video-worker/status
```

단일 액션:

```json
POST /api/admin/video-worker/run
{
  "action": "video.inspect",
  "payload": {
    "inputPath": "D:/RelayDesk/inbox/customer.mp4"
  }
}
```

편집 계획 실행:

```json
POST /api/admin/video-worker/plan
{
  "steps": [
    {
      "action": "video.inspect",
      "payload": { "inputPath": "D:/RelayDesk/inbox/customer.mp4" }
    },
    {
      "action": "video.cut",
      "payload": {
        "inputPath": "D:/RelayDesk/inbox/customer.mp4",
        "outputPath": "D:/RelayDesk/work/cut.mp4",
        "cuts": [
          { "start": "00:00:03.200", "end": "00:00:08.500" },
          { "start": "00:00:12.100", "end": "00:00:19.000" }
        ]
      }
    },
    {
      "action": "video.render",
      "payload": {
        "inputPath": "D:/RelayDesk/work/cut.mp4",
        "outputPath": "D:/RelayDesk/output/final.mp4",
        "subtitlePath": "D:/RelayDesk/work/final.srt",
        "resolution": "1080x1920",
        "normalizeAudio": true
      }
    },
    {
      "action": "video.qc",
      "payload": {
        "inputPath": "D:/RelayDesk/output/final.mp4",
        "expected": { "resolution": "1080x1920", "hasAudio": true },
        "frameDir": "D:/RelayDesk/output/qc"
      }
    }
  ]
}
```

## CLI

```bash
npm run video:status
npm run video:worker -- video.inspect "{\"inputPath\":\"D:/RelayDesk/inbox/customer.mp4\"}"
npm run video:worker -- plan edit_plan.json
npm run test:video-worker
```

## 역할 분리

AI가 직접 프레임을 편집하지 않는다. AI는 고객 요구를 구조화해 `edit_plan.json`을 만들고, Video Worker가 결정론적으로 실행한다.

고급 생성형 영상이 필요할 경우에는 이후 별도 `video.generate` 어댑터를 추가해 외부 생성 API 결과를 받은 뒤 `video.render` 단계에서 합성한다. CapCut 등 GUI 자동 조작은 기본 경로로 사용하지 않는다.
