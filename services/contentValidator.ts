export type ValidationResult = {
  isValid: boolean;
  length: number;
  wordCount: number;
  headingHeavy: boolean;
  truncatedSuspected: boolean;
  warnings: string[];
  reasons: string[];
};

const MIN_CONTENT_CHARS = 3000;
const MIN_WORDS = 450;
const HEADING_RATIO_THRESHOLD = 0.6;

const getLineStats = (text: string) => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const wordCounts = lines.map((line) => line.split(/\s+/).filter(Boolean).length);
  return { lines, wordCounts };
};

const isHeadingHeavy = (text: string) => {
  const { lines, wordCounts } = getLineStats(text);
  if (!lines.length) return true;

  const headingLike = lines.filter((line, index) => {
    const words = wordCounts[index] || 0;
    const isShort = words <= 6;
    const isUpper = line.length >= 6 && line === line.toUpperCase();
    const hasMarker = line.startsWith('#') || line.endsWith(':');
    return isShort || isUpper || hasMarker;
  });

  const longLines = wordCounts.filter((count) => count >= 12).length;
  const longLineRatio = longLines / lines.length;

  if (longLineRatio >= 0.25) {
    return false;
  }

  return headingLike.length / lines.length >= HEADING_RATIO_THRESHOLD;
};

const detectTruncation = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/(\.\.\.|…)$/.test(trimmed)) return true;
  if (/\b(read more|continue reading|subscribe to read|view more)\b/i.test(trimmed)) return true;
  return false;
};

export const validateExtractedContent = (content: string): ValidationResult => {
  const length = content?.length || 0;
  const wordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;
  const headingHeavy = isHeadingHeavy(content || '');
  const truncatedSuspected = detectTruncation(content || '');

  const warnings: string[] = [];
  const reasons: string[] = [];

  if (length < MIN_CONTENT_CHARS || wordCount < MIN_WORDS) {
    reasons.push('content_too_short');
  }

  if (headingHeavy) {
    if (wordCount < MIN_WORDS * 2) {
      reasons.push('heading_only_content');
    } else {
      warnings.push('heading_heavy_content');
    }
  }

  if (truncatedSuspected) {
    warnings.push('content_appears_truncated');
  }

  return {
    isValid: reasons.length === 0,
    length,
    wordCount,
    headingHeavy,
    truncatedSuspected,
    warnings,
    reasons
  };
};

export const enforceContentLossGuard = (rawContent: string, cleanedContent: string) => {
  const rawLength = rawContent.length || 0;
  const cleanedLength = cleanedContent.length || 0;

  if (!rawLength) return;

  const lossRatio = (rawLength - cleanedLength) / rawLength;
  if (lossRatio > 0.4) {
    throw new Error(`Cleaned content removed ${(lossRatio * 100).toFixed(1)}% of text`);
  }
};
