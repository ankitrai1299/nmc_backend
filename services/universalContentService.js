import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import OpenAI from 'openai';
import { YoutubeTranscript } from 'youtube-transcript';
import ytdl from 'ytdl-core';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

let openaiClient = null;

const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Required for OpenAI analysis/transcription.');
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const normalizeUrl = (url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('URL must start with http or https');
    }
    return parsed.toString();
  } catch (error) {
    throw new Error('Invalid URL');
  }
};

export const detectUrlType = (url) => {
  const normalized = normalizeUrl(url);
  const host = new URL(normalized).hostname.toLowerCase();
  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    return 'youtube';
  }
  return 'blog';
};

const extractTextFromHtml = (html, url) => {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const text = article?.textContent || '';
  return text.replace(/\s+/g, ' ').trim();
};

const fetchWithJinaReader = async (url) => {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const response = await axios.get(jinaUrl, {
    timeout: 15000,
    headers: {
      'User-Agent': getRandomUserAgent()
    }
  });
  return response.data;
};

const fetchWithPuppeteer = async (url) => {
  puppeteerExtra.use(StealthPlugin());
  const browser = await puppeteerExtra.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(getRandomUserAgent());
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const html = await page.content();
    return extractTextFromHtml(html, url);
  } finally {
    await browser.close();
  }
};

export const extractBlogContent = async (url) => {
  const normalized = normalizeUrl(url);
  try {
    const content = await fetchWithJinaReader(normalized);
    const text = typeof content === 'string' ? content : '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned) {
      return cleaned;
    }
  } catch (error) {
    console.warn('[Blog Extraction] Jina Reader failed:', error.message);
  }

  const fallbackText = await fetchWithPuppeteer(normalized);
  if (!fallbackText) {
    throw new Error('Unable to extract readable content from blog URL');
  }

  return fallbackText;
};

export const extractYoutubeTranscript = async (url) => {
  const normalized = normalizeUrl(url);
  try {
    const transcriptItems = await YoutubeTranscript.fetchTranscript(normalized);
    const transcript = transcriptItems.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!transcript) {
      throw new Error('Transcript empty');
    }
    return transcript;
  } catch (error) {
    console.warn('[YouTube] Transcript unavailable:', error.message);
    return null;
  }
};

const downloadYoutubeAudio = async (url) => {
  const normalized = normalizeUrl(url);
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, `yt-audio-${Date.now()}.mp3`);

  await new Promise((resolve, reject) => {
    const stream = ytdl(normalized, { filter: 'audioonly', quality: 'highestaudio' });
    const writeStream = fs.createWriteStream(filePath);

    stream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);

    stream.pipe(writeStream);
  });

  return filePath;
};

export const transcribeAudio = async (audioPath) => {
  const client = getOpenAIClient();
  const response = await client.audio.transcriptions.create({
    model: 'gpt-4o-transcribe',
    file: fs.createReadStream(audioPath)
  });

  const text = response?.text?.trim() || '';
  if (!text) {
    throw new Error('Transcription returned empty text');
  }

  return text;
};

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const extractResponseText = (response) => {
  if (response?.output_text) return response.output_text;
  const content = response?.output?.[0]?.content?.[0]?.text;
  return content || '';
};

export const analyzeContentWithOpenAI = async (text) => {
  const client = getOpenAIClient();
  const prompt = `You are a compliance analyst. Summarize the content, list key points, and provide a compliance/risk analysis.\n\nReturn STRICT JSON with keys:\nsummary (string), keyPoints (array of strings), riskAnalysis (string).\n\nContent:\n${text}`;

  const response = await client.responses.create({
    model: 'gpt-4o-mini',
    input: prompt,
    temperature: 0.2
  });

  const raw = extractResponseText(response).trim();
  const parsed = safeJsonParse(raw);

  if (!parsed) {
    throw new Error('OpenAI response was not valid JSON');
  }

  return parsed;
};

export const universalContentProcessor = async (url) => {
  const normalized = normalizeUrl(url);
  const sourceType = detectUrlType(normalized);

  let extractedText = '';

  if (sourceType === 'youtube') {
    const transcript = await extractYoutubeTranscript(normalized);
    if (transcript) {
      extractedText = transcript;
    } else {
      const audioPath = await downloadYoutubeAudio(normalized);
      try {
        extractedText = await transcribeAudio(audioPath);
      } finally {
        fs.unlink(audioPath, () => undefined);
      }
    }
  } else {
    extractedText = await extractBlogContent(normalized);
  }

  if (!extractedText) {
    throw new Error('Failed to extract content from URL');
  }

  const analysis = await analyzeContentWithOpenAI(extractedText);

  return {
    sourceType,
    originalUrl: normalized,
    extractedText,
    summary: analysis.summary || '',
    keyPoints: analysis.keyPoints || [],
    riskAnalysis: analysis.riskAnalysis || ''
  };
};

export default {
  detectUrlType,
  extractBlogContent,
  extractYoutubeTranscript,
  transcribeAudio,
  analyzeContentWithOpenAI,
  universalContentProcessor
};
