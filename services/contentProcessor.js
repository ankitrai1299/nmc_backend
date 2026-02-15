import { scrapeUrl, extractReadableFromUrl, extractMetadataFromUrl, extractBlogContentByMethod } from './scrapingService.js';
import { transcribe } from './transcriptionService.js';
import { performAudit, performMultimodalAudit } from './auditService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { YoutubeTranscript } from 'youtube-transcript';
import OpenAI from 'openai';
import { analyzeWithGemini, extractClaimsWithGemini } from '../geminiService.js';
import { extractTextFromDocument } from './documentService.js';
import { getYoutubeTranscript } from './youtubeTranscriptService.js';
import { getRulesForSelection } from './rulesService.js';
import AuditRecord from '../models/AuditRecord.js';
import { extractTextFromImage } from './ocrService.js';
import { buildAuditInput } from './auditInputBuilder.ts';

const MAX_TEXT_LENGTH = 100000;
const MAX_CONTENT_FOR_AI = 12000;
const MAX_BLOG_CONTENT = 12000;
const MAX_MEDIA_SIZE = 100 * 1024 * 1024;
const REQUEST_TIMEOUT = 60000;
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const delay = (minMs = 300, maxMs = 900) => {
  const jitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, jitter));
};

let openaiClient = null;

const getOpenAIClient = () => {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set. Required for URL analysis fallback.');
    }
    openaiClient = new OpenAI({ apiKey });
    console.log('[URL Fallback] OpenAI client initialized');
  }
  return openaiClient;
};

const validateInputSize = (input, type) => {
  if (type === 'text' && typeof input === 'string' && input.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text content exceeds ${MAX_TEXT_LENGTH} characters limit`);
  }
};

const truncateForAI = (content) => {
  if (!content || typeof content !== 'string') return '';
  return content.length > MAX_CONTENT_FOR_AI 
    ? content.substring(0, MAX_CONTENT_FOR_AI)
    : content;
};

export const detectContentType = (input) => {
  if (input.text) return 'text';
  if (input.url) return 'url';
  if (input.file) {
    const mimetype = input.file?.mimetype || '';
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'document';
    if (mimetype === 'application/msword') return 'document';
    if (mimetype === 'application/pdf') return 'document';
  }
  throw new Error('Unable to detect content type');
};

const isYouTubeUrl = (url) => {
  const urlLower = url.toLowerCase();
  return urlLower.includes('youtube.com') || urlLower.includes('youtu.be');
};

const detectUrlContentType = (url) => {
  const urlLower = url.toLowerCase();
  const videoPlatforms = [
    'youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com',
    'facebook.com/watch', 'instagram.com/reel', 'tiktok.com',
    'twitch.tv'
  ];
  const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.m4v'];
  const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma'];

  if (videoPlatforms.some(platform => urlLower.includes(platform))) return 'video';
  if (videoExtensions.some(ext => urlLower.includes(ext))) return 'video';
  if (audioExtensions.some(ext => urlLower.includes(ext))) return 'audio';

  return 'webpage';
};

const downloadMediaFile = async (url) => {
  console.log(`[URL Processor] Downloading media from: ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    await delay();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': getRandomUserAgent()
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_MEDIA_SIZE) {
      throw new Error(`File size (${(buffer.length / 1024 / 1024).toFixed(2)}MB) exceeds limit of ${MAX_MEDIA_SIZE / 1024 / 1024}MB`);
    }

    return { buffer, mimetype: contentType };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Download timeout: URL took too long to respond');
    }
    throw new Error(`Failed to download media: ${error.message}`);
  }
};

const extractYouTubeVideoId = (url) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.replace('/', '').trim() || null;
    }
    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const shortsIndex = pathParts.indexOf('shorts');
    if (shortsIndex !== -1 && pathParts[shortsIndex + 1]) {
      return pathParts[shortsIndex + 1];
    }
    const embedIndex = pathParts.indexOf('embed');
    if (embedIndex !== -1 && pathParts[embedIndex + 1]) {
      return pathParts[embedIndex + 1];
    }
    return null;
  } catch {
    return null;
  }
};

const fetchYouTubeTranscript = async (url) => {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    console.warn('[YouTube Transcript] Invalid URL, unable to extract video ID');
    throw new Error('Invalid YouTube URL format. Please provide a valid YouTube video link.');
  }

  try {
    await delay(400, 1200);
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
    const transcript = transcriptItems.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();

    if (!transcript) {
      console.warn('[YouTube Transcript] Empty transcript received');
      throw new Error('Transcript unavailable');
    }

    console.log(`[YouTube Transcript] Success | Video: ${videoId} | Length: ${transcript.length} chars`);
    return transcript;
  } catch (error) {
    console.error(`[YouTube Transcript] Failure | Video: ${videoId} | Error: ${error.message}`);
    throw new Error(`YouTube transcript unavailable: ${error.message}`);
  }
};

const fetchYouTubeFallbackText = async (url, reason) => {
  const fallbackLines = [];
  fallbackLines.push('YouTube transcript unavailable.');
  if (reason) {
    fallbackLines.push(`Reason: ${reason}`);
  }
  fallbackLines.push(`Video URL: ${url}`);

  try {
    await delay(300, 800);
    let description = '';
    try {
      const videoResponse = await fetch(url, {
        headers: {
          'User-Agent': getRandomUserAgent()
        }
      });
      if (videoResponse.ok) {
        const html = await videoResponse.text();
        const match = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
        if (match && match[1]) {
          description = match[1];
        }
      }
    } catch (error) {
      console.warn('[YouTube Transcript] Description fetch failed:', error.message);
    }

    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      headers: {
        'User-Agent': getRandomUserAgent()
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.title) {
        fallbackLines.push(`Title: ${data.title}`);
      }
      if (data?.author_name) {
        fallbackLines.push(`Channel: ${data.author_name}`);
      }
    }

    if (description) {
      fallbackLines.push(`Description: ${description}`);
    }
  } catch (error) {
    console.warn('[YouTube Transcript] Fallback metadata unavailable:', error.message);
  }

  const fallbackText = fallbackLines.join(' ');
  return fallbackText.length < 60
    ? `${fallbackText} Please provide a summary or upload a file for review.`
    : fallbackText;
};

const analyzeUrlWithOpenAI = async (url) => {
  try {
    await delay(500, 1200);
    const openai = getOpenAIClient();
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: `Extract and summarize the main marketing/medical claims from this URL. Return plain text only. URL: ${url}`,
      temperature: 0.2
    });

    const text = response.output_text?.trim() || '';
    if (!text) {
      throw new Error('OpenAI URL analysis returned empty content');
    }

    console.log('[URL Fallback] OpenAI URL analysis succeeded.');
    return text;
  } catch (error) {
    console.warn('[URL Fallback] OpenAI URL analysis failed:', error.message);
    return '';
  }
};

const scanDocumentWithOpenAI = async (text) => {
  const normalized = (text || '').trim();
  const placeholderPatterns = [
    /no selectable text/i,
    /no readable text/i,
    /scanned document/i,
    /please upload a text-based/i
  ];

  if (!normalized || normalized.length < 200 || placeholderPatterns.some((pattern) => pattern.test(normalized))) {
    console.warn('[Document Scan] Skipping: insufficient text');
    return '';
  }

  try {
    await delay(400, 900);
    const openai = getOpenAIClient();
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: `Extract the key marketing, medical, and compliance-relevant claims from this document. Return plain text only.\n\n${normalized.substring(0, MAX_CONTENT_FOR_AI)}`,
      temperature: 0.2
    });

    const scanned = response.output_text?.trim() || '';
    if (!scanned || scanned.length < 200) {
      throw new Error('OpenAI scan returned empty content');
    }

    console.log('[Document Scan] Success');
    return scanned;
  } catch (error) {
    console.warn('[Document Scan] Failed:', error.message);
    return '';
  }
};


const normalizeGeminiResult = (result) => {
  if (!result || typeof result !== 'object') {
    throw new Error('Gemini returned invalid JSON');
  }

  const normalizeScore = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }
    if (value <= 1) {
      return Math.round(value * 100);
    }
    return Math.max(0, Math.min(100, Math.round(value)));
  };

  return {
    score: normalizeScore(result.score),
    status: result.status || 'Needs Review',
    summary: result.summary || 'Summary unavailable.',
    transcription: result.transcription || '',
    financialPenalty: result.financialPenalty || {
      riskLevel: 'Low',
      description: 'No financial risk assessment available.'
    },
    ethicalMarketing: result.ethicalMarketing || {
      score: normalizeScore(result?.ethicalMarketing?.score),
      assessment: 'Ethical marketing assessment unavailable.'
    },
    violations: Array.isArray(result.violations) ? result.violations : []
  };
};

const saveAuditRecord = async ({
  userId,
  contentType,
  originalInput,
  extractedText,
  transcript,
  auditResult
}) => {
  const normalizedResult = normalizeGeminiResult(auditResult);

  const record = new AuditRecord({
    userId,
    contentType,
    originalInput,
    extractedText,
    transcript,
    auditResult: normalizedResult
  });

  await record.save();
  return record;
};

const processText = async ({ text, category, analysisMode, country, region, rules }) => {
  validateInputSize(text, 'text');
  const truncatedText = truncateForAI(text);

  const auditResult = await analyzeWithGemini({
    content: truncatedText,
    inputType: 'text',
    category,
    analysisMode,
    country,
    region,
    rules
  });

  return {
    contentType: 'text',
    originalInput: text,
    extractedText: truncatedText,
    transcript: '',
    auditResult
  };
};

const processMediaBuffer = async ({ buffer, mimetype, inputType, originalInput, category, analysisMode, country, region, rules }) => {
  const transcriptionResult = await transcribe(buffer, mimetype);
  const transcriptText = transcriptionResult.transcript;
  const truncatedTranscript = truncateForAI(transcriptText);

  const auditResult = await analyzeWithGemini({
    content: truncatedTranscript,
    inputType,
    category,
    analysisMode,
    country,
    region,
    rules
  });

  return {
    contentType: inputType,
    originalInput,
    extractedText: transcriptText,
    transcript: transcriptText,
    auditResult
  };
};

const processImageBuffer = async ({ buffer, originalInput, category, analysisMode, country, region, rules }) => {
  const extractedText = await extractTextFromImage(buffer);

  if (!extractedText || !extractedText.trim()) {
    throw new Error('Unable to extract readable text from image');
  }

  const truncatedText = truncateForAI(extractedText);

  const auditResult = await analyzeWithGemini({
    content: truncatedText,
    inputType: 'image',
    category,
    analysisMode,
    country,
    region,
    rules
  });

  return {
    contentType: 'image',
    originalInput,
    extractedText: truncatedText,
    transcript: truncatedText,
    auditResult
  };
};

const processUrl = async ({ url, category, analysisMode, country, region, rules }) => {
  const urlType = detectUrlContentType(url);

  if (isYouTubeUrl(url)) {
    let transcriptText = '';
    try {
      console.log('[YouTube] Fetching transcript...');
      transcriptText = await getYoutubeTranscript(url);
    } catch (error) {
      console.warn('[YouTube] Fallback to metadata:', error.message);
      transcriptText = await fetchYouTubeFallbackText(url, error.message);
    }

    const truncatedTranscript = truncateForAI(transcriptText);

    const auditResult = await analyzeWithGemini({
      content: truncatedTranscript,
      inputType: 'video',
      category,
      analysisMode,
      country,
      region,
      rules
    });

    return {
      contentType: 'video',
      originalInput: url,
      extractedText: truncatedTranscript,
      transcript: truncatedTranscript,
      auditResult
    };
  }

  if (urlType === 'video' || urlType === 'audio') {
    const { buffer, mimetype } = await downloadMediaFile(url);
    if (mimetype.startsWith('text/') || mimetype.includes('html')) {
      let extractedText = '';

      try {
        ({ extractedText } = await scrapeUrl(url));
      } catch (error) {
        console.warn('[Scraping] Puppeteer scrape failed:', error.message);
      }

      if (!extractedText) {
        extractedText = await extractReadableFromUrl(url);
      }

      if (!extractedText) {
        extractedText = await analyzeUrlWithOpenAI(url);
      }

      if (!extractedText) {
        extractedText = await extractMetadataFromUrl(url);
      }

      if (!extractedText) {
        extractedText = `Content could not be extracted. URL: ${url}. Please provide text or upload a file.`;
      }

      const truncatedText = truncateForAI(extractedText);

      const auditResult = await analyzeWithGemini({
        content: truncatedText,
        inputType: 'url',
        category,
        analysisMode,
        country,
        region,
        rules
      });

      return {
        contentType: 'webpage',
        originalInput: url,
        extractedText: truncatedText,
        transcript: truncatedText,
        auditResult
      };
    }
    return processMediaBuffer({
      buffer,
      mimetype,
      inputType: urlType,
      originalInput: url,
      category,
      analysisMode
    });
  }

  const allowPuppeteer = process.env.NODE_ENV !== 'production' || process.env.ENABLE_PUPPETEER === 'true';
  const extractionPlan = allowPuppeteer
    ? ['jina_reader', 'readability', 'puppeteer']
    : ['jina_reader', 'readability'];
  let lastError;

  for (const method of extractionPlan) {
    try {
      const { extractedText, extractionMethod } = await extractBlogContentByMethod(url, method);
      console.log('[Pipeline] Scraping completed', JSON.stringify({ method: extractionMethod, length: extractedText.length }));

      const auditInputResult = await buildAuditInput({
        rawContent: extractedText,
        sourceType: 'blog',
        contentFormat: 'article',
        extractionMethod
      });

      if (auditInputResult.validationResult.warnings.length) {
        console.warn('[Pipeline] Content warnings', JSON.stringify({ warnings: auditInputResult.validationResult.warnings }));
      }

      if (!auditInputResult.validationResult.isValid) {
        console.warn('[Pipeline] Content validation warnings', JSON.stringify({ reasons: auditInputResult.validationResult.reasons }));
      }

      if (auditInputResult.cleanedContent.length < 300) {
        console.warn('[Pipeline] Content too short after cleaning', JSON.stringify({ length: auditInputResult.cleanedContent.length }));
        lastError = new Error('Content too short after cleaning');
        continue;
      }

      const truncatedAuditText = truncateForAI(auditInputResult.auditInput.textContent);

      const auditResult = await analyzeWithGemini({
        content: truncatedAuditText,
        inputType: 'article',
        category,
        analysisMode,
        country,
        region,
        rules,
        contentContext: 'Input is a written healthcare article, not a speech transcript.'
      });

      auditResult.metadata = auditInputResult.auditInput.metadata;

      return {
        contentType: 'webpage',
        originalInput: url,
        extractedText: auditInputResult.cleanedContent,
        transcript: auditInputResult.cleanedContent,
        auditResult
      };
    } catch (error) {
      lastError = error;
      console.warn('[Pipeline] Extraction attempt failed', JSON.stringify({ method, message: error.message }));
    }
  }

  try {
    const metadataText = await extractMetadataFromUrl(url);
    if (metadataText) {
      const truncatedText = truncateForAI(metadataText);
      const auditResult = await analyzeWithGemini({
        content: truncatedText,
        inputType: 'article',
        category,
        analysisMode,
        country,
        region,
        rules,
        contentContext: 'Input is page metadata only. Provide best-effort compliance analysis.'
      });

      return {
        contentType: 'webpage',
        originalInput: url,
        extractedText: metadataText,
        transcript: metadataText,
        auditResult
      };
    }
  } catch (error) {
    lastError = error;
  }

  throw new Error(`Blog content extraction failed: ${lastError?.message || 'Unknown error'}`);
};

const processDocumentBuffer = async ({ buffer, mimetype, originalInput, category, analysisMode, country, region, rules }) => {
  let extractedText = await extractTextFromDocument(buffer, mimetype);

  let scannedText = await scanDocumentWithOpenAI(extractedText);
  if (!scannedText) {
    try {
      scannedText = await extractClaimsWithGemini(extractedText);
      console.log('[Document Scan] Gemini claim extraction succeeded.');
    } catch (error) {
      console.warn('[Document Scan] Gemini claim extraction failed:', error.message);
    }
  }

  if (scannedText && scannedText.length < 200) {
    console.warn('[Document Scan] Claim extraction too short, falling back to full text.');
    scannedText = '';
  }

  const auditText = scannedText || extractedText;
  const truncatedText = truncateForAI(auditText);

  const auditResult = await analyzeWithGemini({
    content: truncatedText,
    inputType: 'document',
    category,
    analysisMode,
    country,
    region,
    rules
  });

  if (!auditResult.transcription) {
    auditResult.transcription = truncatedText;
  }

  return {
    contentType: 'document',
    originalInput,
    extractedText,
    transcript: extractedText,
    auditResult
  };
};

export const processContent = async (input, options = {}) => {
  const { userId, category, analysisMode, country, region } = options;

  if (!userId) {
    throw new Error('Authentication required');
  }

  const contentType = detectContentType(input);
  const rules = getRulesForSelection({ country, region, category });
  let processingResult;

  if (contentType === 'text') {
    processingResult = await processText({ text: input.text, category, analysisMode, country, region, rules });
  } else if (contentType === 'url') {
    processingResult = await processUrl({ url: input.url, category, analysisMode, country, region, rules });
  } else if (contentType === 'video' || contentType === 'audio') {
    processingResult = await processMediaBuffer({
      buffer: input.file.buffer,
      mimetype: input.file.mimetype,
      inputType: contentType,
      originalInput: input.file.originalname || `uploaded ${contentType}`,
      category,
      analysisMode,
      country,
      region,
      rules
    });
  } else if (contentType === 'image') {
    processingResult = await processImageBuffer({
      buffer: input.file.buffer,
      originalInput: input.file.originalname || 'uploaded image',
      category,
      analysisMode,
      country,
      region,
      rules
    });
  } else if (contentType === 'document') {
    processingResult = await processDocumentBuffer({
      buffer: input.file.buffer,
      mimetype: input.file.mimetype,
      originalInput: input.file.originalname || 'uploaded document',
      category,
      analysisMode,
      country,
      region,
      rules
    });
  } else {
    throw new Error('Unsupported input type');
  }

  await saveAuditRecord({
    userId,
    contentType: processingResult.contentType,
    originalInput: processingResult.originalInput,
    extractedText: processingResult.extractedText,
    transcript: processingResult.transcript,
    auditResult: processingResult.auditResult
  });

  return processingResult.auditResult;
};

export default { processContent };
