import puppeteer from 'puppeteer';

/**
 * Web Scraping Service
 * Extracts visible marketing claims from web pages
 */

const MAX_CONTENT_LENGTH = 50000; // Limit scraped content to 50KB
const REQUEST_TIMEOUT = 20000; // 20 seconds
const MAX_ATTEMPTS = 2;
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

      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setUserAgent(userAgent);
      page.setDefaultNavigationTimeout(REQUEST_TIMEOUT);

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
        throw new Error('HTTP 403: Access denied');
      }

      await page.waitForTimeout(500);

      const rawText = await page.evaluate(() => {
        const elements = document.querySelectorAll('script, style, noscript');
        elements.forEach((el) => el.remove());
        return document.body ? document.body.innerText : '';
      });

      const extractedText = sanitizeContent(rawText);

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
        console.log('[Scraping] Retrying with new user-agent...');
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
