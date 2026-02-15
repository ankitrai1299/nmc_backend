import { processContent } from '../services/contentProcessor.js';

/**
 * Compatibility endpoint for /api/analyze
 * POST /api/analyze
 */
export const analyzeCompatibility = async (req, res) => {
  try {
    const { content, inputType, category, analysisMode, country, region } = req.body;
    const file = req.file;
    
    // Validate input
    if (!content && !file) {
      return res.status(400).json({
        ok: false,
        error: 'Content or file is required'
      });
    }
    
    // Prepare input object
    const input = {};
    if (content) {
      if (inputType === 'URL') {
        input.url = content;
      } else {
        input.text = content;
      }
    }
    if (file) {
      input.file = file;
    }

    const auditResult = await processContent(input, {
      userId: req.user?.id,
      category,
      analysisMode,
      country,
      region
    });

    return res.json(auditResult);
  } catch (error) {
    console.error('[Compatibility] Error:', error);
    return res.status(500).json({
      error: error.message || error.error || 'Analysis failed'
    });
  }
};

export default {
  analyzeCompatibility
};
