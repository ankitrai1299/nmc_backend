import express from 'express';
import multer from 'multer';
import { createAudit, getAuditHistory, getAuditById } from '../controllers/auditController.js';
import { analyzeCompatibility } from '../controllers/compatibilityController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Configure multer for file uploads (in-memory storage)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images, audio, and video
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/webm',
      'audio/ogg',
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/pdf'
    ];
    
    // Check if file mimetype matches any allowed type
    const isAllowed = allowedMimes.some(mime => {
      return file.mimetype === mime || file.mimetype.startsWith(mime.split('/')[0] + '/');
    });
    
    if (isAllowed) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed types: ${allowedMimes.join(', ')}`), false);
    }
  }
});

/**
 * POST /audit
 * Create a new compliance audit
 */
router.post('/audit', authMiddleware, upload.single('file'), createAudit);

/**
 * GET /audit/history
 * Authenticated audit history for the logged-in user
 * Query params: limit, skip
 */
router.get('/audit/history', authMiddleware, getAuditHistory);

/**
 * GET /audit/:id
 * Get a specific audit by ID
 */
router.get('/audit/:id', authMiddleware, getAuditById);

/**
 * POST /analyze
 * Compatibility endpoint for frontend
 */
router.post('/analyze', authMiddleware, upload.single('file'), analyzeCompatibility);

export default router;
