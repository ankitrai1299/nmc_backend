import { franc } from 'franc-min';

export type SourceType = 'blog' | 'youtube' | 'transcript';
export type ContentFormat = 'article' | 'speech';
export type ExtractionMethod = 'jina_reader' | 'mercury' | 'puppeteer';

export type ContentMetadata = {
  sourceType: SourceType;
  contentFormat: ContentFormat;
  language: string;
  extractionMethod: ExtractionMethod;
};

const detectScriptMix = (text: string) => {
  const chars = text.replace(/\s+/g, '');
  if (!chars) return { devanagariRatio: 0, latinRatio: 0 };

  const devanagariMatches = chars.match(/[\u0900-\u097F]/g) || [];
  const latinMatches = chars.match(/[A-Za-z]/g) || [];
  const length = chars.length || 1;

  return {
    devanagariRatio: devanagariMatches.length / length,
    latinRatio: latinMatches.length / length
  };
};

const mapFrancCode = (code: string) => {
  switch (code) {
    case 'hin':
      return 'hi';
    case 'eng':
      return 'en';
    case 'urd':
      return 'ur';
    case 'pan':
      return 'pa';
    case 'ben':
      return 'bn';
    default:
      return code;
  }
};

export const detectLanguage = (text: string): string => {
  const sample = text?.slice(0, 6000) || '';
  const { devanagariRatio, latinRatio } = detectScriptMix(sample);

  if (devanagariRatio > 0.15 && latinRatio > 0.15) {
    return 'mixed';
  }

  if (devanagariRatio > 0.2) {
    return 'hi';
  }

  if (sample.length < 80) {
    return 'unknown';
  }

  const detected = franc(sample, { minLength: 60 });
  if (detected === 'und') {
    return 'unknown';
  }

  return mapFrancCode(detected);
};

export const detectContentMetadata = ({
  text,
  sourceType,
  contentFormat,
  extractionMethod
}: {
  text: string;
  sourceType: SourceType;
  contentFormat: ContentFormat;
  extractionMethod: ExtractionMethod;
}): ContentMetadata => {
  const language = detectLanguage(text);

  return {
    sourceType,
    contentFormat,
    language,
    extractionMethod
  };
};
