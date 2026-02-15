# Smart AI Model Router Architecture

## Overview

The backend implements a **Smart AI Model Router** that automatically selects the optimal AI model based on content characteristics, with automatic fallback and cost optimization.

## Key Features

1. **Automatic Model Selection**: Based on input type, size, and complexity
2. **Automatic Fallback**: gemini-1.5-pro-002 → gemini-1.5-flash
3. **Cost Optimization**: Uses cheaper models when appropriate
4. **Token Optimization**: Extracts only claims before sending to Gemini
5. **Never Crashes**: All errors return structured responses
6. **Comprehensive Logging**: Model selection, fallback, processing time

## AI Pipeline Rules

### 1. Transcription Tasks
- **Service**: `transcriptionService.js`
- **Model**: `gpt-4o-transcribe` (OpenAI)
- **Used For**: Audio and video files only
- **Output**: Text transcript

### 2. Compliance Audit Tasks
- **Service**: `auditService.js`
- **Models**: Gemini via Vertex AI
- **Used For**: All content types (text, URL, image, audio transcript, video transcript)
- **Output**: Structured compliance JSON

## Model Routing Logic

### Audio/Video Processing
```
1. OpenAI transcribes audio/video → transcript
2. Router checks transcript length:
   - < 3000 chars → gemini-1.5-flash
   - >= 3000 chars → gemini-1.5-pro-002
3. If pro-002 fails → fallback to flash
```

### Image Processing
```
1. Router selects: gemini-1.5-pro-002 (multimodal)
2. If pro-002 fails → fallback to gemini-1.5-flash
```

### Text/URL Processing
```
1. Router checks content:
   - Short & simple (< 3000 chars) → gemini-1.5-flash
   - Long or complex (>= 10000 chars) → gemini-1.5-pro-002
   - Medium → gemini-1.5-flash (cost optimization)
2. If pro-002 fails → fallback to flash
```

## Automatic Fallback

### Fallback Rules
- **Primary Model Fails**: Automatically tries fallback
- **gemini-1.5-pro-002** → **gemini-1.5-flash**
- **No Fallback Available**: Returns structured error (never crashes)

### Fallback Logging
```
[Audit Service] Primary model gemini-1.5-pro-002 failed: <error>
[Audit Service] Attempting fallback to gemini-1.5-flash
[Audit Service] Fallback successful | Model: gemini-1.5-flash
```

## Token Optimization

### Claims Extraction
Before sending content to Gemini:
1. Check if content length > 2000 characters
2. Extract only marketing/medical claims
3. Reduce token usage by 60-80%

### Claims Patterns
- Health claims: "cure", "treat", "heal", "prevent"
- Medical terms: "medicine", "drug", "treatment", "therapy"
- Effectiveness: "effective", "works", "improves", "boosts"
- Comparisons: "better", "best", "faster", "stronger"
- Numbers: "90% effective", "in 7 days"

## Error Handling

### Structured Error Responses
All errors return structured JSON:
```json
{
  "complianceScore": 0,
  "violations": [],
  "modelUsed": "none",
  "error": "Error type",
  "message": "Error message",
  "processingTime": 1234
}
```

### Never Crashes
- All model calls wrapped in try/catch
- Fallback on primary model failure
- Structured errors on complete failure
- Server continues running

## Logging

### Logged Information
- Selected model and reason
- Fallback usage
- Processing time (per step and total)
- Token optimization (before/after)
- Errors with context

### Example Logs
```
[Model Router] Selected: gemini-1.5-flash | Reason: Short transcript (1234 chars) | Time: 2ms
[Audit Service] Using model: gemini-1.5-flash | Content: 1234 chars
[Audit Service] Extracted claims: 5000 → 1200 chars
[Audit Service] Success | Model: gemini-1.5-flash | Violations: 2 | Time: 1234ms
[Content Processor] Pipeline complete | Total time: 2345ms
```

## Service Architecture

### Services

1. **modelRouter.js**
   - Model selection logic
   - Fallback management
   - Complexity detection

2. **transcriptionService.js**
   - OpenAI transcription
   - Model: gpt-4o-transcribe
   - Error handling

3. **auditService.js**
   - Gemini compliance audit
   - Automatic fallback
   - Token optimization integration

4. **claimsExtractor.js**
   - Claims extraction
   - Token optimization
   - Pattern matching

5. **contentProcessor.js**
   - Pipeline orchestration
   - Service coordination
   - Error aggregation

## Environment Variables

```env
# OpenAI - For transcription only
OPENAI_API_KEY=YOUR_OPENAI_API_KEY

# Gemini/Vertex AI - For compliance analysis
GOOGLE_VERTEX_PROJECT=your-project-id
GOOGLE_VERTEX_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS_JSON=your-service-account-json

# Alternative (if using API key instead of service account)
GOOGLE_API_KEY=your-api-key
```

## Output Format

### Compliance Response
```json
{
  "complianceScore": 75,
  "violations": [
    {
      "severity": "High",
      "regulation": "Drugs and Magic Remedies Act 1954",
      "violation_title": "Unsubstantiated Health Claim",
      "evidence": "Direct quote from content",
      "translation": "English translation if applicable",
      "guidance": ["Guidance 1", "Guidance 2"],
      "fix": ["Fix 1", "Compliant rewrite"],
      "risk_score": 85
    }
  ],
  "modelUsed": "gemini-1.5-flash",
  "usedFallback": false,
  "processingTime": 1234,
  "totalProcessingTime": 2345
}
```

## Benefits

1. **Cost Efficiency**: Uses cheaper models when appropriate
2. **Reliability**: Automatic fallback prevents failures
3. **Performance**: Optimal model selection for each task
4. **Scalability**: Handles various content types and sizes
5. **Maintainability**: Clear separation of concerns
6. **Observability**: Comprehensive logging

## Testing

### Test Short Text (Flash)
```bash
curl -X POST http://localhost:3001/api/audit \
  -H "Content-Type: application/json" \
  -d '{"text":"This medicine cures all diseases!"}'
```

### Test Long Text (Pro)
```bash
curl -X POST http://localhost:3001/api/audit \
  -H "Content-Type: application/json" \
  -d '{"text":"<long text with 5000+ characters>"}'
```

### Test Audio (OpenAI → Gemini)
```bash
curl -X POST http://localhost:3001/api/audit \
  -F "file=@audio.mp3" \
  -F "inputType=Audio"
```

### Test Image (Pro Multimodal)
```bash
curl -X POST http://localhost:3001/api/audit \
  -F "file=@image.jpg" \
  -F "inputType=Image"
```

