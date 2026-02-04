#!/usr/bin/env node
/**
 * Installs Git hooks from scripts/githooks/ into .git/hooks/ so CI/Vercel
 * failures are caught before push. Runs on npm install (prepare script).
 */
import { chmod, copyFile, mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const hooksSrc = join(repoRoot, 'scripts', 'githooks');
const hooksDest = join(repoRoot, '.git', 'hooks');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(join(repoRoot, '.git')))) {
    return; // not a git repo (e.g. npm pack)
  }
  const prePushSrc = join(hooksSrc, 'pre-push');
  if (!(await exists(prePushSrc))) {
    return;
  }
  await mkdir(hooksDest, { recursive: true });
  const prePushDest = join(hooksDest, 'pre-push');
  await copyFile(prePushSrc, prePushDest);
  await chmod(prePushDest, 0o755);
  console.log('Git hooks installed (pre-push: typecheck + build).');
}

main().catch((err) => {
  console.warn('install-git-hooks:', err.message);
  process.exitCode = 0; // don't fail npm install
});
