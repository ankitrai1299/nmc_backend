import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import ytdl from 'ytdl-core';
import { YoutubeTranscript } from 'youtube-transcript';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const AUDIO_DOWNLOAD_ENABLED = process.env.ENABLE_YOUTUBE_AUDIO === 'true';
const ALLOW_AUDIO_DOWNLOAD = !IS_PRODUCTION || AUDIO_DOWNLOAD_ENABLED;

const AUDIO_TIMEOUT_MS = 2 * 60 * 1000;
const TRANSCRIBE_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 800;
const BACKOFF_FACTOR = 2;
const YTDL_EXTRACT_FAILURE = /could not extract functions/i;

let openaiClient = null;

const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Required for audio transcription.');
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const retryWithBackoff = async (fn, attempts, label) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`[YouTube Transcript] ${label} failed (attempt ${attempt}/${attempts}):`, error.message);
      if (attempt < attempts) {
        const backoffMs = BACKOFF_BASE_MS * (BACKOFF_FACTOR ** (attempt - 1));
        await sleep(backoffMs);
      }
    }
  }
  throw lastError;
};

const fetchYtDlpMetadata = async (videoUrl) => {
  return await withTimeout(new Promise((resolve, reject) => {
    const args = ['--dump-json', '--skip-download', videoUrl];
    const process = spawn(getYtDlpCommand(), args);

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('error', reject);
    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp metadata failed (code ${code}): ${stderr.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (error) {
        reject(new Error('yt-dlp metadata returned invalid JSON'));
      }
    });
  }), AUDIO_TIMEOUT_MS, 'yt-dlp metadata timed out');
};

const normalizeUrl = (videoUrl) => {
  try {
    const parsed = new URL(videoUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('URL must start with http or https');
    }
    return parsed.toString();
  } catch (error) {
    throw new Error('Invalid YouTube URL');
  }
};

const getYtDlpCommand = () => process.env.YTDL_PATH || 'yt-dlp';
const getYtDlpJsRuntime = () => process.env.YTDL_JS_RUNTIME || 'node';
const resolveFfmpegLocation = () => {
  const rawPath = process.env.FFMPEG_PATH || '';
  if (!rawPath) return '';

  const normalized = rawPath.trim();
  if (!normalized) return '';

  if (normalized.toLowerCase().endsWith('ffmpeg.exe')) {
    const dir = path.dirname(normalized);
    const probePath = path.join(dir, 'ffprobe.exe');
    if (fs.existsSync(normalized) && fs.existsSync(probePath)) {
      return dir;
    }
    return '';
  }

  const probePath = path.join(normalized, 'ffprobe.exe');
  if (fs.existsSync(probePath)) {
    return normalized;
  }

  return '';
};

const ensureFfmpegAvailable = () => {
  const ffmpegLocation = resolveFfmpegLocation();
  if (!ffmpegLocation) {
    throw new Error('FFMPEG_PATH is missing or ffprobe/ffmpeg not found. Required for MP3 re-encoding.');
  }
  return ffmpegLocation;
};

const downloadWithYtDlp = async (videoUrl, outputPath) => {
  console.log('[YouTube Transcript] Downloading audio with yt-dlp + FFmpeg MP3 re-encode...');

  await withTimeout(new Promise((resolve, reject) => {
    const ffmpegLocation = ensureFfmpegAvailable();
    const args = [
      '--js-runtimes',
      getYtDlpJsRuntime(),
      '--ffmpeg-location',
      ffmpegLocation,
      '-x',
      '--audio-format',
      'mp3',
      '-o',
      outputPath,
      videoUrl
    ];

    const process = spawn(getYtDlpCommand(), args);

    let stderr = '';
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('error', (error) => {
      reject(error);
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`yt-dlp failed (code ${code}): ${stderr.trim()}`));
    });
  }), AUDIO_TIMEOUT_MS, 'yt-dlp download timed out');

  console.log('[YouTube Transcript] yt-dlp audio downloaded successfully');
};

const getAudioDurationSeconds = async (filePath) => {
  const ffmpegLocation = ensureFfmpegAvailable();
  const ffprobePath = path.join(ffmpegLocation, 'ffprobe.exe');

  return await withTimeout(new Promise((resolve, reject) => {
    const process = spawn(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);

    let output = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('error', reject);
    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed (code ${code}): ${stderr.trim()}`));
        return;
      }
      const duration = parseFloat(output.trim());
      resolve(duration);
    });
  }), AUDIO_TIMEOUT_MS, 'Audio duration probe timed out');
};

const validateDownloadedAudio = async (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error('Downloaded audio file not found');
  }

  const stats = fs.statSync(filePath);
  if (!stats.size || stats.size <= 0) {
    throw new Error('Downloaded audio file is empty');
  }

  const duration = await getAudioDurationSeconds(filePath);
  if (!duration || Number.isNaN(duration) || duration <= 0) {
    throw new Error('Downloaded audio has invalid duration');
  }
};

const validateYoutubeUrl = async (videoUrl) => {
  if (!ytdl.validateURL(videoUrl)) {
    throw new Error('Invalid YouTube URL');
  }

  try {
    const info = await retryWithBackoff(() => ytdl.getInfo(videoUrl), MAX_RETRIES, 'Video info');
    const isPrivate = info?.videoDetails?.isPrivate;
    const isLive = info?.videoDetails?.isLiveContent;
    if (isPrivate) {
      throw new Error('YouTube video is private');
    }
    if (isLive) {
      console.warn('[YouTube Transcript] Video is live content. Transcript may be unavailable.');
    }
  } catch (error) {
    if (YTDL_EXTRACT_FAILURE.test(error.message || '')) {
      console.warn('[YouTube Transcript] Video info unavailable via ytdl-core. Continuing with yt-dlp fallback.');
      return;
    }
    throw error;
  }
};

export const downloadYoutubeAudio = async (videoUrl, outputPath) => {
  console.log('[YouTube Transcript] Downloading audio...');
  await validateYoutubeUrl(videoUrl);
  await downloadWithYtDlp(videoUrl, outputPath);
  await validateDownloadedAudio(outputPath);
};

export const transcribeAudioWithOpenAI = async (filePath) => {
  const client = getOpenAIClient();
  console.log('[YouTube Transcript] Transcribing audio...');

  const extension = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeMap = {
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    webm: 'audio/webm',
    ogg: 'audio/ogg',
    wav: 'audio/wav'
  };
  const mimeType = mimeMap[extension] || 'application/octet-stream';

  const response = await withTimeout(
    retryWithBackoff(() => client.audio.transcriptions.create({
      model: 'gpt-4o-transcribe',
      file: fs.createReadStream(filePath),
      mime_type: mimeType
    }), MAX_RETRIES, 'OpenAI transcription'),
    TRANSCRIBE_TIMEOUT_MS,
    'Audio transcription timed out'
  );

  const text = response?.text?.trim() || '';
  if (!text) {
    throw new Error('Transcription returned empty text');
  }

  console.log('[YouTube Transcript] Transcription completed');
  return text;
};

export const getYoutubeTranscript = async (videoUrl) => {
  const normalized = normalizeUrl(videoUrl);

  try {
    await validateYoutubeUrl(normalized);
  } catch (error) {
    console.warn('[YouTube Transcript] URL validation failed:', error.message);
  }

  console.log('[YouTube Transcript] Trying captions...');
  try {
    const transcriptItems = await retryWithBackoff(() => YoutubeTranscript.fetchTranscript(normalized), MAX_RETRIES, 'Captions fetch');
    const transcript = transcriptItems.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
    if (transcript) {
      return transcript;
    }
  } catch (error) {
    console.warn('[YouTube Transcript] Captions failed:', error.message);
  }

  console.log('[YouTube Transcript] Captions unavailable. Fetching metadata...');
  try {
    const metadata = await retryWithBackoff(() => fetchYtDlpMetadata(normalized), MAX_RETRIES, 'yt-dlp metadata');
    const title = metadata?.title || 'Unknown';
    const description = metadata?.description || 'Description unavailable.';
    return `YouTube video transcript unavailable. Title: ${title}. Description: ${description}. URL: ${normalized}`;
  } catch (error) {
    console.warn('[YouTube Transcript] yt-dlp metadata failed:', error.message);
  }

  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(normalized)}&format=json`);
    if (response.ok) {
      const data = await response.json();
      const title = data?.title || 'Unknown';
      const channel = data?.author_name || 'Unknown';
      return `YouTube video transcript unavailable. Title: ${title}. Channel: ${channel}. URL: ${normalized}`;
    }
  } catch (error) {
    console.warn('[YouTube Transcript] oEmbed metadata failed:', error.message);
  }

  // Audio download only as last resort
  if (ALLOW_AUDIO_DOWNLOAD) {
    const tempFile = path.join(os.tmpdir(), `yt-audio-${Date.now()}.mp3`);
    try {
      await retryWithBackoff(() => downloadYoutubeAudio(normalized, tempFile), MAX_RETRIES, 'Audio download');
      return await transcribeAudioWithOpenAI(tempFile);
    } catch (error) {
      console.warn('[YouTube Transcript] Audio transcription failed:', error.message);
    } finally {
      fs.unlink(tempFile, () => undefined);
    }
  }

  return `YouTube transcript unavailable. Video URL: ${normalized}. Please provide a summary or upload a file.`;
};

export default {
  downloadYoutubeAudio,
  transcribeAudioWithOpenAI,
  getYoutubeTranscript
};
