import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { connectDB } from './config/database.js';
import auditRoutes from './routes/auditRoutes.js';
import rulesRoutes from './routes/rulesRoutes.js';
import urlAuditRoutes from './routes/urlAudit.route.ts';

// Import auth routes
console.log('[Server] Importing auth routes...');
import authRoutes from './routes/authRoutes.js';
console.log('[Server] Auth routes imported:', authRoutes ? '✅' : '❌');

// Load environment variables
dotenv.config();

// Setup Google Application Credentials from JSON env var
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  console.log('[Server] Setting up Google Application Credentials from JSON env var...');
  try {
    const rawCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    console.log('[Server] Raw credentials length:', rawCredentials?.length);
    
    const credentials = JSON.parse(rawCredentials);
    console.log('[Server] Parsed credentials project_id:', credentials.project_id);
    console.log('[Server] Parsed credentials client_email:', credentials.client_email);
    
    // Create temp file path
    const tempPath = path.join(process.cwd(), 'service-account.json');
    console.log('[Server] Writing credentials to temp file:', tempPath);
    
    // Write JSON to file
    fs.writeFileSync(tempPath, JSON.stringify(credentials, null, 2));
    console.log('[Server] ✓ Temp credentials file created');
    
    // Set environment variable for Google SDKs
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tempPath;
    console.log('[Server] ✓ GOOGLE_APPLICATION_CREDENTIALS set to:', tempPath);
  } catch (error) {
    console.error('[Server] ❌ Failed to setup credentials:', error.message);
    throw error;
  }
}

// Validate required environment variables
const projectId = process.env.VERTEX_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID || process.env.GOOGLE_VERTEX_PROJECT;
const missingEnv = [];

if (!projectId) {
  missingEnv.push('VERTEX_PROJECT_ID');
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  missingEnv.push('GOOGLE_APPLICATION_CREDENTIALS_JSON');
}

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const allowedOrigins = new Set([
  'https://nextcomplyai.com',
  'https://www.nextcomplyai.com',
  'https://www.nextdoc.in',
  'https://nextdoc.in',
  'http://localhost:3000',
  'http://localhost:5173'
]);

if (process.env.FRONTEND_URL) {
  allowedOrigins.add(process.env.FRONTEND_URL.replace(/\/$/, ''));
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = origin.replace(/\/$/, '');

    if (allowedOrigins.has(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error('CORS not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));


// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'NextComply AI Backend is running' });
});

// Auth routes - must be registered before error handlers
console.log('📝 Registering auth routes...');
console.log('   Imported authRoutes:', authRoutes ? '✅' : '❌');
console.log('   Auth routes type:', typeof authRoutes);
try {
  if (!authRoutes) {
    throw new Error('authRoutes is undefined - import failed');
  }
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth routes successfully registered at /api/auth');
  console.log('   Available auth endpoints:');
  console.log('     - GET  /api/auth/health');
  console.log('     - POST /api/auth/signup');
  console.log('     - POST /api/auth/login');
} catch (error) {
  console.error('❌ Error registering auth routes:', error);
  console.error('   Error stack:', error.stack);
  throw error;
}

app.use('/api', auditRoutes);
app.use('/api', rulesRoutes);
app.use('/api', urlAuditRoutes);

// 404 handler for undefined routes
app.use((req, res, next) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server with automatic port detection
(async () => {
  try {
    // Connect to MongoDB
    try {
      await connectDB();
    } catch (dbError) {
      console.warn('⚠️  MongoDB connection failed. Auth features will not work:', dbError.message);
      console.warn('   Set MONGODB_URI in your .env file to enable authentication.');
    }

    app.listen(PORT, () => {
      console.log(`🚀 NextComply AI Backend server running on port ${PORT}`);
      console.log(`📍 Backend URL: http://localhost:${PORT}`);
      console.log(`📍 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
      console.log(`☁️  Vertex AI Project: ${projectId || '✗ Missing'}`);
      console.log(`📍 Vertex AI Location: ${process.env.VERTEX_LOCATION || process.env.VERTEX_AI_LOCATION || 'us-central1'}`);
      console.log(`🔐 Service Account JSON: ${process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? '✓ Configured' : '✗ Missing'}`);
      console.log(`💾 MongoDB: ${process.env.MONGODB_URI ? '✓ Configured' : '✗ Missing (Auth disabled)'}`);
      console.log(`🔗 Available routes:`);
      console.log(`   - GET  /health`);
      console.log(`   - POST /api/analyze`);
      console.log(`   - POST /api/audit`);
      console.log(`   - GET  /api/audit/history`);
      console.log(`   - GET  /api/audit/:id`);
      console.log(`   - GET  /api/auth/health`);
      console.log(`   - POST /api/auth/login`);
      console.log(`   - POST /api/auth/signup`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
})();

export default app;
