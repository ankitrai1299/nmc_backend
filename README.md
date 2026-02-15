# NEXTCOMPLY AI Compliance Auditor - Backend

Production-ready Node.js + Express + MongoDB + Vertex AI backend for healthcare advertisement compliance auditing.

## Features

- **Multi-format Input Support**: Text, URL, Image, Video, Audio
- **Intelligent Processing Pipeline**: Automatic content type detection and processing
- **Model Routing**: Fast Scan (flash), Advanced (pro), Deep Reason (pro-thinking)
- **Comprehensive Compliance Auditing**: Based on Indian regulatory laws
- **MongoDB Storage**: Persistent audit history with structured schema
- **Production Ready**: Error handling, validation, security measures

## Architecture

```
server/
├── config/
│   └── database.js          # MongoDB connection singleton
├── controllers/
│   └── auditController.js   # Request handlers
├── models/
│   └── AuditRecord.js       # MongoDB schema
├── routes/
│   └── auditRoutes.js       # API route definitions
├── services/
│   ├── aiAuditService.js    # AI compliance auditing
│   ├── contentProcessor.js  # Content processing pipeline
│   ├── modelRouter.js       # Model selection logic
│   ├── scrapingService.js   # URL content extraction
│   └── transcriptService.js # Audio/video transcription
├── utils/
│   └── validators.js        # Input validation utilities
└── server.js                # Express app entry point
```

## Setup

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Environment Configuration

Create a `.env` file in the `server/` directory:

```env
# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/satark-ai-compliance

# OpenAI Configuration (for transcription ONLY)
OPENAI_API_KEY=YOUR_OPENAI_API_KEY

# Google Vertex AI Configuration (for compliance analysis ONLY)
GOOGLE_VERTEX_PROJECT=your-project-id
GOOGLE_VERTEX_LOCATION=us-central1

# Google Application Credentials
GOOGLE_APPLICATION_CREDENTIALS_JSON=your-service-account-json

# Server Configuration
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

**Important**: 
- `OPENAI_API_KEY` is used ONLY for transcription (audio/video)
- `GOOGLE_VERTEX_PROJECT` is used ONLY for compliance analysis
- Never mix API keys between services

### 3. Start MongoDB

Ensure MongoDB is running locally or use a cloud instance (MongoDB Atlas).

### 4. Run the Server

```bash
npm start
# or for development with auto-reload
npm run dev
```

## API Endpoints

### POST /api/audit

Create a new compliance audit.

**Request Body (multipart/form-data or JSON):**

```json
{
  "text": "Optional text content",
  "url": "Optional URL to scrape",
  "scanType": "advanced" // "fast-scan" | "advanced" | "deep-reason"
}
```

**With File Upload (multipart/form-data):**
- `file`: Image, audio, or video file
- `scanType`: Optional scan type

**Response:**

```json
{
  "success": true,
  "data": {
    "auditId": "507f1f77bcf86cd799439011",
    "contentType": "text",
    "complianceScore": 75,
    "violations": [
      {
        "severity": "High",
        "regulation": "Drugs and Magic Remedies Act 1954",
        "violation_title": "Unsubstantiated Health Claim",
        "evidence": "Direct quote from content",
        "translation": "English translation if applicable",
        "guidance": ["Guidance point 1", "Guidance point 2"],
        "fix": ["Fix suggestion 1", "Compliant rewrite"],
        "risk_score": 85
      }
    ],
    "modelUsed": "gemini-1.5-pro",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### GET /api/history

Get audit history with pagination.

**Query Parameters:**
- `limit`: Number of results (default: 50)
- `skip`: Number of results to skip (default: 0)
- `contentType`: Filter by content type (optional)

**Response:**

```json
{
  "success": true,
  "data": {
    "audits": [...],
    "pagination": {
      "total": 100,
      "limit": 50,
      "skip": 0,
      "hasMore": true
    }
  }
}
```

### GET /api/audit/:id

Get a specific audit by ID.

**Response:**

```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "contentType": "text",
    "originalInput": "...",
    "extractedText": "...",
    "transcript": "",
    "modelUsed": "gemini-1.5-pro",
    "auditFindings": [...],
    "complianceScore": 75,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## Processing Pipeline

### Content Type Detection

The system automatically detects content type from input:
- **Text**: Direct string input
- **URL**: Webpage URL
- **Image**: Image file (JPEG, PNG, GIF, WebP)
- **Video**: Video file (MP4, WebM, QuickTime)
- **Audio**: Audio file (MP3, WAV, WebM, OGG)

### Processing Flow

1. **Text** → Direct audit
2. **URL** → Scrape → Extract text → Audit
3. **Image** → Multimodal Gemini → Extract text + Audit
4. **Audio** → Transcribe → Audit
5. **Video** → Extract audio → Transcribe → Audit

### Model Routing

- **Fast Scan** (`fast-scan`): `gemini-1.5-flash` - Quick analysis
- **Advanced** (`advanced`): `gemini-1.5-pro` - Standard analysis
- **Deep Reason** (`deep-reason`): `gemini-1.5-pro` - Thorough analysis

## Compliance Regulations

The system audits against:

- Drugs and Magic Remedies Act 1954
- Drugs and Cosmetics Act 1940
- FSSAI Advertising Regulations 2018
- Consumer Protection Act 2019
- CCPA Misleading Ads Guidelines 2022
- ASCI Code + Healthcare + Influencer Guidelines
- UCPMP 2024
- Medical Device Promotion Norms
- Digital Personal Data Protection Act 2023
- IT Intermediary Rules 2021
- MeitY AI Advisories

## Database Schema

### AuditRecord

```javascript
{
  contentType: String,        // 'text' | 'url' | 'image' | 'video' | 'audio'
  originalInput: String,      // Original input content
  extractedText: String,       // Extracted/processed text
  transcript: String,          // Audio/video transcript
  modelUsed: String,          // Gemini model used
  auditFindings: [Violation],  // Array of violations
  complianceScore: Number,    // 0-100
  createdAt: Date
}
```

### Violation

```javascript
{
  severity: String,           // 'Critical' | 'High' | 'Medium' | 'Low'
  regulation: String,         // Regulation name
  violation_title: String,    // Violation title
  evidence: String,           // Direct quote from content
  translation: String,        // Translation if applicable
  guidance: [String],         // Minimum 2 guidance points
  fix: [String],             // Minimum 2 fix points (includes compliant rewrite)
  risk_score: Number         // 0-100
}
```

## Security Features

- Input size validation (text: 100KB, images: 20MB)
- File type validation
- Content sanitization for scraped data
- Request timeout limits
- CORS configuration
- Error handling and logging

## Optimization

- Reused AI client instances
- Async processing pipeline
- Streaming responses for large content (>5KB)
- Token usage minimization (sends only extracted claims)
- MongoDB indexing for faster queries

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message"
}
```

## Development

### Project Structure

The backend follows a modular architecture:
- **Controllers**: Handle HTTP requests/responses
- **Services**: Business logic and external integrations
- **Models**: Database schemas
- **Routes**: API route definitions
- **Config**: Configuration files
- **Utils**: Utility functions

### Adding New Features

1. Add service in `services/`
2. Add controller method in `controllers/`
3. Add route in `routes/`
4. Update model if needed in `models/`

## License

Proprietary - NEXTCOMPLY AI Compliance Auditor

