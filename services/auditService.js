import { VertexAI } from '@google-cloud/vertexai';
import { selectGeminiModel, getFallbackModel, getGenerationConfig, isComplexContent } from './modelRouter.js';
import { extractClaims, shouldExtractClaims } from './claimsExtractor.js';

/**
 * Audit Service
 * Performs compliance audits using Gemini models with automatic fallback
 * 
 * IMPORTANT: This service uses ONLY Gemini/Vertex AI
 * NEVER uses OpenAI - OpenAI is reserved for transcription only
 */

// Reuse AI client instances
let vertexAIClient = null;

const getVertexCredentials = () => {
  const rawCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!rawCredentials) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not set');
  }
  try {
    return JSON.parse(rawCredentials);
  } catch (error) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON');
  }
};

/**
 * Get or create Vertex AI client instance
 * @returns {VertexAI} Vertex AI client
 */
const getVertexAIClient = () => {
  if (!vertexAIClient) {
    const projectId = process.env.VERTEX_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID || process.env.GOOGLE_VERTEX_PROJECT;
    const credentials = getVertexCredentials();
    // Always use us-central1 region
    const location = 'us-central1';
    
    if (!projectId) {
      throw new Error('GOOGLE_VERTEX_PROJECT or VERTEX_AI_PROJECT_ID is not set');
    }
    
    vertexAIClient = new VertexAI({ 
      project: projectId, 
      location: location,
      credentials
    });
    
    console.log('[Audit Service] Vertex AI client initialized | Region: us-central1 | Model: gemini-2.0-flash');
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

AUDIT RESPONSIBILITIES:

You must:

• Identify misleading medical claims
• Detect illegal curing claims
• Detect discouraging medical consultation
• Detect self-diagnosis promotion
• Detect lack of mandatory disclaimers
• Detect unethical marketing or licensing violations

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

Guidance must be:
• Formal
• Regulatory tone
• Actionable for advertiser
• Minimum 2 points per violation

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
  "severity": "",
  "regulation": "",
  "violation_title": "",
  "evidence": "",
  "translation": "",
  "guidance": [],
  "fix": [],
  "risk_score": ""
}

For multiple violations, return array:

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

IMPORTANT COMPLIANCE RULES:

1. NEVER support curing claims for cancer or prohibited diseases
2. ALWAYS add disclaimer if medical consultation is discouraged
3. NEVER hallucinate regulatory references
4. Maintain professional audit-report tone
5. Always promote ethical healthcare communication

----------------------------------------------------

If advertisement appears compliant:

Return:

{
  "complianceScore": 0,
  "violations": [],
  "status": "Compliant"
}

----------------------------------------------------

Tone:
Professional Healthcare Compliance Audit Report

Evidence must be extracted verbatim from content. Do not paraphrase.

Return ONLY valid JSON, no additional commentary or markdown formatting.`;
};

/**
 * Clean JSON string from markdown code blocks
 * @param {string} text - Raw text
 * @returns {string} Cleaned JSON string
 */
const cleanJsonString = (text) => {
  if (!text) return '{}';
  
  let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  
  if (!cleaned.startsWith('{')) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }
  }
  
  return cleaned;
};

/**
 * Validate and normalize audit response
 * @param {object} parsed - Parsed JSON response
 * @returns {object} Normalized response
 */
const normalizeResponse = (parsed) => {
  // Handle compliant response
  if (parsed.status === 'Compliant' || (parsed.violations && parsed.violations.length === 0 && parsed.complianceScore === 0)) {
    return {
      complianceScore: 0,
      violations: [],
      status: 'Compliant'
    };
  }
  
  // Validate complianceScore
  if (typeof parsed.complianceScore !== 'number') {
    // Calculate from violations if not provided
    if (parsed.violations && parsed.violations.length > 0) {
      const maxRisk = Math.max(...parsed.violations.map(v => {
        const risk = typeof v.risk_score === 'number' ? v.risk_score : 0;
        return risk;
      }));
      parsed.complianceScore = Math.min(100, maxRisk);
    } else {
      parsed.complianceScore = 0;
    }
  }
  
  // Ensure complianceScore is in valid range
  parsed.complianceScore = Math.max(0, Math.min(100, parsed.complianceScore));
  
  if (!Array.isArray(parsed.violations)) {
    parsed.violations = [];
  }
  
  // Ensure violations have required fields
  parsed.violations = parsed.violations.map(violation => {
    // Normalize severity to uppercase (CRITICAL, HIGH, MEDIUM, LOW)
    const severity = (violation.severity || 'MEDIUM').toUpperCase();
    const validSeverities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    violation.severity = validSeverities.includes(severity) ? severity : 'MEDIUM';
    
    // Ensure regulation is present (exact Act/Guideline/Section name)
    if (!violation.regulation || typeof violation.regulation !== 'string') {
      violation.regulation = 'Applicable Indian Healthcare Regulation';
    }
    
    // Ensure violation_title is present (one-line clear summary)
    if (!violation.violation_title || typeof violation.violation_title !== 'string') {
      violation.violation_title = 'Regulatory Violation Detected';
    }
    
    // Ensure evidence is present (EXACT quote in original language, verbatim)
    if (!violation.evidence || typeof violation.evidence !== 'string') {
      violation.evidence = 'Evidence not extracted verbatim from content';
    }
    
    // Ensure translation is present (accurate English translation)
    if (!violation.translation || typeof violation.translation !== 'string') {
      violation.translation = violation.evidence; // Use evidence as fallback
    }
    
    // Ensure minimum 2 guidance points (professional compliance recommendations)
    if (!Array.isArray(violation.guidance) || violation.guidance.length < 2) {
      violation.guidance = violation.guidance || [];
      while (violation.guidance.length < 2) {
        violation.guidance.push('Review applicable regulatory guidelines and consult legal counsel for compliance');
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
    
    // Ensure risk_score is present and valid (0-100)
    if (typeof violation.risk_score !== 'number' || violation.risk_score < 0 || violation.risk_score > 100) {
      // Map severity to risk score if not provided
      const severityScores = {
        'CRITICAL': 90,
        'HIGH': 70,
        'MEDIUM': 50,
        'LOW': 30
      };
      violation.risk_score = severityScores[violation.severity] || 50;
    }
    
    // Ensure risk_score is in valid range
    violation.risk_score = Math.max(0, Math.min(100, violation.risk_score));
    
    return violation;
  });
  
  return parsed;
};

/**
 * Perform audit with a specific model (with error handling)
 * @param {string} modelName - Model to use
 * @param {string} transcriptText - Transcript text to audit (for audio/video) or content (for text/url)
 * @param {string} contentType - Content type
 * @param {object} generationConfig - Generation configuration
 * @param {boolean} useFailSafe - Whether to use fail-safe prompt
 * @returns {Promise<object>} Audit result
 */
const performAuditWithModel = async (modelName, transcriptText, contentType, generationConfig, useFailSafe = false) => {
  const startTime = Date.now();
  
  try {
    // Validate transcriptText is provided
    if (!transcriptText || transcriptText.trim().length === 0) {
      throw new Error('Transcript text is empty. Cannot perform audit.');
    }
    
    const vertexAI = getVertexAIClient();
    const systemPrompt = buildAuditPrompt();
    
    // Optimize content: extract claims if content is long
    let optimizedContent = transcriptText;
    if (shouldExtractClaims(transcriptText)) {
      optimizedContent = extractClaims(transcriptText);
      console.log(`[Audit Service] Extracted claims: ${transcriptText.length} → ${optimizedContent.length} chars`);
    }
    
    // Build audit prompt - ensure transcriptText is included
    // Format: "Audit the following advertisement content for compliance:\n\n" + transcriptText
    let auditPrompt;
    if (useFailSafe) {
      // Fail-safe prompt for re-analysis
      auditPrompt = `Carefully analyze and detect ANY misleading or prohibited healthcare claims.\n\nAudit the following advertisement content for compliance:\n\n${optimizedContent}`;
      console.log('[Audit Service] Using fail-safe prompt for re-analysis');
    } else {
      // Standard prompt with transcriptText (as specified)
      auditPrompt = `Audit the following advertisement content for compliance:\n\n${optimizedContent}`;
    }
    
    // Combine system prompt with audit prompt
    const fullPrompt = `${systemPrompt}\n\n${auditPrompt}`;
    
    const model = vertexAI.getGenerativeModel({
      model: modelName,
      generationConfig
    });
    
    console.log(`[Audit Service] Using model: ${modelName} | Content: ${optimizedContent.length} chars | Fail-safe: ${useFailSafe}`);
    console.log(`[Audit Service] Transcript text length: ${transcriptText.length} chars`);
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }]
    });
    
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
    
    const cleanedText = cleanJsonString(rawText);
    const parsed = JSON.parse(cleanedText);
    const normalized = normalizeResponse(parsed);
    
    const processingTime = Date.now() - startTime;
    console.log(`[Audit Service] Success | Model: ${modelName} | Violations: ${normalized.violations.length} | Time: ${processingTime}ms`);
    
    return {
      complianceScore: normalized.complianceScore,
      violations: normalized.violations,
      modelUsed: modelName,
      processingTime,
      usedFallback: false,
      usedFailSafe: useFailSafe
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[Audit Service] Error | Model: ${modelName} | Time: ${processingTime}ms | Error:`, error.message);
    throw error;
  }
};

/**
 * Perform compliance audit with automatic fallback and fail-safe
 * @param {string} transcriptText - Transcript text to audit (for audio/video) or content (for text/url)
 * @param {string} inputType - 'text', 'url', 'image', 'video', 'audio'
 * @returns {Promise<object>} Audit results
 */
export const performAudit = async (transcriptText, inputType = 'text') => {
  const startTime = Date.now();
  
  try {
    // Validate transcriptText is provided
    if (!transcriptText || !transcriptText.trim()) {
      throw new Error('Transcript text is required for audit');
    }
    
    // Additional validation for transcript length
    if (transcriptText.length < 50) {
      throw new Error('Transcript too short for audit. Minimum 50 characters required.');
    }
    
    console.log(`[Audit Service] Starting audit for ${inputType} content`);
    console.log(`[Audit Service] Transcript text length: ${transcriptText.length} chars`);
    console.log(`[Audit Service] Transcript preview: ${transcriptText.substring(0, 200)}`);
    
    // Determine content complexity
    const isComplex = isComplexContent(transcriptText);
    
    // Select optimal model using smart router
    const { model: primaryModel, reason } = selectGeminiModel(inputType, transcriptText.length, isComplex);
    const generationConfig = getGenerationConfig(primaryModel);
    
    try {
      // Try primary model
      let result = await performAuditWithModel(primaryModel, transcriptText, inputType, generationConfig, false);
      
      // Fail-safe: If no findings, re-run with stronger prompt
      if (result.violations.length === 0 && result.complianceScore >= 90) {
        console.log('[Audit Service] No findings detected. Running fail-safe analysis...');
        const failSafeResult = await performAuditWithModel(primaryModel, transcriptText, inputType, generationConfig, true);
        
        // Use fail-safe result if it found violations
        if (failSafeResult.violations.length > 0) {
          console.log(`[Audit Service] Fail-safe found ${failSafeResult.violations.length} violations`);
          result = failSafeResult;
        } else {
          console.log('[Audit Service] Fail-safe also found no violations');
        }
      }
      
      result.totalProcessingTime = Date.now() - startTime;
      return result;
    } catch (primaryError) {
      console.warn(`[Audit Service] Model ${primaryModel} failed:`, primaryError.message);
      
      // No fallback available - only gemini-2.0-flash is accessible
      // Return structured error
      throw {
        error: 'Audit failed',
        message: `Model ${primaryModel} failed and no fallback available (only gemini-2.0-flash is accessible): ${primaryError.message}`,
        primaryModel,
        processingTime: Date.now() - startTime
      };
    }
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[Audit Service] Fatal error | Time: ${processingTime}ms | Error:`, error);
    
    // Return structured error response (never crash)
    if (error.error) {
      return {
        complianceScore: 0,
        violations: [],
        modelUsed: 'none',
        error: error.error,
        message: error.message,
        processingTime: error.processingTime || processingTime
      };
    }
    
    throw {
      error: 'Audit failed',
      message: error.message || 'Unknown error',
      processingTime
    };
  }
};

/**
 * Perform multimodal audit (for images) with automatic fallback
 * @param {Buffer} imageBuffer - Image buffer
 * @param {string} mimetype - MIME type
 * @returns {Promise<object>} Audit results
 */
export const performMultimodalAudit = async (imageBuffer, mimetype) => {
  const startTime = Date.now();
  
  try {
    console.log(`[Audit Service] Starting multimodal audit for image`);
    
    const vertexAI = getVertexAIClient();
    
    // Use gemini-2.0-flash (only model available)
    const primaryModel = 'gemini-2.0-flash';
    const fallbackModel = null; // No fallback available
    
    const systemPrompt = buildAuditPrompt();
    const base64Image = imageBuffer.toString('base64');
    const auditPrompt = `${systemPrompt}\n\nAnalyze the following image content for compliance violations. Extract all visible advertisement text and claims first, then audit them.`;
    
      const generationConfig = getGenerationConfig(primaryModel);
    
    const model = vertexAI.getGenerativeModel({
      model: primaryModel,
      generationConfig
    });
    
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: base64Image, mimeType: mimetype } },
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
    const normalized = normalizeResponse(parsed);
    
    const processingTime = Date.now() - startTime;
    console.log(`[Audit Service] Success | Model: ${primaryModel} | Violations: ${normalized.violations.length} | Time: ${processingTime}ms`);
    
    return {
      complianceScore: normalized.complianceScore,
      violations: normalized.violations,
      modelUsed: primaryModel,
      processingTime,
      usedFallback: false,
      totalProcessingTime: processingTime
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[Audit Service] Multimodal error | Time: ${processingTime}ms | Error:`, error);
    
    return {
      complianceScore: 0,
      violations: [],
      modelUsed: 'none',
      error: 'Multimodal audit failed',
      message: error.message || 'Unknown error',
      processingTime
    };
  }
};

export default {
  performAudit,
  performMultimodalAudit
};
