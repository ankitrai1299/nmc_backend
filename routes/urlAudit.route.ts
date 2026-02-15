import express from 'express';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectUrlType } from '../services/urlDetector.service.ts';
import { scrapeWebpage } from '../services/scraper.service.ts';
import { transcribeMediaFile, transcribeYoutubeUrl } from '../services/youtubeTranscription.service.ts';
import { processContent } from '../services/contentProcessor.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

const REQUEST_TIMEOUT_MS = 60000;
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const guessExtension = (url: string, contentType: string | undefined): string => {
  const lowerUrl = url.toLowerCase();
  const known = ['.mp3', '.mp4', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm', '.mov', '.avi', '.mkv'];
  const match = known.find((ext) => lowerUrl.endsWith(ext));
  if (match) return match;

  if (contentType?.includes('audio/')) return '.mp3';
  if (contentType?.includes('video/')) return '.mp4';

  return '';
};

const downloadMediaToTemp = async (url: string) => {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'User-Agent': getRandomUserAgent()
    }
  });

  const contentType = response.headers['content-type'] as string | undefined;
  const extension = guessExtension(url, contentType);
  const tempPath = path.join(os.tmpdir(), `url-media-${Date.now()}${extension}`);

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(tempPath);
    response.data.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  return { filePath: tempPath, contentType };
};

const safeDelete = async (filePath: string): Promise<void> => {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[URL Audit] Failed to delete temp file:', (error as Error).message);
    }
  }
};

router.post('/url-audit', authMiddleware, async (req, res) => {
  try {
    const { url, category, analysisMode, country, region } = req.body || {};

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        error: 'Invalid URL. Provide a valid URL string in the request body.'
      });
    }

    const { normalizedUrl, type } = detectUrlType(url);
    let extractedText = '';

    if (type === 'youtube') {
      extractedText = await transcribeYoutubeUrl(normalizedUrl);
    } else if (type === 'media') {
      const { filePath } = await downloadMediaToTemp(normalizedUrl);
      try {
        extractedText = await transcribeMediaFile(filePath);
      } finally {
        await safeDelete(filePath);
      }
    } else {
      extractedText = await scrapeWebpage(normalizedUrl);
    }

    if (!extractedText) {
      throw new Error('Failed to extract content from URL');
    }

    await processContent(
      { text: extractedText },
      {
        userId: req.user?.id,
        category,
        analysisMode,
        country,
        region
      }
    );

    return res.json({
      source_url: normalizedUrl,
      content_type: type,
      extracted_text: extractedText
    });
  } catch (error) {
    console.error('[URL Audit] Error:', error);
    return res.status(500).json({
      error: (error as Error).message || 'Failed to process URL'
    });
  }
});

export default router;
