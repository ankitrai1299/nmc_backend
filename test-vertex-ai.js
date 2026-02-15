#!/usr/bin/env node

import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';

// Load environment variables
dotenv.config();

console.log('[Test] Environment Variables:');
console.log('  VERTEX_PROJECT_ID:', process.env.VERTEX_PROJECT_ID);
console.log('  VERTEX_AI_PROJECT_ID:', process.env.VERTEX_AI_PROJECT_ID);
console.log('  VERTEX_LOCATION:', process.env.VERTEX_LOCATION);
console.log('  VERTEX_AI_LOCATION:', process.env.VERTEX_AI_LOCATION);
console.log('  GOOGLE_APPLICATION_CREDENTIALS_JSON:', process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? '[set]' : undefined);

console.log('\n[Test] Testing Vertex AI SDK...');

try {
  console.log('[Test] Importing VertexAI...');
  const { VertexAI } = await import('@google-cloud/vertexai');
  console.log('[Test] ✓ VertexAI imported successfully');
  
  console.log('[Test] Initializing VertexAI...');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not set');
  }

  const rawCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  console.log('[Test] Raw credentials length:', rawCredentials?.length);
  
  const credentials = JSON.parse(rawCredentials);
  console.log('[Test] Parsed credentials project_id:', credentials.project_id);
  console.log('[Test] Parsed credentials client_email:', credentials.client_email);
  
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  console.log('[Test] GoogleAuth client created successfully');
  
  const vertexAI = new VertexAI({
    project: process.env.VERTEX_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID,
    location: process.env.VERTEX_LOCATION || process.env.VERTEX_AI_LOCATION || 'asia-southeast1',
    auth
  });
  console.log('[Test] ✓ VertexAI initialized with explicit auth');
  
  console.log('[Test] Getting generative model...');
  const model = vertexAI.getGenerativeModel({
    model: 'gemini-2.0-flash'  // Latest model available in us-central1
  });
  console.log('[Test] ✓ Model obtained');
  
  console.log('\n[Test] Sending test request to Vertex AI...');
  const result = await model.generateContent('Hello, world!');
  console.log('[Test] ✓ Got response from Vertex AI');
  
  // Access the text from the response
  const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text 
    || result.response?.text?.() 
    || JSON.stringify(result.response).substring(0, 100);
  console.log('[Test] Response text length:', responseText?.length || 0);
  
  console.log('\n✅ All tests PASSED! Vertex AI is working correctly.');
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error('Full error:', error);
  process.exit(1);
}
