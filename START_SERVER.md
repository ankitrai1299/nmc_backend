# Starting the Backend Server

## Quick Start

1. **Navigate to server directory:**
   ```bash
   cd server
   ```

2. **Install dependencies (if not already installed):**
   ```bash
   npm install
   ```

3. **Create `.env` file** (if it doesn't exist):
   ```env
   MONGODB_URI=mongodb://localhost:27017/satark-ai-compliance
   GOOGLE_VERTEX_PROJECT=your-project-id
   GOOGLE_VERTEX_LOCATION=us-central1
   GOOGLE_APPLICATION_CREDENTIALS=satark-ai-486508-18a7a7906136.json
   PORT=3001
   ```

4. **Start MongoDB** (if using local MongoDB):
   ```bash
   # Windows (if MongoDB is installed as service, it should already be running)
   # Or start manually:
   mongod
   ```

5. **Start the server:**
   ```bash
   npm start
   ```

## Troubleshooting

### Error: MONGODB_URI is not set
- Create a `.env` file in the `server/` directory
- Add `MONGODB_URI=mongodb://localhost:27017/satark-ai-compliance`
- Or use MongoDB Atlas connection string

### Error: Connection refused
- Make sure MongoDB is running
- Check if the port in MONGODB_URI is correct (default: 27017)
- For MongoDB Atlas, ensure your IP is whitelisted

### Error: GOOGLE_VERTEX_PROJECT is not set
- Add `GOOGLE_VERTEX_PROJECT=your-project-id` to `.env`
- Or use `VERTEX_AI_PROJECT_ID` (for backward compatibility)

### Server won't start on port 3001
- The server automatically finds an available port starting from 3001
- Check the console output for the actual port number
- The frontend will auto-discover the port

### Frontend can't connect
- Make sure the server is running
- Check the console for the actual port number
- The frontend tries ports: 3001, 3002, 3003, 3004, 3005, 5000, 8000, 8080
- Ensure CORS is properly configured (already set up in server.js)

## Verification

Once the server starts, you should see:
```
🚀 NEXTCOMPLY AI Compliance Auditor Backend
==========================================
📍 Server running on port 3001
📍 Backend URL: http://localhost:3001
📦 MongoDB: ✓ Connected
☁️  Vertex AI Project: ✓ Configured
```

Test the health endpoint:
```bash
curl http://localhost:3001/health
```

Test the analyze endpoint:
```bash
curl -X POST http://localhost:3001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"content":"Test text","inputType":"Text","category":"Pharmaceuticals"}'
```

