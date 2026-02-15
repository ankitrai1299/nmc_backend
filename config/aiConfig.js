/**
 * AI Configuration
 * Manages API keys and ensures proper separation between OpenAI and Gemini
 * 
 * RULES:
 * - OpenAI API key: OPENAI_API_KEY (for transcription only)
 * - Gemini/Vertex AI: GOOGLE_VERTEX_PROJECT (for compliance analysis only)
 * - NEVER mix API keys between services
 */

/**
 * Validate OpenAI configuration
 * @returns {object} OpenAI config
 */
export const getOpenAIConfig = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Required for transcription tasks.');
  }
  
  return {
    apiKey,
    // Ensure we're using OpenAI, not Google
    provider: 'openai'
  };
};

/**
 * Validate Gemini/Vertex AI configuration
 * @returns {object} Vertex AI config
 */
export const getGeminiConfig = () => {
  const projectId = process.env.VERTEX_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID || process.env.GOOGLE_VERTEX_PROJECT;
  const location = process.env.VERTEX_LOCATION || process.env.VERTEX_AI_LOCATION || process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
  
  if (!projectId) {
    throw new Error('GOOGLE_VERTEX_PROJECT or VERTEX_AI_PROJECT_ID is not set. Required for compliance analysis.');
  }
  
  return {
    projectId,
    location,
    // Ensure we're using Gemini, not OpenAI
    provider: 'gemini'
  };
};

/**
 * Validate that API keys are properly separated
 * Ensures no mixing of keys between services
 */
export const validateAISeparation = () => {
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiProject = process.env.VERTEX_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID || process.env.GOOGLE_VERTEX_PROJECT;
  
  if (!openaiKey) {
    console.warn('⚠️  OPENAI_API_KEY not set - transcription will fail');
  }
  
  if (!geminiProject) {
    console.warn('⚠️  GOOGLE_VERTEX_PROJECT not set - compliance analysis will fail');
  }
  
  // Ensure keys are different (basic validation)
  if (openaiKey && geminiProject && openaiKey === geminiProject) {
    throw new Error('CRITICAL: OpenAI and Gemini API keys must be different. Never mix API keys between services.');
  }
  
  return {
    openaiConfigured: !!openaiKey,
    geminiConfigured: !!geminiProject
  };
};

export default {
  getOpenAIConfig,
  getGeminiConfig,
  validateAISeparation
};
