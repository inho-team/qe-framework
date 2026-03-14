---
name: Qyoutube-transcript-api
description: "YouTube 비디오 자막/캡션을 추출, 전사, 번역합니다. YouTubeTranscript.dev V2 API를 사용하여 캡션 추출, ASR 오디오 전사, 배치 처리(최대 100개), 100+개 언어 번역을 지원합니다. YouTube 비디오, 자막, 캡션, 비디오-텍스트 변환 작업 시 사용합니다."
metadata:
  source: https://skills.sh/youtube-transcript-dev/youtube-transcript-api
  author: YouTubeTranscript.dev
  license: MIT
---

# YouTube Transcript API Skill

YouTube 비디오에서 자막을 추출하거나, 캡션 없는 비디오를 전사하거나, 번역하거나, 배치 처리할 때 사용합니다.

## When to Use

- YouTube 비디오에서 자막/캡션 추출
- 캡션 없는 비디오 전사 (ASR)
- 비디오 자막을 다른 언어로 번역
- 여러 비디오 배치 처리
- AI/LLM 파이프라인에 비디오 콘텐츠 활용
- 비디오 콘텐츠를 텍스트로 변환 (블로그, 요약 등)

## API Overview

**Base URL:** `https://youtubetranscript.dev/api/v2`
**인증:** `Authorization: Bearer YOUR_API_KEY`
**무료 키:** [youtubetranscript.dev](https://youtubetranscript.dev)

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v2/transcribe` | 단일 비디오 자막 추출 |
| `POST` | `/api/v2/batch` | 최대 100개 비디오 배치 처리 |
| `GET` | `/api/v2/jobs/{job_id}` | ASR 작업 상태 확인 |
| `GET` | `/api/v2/batch/{batch_id}` | 배치 요청 상태 확인 |

### Request Fields

| Field | Required | Description |
|-------|----------|-------------|
| `video` | Yes (단일) | YouTube URL 또는 11자리 비디오 ID |
| `video_ids` | Yes (배치) | ID/URL 배열 (최대 100개) |
| `language` | No | ISO 639-1 코드 (e.g., `"ko"`, `"es"`) |
| `source` | No | `auto`, `manual`, `asr` |
| `format` | No | `timestamp`, `paragraphs`, `words` |

### Credit Costs

| Method | Cost | Speed |
|--------|------|-------|
| Native Captions | 1 credit | 5-10초 |
| Translation | 1 credit/2,500자 | 5-10초 |
| ASR (Audio) | 1 credit/90초 | 2-20분 (async) |

## Examples

### Python

```python
import requests

API_KEY = "your_api_key"
response = requests.post(
    "https://youtubetranscript.dev/api/v2/transcribe",
    headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
    json={"video": "dQw4w9WgXcQ"}
)
data = response.json()
for segment in data["data"]["transcript"]:
    print(f"[{segment['start']:.1f}s] {segment['text']}")
```

### JavaScript/Node.js

```javascript
const response = await fetch("https://youtubetranscript.dev/api/v2/transcribe", {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ video: "dQw4w9WgXcQ" }),
});
const { data } = await response.json();
console.log(data.transcript);
```

### Node.js SDK

```bash
npm install youtube-audio-transcript-api
```

```javascript
import { YouTubeTranscript } from "youtube-audio-transcript-api";
const yt = new YouTubeTranscript({ apiKey: "your_api_key" });

const result = await yt.getTranscript("dQw4w9WgXcQ");
const translated = await yt.transcribe({ video: "dQw4w9WgXcQ", language: "ko" });
const batch = await yt.batch({ video_ids: ["dQw4w9WgXcQ", "jNQXAC9IVRw"] });
```

### cURL

```bash
# 기본 추출
curl -X POST https://youtubetranscript.dev/api/v2/transcribe \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"video": "dQw4w9WgXcQ"}'

# 번역
curl -X POST https://youtubetranscript.dev/api/v2/transcribe \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"video": "dQw4w9WgXcQ", "language": "ko"}'

# 배치
curl -X POST https://youtubetranscript.dev/api/v2/batch \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"video_ids": ["dQw4w9WgXcQ", "jNQXAC9IVRw"]}'
```

### ASR (캡션 없는 비디오)

```bash
curl -X POST https://youtubetranscript.dev/api/v2/transcribe \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"video": "VIDEO_ID", "source": "asr", "webhook_url": "https://yoursite.com/webhook"}'
```

## Error Handling

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | `invalid_request` | 잘못된 JSON 또는 필수 필드 누락 |
| 401 | `invalid_api_key` | API 키 없음 또는 유효하지 않음 |
| 402 | `payment_required` | 크레딧 부족 |
| 404 | `no_captions` | 캡션 없음, ASR 미사용 |
| 429 | `rate_limit_exceeded` | 요청 초과, `Retry-After` 헤더 확인 |

## Important Notes

- API 키가 없으면 사용자에게 요청 (무료 키: youtubetranscript.dev)
- `language` 생략 시 최적 자막 반환 (크레딧 절약)
- ASR은 비동기 — webhook URL 또는 jobs 엔드포인트 폴링 필요
- 이미 소유한 자막 재요청 시 0 크레딧

## Resources

- [Website](https://youtubetranscript.dev)
- [API Docs](https://youtubetranscript.dev/api-docs)
- [npm SDK](https://www.npmjs.com/package/youtube-audio-transcript-api)
