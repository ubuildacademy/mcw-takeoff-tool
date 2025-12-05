#!/usr/bin/env ts-node
/**
 * Upload trained model to Supabase Storage
 * 
 * Usage:
 *   ts-node scripts/upload_model_to_supabase.ts
 * 
 * Environment variables required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs-extra';
import * as path from 'path';

const STORAGE_BUCKET = 'project-files';
const STORAGE_PATH = 'models/floor_plan_cubicasa5k_resnet50.pth';

async function uploadModel() {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://mxjyytwfhmoonkduvybr.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseKey) {
    console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Resolve model path relative to server directory (where this script is)
  const scriptDir = path.dirname(__filename);
  const serverDir = path.dirname(scriptDir);
  const modelPath = path.join(serverDir, 'models', 'floor_plan_cubicasa5k_resnet50.pth');
  if (!await fs.pathExists(modelPath)) {
    console.error(`❌ Model file not found: ${modelPath}`);
    process.exit(1);
  }

  const fileStats = await fs.stat(modelPath);
  const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
  console.log(`📦 Model file: ${modelPath}`);
  console.log(`📦 File size: ${fileSizeMB} MB`);

  // Read model file
  console.log('📥 Reading model file...');
  const fileBuffer = await fs.readFile(modelPath);

  // Upload to Supabase Storage
  console.log(`📤 Uploading to Supabase Storage: ${STORAGE_BUCKET}/${STORAGE_PATH}...`);
  
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(STORAGE_PATH, fileBuffer, {
      contentType: 'application/octet-stream',
      upsert: true, // Overwrite if exists (for model updates)
      cacheControl: '3600' // Cache for 1 hour
    });

  if (error) {
    console.error('❌ Upload failed:', error);
    process.exit(1);
  }

  console.log('✅ Model uploaded successfully!');
  console.log(`   Storage path: ${STORAGE_BUCKET}/${STORAGE_PATH}`);
  console.log(`   File size: ${fileSizeMB} MB`);
  
  // Get public URL (if bucket is public) or signed URL
  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(STORAGE_PATH);
  
  if (urlData?.publicUrl) {
    console.log(`   Public URL: ${urlData.publicUrl}`);
  }

  console.log('\n💡 Next steps:');
  console.log('   1. The model will be automatically downloaded during Railway deployment');
  console.log('   2. Or download on-demand when the model file is missing locally');
  console.log('   3. To update the model, just run this script again (it will overwrite)');
}

uploadModel().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

