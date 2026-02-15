# Quick Start Guide

## Prerequisites

1. **Node.js** (v18 or higher)
2. **MongoDB** (local or cloud instance)
3. **Google Cloud Project** with Vertex AI enabled
4. **Service Account** JSON key file

## Setup Steps

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment

Create `.env` file:

```env
MONGODB_URI=mongodb://localhost:27017/satark-ai-compliance
GOOGLE_VERTEX_PROJECT=your-project-id
GOOGLE_VERTEX_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=your-service-account.json
PORT=3001
```

### 3. Start MongoDB

```bash
# Local MongoDB
mongod

# Or use MongoDB Atlas cloud instance
# Update MONGODB_URI in .env
```

### 4. Run Server

```bash
npm start
```

Server will start on `http://localhost:3001`

## Test the API

### Test Text Audit

```bash
curl -X POST http://localhost:3001/api/audit \
  -H "Content-Type: application/json" \
  -d '{
    "text": "This medicine cures all diseases instantly!",
    "scanType": "advanced"
  }'
```

### Test URL Audit

```bash
curl -X POST http://localhost:3001/api/audit \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/health-ad",
    "scanType": "fast-scan"
  }'
```

### Test Image Audit

```bash
curl -X POST http://localhost:3001/api/audit \
  -F "file=@/path/to/image.jpg" \
  -F "scanType=advanced"
```

### Get Audit History

```bash
curl http://localhost:3001/api/history?limit=10
```

## Scan Types

- `fast-scan`: Quick analysis using gemini-1.5-flash
- `advanced`: Standard analysis using gemini-1.5-pro (default)
- `deep-reason`: Thorough analysis using gemini-1.5-pro

## Troubleshooting

### MongoDB Connection Error

- Ensure MongoDB is running
- Check `MONGODB_URI` in `.env`
- Verify network connectivity

### Vertex AI Error

- Verify `GOOGLE_VERTEX_PROJECT` is set
- Check service account credentials file exists
- Ensure Vertex AI API is enabled in GCP project

### File Upload Error

- Check file size (max 100MB)
- Verify file type is supported
- Ensure proper Content-Type header

