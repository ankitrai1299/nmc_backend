import chromium from '@sparticuz/chromium';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import puppeteerCore from 'puppeteer-core';

puppeteerExtra.use(StealthPlugin());
const puppeteer = puppeteerExtra.addExtra(puppeteerCore);

/**
 * Web Scraping Service
 * Extracts visible marketing claims from web pages
 */

const MAX_CONTENT_LENGTH = 50000; // Limit scraped content to 50KB
const REQUEST_TIMEOUT = 60000; // 60 seconds
const MAX_ATTEMPTS = 3;
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];
const BOT_BLOCK_PATTERNS = [/captcha/i, /cloudflare/i, /access denied/i, /attention required/i, /verify you are human/i];

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

const isBotBlocked = (text) => BOT_BLOCK_PATTERNS.some((pattern) => pattern.test(text));

const extractReadableText = (html) => {
  try {
    const dom = new JSDOM(html, { url: 'https://example.com' });
    const article = new Readability(dom.window.document).parse();
    if (article?.textContent) {
      return sanitizeContent(article.textContent);
    }
  } catch (error) {
    console.warn('[Scraping] Readability parse failed:', error.message);
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

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const userAgent = getRandomUserAgent();
    let browser;

    try {
      await delay();
      console.log(`[Scraping] Attempt ${attempt}/${MAX_ATTEMPTS} | URL: ${url}`);

      const executablePath = await chromium.executablePath();
      const resolvedExecutablePath = executablePath || process.env.PUPPETEER_EXECUTABLE_PATH;

      browser = await puppeteer.launch({
        args: resolvedExecutablePath ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: resolvedExecutablePath || undefined,
        headless: resolvedExecutablePath ? chromium.headless : 'new'
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
        waitUntil: 'networkidle2',
        timeout: REQUEST_TIMEOUT
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
        const elements = document.querySelectorAll('script, style, noscript');
        elements.forEach((el) => el.remove());
        return document.body ? document.body.innerText : '';
      });

      const extractedText = sanitizeContent(rawText);

      if (!extractedText.trim()) {
        const html = await page.content();
        const readableText = extractReadableText(html);
        if (readableText) {
          console.log('[Scraping] Readability fallback succeeded.');
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

      console.log(`[Scraping] Success | Extracted ${extractedText.length} characters`);

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
