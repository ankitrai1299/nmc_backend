import fs from 'fs';
import os from 'os';
import path from 'path';
import OpenAI from 'openai';
import ytdlp from 'yt-dlp-exec';
import { spawn } from 'child_process';

const MODEL = 'whisper-1';

let openaiClient: OpenAI | null = null;

const getOpenAIClient = (): OpenAI => {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set. Required for transcription.');
    }
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
};

const safeDelete = async (filePath: string): Promise<void> => {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[URL Audit] Failed to delete temp file:', (error as Error).message);
    }
  }
};

const runYtDlpFallback = async (url: string, outputPath: string): Promise<void> => {
  const args = ['-x', '--audio-format', 'mp3', '-o', outputPath, url];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('yt-dlp', args, { windowsHide: true });
    let stderr = '';
    let stdout = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('yt-dlp not found in PATH. Please install yt-dlp and ensure it is available in PATH.'));
        return;
      }
      reject(new Error(`yt-dlp failed to start: ${(error as Error).message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const message = [
          'yt-dlp fallback failed.',
          `exit code: ${code ?? 'unknown'}`,
          stderr ? `stderr: ${stderr}` : '',
          stdout ? `stdout: ${stdout}` : ''
        ]
          .filter(Boolean)
          .join(' ');
        reject(new Error(message));
        return;
      }
      resolve();
    });
  });
};

const downloadYoutubeAudio = async (url: string): Promise<string> => {
  const tempPath = path.join(os.tmpdir(), `yt-audio-${Date.now()}.mp3`);

  try {
    await ytdlp(url, {
      output: tempPath,
      extractAudio: true,
      audioFormat: 'mp3',
      format: 'bestaudio/best',
      noPlaylist: true
    });
  } catch (error) {
    console.warn('[URL Audit] yt-dlp-exec failed, falling back to binary:', (error as Error).message);
    await runYtDlpFallback(url, tempPath);
  }

  return tempPath;
};

const transcribeAudioFile = async (filePath: string): Promise<string> => {
  const client = getOpenAIClient();
  const response = await client.audio.transcriptions.create({
    model: MODEL,
    file: fs.createReadStream(filePath),
    response_format: 'text'
  });

  const text = typeof response === 'string' ? response : response?.text || '';
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error('Transcription returned empty text');
  }

  return trimmed;
};

export const transcribeYoutubeUrl = async (url: string): Promise<string> => {
  let audioPath = '';
  try {
    audioPath = await downloadYoutubeAudio(url);
    return await transcribeAudioFile(audioPath);
  } catch (error) {
    throw new Error(`YouTube transcription failed: ${(error as Error).message}`);
  } finally {
    if (audioPath) {
      await safeDelete(audioPath);
    }
  }
};

export const transcribeMediaFile = async (filePath: string): Promise<string> => {
  return await transcribeAudioFile(filePath);
};

export default {
  transcribeYoutubeUrl,
  transcribeMediaFile
};
