---
name: Qaudio-transcriber
description: Analyzes audio recording files (MP3, WAV, M4A, OGG, FLAC, WEBM) and converts them into professional Markdown documents such as meeting minutes, subtitles, and summaries. Use for requests like "analyze this audio file", "generate meeting minutes", or "convert recording to text".
license: MIT
---
> Shared principles: see core/PRINCIPLES.md


## Purpose

This skill automates audio-to-text transcription with professional Markdown output, extracting rich technical metadata (speakers, timestamps, language, file size, duration) and generating structured meeting minutes and executive summaries. It uses Faster-Whisper or Whisper with zero configuration, working universally across projects without hardcoded paths or API keys.

Inspired by tools like Plaud, this skill transforms raw audio recordings into actionable documentation, making it ideal for meetings, interviews, lectures, and content analysis.

## When to Use

Invoke this skill when:

- User needs to transcribe audio/video files to text
- User wants meeting minutes automatically generated from recordings
- User requires speaker identification (diarization) in conversations
- User needs subtitles/captions (SRT, VTT formats)
- User wants executive summaries of long audio content
- User asks variations of "transcribe this audio", "convert audio to text", "generate meeting notes from recording"
- User has audio files in common formats (MP3, WAV, M4A, OGG, FLAC, WEBM)

## Workflow

### Step 0: Discovery (Auto-detect Transcription Tools)

**Objective:** Identify available transcription engines without user configuration.

**Actions:**

Run detection commands to find installed tools:

```bash
# Check for Faster-Whisper (preferred - 4-5x faster)
if python3 -c "import faster_whisper" 2>/dev/null; then
    TRANSCRIBER="faster-whisper"
    echo "✅ Faster-Whisper detected (optimized)"
# Fallback to original Whisper
elif python3 -c "import whisper" 2>/dev/null; then
    TRANSCRIBER="whisper"
    echo "✅ OpenAI Whisper detected"
else
    TRANSCRIBER="none"
    echo "⚠️  No transcription tool found"
fi

# Check for ffmpeg (audio format conversion)
if command -v ffmpeg &>/dev/null; then
    echo "✅ ffmpeg available (format conversion enabled)"
else
    echo "ℹ️  ffmpeg not found (limited format support)"
fi
```

**If no transcriber found:**

Offer automatic installation using the provided script:

```bash
echo "⚠️  No transcription tool found"
echo ""
echo "🔧 Auto-install dependencies? (Recommended)"
read -p "Run installation script? [Y/n]: " AUTO_INSTALL

if [[ ! "$AUTO_INSTALL" =~ ^[Nn] ]]; then
    pip install faster-whisper
    brew install ffmpeg  # macOS
else
    echo ""
    echo "📦 Manual installation required:"
    echo ""
    echo "Recommended (fastest):"
    echo "  pip install faster-whisper"
    echo ""
    echo "Alternative (original):"
    echo "  pip install openai-whisper"
    echo ""
    echo "Optional (format conversion):"
    echo "  brew install ffmpeg  # macOS"
    echo "  apt install ffmpeg   # Linux"
    echo ""
    exit 1
fi
```

### Step 1: Validate Audio File

**Objective:** Verify file exists, check format, and extract metadata.

**Actions:**

1. **Accept file path or URL** from user:
   - Local file: `meeting.mp3`
   - URL: `https://example.com/audio.mp3` (download to temp directory)

2. **Verify file exists:**

```bash
if [[ ! -f "$AUDIO_FILE" ]]; then
    echo "❌ File not found: $AUDIO_FILE"
    exit 1
fi
```

3. **Extract metadata** using ffprobe or file utilities:

```bash
FILE_SIZE=$(du -h "$AUDIO_FILE" | cut -f1)
DURATION=$(ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "$AUDIO_FILE" 2>/dev/null)
FORMAT=$(ffprobe -v error -select_streams a:0 -show_entries \
    stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$AUDIO_FILE" 2>/dev/null)
DURATION_HMS=$(date -u -r "$DURATION" +%H:%M:%S 2>/dev/null || echo "Unknown")
```

4. **Validate format** (supported: MP3, WAV, M4A, OGG, FLAC, WEBM):

```bash
EXTENSION="${AUDIO_FILE##*.}"
SUPPORTED_FORMATS=("mp3" "wav" "m4a" "ogg" "flac" "webm" "mp4")

if [[ ! " ${SUPPORTED_FORMATS[@]} " =~ " ${EXTENSION,,} " ]]; then
    echo "⚠️  Unsupported format: $EXTENSION"
    if command -v ffmpeg &>/dev/null; then
        echo "🔄 Converting to WAV..."
        ffmpeg -i "$AUDIO_FILE" -ar 16000 "${AUDIO_FILE%.*}.wav" -y
        AUDIO_FILE="${AUDIO_FILE%.*}.wav"
    else
        echo "❌ Install ffmpeg to convert formats: brew install ffmpeg"
        exit 1
    fi
fi
```

### Step 2: Transcribe Audio

Transcribe using detected engine and generate structured Markdown output.

### Step 3: Generate Markdown Output

**Objective:** Create structured Markdown with metadata, transcription, meeting minutes, and summary.

**Output Template:**

```markdown
# Audio Transcription Report

## 📊 Metadata

| Field | Value |
|-------|-------|
| **File Name** | {filename} |
| **File Size** | {file_size} |
| **Duration** | {duration_hms} |
| **Language** | {language} ({language_code}) |
| **Processed Date** | {process_date} |
| **Speakers Identified** | {num_speakers} |
| **Transcription Engine** | {engine} (model: {model}) |


## 📋 Meeting Minutes

### Participants
- {speaker_1}
- {speaker_2}

### Topics Discussed
1. **{topic_1}** ({timestamp})
   - {key_point_1}
   - {key_point_2}

### Decisions Made
- ✅ {decision_1}
- ✅ {decision_2}

### Action Items
- [ ] **{action_1}** - Assigned to: {speaker} - Due: {date_if_mentioned}
- [ ] **{action_2}** - Assigned to: {speaker}


*Generated by Qaudio-transcriber*
*Transcription engine: {engine} | Processing time: {elapsed_time}s*
```

### Step 4: Save Output

```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
TRANSCRIPT_FILE="transcript-${TIMESTAMP}.md"

echo "$TRANSCRIPT_CONTENT" > "$TRANSCRIPT_FILE"
echo "✅ Transcript saved: $TRANSCRIPT_FILE"
```

### Step 5: Display Results Summary

```bash
echo ""
echo "✅ Transcription Complete!"
echo ""
echo "📊 Results:"
echo "  File: $OUTPUT_FILE"
echo "  Language: $LANGUAGE"
echo "  Duration: $DURATION_HMS"
echo "  Speakers: $NUM_SPEAKERS"
echo "  Words: $WORD_COUNT"
echo "  Processing time: ${ELAPSED_TIME}s"
echo ""
echo "🎯 Next steps:"
echo "  1. Review meeting minutes and action items"
echo "  2. Share report with participants"
echo "  3. Track action items to completion"
```

## Error Handling

| Error | Likely Cause | Action |
|-------|-------------|--------|
| Transcription tool not found | faster-whisper/whisper not installed | Auto-install with `pip install faster-whisper` |
| Unsupported audio format | File extension not supported | Convert with ffmpeg automatically |
| File not found | Path is incorrect | Show exact path error; ask user to verify |
| File too large (>1 GB) | Very long recordings | Warn about processing time; offer to split |
| Low quality transcript | Poor audio quality | Report confidence issues |
| ffmpeg not found | ffmpeg not installed | Show install command: `brew install ffmpeg` |

## Example Usage

```
User: Create meeting minutes from meeting-20260311.m4a
User: Convert all recordings/*.mp3 to text
User: Analyze this audio file and summarize it in English
```

Credits: Original skill by @ericgandrade - https://github.com/ericgandrade/claude-superskills
