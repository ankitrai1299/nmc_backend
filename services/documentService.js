import mammoth from 'mammoth';
import { extractTextFromPdfPipeline } from './pdfTextPipeline.ts';
import textract from 'textract';

const MAX_DOC_SIZE = 20 * 1024 * 1024;

const validateDocumentBuffer = (buffer) => {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Invalid document buffer');
  }

  if (buffer.length > MAX_DOC_SIZE) {
    throw new Error(`Document size exceeds ${MAX_DOC_SIZE / 1024 / 1024}MB limit`);
  }
};

export const extractTextFromDocx = async (buffer) => {
  validateDocumentBuffer(buffer);

  const result = await mammoth.extractRawText({ buffer });
  const text = (result?.value || '').replace(/\s+/g, ' ').trim();

  if (!text) {
    return 'DOCX has no readable text. Please upload a text-based DOCX/DOC or PDF for best results.';
  }

  return text;
};

export const extractTextFromPdf = async (buffer) => {
  validateDocumentBuffer(buffer);

  const text = await extractTextFromPdfPipeline(buffer);
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();

  if (!cleaned) {
    return 'PDF has no readable text. It may be a low-quality scan. Please upload a clearer PDF for best results.';
  }

  return cleaned;
};

export const extractTextFromDoc = async (buffer) => {
  validateDocumentBuffer(buffer);

  const text = await new Promise((resolve, reject) => {
    textract.fromBufferWithMime('application/msword', buffer, (error, extractedText) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(extractedText || '');
    });
  });

  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return 'DOC has no readable text. Please upload a text-based DOC/DOCX or PDF for best results.';
  }

  return cleaned;
};

export const extractTextFromDocument = async (buffer, mimetype) => {
  if (mimetype === 'application/msword') {
    return extractTextFromDoc(buffer);
  }
  if (mimetype === 'application/pdf') {
    return extractTextFromPdf(buffer);
  }

  return extractTextFromDocx(buffer);
};

export default {
  extractTextFromDocx,
  extractTextFromDoc,
  extractTextFromPdf,
  extractTextFromDocument
};
