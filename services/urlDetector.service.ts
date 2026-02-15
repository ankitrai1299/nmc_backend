const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'];
const MEDIA_EXTENSIONS = [
  '.mp3',
  '.mp4',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.flac',
  '.webm',
  '.mov',
  '.avi',
  '.mkv'
];

type UrlType = 'youtube' | 'media' | 'webpage';

type UrlDetectionResult = {
  normalizedUrl: string;
  type: UrlType;
};

const normalizeUrl = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL must start with http or https');
  }

  return parsed.toString();
};

const hasMediaExtension = (url: URL): boolean => {
  const pathname = url.pathname.toLowerCase();
  return MEDIA_EXTENSIONS.some((ext) => pathname.endsWith(ext));
};

const isYouTubeHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return YOUTUBE_HOSTS.some((ytHost) => host === ytHost || host.endsWith(`.${ytHost}`));
};

export const detectUrlType = (url: string): UrlDetectionResult => {
  const normalizedUrl = normalizeUrl(url);
  const parsed = new URL(normalizedUrl);

  if (isYouTubeHost(parsed.hostname)) {
    return { normalizedUrl, type: 'youtube' };
  }

  if (hasMediaExtension(parsed)) {
    return { normalizedUrl, type: 'media' };
  }

  return { normalizedUrl, type: 'webpage' };
};

export default {
  detectUrlType
};
