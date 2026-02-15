import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

const REQUEST_TIMEOUT_MS = 30000;
const MIN_TEXT_LENGTH = 300;
const MAX_TEXT_LENGTH = 100000;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const normalizeWhitespace = (text: string): string => {
  return text.replace(/\s+/g, ' ').trim();
};

export const scrapeWebpage = async (url: string): Promise<string> => {
  console.log('Using Mozilla Readability scraper');
  const response = await axios.get(url, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'User-Agent': getRandomUserAgent()
    }
  });

  if (!response.data || typeof response.data !== 'string') {
    throw new Error('Scraper returned empty HTML');
  }

  const dom = new JSDOM(response.data, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const rawText = article?.textContent ?? '';
  const cleaned = normalizeWhitespace(rawText);

  if (!cleaned || cleaned.length < MIN_TEXT_LENGTH) {
    throw new Error('Unable to extract readable text from webpage');
  }

  return cleaned.length > MAX_TEXT_LENGTH ? cleaned.slice(0, MAX_TEXT_LENGTH) : cleaned;
};

export default {
  scrapeWebpage
};
