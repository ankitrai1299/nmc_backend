import { VertexAI } from '@google-cloud/vertexai';
import { cleanArticleContent } from './contentCleaner.ts';
import { detectContentMetadata } from './metadataDetector.ts';
import { enforceContentLossGuard, validateExtractedContent } from './contentValidator.ts';
import type { ContentMetadata, ContentFormat, ExtractionMethod, SourceType } from './metadataDetector.ts';
import type { ValidationResult } from './contentValidator.ts';

const TRANSLATION_MODEL = 'gemini-2.5-flash';

let translationClient: VertexAI | null = null;

const getTranslationClient = () => {
  if (!translationClient) {
    const projectId = process.env.VERTEX_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID;
    const location = process.env.VERTEX_LOCATION || process.env.VERTEX_AI_LOCATION || 'asia-southeast1';
    
    if (!projectId) {
      throw new Error('VERTEX_AI_PROJECT_ID missing for translation');
    }
    
    translationClient = new VertexAI({
      project: projectId,
      location: location
    });
    
    console.log('[Audit Input Builder] Translation client initialized');
  }
  return translationClient;
};

const translateToEnglish = async (text: string, language: string) => {
  const vertexAI = getTranslationClient();
  const model = vertexAI.getGenerativeModel({
    model: TRANSLATION_MODEL,
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 1500
    }
  });

  const truncatedText = text.length > 10000 ? text.substring(0, 10000) : text;
  const prompt = `Translate the following ${language} text to English. Preserve medical terms and claims. Return plain text only.`;
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: `${prompt}\n\n${truncatedText}` }] }]
  });

  const translated = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return translated.trim();
};

const logPipeline = (event: string, details: Record<string, unknown> = {}) => {
  console.log('[Pipeline]', JSON.stringify({ event, ...details }));
};

export type AuditInput = {
  textContent: string;
  metadata: ContentMetadata;
};

export type AuditInputResult = {
  auditInput: AuditInput;
  rawContent: string;
  cleanedContent: string;
  translatedContent: string;
  validationResult: ValidationResult;
};

const buildAuditText = (cleaned: string, translated: string, metadata: ContentMetadata) => {
  const lines = [
    'INPUT CONTEXT:',
    '- This is a written healthcare article (not a speech transcript).',
    '- Domain: healthcare informational content.',
    `- Source type: ${metadata.sourceType}.`,
    `- Content format: ${metadata.contentFormat}.`,
    `- Extraction method: ${metadata.extractionMethod}.`,
    `- Detected language: ${metadata.language}.`,
    '',
    'ORIGINAL ARTICLE:',
    cleaned
  ];

  if (translated) {
    lines.push('', 'ENGLISH TRANSLATION (for semantic analysis only):', translated);
    lines.push('', 'IMPORTANT: Use the English translation for understanding, but keep outputs in the original language.');
  }

  return lines.join('\n');
};

export const buildAuditInput = async ({
  rawContent,
  sourceType,
  contentFormat,
  extractionMethod
}: {
  rawContent: string;
  sourceType: SourceType;
  contentFormat: ContentFormat;
  extractionMethod: ExtractionMethod;
}): Promise<AuditInputResult> => {
  const validationResult = validateExtractedContent(rawContent);
  logPipeline('Content validated', { length: validationResult.length, warnings: validationResult.warnings });

  const cleanedContent = cleanArticleContent(rawContent);
  logPipeline('Content cleaned', { length: cleanedContent.length });

  enforceContentLossGuard(rawContent, cleanedContent);

  const metadata = detectContentMetadata({
    text: cleanedContent,
    sourceType,
    contentFormat,
    extractionMethod
  });
  logPipeline('Metadata attached', metadata);

  let translatedContent = '';
  if (metadata.language === 'hi' || metadata.language === 'mixed') {
    // Translation enables semantic compliance checks while preserving original output language.
    try {
      translatedContent = await translateToEnglish(cleanedContent, metadata.language);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPipeline('Translation failed', { message });
      translatedContent = '';
    }
  }

  const textContent = buildAuditText(cleanedContent, translatedContent, metadata);
  logPipeline('Audit input prepared', { length: textContent.length });

  return {
    auditInput: {
      textContent,
      metadata
    },
    rawContent,
    cleanedContent,
    translatedContent,
    validationResult
  };
};
