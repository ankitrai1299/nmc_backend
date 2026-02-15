import express from 'express';
import { universalContentProcessor } from '../services/universalContentService.js';

const router = express.Router();

// Sample route for testing URL processing
router.post('/universal-content', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        error: 'Invalid URL. Provide a valid URL string in the request body.'
      });
    }

    const result = await universalContentProcessor(url);
    return res.json(result);
  } catch (error) {
    console.error('[UniversalContent] Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to process URL'
    });
  }
});

export default router;
