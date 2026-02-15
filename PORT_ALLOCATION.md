# Dynamic Port Allocation

## Overview

The backend now uses `get-port` package for robust dynamic port allocation. This ensures the server never crashes if the default port is busy.

## Implementation Details

### Backend Changes

1. **Added `get-port` dependency**
   - Automatically finds available ports
   - Handles port conflicts gracefully

2. **Global Port Storage**
   - `SELECTED_PORT` variable stores the chosen port
   - Updated when server starts

3. **Endpoints Exposed**
   - `/health` - Health check endpoint (includes port in response)
   - `/api/port` - Port discovery endpoint (returns selected port)

4. **Error Handling**
   - Server never crashes if default port is busy
   - Automatically finds next available port in range [basePort, basePort + 100]
   - Logs warning if port differs from requested port

### Frontend Auto-Discovery

The frontend automatically discovers the backend by:

1. **Primary Method**: Checking `/health` endpoint across known ports:
   - 3001, 3002, 3003, 3004, 3005, 5000, 8000, 8080
   - Uses port from health response if available

2. **Fallback Method**: Checking `/api/port` endpoint if health checks fail

3. **Final Fallback**: Uses default URL (`http://localhost:3001`)

## Usage

### Starting the Server

```bash
cd server
npm start
```

The server will:
- Try to use port from `PORT` environment variable (default: 3001)
- If that port is busy, automatically find next available port
- Log the actual port being used
- Never crash due to port conflicts

### Example Output

```
🚀 NEXTCOMPLY AI Compliance Auditor Backend
==========================================
📍 Server running on port 3002
⚠️  Note: Port 3001 was busy, using port 3002 instead
📍 Backend URL: http://localhost:3002
📍 Health Check: http://localhost:3002/health
📍 Port Discovery: http://localhost:3002/api/port
```

### Testing Endpoints

**Health Check:**
```bash
curl http://localhost:3002/health
# Returns: {"status":"ok","message":"...","port":3002,"timestamp":"..."}
```

**Port Discovery:**
```bash
curl http://localhost:3002/api/port
# Returns: {"port":3002}
```

## Configuration

Set custom port via environment variable:
```env
PORT=3005
```

The server will try to use 3005, but will automatically use the next available port if 3005 is busy.

## Benefits

1. **No Crashes**: Server never fails to start due to port conflicts
2. **Auto-Discovery**: Frontend automatically finds the backend
3. **Flexible**: Works with any port configuration
4. **Reliable**: Uses proven `get-port` library for port detection
5. **Informative**: Logs clear messages about port selection

## Technical Details

- Uses `get-port` v7.0.0
- Port range: [basePort, basePort + 100]
- Timeout: 800ms per port check (frontend)
- Global variable `SELECTED_PORT` stores the chosen port
- Both endpoints (`/health` and `/api/port`) are available immediately

