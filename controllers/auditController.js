import AuditRecord from '../models/AuditRecord.js';
import { processContent } from '../services/contentProcessor.js';

/**
 * Audit Controller
 * Uses Smart AI Model Router for automatic model selection
 * Router handles: model selection, fallback, cost optimization
 */

/**
 * Audit Controller
 * Handles audit requests and history retrieval
 */

/**
 * Create a new audit
 * POST /audit
 */
export const createAudit = async (req, res) => {
  try {
    const { text, url, category, analysisMode, country, region } = req.body;
    const file = req.file;
    
    // Validate input
    if (!text && !url && !file) {
      return res.status(400).json({
        success: false,
        error: 'At least one of text, url, or file is required'
      });
    }
    
    // Prepare input object
    const input = {};
    if (text) input.text = text;
    if (url) input.url = url;
    if (file) input.file = file;
    
    console.log(`[Audit Controller] Creating audit - Smart AI Model Router will select optimal model`);
    
    // Process content through Smart AI Model Router pipeline
    // Router automatically selects model based on content type, size, and complexity
    const auditResult = await processContent(input, {
      userId: req.user?.id,
      category,
      analysisMode,
      country,
      region
    });

    return res.status(201).json(auditResult);
  } catch (error) {
    console.error('[Audit Controller] Error:', error);
    return res.status(500).json({
      error: error.message || error.error || 'Failed to create audit'
    });
  }
};

/**
 * Get audit history
 * GET /history
 */
export const getAuditHistory = async (req, res) => {
  try {
    const { limit = 50, skip = 0 } = req.query;

    const query = { userId: req.user?.id };
    const audits = await AuditRecord.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .select('auditResult')
      .lean();

    const results = audits.map((record) => record.auditResult);
    return res.json(results);
  } catch (error) {
    console.error('[Audit Controller] History error:', error);
    return res.status(500).json({
      error: error.message || error.error || 'Failed to retrieve audit history'
    });
  }
};

/**
 * Get single audit by ID
 * GET /audit/:id
 */
export const getAuditById = async (req, res) => {
  try {
    const { id } = req.params;

    const audit = await AuditRecord.findOne({ _id: id, userId: req.user?.id })
      .select('auditResult')
      .lean();

    if (!audit) {
      return res.status(404).json({
        error: 'Audit not found'
      });
    }

    return res.json(audit.auditResult);
  } catch (error) {
    console.error('[Audit Controller] Get by ID error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        error: 'Invalid audit ID format'
      });
    }
    return res.status(500).json({
      error: error.message || error.error || 'Failed to retrieve audit'
    });
  }
};

export default {
  createAudit,
  getAuditHistory,
  getAuditById
};
