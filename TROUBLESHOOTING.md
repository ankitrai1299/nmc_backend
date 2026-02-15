# Troubleshooting Guide

## Connection Refused Errors

If you see `ERR_CONNECTION_REFUSED` errors in the frontend:

### 1. Check if the server is running

```bash
# Navigate to server directory
cd server

# Check if server is running
npm start
```

You should see output like:
```
🚀 NEXTCOMPLY AI Compliance Auditor Backend
==========================================
📍 Server running on port 3001
```

### 2. Verify Environment Variables

Create a `.env` file in the `server/` directory with:

```env
MONGODB_URI=mongodb://localhost:27017/satark-ai-compliance
GOOGLE_VERTEX_PROJECT=your-project-id
GOOGLE_VERTEX_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS_JSON=your-service-account-json
PORT=3001
```

### 3. Check MongoDB Connection

The server requires MongoDB to start. Options:

**Option A: Local MongoDB**
```bash
# Start MongoDB (if installed locally)
mongod
```

**Option B: MongoDB Atlas (Cloud)**
- Get connection string from MongoDB Atlas
- Update `MONGODB_URI` in `.env` file
- Format: `mongodb+srv://username:password@cluster.mongodb.net/database`

### 4. Install Dependencies

If you haven't installed dependencies yet:

```bash
cd server
npm install
```

This will install:
- mongoose (MongoDB driver)
- express (web server)
- @google-cloud/vertexai (AI service)
- cheerio (web scraping)
- node-fetch (HTTP client)
- And other required packages

### 5. Check Port Availability

The server automatically finds an available port starting from 3001. If port 3001 is in use, it will try 3002, 3003, etc.

Check the console output to see which port the server is using.

### 6. Test Server Manually

Once the server starts, test it:

```bash
# Health check
curl http://localhost:3001/health

# Should return:
# {"status":"ok","message":"NEXTCOMPLY AI Compliance Auditor Backend is running"}
```

## Common Errors

### "MONGODB_URI is not set"
- Create `.env` file in `server/` directory
- Add `MONGODB_URI=...`

### "MongoDB connection failed"
- Ensure MongoDB is running
- Check connection string is correct
- For MongoDB Atlas, verify network access/IP whitelist

### "GOOGLE_VERTEX_PROJECT is not set"
- Add `GOOGLE_VERTEX_PROJECT=your-project-id` to `.env`
- Or use `VERTEX_AI_PROJECT_ID` (backward compatible)

### "Failed to connect to backend server"
- Ensure server is running
- Check the port number in console output
- Frontend auto-discovers ports: 3001-3005, 5000, 8000, 8080

## Frontend Auto-Discovery

The frontend automatically tries to find the backend on these ports:
- 3001, 3002, 3003, 3004, 3005
- 5000, 8000, 8080

If the server is running on a different port, you can:
1. Set `VITE_BACKEND_URL` environment variable in frontend
2. Or ensure server starts on one of the discovery ports

## API Endpoints

The backend now supports both:
- `/api/audit` - New endpoint (structured format)
- `/api/analyze` - Compatibility endpoint (old frontend format)

Both endpoints work the same way, but return slightly different response formats.

## Still Having Issues?

1. Check server console for error messages
2. Verify all environment variables are set
3. Ensure MongoDB is accessible
4. Check that Node.js version is 18 or higher
5. Try restarting the server

