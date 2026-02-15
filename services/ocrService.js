import vision from '@google-cloud/vision';

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

let visionClient = null;

const getVisionClient = () => {
  if (!visionClient) {
    visionClient = new vision.ImageAnnotatorClient();
    console.log('[OCR] Google Vision client initialized');
  }

  return visionClient;
};

const validateImageBuffer = (imageBuffer) => {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
    throw new Error('Invalid image buffer');
  }

  if (imageBuffer.length > MAX_IMAGE_SIZE) {
    throw new Error(`Image size exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB limit`);
  }
};

export const extractTextFromImage = async (imageBuffer) => {
  validateImageBuffer(imageBuffer);

  const client = getVisionClient();

  const [result] = await client.textDetection({
    image: { content: imageBuffer }
  });

  const text = result?.fullTextAnnotation?.text || '';

  if (!text.trim()) {
    throw new Error('Unable to extract readable text from image');
  }

  return text.trim();
};

export const extractTextFromPdfOcr = async (pdfBuffer) => {
  validateImageBuffer(pdfBuffer);

  const client = getVisionClient();

  const [result] = await client.documentTextDetection({
    image: { content: pdfBuffer }
  });

  const text = result?.fullTextAnnotation?.text || '';

  if (!text.trim()) {
    throw new Error('OCR did not detect readable text in PDF');
  }

  return text.trim();
};

export default {
  extractTextFromImage,
  extractTextFromPdfOcr
};
