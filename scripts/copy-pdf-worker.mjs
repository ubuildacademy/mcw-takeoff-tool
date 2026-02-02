#!/usr/bin/env node
/**
 * Copies the pdfjs-dist worker from node_modules to public/ so the worker
 * version always matches the installed pdfjs-dist (avoids API/worker version mismatch).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const dest = path.join(root, 'public', 'pdf.worker.min.mjs');

if (!fs.existsSync(src)) {
  console.error('copy-pdf-worker: pdfjs-dist worker not found at', src);
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log('copy-pdf-worker: copied pdf.worker.min.mjs to public/');
