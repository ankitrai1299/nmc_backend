import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/database.js';
import auditRoutes from './routes/auditRoutes.js';
import rulesRoutes from './routes/rulesRoutes.js';
import urlAuditRoutes from './routes/urlAudit.route.ts';

// Import auth routes
console.log('[Server] Importing auth routes...');
import authRoutes from './routes/authRoutes.js';
console.log('[Server] Auth routes imported:', authRoutes ? '✅' : '❌');

// Get current directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config();

// Setup Google Cloud credentials from JSON env var (Render-friendly)
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const credentialsPath = '/tmp/gcp-key.json';
  fs.writeFileSync(credentialsPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON, 'utf8');
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
  console.log(`✅ Google credentials written to ${credentialsPath}`);
}

// Validate required environment variables
const requiredEnv = ["VERTEX_AI_PROJECT_ID"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
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
      console.log(`☁️  Vertex AI Project: ${process.env.VERTEX_AI_PROJECT_ID || '✗ Missing'}`);
      console.log(`📍 Vertex AI Location: ${process.env.VERTEX_AI_LOCATION || 'us-central1'}`);
      console.log(`🔐 Service Account: ${process.env.GOOGLE_APPLICATION_CREDENTIALS ? '✓ Configured' : '✗ Missing'}`);
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
