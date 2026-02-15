import chromium from '@sparticuz/chromium';
import axios from 'axios';
import fs from 'fs';
import { Readability } from '@mozilla/readability';
import Mercury from '@postlight/mercury-parser';
import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer-core';

/**
 * Web Scraping Service
 * Extracts visible marketing claims from web pages
 */

const MAX_CONTENT_LENGTH = 50000; // Limit scraped content to 50KB
const MIN_CONTENT_CHARS = 800;
const MIN_CONTENT_WORDS = 120;
const REQUEST_TIMEOUT = 60000; // 60 seconds
const PUPPETEER_TIMEOUT = 45000;
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];
const BOT_BLOCK_PATTERNS = [/captcha/i, /cloudflare/i, /access denied/i, /attention required/i, /verify you are human/i];
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PUPPETEER_ENABLED = process.env.ENABLE_PUPPETEER === 'true';
const ALLOW_PUPPETEER = PUPPETEER_ENABLED;

const delay = (minMs = 400, maxMs = 1200) => {
  const jitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, jitter));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

/**
 * Sanitize scraped content
 * @param {string} text - Raw text content
 * @returns {string} Sanitized text
 */
const sanitizeContent = (text) => {
  if (!text) return '';
  
  // Remove excessive whitespace
  let sanitized = text.replace(/\s+/g, ' ').trim();
  
  // Limit length
  if (sanitized.length > MAX_CONTENT_LENGTH) {
    sanitized = sanitized.substring(0, MAX_CONTENT_LENGTH) + '...';
  }
  
  return sanitized;
};

const normalizeWhitespace = (text) => {
  if (!text) return '';
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const isExecutableFile = (candidatePath) => {
  if (!candidatePath) return false;
  try {
    const stat = fs.statSync(candidatePath);
    return stat.isFile();
  } catch {
    return false;
  }
};

const isBotBlocked = (text) => BOT_BLOCK_PATTERNS.some((pattern) => pattern.test(text));

const logStructured = (event, details = {}) => {
  console.log('[Scraping]', JSON.stringify({ event, ...details }));
};

const getLineStats = (text) => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const wordCounts = lines.map((line) => line.split(/\s+/).filter(Boolean).length);
  return { lines, wordCounts };
};

const isHeadingHeavy = (text) => {
  const { lines, wordCounts } = getLineStats(text);
  if (!lines.length) return true;
  const headingLike = lines.filter((line, index) => {
    const words = wordCounts[index] || 0;
    const isShort = words <= 6;
    const isUpper = line.length >= 6 && line === line.toUpperCase();
    const hasMarker = line.startsWith('#') || line.endsWith(':');
    return isShort || isUpper || hasMarker;
  });
  return headingLike.length / lines.length >= 0.7;
};

const isContentTooShort = (text) => {
  if (!text) return true;
  const words = text.split(/\s+/).filter(Boolean).length;
  return text.length < MIN_CONTENT_CHARS || words < MIN_CONTENT_WORDS || isHeadingHeavy(text);
};

const cleanExtractedText = (text) => {
  if (!text) return '';
  const navTerms = [
    'home',
    'about',
    'contact',
    'privacy',
    'terms',
    'cookie',
    'subscribe',
    'newsletter',
    'sign in',
    'sign up',
    'login',
    'register',
    'follow',
    'share',
    'advert',
    'sponsored',
    'related posts',
    'comments'
  ];

  const seen = new Set();
  const cleanedLines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => {
      const normalized = line.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      if (line.length < 40 && navTerms.some((term) => normalized.includes(term))) {
        return false;
      }
      if (line.length < 25 && normalized.match(/\b(menu|navigation|sidebar|footer|header)\b/)) {
        return false;
      }
      return true;
    });

  return sanitizeContent(cleanedLines.join('\n'));
};

const extractReadableText = (html) => {
  try {
    const dom = new JSDOM(html, { url: 'https://example.com' });
    const article = new Readability(dom.window.document).parse();
    if (article?.textContent) {
      return cleanExtractedText(article.textContent);
    }
  } catch (error) {
    console.warn('[Scraping] Readability parse failed:', error.message);
  }
  return '';
};

const extractFromHtmlContainers = (html) => {
  try {
    const dom = new JSDOM(html, { url: 'https://example.com' });
    const document = dom.window.document;
    const selectors = [
      'article',
      '.blog-content',
      '.post-content',
      '.entry-content',
      '.article-content',
      '.content',
      '.main-content'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element?.textContent) {
        return cleanExtractedText(element.textContent);
      }
    }
  } catch (error) {
    console.warn('[Scraping] Container extraction failed:', error.message);
  }
  return '';
};

const extractMetadataText = (metadata) => {
  const parts = [];
  if (metadata?.title) parts.push(`Title: ${metadata.title}`);
  if (metadata?.description) parts.push(`Description: ${metadata.description}`);
  if (metadata?.ogTitle) parts.push(`OG Title: ${metadata.ogTitle}`);
  if (metadata?.ogDescription) parts.push(`OG Description: ${metadata.ogDescription}`);
  return sanitizeContent(parts.join(' '));
};

const fetchJinaReaderText = async (url) => {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const response = await fetch(jinaUrl, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/plain'
    }
  });

  if (!response.ok) {
    throw new Error(`Jina Reader HTTP ${response.status}`);
  }

  const text = await response.text();
  return cleanExtractedText(text);
};

const fetchJinaReaderRawText = async (url) => {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const response = await fetch(jinaUrl, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/plain'
    }
  });

  if (!response.ok) {
    throw new Error(`Jina Reader HTTP ${response.status}`);
  }

  const text = await response.text();
  return normalizeWhitespace(text);
};

const fetchReadableWithAxios = async (url) => {
  const response = await axios.get(url, {
    timeout: REQUEST_TIMEOUT,
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response?.data || typeof response.data !== 'string') {
    throw new Error('Readability fetch returned empty HTML');
  }

  const dom = new JSDOM(response.data, { url });
  const article = new Readability(dom.window.document).parse();
  if (article?.textContent) {
    return cleanExtractedText(article.textContent);
  }

  return '';
};

const fetchMercuryText = async (url) => {
  const result = await Mercury.parse(url, { fetchAllPages: false });
  const raw = result?.content || result?.excerpt || '';
  if (!raw) {
    return '';
  }
  const dom = new JSDOM(raw, { url });
  return cleanExtractedText(dom.window.document.body?.textContent || raw);
};

const fetchMercuryRawText = async (url) => {
  const result = await Mercury.parse(url, { fetchAllPages: false });
  const raw = result?.content || result?.excerpt || '';
  if (!raw) {
    return '';
  }
  const dom = new JSDOM(raw, { url });
  return normalizeWhitespace(dom.window.document.body?.textContent || raw);
};

const fetchPuppeteerArticleText = async (url) => {
  if (process.env.ENABLE_PUPPETEER !== 'true') {
    throw new Error('Puppeteer is disabled in this environment');
  }
  console.log('[Puppeteer + Readability] Extracting article from:', url);

  const userAgent = getRandomUserAgent();
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    });
    await page.setViewport({ width: 1366, height: 768 });
    page.setDefaultNavigationTimeout(PUPPETEER_TIMEOUT);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PUPPETEER_TIMEOUT });
    await page.waitForSelector('body', { timeout: 15000 });
    await sleep(1200);

    // Get full page HTML after rendering
    const pageHtml = await page.content();

    // Use Mozilla Readability to extract main article content
    const dom = new JSDOM(pageHtml, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    // Extract text from Readability article
    const rawText = article?.textContent ?? '';

    if (!rawText.trim()) {
      throw new Error('Readability extracted empty content from page');
    }

    return normalizeWhitespace(rawText);
  } finally {
    await browser.close().catch(() => {});
  }
};

// Production-safe Puppeteer launch for Render (no GPU, low RAM)
export async function launchBrowser() {
  if (process.env.ENABLE_PUPPETEER !== 'true') {
    throw new Error('Puppeteer is disabled in this environment');
  }
  return puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-zygote',
      '--single-process',
      ...chromium.args
    ],
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}
export const extractBlogContentByMethod = async (url, method) => {
  if (method === 'jina_reader') {
    const text = await fetchJinaReaderRawText(url);
    if (!text.trim()) throw new Error('Jina Reader returned empty content');
    return { extractedText: text, extractionMethod: method };
  }

  if (method === 'readability') {
    const text = await fetchReadableWithAxios(url);
    if (!text.trim()) throw new Error('Readability returned empty content');
    return { extractedText: text, extractionMethod: method };
  }

  if (method === 'puppeteer') {
    const text = await fetchPuppeteerArticleText(url);
    if (!text.trim()) throw new Error('Puppeteer returned empty content');
    return { extractedText: text, extractionMethod: method };
  }

  throw new Error(`Unsupported extraction method: ${method}`);
};

const resolveExecutablePath = async () => {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && isExecutableFile(envPath)) {
    return { path: envPath, isChromium: false };
  }

  if (process.platform === 'win32') {
    const windowsCandidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const candidate of windowsCandidates) {
      if (isExecutableFile(candidate)) {
        return { path: candidate, isChromium: false };
      }
    }

    // @sparticuz/chromium is not supported on Windows in most environments.
    return { path: null, isChromium: false };
  }

  const chromiumPath = await chromium.executablePath();
  if (chromiumPath && isExecutableFile(chromiumPath)) {
    return { path: chromiumPath, isChromium: true };
  }

  return { path: null, isChromium: false };
};

const fetchHtml = async (url) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    await delay();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
};

export const extractReadableFromUrl = async (url) => {
  try {
    const html = await fetchHtml(url);
    const readableText = extractReadableText(html);
    if (!readableText.trim()) {
      throw new Error('Readability returned empty content');
    }
    console.log('[Scraping] Readability URL extraction succeeded.');
    return readableText;
  } catch (error) {
    console.warn('[Scraping] Readability URL extraction failed:', error.message);
    return '';
  }
};

export const extractMetadataFromUrl = async (url) => {
  try {
    const html = await fetchHtml(url);
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const metadata = {
      title: document.title || '',
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
      ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''
    };
    const metadataText = extractMetadataText(metadata);
    if (!metadataText.trim()) {
      throw new Error('Metadata extraction returned empty content');
    }
    console.log('[Scraping] Metadata URL extraction succeeded.');
    return metadataText;
  } catch (error) {
    console.warn('[Scraping] Metadata URL extraction failed:', error.message);
    return '';
  }
};

/**
 * Scrape webpage and extract marketing content
 * @param {string} url - URL to scrape
 * @returns {Promise<{extractedText: string, url: string}>}
 */
export const scrapeUrl = async (url) => {
  // Validate URL
  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  let lastError;

  try {
    const jinaText = await fetchJinaReaderText(url);
    if (jinaText && !isContentTooShort(jinaText)) {
      logStructured('jina_reader', { status: 'success', length: jinaText.length });
      return { extractedText: jinaText, url };
    }
    if (jinaText) {
      logStructured('jina_reader', { status: 'short', length: jinaText.length });
    }
  } catch (error) {
    logStructured('jina_reader', { status: 'error', message: error.message });
  }

  try {
    const mercuryText = await fetchMercuryText(url);
    if (mercuryText && !isContentTooShort(mercuryText)) {
      logStructured('mercury_parser', { status: 'success', length: mercuryText.length });
      return { extractedText: mercuryText, url };
    }
    if (mercuryText) {
      logStructured('mercury_parser', { status: 'short', length: mercuryText.length });
    }
  } catch (error) {
    logStructured('mercury_parser', { status: 'error', message: error.message });
  }

  const { path: resolvedExecutablePath, isChromium } = await resolveExecutablePath();
  const canLaunchBrowser = !!resolvedExecutablePath;

  if (!canLaunchBrowser) {
    logStructured('browser_fallback', { status: 'unavailable' });
    const readable = await extractReadableFromUrl(url);
    if (readable) {
      return { extractedText: readable, url };
    }
    const metadata = await extractMetadataFromUrl(url);
    if (metadata) {
      return { extractedText: metadata, url };
    }
    throw new Error('Failed to scrape URL: no browser available for dynamic pages');
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const userAgent = getRandomUserAgent();
    let browser;

    try {
      await delay();
      logStructured('browser_attempt', { attempt, maxAttempts: MAX_ATTEMPTS, url });

      browser = await puppeteer.launch({
        args: isChromium ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: resolvedExecutablePath || undefined,
        headless: isChromium ? chromium.headless : 'new'
      });

      const page = await browser.newPage();
      await page.setUserAgent(userAgent);
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1'
      });
      await page.setViewport({ width: 1366, height: 768 });
      page.setDefaultNavigationTimeout(REQUEST_TIMEOUT);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
          request.abort();
          return;
        }
        request.continue();
      });

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: PUPPETEER_TIMEOUT
      });

      if (!response) {
        throw new Error('No response received during navigation');
      }

      const status = response.status();
      if (status === 403) {
        console.warn('[Scraping] Bot protection detected (HTTP 403). Triggering fallback.');
        const html = await page.content();
        const readableText = extractReadableText(html);
        if (readableText) {
          console.log('[Scraping] Readability fallback succeeded after 403.');
          return { extractedText: readableText, url };
        }
        const metadata = await page.evaluate(() => ({
          title: document.title || '',
          description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
          ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
          ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''
        }));
        const metadataText = extractMetadataText(metadata);
        if (metadataText) {
          console.warn('[Scraping] Returning metadata fallback after 403.');
          return { extractedText: metadataText, url };
        }
        return { extractedText: sanitizeContent(`Access restricted. URL: ${url}`), url };
      }

      await page.waitForSelector('body', { timeout: 15000 });
      await sleep(1500);

      const rawText = await page.evaluate(() => {
        const selectorsToRemove = [
          'script',
          'style',
          'noscript',
          'nav',
          'header',
          'footer',
          'aside',
          '.sidebar',
          '.nav',
          '.menu',
          '.advert',
          '.ad',
          '.ads',
          '.sponsored',
          '.newsletter',
          '.cookie',
          '.banner'
        ];
        document.querySelectorAll(selectorsToRemove.join(',')).forEach((el) => el.remove());

        const containers = [
          'article',
          '.blog-content',
          '.post-content',
          '.entry-content',
          '.article-content',
          '.content',
          '.main-content'
        ];
        for (const selector of containers) {
          const element = document.querySelector(selector);
          if (element?.innerText) {
            return element.innerText;
          }
        }

        return document.body ? document.body.innerText : '';
      });

      const extractedText = cleanExtractedText(rawText);

      if (!extractedText.trim()) {
        const html = await page.content();
        const readableText = extractReadableText(html) || extractFromHtmlContainers(html);
        if (readableText) {
          logStructured('readability_fallback', { status: 'success', length: readableText.length });
          return { extractedText: readableText, url };
        }
        const metadata = await page.evaluate(() => ({
          title: document.title || '',
          description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
          ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
          ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''
        }));
        const metadataText = extractMetadataText(metadata);
        if (metadataText) {
          console.warn('[Scraping] Returning metadata fallback after empty body text.');
          return { extractedText: metadataText, url };
        }
      }

      if (!extractedText.trim()) {
        console.warn('[Scraping] Empty content response detected.');
        throw new Error('Empty content response');
      }

      if (isBotBlocked(extractedText)) {
        console.warn('[Scraping] CAPTCHA or bot protection content detected.');
        throw new Error('CAPTCHA or bot protection detected');
      }

      logStructured('browser_extract', { status: 'success', length: extractedText.length });

      return {
        extractedText,
        url
      };
    } catch (error) {
      lastError = error;
      console.error(`[Scraping] Attempt ${attempt} failed: ${error.message}`);

      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = Math.min(15000, 1000 * (2 ** (attempt - 1)));
        console.log(`[Scraping] Retrying with new user-agent after ${backoffMs}ms...`);
        await delay(backoffMs, backoffMs + 500);
        continue;
      }
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  throw new Error(`Failed to scrape URL: ${lastError?.message || 'Unknown error'}`);
};

export default { scrapeUrl };
