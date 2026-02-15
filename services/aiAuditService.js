import { VertexAI } from '@google-cloud/vertexai';
import { GoogleAuth } from 'google-auth-library';
import { getModelForScanType, getGenerationConfig } from './modelRouter.js';

/**
 * AI Audit Service
 * Performs compliance audits using Gemini models with structured prompts
 * 
 * IMPORTANT: This service uses ONLY Gemini/Vertex AI
 * NEVER uses OpenAI - OpenAI is reserved for transcription only
 * Transcription text is passed to this service for compliance analysis
 */

// Reuse AI client instances
let vertexAIClient = null;

const getVertexAuth = () => {
  const rawCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  console.log('[AI Audit] Raw credentials length:', rawCredentials?.length);
  
  if (!rawCredentials) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not set');
  }
  let credentials;
  try {
    credentials = JSON.parse(rawCredentials);
    console.log('[AI Audit] Parsed credentials project_id:', credentials.project_id);
    console.log('[AI Audit] Parsed credentials client_email:', credentials.client_email);
  } catch (error) {
    console.error('[AI Audit] JSON parse error:', error.message);
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON');
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  console.log('[AI Audit] GoogleAuth client created successfully');
  
  return auth;
};

/**
 * Get or create Vertex AI client instance
 * @returns {VertexAI} Vertex AI client
 */
const getVertexAIClient = () => {
  if (!vertexAIClient) {
    const projectId = process.env.VERTEX_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID || process.env.GOOGLE_VERTEX_PROJECT;
    const location = process.env.VERTEX_LOCATION || process.env.VERTEX_AI_LOCATION || process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
    
    console.log('[AI Audit] Initializing Vertex AI client...');
    console.log('[AI Audit] Project ID:', projectId);
    console.log('[AI Audit] Location:', location);
    
    const auth = getVertexAuth();
    
    if (!projectId) {
      throw new Error('GOOGLE_VERTEX_PROJECT or VERTEX_AI_PROJECT_ID is not set');
    }
    
    vertexAIClient = new VertexAI({ 
      project: projectId, 
      location: location,
      auth
    });
    
    console.log('[AI Audit] ✓ Vertex AI client initialized with explicit auth');
  }
  
  return vertexAIClient;
};

/**
 * Build compliance audit system prompt
 * @returns {string} System prompt
 */
const buildAuditPrompt = () => {
  return `You are an expert Healthcare Advertisement Compliance Auditor trained on Indian regulatory laws.

----------------------------------------------------

LANGUAGE RULE (MANDATORY):

Detect the PRIMARY language of the advertisement content.

ALL of the following MUST be generated in the SAME language:

• Violation Title
• Guidance / Recommendation
• Fix / Corrective Action

Exception:
Regulation names remain in English.

----------------------------------------------------

REGULATORY KNOWLEDGE BASE:

You are trained on:

1. Drugs and Magic Remedies (Objectionable Advertisements) Act, 1954
2. Drugs and Cosmetics Act, 1940 (Rule 106 & Schedule J)
3. Food Safety and Standards Act, 2006
4. FSSAI Advertising & Claims Regulations, 2018
5. Consumer Protection Act, 2019
6. CCPA Guidelines for Prevention of Misleading Advertisements, 2022
7. ASCI Code for Self-Regulation in Advertising
8. ASCI Healthcare & Influencer Guidelines
9. National Medical Commission RMP Regulations, 2023
10. Telemedicine Practice Guidelines, 2020
11. UCPMP 2024 Pharma Marketing Code
12. Medical Device Promotion Norms
13. Digital Personal Data Protection Act, 2023
14. IT Act + Intermediary Guidelines
15. MeitY AI / Deepfake Advisories

----------------------------------------------------

MANDATORY OUTPUT COUNT RULE:

For EACH violation:

You MUST generate:

• At least TWO Guidance recommendations
• At least TWO Fix options

If you generate fewer than two items,
you MUST internally regenerate response until requirement is satisfied.

Under NO condition return single guidance or single fix.

This is a HARD REQUIREMENT - violation of this rule makes the response invalid.

----------------------------------------------------

OUTPUT RULES (MANDATORY):

For every violation detected:

1. Provide at least TWO Guidance / Recommendation points.
2. Provide at least TWO Fix / Corrective options.
3. Fix options must include:
   - Safe rewrite version of advertisement
   - Compliance improvement instruction

VALIDATION CHECK BEFORE RETURNING:

Before returning JSON response, verify:
✓ Each violation has AT LEAST 2 guidance items
✓ Each violation has AT LEAST 2 fix items
✓ If any violation has fewer than 2 items, regenerate that violation

----------------------------------------------------

GUIDANCE REQUIREMENTS:

Guidance must explain:
• Why claim violates regulation
• What advertiser must change
• Which compliance principle is violated

----------------------------------------------------

FIX REQUIREMENTS (REGULATION-BASED):

You are a Healthcare Advertisement Compliance Remediation Expert.

You must generate Fix recommendations STRICTLY based on applicable regulatory rule packs.

RULE PACK COMPLIANCE REQUIREMENT:

For each violation:

1. Identify Applicable Regulation.
2. Apply compliance correction based on that regulation.
3. Fix MUST follow the legal restrictions and permitted advertising practices of that regulation.

REGULATION BASED FIX LOGIC:

If violation relates to:

Drugs and Magic Remedies Act:
→ Remove disease curing claims
→ Replace with wellness or support positioning
→ Add disclaimer that product does not cure disease

Drugs and Cosmetics Act:
→ Remove unlicensed or unverified selling claims
→ Require licensed distribution mention

ASCI Healthcare Guidelines:
→ Avoid exaggerated or guaranteed results
→ Promote professional consultation

Consumer Protection / CCPA:
→ Remove misleading, unverifiable or comparative superiority claims

FSSAI Advertising Regulations:
→ Remove unsubstantiated health claims
→ Use only approved health claims

FIX GENERATION RULE:

Fix must include:

• Full replacement advertisement text
• Compliance-safe marketing language
• Mandatory disclaimer if regulation requires
• Minimum TWO Fix options

PROHIBITED FIX:

❌ "Remove the claim"
❌ "Modify wording"
❌ "Change advertisement"
❌ Generic instructions without full text

REQUIRED FIX STYLE:

Fix Option 1:
Full compliant rewritten advertisement text (complete replacement).

Fix Option 2:
Alternative compliant marketing rewrite (complete replacement).

Each fix must be a COMPLETE, READY-TO-USE advertisement text that complies with the identified regulation.

LANGUAGE RULE:

Fix MUST be generated in SAME language as advertisement.

----------------------------------------------------

LANGUAGE CONSISTENCY RULE:

If input content is Hindi:
→ Output Guidance and Fix MUST be Hindi

If input content is English:
→ Output MUST be English

If input content is mixed:
→ Maintain same tone and mixture style

----------------------------------------------------

MANDATORY OUTPUT FORMAT:

Return JSON:

{
  "complianceScore": number (0-100),
  "violations": [
    {
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "regulation": "string (exact Act/Guideline/Section name - in English)",
      "violation_title": "string (in SAME language as input content)",
      "evidence": "string (EXACT quote in original language)",
      "translation": "string (accurate English translation)",
      "guidance": ["string", "string"] (MANDATORY: minimum 2 items, in SAME language as input - regenerate if only 1),
      "fix": ["string", "string"] (MANDATORY: minimum 2 items, in SAME language as input, each must be FULL rewritten advertisement text - regenerate if only 1),
      "risk_score": number (0-100)
    }
  ]
}

----------------------------------------------------

MANDATORY CONDITIONS:

• guidance array must contain minimum 2 items (HARD REQUIREMENT - regenerate if not met)
• fix array must contain minimum 2 items (HARD REQUIREMENT - regenerate if not met)
• fix must include FULL rewritten compliant advertisement text (complete replacement, not instructions)
• evidence must be direct quote
• risk_score must always be present
• violation_title, guidance, and fix must be in SAME language as input content
• regulation names remain in English

CRITICAL: If you generate a violation with only 1 guidance or 1 fix, you MUST regenerate that violation until it has at least 2 of each.

----------------------------------------------------

If advertisement appears compliant:

Return:

{
  "complianceScore": 0,
  "violations": [],
  "status": "Compliant"
}

----------------------------------------------------

Return ONLY valid JSON, no additional commentary or markdown formatting.`;
};

/**
 * Clean JSON string from markdown code blocks
 * @param {string} text - Raw text
 * @returns {string} Cleaned JSON string
 */
const cleanJsonString = (text) => {
  if (!text) return '{}';
  
  // Remove markdown code blocks
  let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  
  // Remove leading/trailing whitespace
  cleaned = cleaned.trim();
  
  // If it doesn't start with {, try to find JSON object
  if (!cleaned.startsWith('{')) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }
  }
  
  return cleaned;
};

/**
 * Perform compliance audit
 * @param {string} content - Content to audit
 * @param {string} scanType - 'fast-scan', 'advanced', or 'deep-reason'
 * @param {string} contentType - 'text', 'url', 'image', 'video', 'audio'
 * @returns {Promise<object>} Audit results
 */
export const performAudit = async (content, scanType = 'advanced', contentType = 'text') => {
  try {
    if (!content || !content.trim()) {
      throw new Error('Content is required for audit');
    }
    
    console.log(`[AI Audit] Starting ${scanType} audit for ${contentType} content`);
    
    const vertexAI = getVertexAIClient();
    const modelName = getModelForScanType(scanType);
    const generationConfig = getGenerationConfig(scanType);
    
    const model = vertexAI.getGenerativeModel({
      model: modelName,
      generationConfig
    });
    
    const systemPrompt = buildAuditPrompt();
    
    // Minimize token usage by sending only extracted claims
    // For text content, use as-is
    // For other types, content should already be extracted
    const auditPrompt = `${systemPrompt}\n\nAnalyze the following ${contentType} content for compliance violations:\n\n${content}`;
    
    console.log(`[AI Audit] Using model: ${modelName}`);
    console.log(`[AI Audit] Content length: ${content.length} characters`);
    
    // Use streaming only if response is expected to be > 5KB
    const useStreaming = content.length > 5000;
    
    let result;
    if (useStreaming) {
      console.log('[AI Audit] Using streaming response');
      const streamingResult = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: auditPrompt }] }]
      });
      
      let fullText = '';
      for await (const chunk of streamingResult.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
      }
      
      result = { response: { text: () => fullText } };
    } else {
      result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: auditPrompt }] }]
      });
    }
    
    // Extract text from response
    let rawText = '';
    if (result.response?.text && typeof result.response.text === 'function') {
      rawText = result.response.text();
    } else if (result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      rawText = result.response.candidates[0].content.parts[0].text;
    } else {
      rawText = result.response?.text || '';
    }
    
    if (!rawText) {
      throw new Error('AI model returned empty response');
    }
    
    console.log('[AI Audit] Parsing response...');
    const cleanedText = cleanJsonString(rawText);
    const parsed = JSON.parse(cleanedText);
    
    // Validate response structure
    if (typeof parsed.complianceScore !== 'number') {
      parsed.complianceScore = 100;
    }
    
    if (!Array.isArray(parsed.violations)) {
      parsed.violations = [];
    }
    
    // Ensure violations have required fields
    parsed.violations = parsed.violations.map(violation => {
      if (!Array.isArray(violation.guidance) || violation.guidance.length < 2) {
        violation.guidance = violation.guidance || [];
        while (violation.guidance.length < 2) {
          violation.guidance.push('Review regulatory guidelines');
        }
      }
      
      // Ensure minimum 2 fix points (must be FULL rewritten advertisement text, not instructions)
      if (!Array.isArray(violation.fix) || violation.fix.length < 2) {
        violation.fix = violation.fix || [];
        while (violation.fix.length < 2) {
          // Fallback: Generic compliant advertisement text (AI should provide full rewrites)
          violation.fix.push('[Full compliant rewritten advertisement text required - replace with regulation-based rewrite]');
        }
      }
      
      return violation;
    });
    
    console.log(`[AI Audit] Found ${parsed.violations.length} violations`);
    
    return {
      complianceScore: parsed.complianceScore,
      violations: parsed.violations,
      modelUsed: modelName
    };
  } catch (error) {
    console.error('[AI Audit] Error:', error);
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse AI response: ${error.message}`);
    }
    throw new Error(`Audit failed: ${error.message}`);
  }
};

/**
 * Perform multimodal audit (for images)
 * @param {Buffer} imageBuffer - Image buffer
 * @param {string} mimetype - MIME type
 * @param {string} scanType - Scan type
 * @returns {Promise<object>} Audit results
 */
export const performMultimodalAudit = async (imageBuffer, mimetype, scanType = 'advanced') => {
  try {
    console.log(`[AI Audit] Starting multimodal audit for image`);
    
    const vertexAI = getVertexAIClient();
    const modelName = getModelForScanType(scanType);
    const generationConfig = getGenerationConfig(scanType);
    
    const model = vertexAI.getGenerativeModel({
      model: modelName,
      generationConfig
    });
    
    const systemPrompt = buildAuditPrompt();
    const base64Image = imageBuffer.toString('base64');
    
    const auditPrompt = `${systemPrompt}\n\nAnalyze the following image content for compliance violations. Extract all visible advertisement text and claims first, then audit them.`;
    
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimetype
            }
          },
          { text: auditPrompt }
        ]
      }]
    });
    
    let rawText = '';
    if (result.response?.text && typeof result.response.text === 'function') {
      rawText = result.response.text();
    } else if (result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      rawText = result.response.candidates[0].content.parts[0].text;
    } else {
      rawText = result.response?.text || '';
    }
    
    if (!rawText) {
      throw new Error('AI model returned empty response');
    }
    
    const cleanedText = cleanJsonString(rawText);
    const parsed = JSON.parse(cleanedText);
    
    // Validate and normalize response
    if (typeof parsed.complianceScore !== 'number') {
      parsed.complianceScore = 100;
    }
    
    if (!Array.isArray(parsed.violations)) {
      parsed.violations = [];
    }
    
    parsed.violations = parsed.violations.map(violation => {
      if (!Array.isArray(violation.guidance) || violation.guidance.length < 2) {
        violation.guidance = violation.guidance || [];
        while (violation.guidance.length < 2) {
          violation.guidance.push('Review regulatory guidelines');
        }
      }
      
      // Ensure minimum 2 fix points (must be FULL rewritten advertisement text, not instructions)
      if (!Array.isArray(violation.fix) || violation.fix.length < 2) {
        violation.fix = violation.fix || [];
        while (violation.fix.length < 2) {
          // Fallback: Generic compliant advertisement text (AI should provide full rewrites)
          violation.fix.push('[Full compliant rewritten advertisement text required - replace with regulation-based rewrite]');
        }
      }
      
      return violation;
    });
    
    return {
      complianceScore: parsed.complianceScore,
      violations: parsed.violations,
      modelUsed: modelName
    };
  } catch (error) {
    console.error('[AI Audit] Multimodal error:', error);
    throw new Error(`Multimodal audit failed: ${error.message}`);
  }
};

export default {
  performAudit,
  performMultimodalAudit
};
