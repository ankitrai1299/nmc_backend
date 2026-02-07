import { scrapeUrl } from './scrapingService.js';
import { transcribe } from './transcriptionService.js';
import { performAudit, performMultimodalAudit } from './auditService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { YoutubeTranscript } from 'youtube-transcript';
import { analyzeWithGemini } from '../geminiService.js';
import AuditRecord from '../models/AuditRecord.js';
import { extractTextFromImage } from './ocrService.js';

const MAX_TEXT_LENGTH = 100000;
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

const validateInputSize = (input, type) => {
  if (type === 'text' && typeof input === 'string' && input.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text content exceeds ${MAX_TEXT_LENGTH} characters limit`);
  }
};

export const detectContentType = (input) => {
  if (input.text) return 'text';
  if (input.url) return 'url';
  if (input.file) {
    const mimetype = input.file?.mimetype || '';
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
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

const validateGeminiResult = (result) => {
  const requiredKeys = [
    'score',
    'status',
    'summary',
    'transcription',
    'financialPenalty',
    'ethicalMarketing',
    'violations'
  ];

  if (!result || typeof result !== 'object') {
    console.error('[Content Processor] Invalid Gemini JSON:', result);
    throw new Error('Gemini returned invalid JSON');
  }

  const missing = requiredKeys.filter((key) => !(key in result));
  if (missing.length > 0) {
    console.error('[Content Processor] Invalid Gemini JSON:', JSON.stringify(result));
    throw new Error('Gemini returned invalid JSON');
  }

  if (!Array.isArray(result.violations)) {
    console.error('[Content Processor] Invalid Gemini JSON:', JSON.stringify(result));
    throw new Error('Gemini returned invalid JSON');
  }
};

const saveAuditRecord = async ({
  userId,
  contentType,
  originalInput,
  extractedText,
  transcript,
  auditResult
}) => {
  validateGeminiResult(auditResult);

  const record = new AuditRecord({
    userId,
    contentType,
    originalInput,
    extractedText,
    transcript,
    auditResult
  });

  await record.save();
  return record;
};

const processText = async ({ text, category, analysisMode }) => {
  validateInputSize(text, 'text');

  const auditResult = await analyzeWithGemini({
    content: text,
    inputType: 'text',
    category,
    analysisMode
  });

  return {
    contentType: 'text',
    originalInput: text,
    extractedText: text,
    transcript: '',
    auditResult
  };
};

const processMediaBuffer = async ({ buffer, mimetype, inputType, originalInput, category, analysisMode }) => {
  const transcriptionResult = await transcribe(buffer, mimetype);
  const transcriptText = transcriptionResult.transcript;

  const auditResult = await analyzeWithGemini({
    content: transcriptText,
    inputType,
    category,
    analysisMode
  });

  return {
    contentType: inputType,
    originalInput,
    extractedText: transcriptText,
    transcript: transcriptText,
    auditResult
  };
};

const processImageBuffer = async ({ buffer, originalInput, category, analysisMode }) => {
  const extractedText = await extractTextFromImage(buffer);

  if (!extractedText || !extractedText.trim()) {
    throw new Error('Unable to extract readable text from image');
  }

  const auditResult = await analyzeWithGemini({
    content: extractedText,
    inputType: 'image',
    category,
    analysisMode
  });

  return {
    contentType: 'image',
    originalInput,
    extractedText,
    transcript: extractedText,
    auditResult
  };
};

const processUrl = async ({ url, category, analysisMode }) => {
  const urlType = detectUrlContentType(url);

  if (isYouTubeUrl(url)) {
    const transcriptText = await fetchYouTubeTranscript(url);
    const auditResult = await analyzeWithGemini({
      content: transcriptText,
      inputType: 'video',
      category,
      analysisMode
    });

    return {
      contentType: 'video',
      originalInput: url,
      extractedText: transcriptText,
      transcript: transcriptText,
      auditResult
    };
  }

  if (urlType === 'video' || urlType === 'audio') {
    const { buffer, mimetype } = await downloadMediaFile(url);
    if (mimetype.startsWith('text/') || mimetype.includes('html')) {
      const { extractedText } = await scrapeUrl(url);
      const auditResult = await analyzeWithGemini({
        content: extractedText,
        inputType: 'url',
        category,
        analysisMode
      });

      return {
        contentType: 'webpage',
        originalInput: url,
        extractedText,
        transcript: extractedText,
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

  const { extractedText } = await scrapeUrl(url);
  const auditResult = await analyzeWithGemini({
    content: extractedText,
    inputType: 'url',
    category,
    analysisMode
  });

  return {
    contentType: 'webpage',
    originalInput: url,
    extractedText,
    transcript: extractedText,
    auditResult
  };
};

export const processContent = async (input, options = {}) => {
  const { userId, category, analysisMode } = options;

  if (!userId) {
    throw new Error('Authentication required');
  }

  const contentType = detectContentType(input);
  let processingResult;

  if (contentType === 'text') {
    processingResult = await processText({ text: input.text, category, analysisMode });
  } else if (contentType === 'url') {
    processingResult = await processUrl({ url: input.url, category, analysisMode });
  } else if (contentType === 'video' || contentType === 'audio') {
    processingResult = await processMediaBuffer({
      buffer: input.file.buffer,
      mimetype: input.file.mimetype,
      inputType: contentType,
      originalInput: input.file.originalname || `uploaded ${contentType}`,
      category,
      analysisMode
    });
  } else if (contentType === 'image') {
    processingResult = await processImageBuffer({
      buffer: input.file.buffer,
      originalInput: input.file.originalname || 'uploaded image',
      category,
      analysisMode
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
