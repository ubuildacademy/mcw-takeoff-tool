#!/usr/bin/env node
/**
 * Installs Git hooks from scripts/githooks/ into .git/hooks/.
 * Runs on npm install (prepare script).
 */
import { chmod, copyFile, mkdir, access, readdir } from 'fs/promises';
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

  await mkdir(hooksDest, { recursive: true });

  if (!(await exists(hooksSrc))) {
    return;
  }

  const entries = await readdir(hooksSrc, { withFileTypes: true });
  const hookFiles = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => !name.startsWith('.'));

  if (hookFiles.length === 0) {
    return;
  }

  for (const name of hookFiles) {
    const src = join(hooksSrc, name);
    const dest = join(hooksDest, name);
    await copyFile(src, dest);
    await chmod(dest, 0o755);
  }

  console.log(`Git hooks installed: ${hookFiles.join(', ')}`);
}

main().catch((err) => {
  console.warn('install-git-hooks:', err.message);
  process.exitCode = 0; // don't fail npm install
});
