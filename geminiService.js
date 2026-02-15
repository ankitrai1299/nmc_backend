import { VertexAI } from "@google-cloud/vertexai";

/* ===============================
   CONFIG
================================ */
const MODEL_NAME = "gemini-2.5-flash";
const MAX_CONTENT_LENGTH = 10000;
const GEMINI_TIMEOUT_MS = 30000;

let vertexAIClient = null;

const getVertexAIClient = () => {
  if (!vertexAIClient) {
    const projectId = process.env.VERTEX_PROJECT_ID;
    const location = process.env.VERTEX_LOCATION;
    
    if (!projectId || !location) {
      throw new Error("VERTEX_PROJECT_ID or VERTEX_LOCATION missing");
    }
    
    vertexAIClient = new VertexAI({ project: projectId, location: location });
    console.log('[Gemini] Vertex AI client initialized');
  }
  return vertexAIClient;
};

const truncateContent = (content) => {
  if (!content || typeof content !== 'string') return '';
  return content.length > MAX_CONTENT_LENGTH 
    ? content.substring(0, MAX_CONTENT_LENGTH) 
    : content;
};

const withTimeout = (promise, ms, errorMsg) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(errorMsg)), ms)
    )
  ]);
};

if (process.env.VERTEX_PROJECT_ID && process.env.VERTEX_LOCATION) {
  getVertexAIClient();
}

const cleanJsonString = (text = "") => {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
};

const removeTrailingCommas = (text = "") => {
  return text.replace(/,\s*([}\]])/g, '$1');
};

const extractJsonCandidate = (text = "") => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return text.trim();
  }
  return text.slice(start, end + 1).trim();
};

const extractBalancedJson = (text = "") => {
  const trimmed = text.trim();
  const startIndex = trimmed.search(/[\[{]/);
  if (startIndex === -1) return trimmed;

  const opener = trimmed[startIndex];
  const closer = opener === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < trimmed.length; i += 1) {
    const char = trimmed[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === opener) depth += 1;
    if (char === closer) depth -= 1;

    if (depth === 0) {
      return trimmed.slice(startIndex, i + 1).trim();
    }
  }

  return trimmed.slice(startIndex).trim();
};

const tryParseJson = (text) => {
  const cleaned = cleanJsonString(text);
  const candidates = [
    cleaned,
    extractJsonCandidate(cleaned),
    extractBalancedJson(cleaned)
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        return JSON.parse(removeTrailingCommas(candidate));
      } catch {
        // Try next candidate.
      }
    }
  }

  throw new Error('Invalid JSON');
};

/* ===============================
   PROMPT (VERY IMPORTANT)
================================ */
const buildRulesBlock = (rules = []) => {
  if (!rules.length) {
    return 'No rule pack provided. Use best-effort compliance reasoning based on jurisdiction.';
  }

  const maxRules = 50;
  const lines = rules.slice(0, maxRules).map((rule, index) => {
    const section = rule.section ? ` (Section: ${rule.section})` : '';
    return `${index + 1}. ${rule.regulation} - ${rule.title}${section}`;
  });

  if (rules.length > maxRules) {
    lines.push(`...and ${rules.length - maxRules} more rules in this jurisdiction.`);
  }

  return lines.join('\n');
};

const buildCompliancePrompt = ({ inputType, category, analysisMode, country, region, rules, contentContext }) => {
  const jurisdiction = country ? country : 'India';
  const regionLabel = region ? ` (${region})` : '';
  const rulesBlock = buildRulesBlock(rules);
  const contextBlock = contentContext
    ? `\nCONTENT CONTEXT (MANDATORY):\n${contentContext}\n`
    : '';

  return `
You are NextComply AI, a senior regulatory compliance auditor for ${jurisdiction}${regionLabel}.

TASK:
Audit the given ${inputType} content for ${jurisdiction}${regionLabel} advertising & healthcare compliance.

${contextBlock}

RULE PACK (MANDATORY):
Use ONLY the rules listed below to identify violations and generate fixes.
${rulesBlock}

CRITICAL OUTPUT RULES:
- Return ONLY valid JSON
- Do NOT repeat points
- Do NOT restart numbering
- Each recommendation must be ACTIONABLE and REPLACEMENT-BASED

RECOMMENDATION STYLE (VERY IMPORTANT):
❌ Wrong: "Remove misleading claim"
✅ Correct:
"Replace the sentence:
  'This medicine cures diabetes permanently'
 with:
  'This product may help support diabetes management when used under medical supervision.'"

FORMAT RULES:
- suggestion: numbered points (1., 2., 3.)
- solution: numbered points (1., 2., 3.)
- Max 3 points per field
- If only 1 point exists, return ONLY "1."

JSON SCHEMA:
{
  "score": number,
  "status": "Compliant" | "Needs Review" | "Non-Compliant",
  "summary": string,
  "transcription": string,
  "financialPenalty": {
    "riskLevel": "High" | "Medium" | "Low" | "None",
    "description": string
  },
  "ethicalMarketing": {
    "score": number,
    "assessment": string
  },
  "violations": [
    {
      "severity": "Critical" | "High" | "Medium" | "Low",
      "regulation": string,
      "description": string,
      "problematicContent": string,
      "englishTranslation": string,
      "suggestion": string,
      "solution": string
    }
  ]
}

ANALYSIS MODE: ${analysisMode || "Standard"}
INDUSTRY DOMAIN: ${category || "General"}

Return JSON only.`;
};

/* ===============================
   MAIN FUNCTION (EXPORTED)
================================ */
export const analyzeWithGemini = async ({
  content,
  inputType = "text",
  category = "General",
  analysisMode = "Standard",
  country,
  region,
  rules = [],
  contentContext = ''
}) => {
  const truncatedContent = truncateContent(content);
  const vertexAI = getVertexAIClient();

  const model = vertexAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 2048,
      topP: 0.95,
      responseMimeType: "application/json"
    },
  });

  const prompt = buildCompliancePrompt({
    inputType,
    category,
    analysisMode,
    country,
    region,
    rules,
    contentContext
  });

  const parts = [
    { text: truncatedContent },
    { text: prompt },
  ];

  const result = await withTimeout(
    model.generateContent({ contents: [{ role: "user", parts }] }),
    GEMINI_TIMEOUT_MS,
    'Gemini API call timed out'
  );

  let rawText =
    result?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  if (!rawText) {
    throw new Error("Gemini returned empty response");
  }

  try {
    return tryParseJson(rawText);
  } catch (err) {
    console.error('[Gemini] JSON parse failed');
    throw new Error("Gemini returned invalid JSON");
  }
};

/* ===============================
   OPTIONAL: AUDIO SUMMARY
================================ */
export const generateAudioSummary = async (text) => {
  const vertexAI = getVertexAIClient();

  const ttsModel = vertexAI.getGenerativeModel({
    model: "gemini-2.5-flash-preview-tts",
  });

  const result = await ttsModel.generateContent({
    contents: [{ role: "user", parts: [{ text }] }],
  });

  const audioBase64 =
    result?.response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!audioBase64) {
    throw new Error("Audio generation failed");
  }

  return audioBase64;
};

export const extractClaimsWithGemini = async (text) => {
  const cleaned = (text || '').trim();
  if (!cleaned) {
    throw new Error('No text provided for claim extraction');
  }

  const vertexAI = getVertexAIClient();

  const model = vertexAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 2048,
      topP: 0.9
    }
  });

  const prompt = `Extract the key marketing, medical, and compliance-relevant claims from the following document text. Return plain text only. Do NOT include JSON or markdown. If no claims are present, return a short sentence stating that no explicit claims were found.`;

  const truncatedText = cleaned.substring(0, MAX_CONTENT_LENGTH);
  
  const result = await withTimeout(
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${prompt}\n\n${truncatedText}` }] }]
    }),
    GEMINI_TIMEOUT_MS,
    'Gemini claim extraction timed out'
  );

  const output = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const extracted = output.trim();

  if (!extracted) {
    throw new Error('Gemini claim extraction returned empty output');
  }

  const lower = extracted.toLowerCase();
  const isNoClaims = lower.includes('no explicit claims') || lower.includes('no clear claims');
  if (!isNoClaims && extracted.length < 80) {
    throw new Error('Gemini claim extraction returned too-short output');
  }

  return extracted;
};