#!/usr/bin/env node

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

// Setup credentials temp file (same as server.js)
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  console.log('[Test] Setting up Google Application Credentials from JSON env var...');
  try {
    const rawCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    console.log('[Test] Raw credentials length:', rawCredentials?.length);
    
    const credentials = JSON.parse(rawCredentials);
    console.log('[Test] Parsed credentials project_id:', credentials.project_id);
    console.log('[Test] Parsed credentials client_email:', credentials.client_email);
    
    // Create temp file path
    const tempPath = path.join(process.cwd(), 'service-account.json');
    console.log('[Test] Writing credentials to temp file:', tempPath);
    
    // Write JSON to file
    fs.writeFileSync(tempPath, JSON.stringify(credentials, null, 2));
    console.log('[Test] ✓ Temp credentials file created');
    
    // Set environment variable for Google SDKs
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tempPath;
    console.log('[Test] ✓ GOOGLE_APPLICATION_CREDENTIALS set to:', tempPath);
  } catch (error) {
    console.error('[Test] ❌ Failed to setup credentials:', error.message);
    throw error;
  }
}

console.log('[Test] Environment Variables:');
console.log('  VERTEX_PROJECT_ID:', process.env.VERTEX_PROJECT_ID);
console.log('  VERTEX_AI_PROJECT_ID:', process.env.VERTEX_AI_PROJECT_ID);
console.log('  VERTEX_LOCATION:', process.env.VERTEX_LOCATION);
console.log('  VERTEX_AI_LOCATION:', process.env.VERTEX_AI_LOCATION);
console.log('  GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

console.log('\n[Test] Testing Vertex AI SDK...');

try {
  console.log('[Test] Importing VertexAI...');
  const { VertexAI } = await import('@google-cloud/vertexai');
  console.log('[Test] ✓ VertexAI imported successfully');
  
  console.log('[Test] Initializing VertexAI...');
  
  const vertexAI = new VertexAI({
    project: process.env.VERTEX_PROJECT_ID || process.env.VERTEX_AI_PROJECT_ID,
    location: process.env.VERTEX_LOCATION || process.env.VERTEX_AI_LOCATION || 'asia-southeast1'
  });
  console.log('[Test] ✓ VertexAI initialized (using GOOGLE_APPLICATION_CREDENTIALS)');
  
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
