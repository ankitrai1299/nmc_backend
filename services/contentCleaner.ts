const NAV_TERMS = [
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
  'comments',
  'categories',
  'tags',
  'sidebar'
];

const normalizeLine = (line: string) => line.replace(/\s+/g, ' ').trim();

const isLikelyNavigation = (line: string) => {
  const normalized = line.toLowerCase();
  if (line.length >= 90) return false;
  return NAV_TERMS.some((term) => normalized.includes(term));
};

const isLikelySidebar = (line: string) => {
  const normalized = line.toLowerCase();
  if (line.length >= 90) return false;
  return /\b(popular|recent|recommended|archive|newsletter|share)\b/i.test(normalized);
};

export const cleanArticleContent = (rawContent: string): string => {
  if (!rawContent) return '';

  // Conservative cleaning to avoid removing full paragraphs.
  const seen = new Set<string>();
  const cleanedLines = rawContent
    .replace(/\r/g, '')
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean)
    .filter((line) => {
      const normalized = line.toLowerCase();
      if (line.length < 120 && seen.has(normalized)) {
        return false;
      }
      if (line.length < 120) {
        seen.add(normalized);
      }

      if (isLikelyNavigation(line)) {
        return false;
      }

      if (isLikelySidebar(line)) {
        return false;
      }

      return true;
    });

  return cleanedLines.join('\n');
};
