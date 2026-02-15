# Dual AI Pipeline Architecture

## Overview

The backend uses a **dual AI pipeline** with strict separation between OpenAI and Gemini services:

- **OpenAI**: Used ONLY for transcription tasks (audio/video)
- **Gemini**: Used ONLY for compliance analysis and final output
- **Flow**: OpenAI transcribes → Transcript passed to Gemini → Gemini analyzes

## API Key Separation

### Environment Variables

```env
# OpenAI - For transcription ONLY
OPENAI_API_KEY=YOUR_OPENAI_API_KEY

# Gemini/Vertex AI - For compliance analysis ONLY
GOOGLE_VERTEX_PROJECT=your-project-id
GOOGLE_VERTEX_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS_JSON=your-service-account-json
```

### Rules

1. **NEVER mix API keys** between services
2. **OpenAI key** is ONLY used in `transcriptService.js`
3. **Gemini credentials** are ONLY used in `aiAuditService.js`
4. Keys are validated separately in `config/aiConfig.js`

## Service Architecture

### 1. Transcription Service (`services/transcriptService.js`)

**Purpose**: Convert audio/video to text

**Uses**: OpenAI Whisper API

**API Key**: `OPENAI_API_KEY`

**Input**: Audio/Video buffer
**Output**: Text transcript

```javascript
// Example usage
const transcript = await transcribeAudio(audioBuffer, mimetype);
// Returns: "This medicine cures all diseases instantly!"
```

### 2. AI Audit Service (`services/aiAuditService.js`)

**Purpose**: Analyze content for compliance violations

**Uses**: Gemini/Vertex AI models

**API Key**: `GOOGLE_VERTEX_PROJECT` + Service Account

**Input**: Text content (including transcripts from OpenAI)
**Output**: Compliance analysis with violations

```javascript
// Example usage
const auditResult = await performAudit(transcript, scanType, contentType);
// Returns: { complianceScore, violations, modelUsed }
```

### 3. Content Processor (`services/contentProcessor.js`)

**Purpose**: Orchestrates the dual AI pipeline

**Flow**:
1. Detect content type
2. If audio/video → Use OpenAI for transcription
3. Pass transcript to Gemini for compliance analysis
4. Return combined result

```javascript
// Audio processing flow
Audio File → OpenAI Transcription → Gemini Compliance Analysis → Result

// Video processing flow  
Video File → OpenAI Transcription → Gemini Compliance Analysis → Result

// Text/URL/Image processing flow
Content → Gemini Compliance Analysis → Result
```

## Processing Pipeline

### Audio Processing

```
1. Audio file uploaded
2. transcriptService.transcribeAudio() [OpenAI]
   └─> Returns: "Spoken text from audio"
3. contentProcessor passes transcript to performAudit() [Gemini]
   └─> Returns: Compliance analysis
4. Combined result returned
```

### Video Processing

```
1. Video file uploaded
2. transcriptService.transcribeVideo() [OpenAI]
   └─> Returns: "Spoken text from video"
3. contentProcessor passes transcript to performAudit() [Gemini]
   └─> Returns: Compliance analysis
4. Combined result returned
```

### Text/URL/Image Processing

```
1. Content provided
2. contentProcessor directly calls performAudit() [Gemini]
   └─> Returns: Compliance analysis
3. Result returned
```

## Code Structure

### File Organization

```
server/
├── config/
│   └── aiConfig.js          # API key validation & separation
├── services/
│   ├── transcriptService.js # OpenAI transcription (ONLY)
│   ├── aiAuditService.js    # Gemini compliance (ONLY)
│   └── contentProcessor.js  # Pipeline orchestration
```

### Key Functions

**transcriptService.js**:
- `transcribeAudio()` - Uses OpenAI Whisper
- `transcribeVideo()` - Uses OpenAI Whisper
- Uses: `OPENAI_API_KEY` only

**aiAuditService.js**:
- `performAudit()` - Uses Gemini models
- `performMultimodalAudit()` - Uses Gemini for images
- Uses: `GOOGLE_VERTEX_PROJECT` only

**contentProcessor.js**:
- `processContent()` - Main orchestrator
- Routes to appropriate service based on content type
- Ensures transcript flows from OpenAI → Gemini

## Validation

The `config/aiConfig.js` module validates:

1. Both API keys are set
2. Keys are different (no mixing)
3. Proper configuration for each service

```javascript
import { validateAISeparation } from './config/aiConfig.js';

// Validates separation on startup
const config = validateAISeparation();
// Returns: { openaiConfigured: true, geminiConfigured: true }
```

## Error Handling

### OpenAI Errors

- Missing `OPENAI_API_KEY` → Transcription fails
- Invalid API key → Clear error message
- File size exceeded → Specific limit message

### Gemini Errors

- Missing `GOOGLE_VERTEX_PROJECT` → Analysis fails
- Invalid credentials → Clear error message
- Model unavailable → Fallback handling

## Benefits

1. **Specialized Services**: Each AI optimized for its task
2. **Cost Efficiency**: Use best tool for each job
3. **Reliability**: Separation prevents cross-contamination
4. **Maintainability**: Clear boundaries between services
5. **Security**: API keys never mixed

## Testing

### Test Transcription (OpenAI)

```bash
curl -X POST http://localhost:3001/api/analyze \
  -F "file=@audio.mp3" \
  -F "inputType=Audio"
```

### Test Compliance Analysis (Gemini)

```bash
curl -X POST http://localhost:3001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"text":"This cures all diseases!","inputType":"Text"}'
```

### Test Full Pipeline (OpenAI → Gemini)

```bash
curl -X POST http://localhost:3001/api/analyze \
  -F "file=@video.mp4" \
  -F "inputType=Video"
```

## Troubleshooting

### "OPENAI_API_KEY is not set"
- Add `OPENAI_API_KEY=sk-...` to `.env`
- Required for audio/video transcription

### "GOOGLE_VERTEX_PROJECT is not set"
- Add `GOOGLE_VERTEX_PROJECT=...` to `.env`
- Required for compliance analysis

### "API keys must be different"
- Ensure OpenAI and Gemini keys are different
- Never reuse keys between services

