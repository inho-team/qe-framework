---
name: Qyoutube-transcript-api
description: "Extracts, transcribes, and translates YouTube video subtitles/captions. Uses the YouTubeTranscript.dev V2 API for caption extraction, ASR audio transcription, batch processing (up to 100 videos), and translation into 100+ languages. Use for tasks involving YouTube videos, subtitles, captions, or video-to-text conversion."
metadata:
  source: https://skills.sh/youtube-transcript-dev/youtube-transcript-api
  author: YouTubeTranscript.dev
  license: MIT
---
> Shared principles: see core/PRINCIPLES.md


# YouTube Transcript API Skill

Use when extracting subtitles from YouTube videos, transcribing videos without captions, translating, or batch processing.

## When to Use

- Extract subtitles/captions from YouTube videos
- Transcribe videos without captions (ASR)
- Translate video subtitles to another language
- Batch process multiple videos
- Feed video content into AI/LLM pipelines
- Convert video content to text (blog posts, summaries, etc.)

## API Overview

**Base URL:** `https://youtubetranscript.dev/api/v2`
**Auth:** `Authorization: Bearer YOUR_API_KEY`
**Free key:** [youtubetranscript.dev](https://youtubetranscript.dev)

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v2/transcribe` | Extract subtitles from a single video |
| `POST` | `/api/v2/batch` | Batch process up to 100 videos |
| `GET` | `/api/v2/jobs/{job_id}` | Check ASR job status |
| `GET` | `/api/v2/batch/{batch_id}` | Check batch request status |

### Request Fields

| Field | Required | Description |
|-------|----------|-------------|
| `video` | Yes (single) | YouTube URL or 11-character video ID |
| `video_ids` | Yes (batch) | Array of IDs/URLs (max 100) |
| `language` | No | ISO 639-1 code (e.g., `"ko"`, `"es"`) |
| `source` | No | `auto`, `manual`, `asr` |
| `format` | No | `timestamp`, `paragraphs`, `words` |

### Credit Costs

| Method | Cost | Speed |
|--------|------|-------|
| Native Captions | 1 credit | 5-10s |
| Translation | 1 credit/2,500 chars | 5-10s |
| ASR (Audio) | 1 credit/90s | 2-20 min (async) |

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
# Basic extraction
curl -X POST https://youtubetranscript.dev/api/v2/transcribe \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"video": "dQw4w9WgXcQ"}'

# Translation
curl -X POST https://youtubetranscript.dev/api/v2/transcribe \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"video": "dQw4w9WgXcQ", "language": "ko"}'

# Batch
curl -X POST https://youtubetranscript.dev/api/v2/batch \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"video_ids": ["dQw4w9WgXcQ", "jNQXAC9IVRw"]}'
```

### ASR (Videos Without Captions)

```bash
curl -X POST https://youtubetranscript.dev/api/v2/transcribe \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"video": "VIDEO_ID", "source": "asr", "webhook_url": "https://yoursite.com/webhook"}'
```

## Error Handling

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | `invalid_request` | Malformed JSON or missing required fields |
| 401 | `invalid_api_key` | API key missing or invalid |
| 402 | `payment_required` | Insufficient credits |
| 404 | `no_captions` | No captions found and ASR not used |
| 429 | `rate_limit_exceeded` | Too many requests; check `Retry-After` header |

## Important Notes

- If no API key is available, ask the user to obtain one (free at youtubetranscript.dev)
- Omitting `language` returns the best available captions (saves credits)
- ASR is async — use a webhook URL or poll the jobs endpoint
- Re-requesting captions you already own costs 0 credits

## Resources

- [Website](https://youtubetranscript.dev)
- [API Docs](https://youtubetranscript.dev/api-docs)
- [npm SDK](https://www.npmjs.com/package/youtube-audio-transcript-api)
