#!/usr/bin/env ts-node
/**
 * Download trained model from Supabase Storage
 * 
 * This script is used during Railway deployment or when model is missing locally
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs-extra';
import * as path from 'path';

const MODEL_FILE = 'server/models/floor_plan_cubicasa5k_resnet50.pth';
const STORAGE_BUCKET = 'project-files';
const STORAGE_PATH = 'models/floor_plan_cubicasa5k_resnet50.pth';

async function downloadModel() {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://mxjyytwfhmoonkduvybr.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseKey) {
    console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
    return false;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check if model already exists locally
  const modelPath = path.resolve(MODEL_FILE);
  if (await fs.pathExists(modelPath)) {
    const stats = await fs.stat(modelPath);
    if (stats.size > 0) {
      console.log(`✓ Model already exists locally: ${modelPath} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
      return true;
    }
  }

  // Create models directory if it doesn't exist
  await fs.ensureDir(path.dirname(modelPath));

  // Download from Supabase Storage
  console.log(`📥 Downloading model from Supabase Storage: ${STORAGE_BUCKET}/${STORAGE_PATH}...`);
  
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(STORAGE_PATH);

  if (error || !data) {
    console.error('❌ Download failed:', error?.message || 'Unknown error');
    return false;
  }

  // Convert blob to buffer and save
  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.writeFile(modelPath, buffer);

  const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
  console.log(`✅ Model downloaded successfully!`);
  console.log(`   Saved to: ${modelPath}`);
  console.log(`   File size: ${fileSizeMB} MB`);

  return true;
}

// Run if called directly
if (require.main === module) {
  downloadModel().then((success) => {
    process.exit(success ? 0 : 1);
  }).catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
}

export { downloadModel };

