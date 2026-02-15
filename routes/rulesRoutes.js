import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { getRulesMetadata } from '../services/rulesService.js';

const router = express.Router();

// GET /rules/metadata
router.get('/rules/metadata', authMiddleware, (req, res) => {
  try {
    const metadata = getRulesMetadata();
    return res.json({ ok: true, data: metadata });
  } catch (error) {
    console.error('[Rules] Metadata error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load rules metadata' });
  }
});

export default router;
