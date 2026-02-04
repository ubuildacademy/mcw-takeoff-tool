# Deploy checklist — keep CI, Vercel, and Railway green

To avoid pushing commits that fail on GitHub Actions, Vercel, or Railway, use these habits so all three stay green.

## 1. Pre-push hook (automatic)

A **pre-push hook** is installed when you run `npm install` (via the `prepare` script). Before every `git push`, it runs:

- `npm run typecheck`
- `npm run build`

If either fails, the push is **blocked**. That catches missing files (e.g. `apiAuth`), removed exports (e.g. `SelectionBox`), and type errors before they hit CI or Vercel.

**If you don’t have the hook yet:** run `npm install` once in the repo, or copy the hook manually:

```bash
cp scripts/githooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

**To skip the hook once** (not recommended): `git push --no-verify`

## 2. Run CI locally before pushing

Same checks as the hook, on demand:

```bash
npm run ci:local
```

This runs typecheck then build. Run it before pushing if you want to double-check, or if you temporarily disabled the hook.

## 3. Commit any new files that are imported

If you add a **new file** that other code imports (e.g. `src/lib/apiAuth.ts`), it **must** be committed. Otherwise CI and Vercel don’t have it and typecheck fails with “Cannot find module …”.

- After adding a new module, run `git status` and `npm run typecheck`.
- If typecheck passes only when the file exists, add and commit that file in the same commit (or an immediate follow-up).

## 4. Don’t remove exported types used elsewhere

If you remove or rename an **export** (e.g. `SelectionBox` from `PDFViewer.types.ts`), ensure nothing else imports it. Otherwise the build fails. A quick search for the symbol (e.g. `SelectionBox`) before removing it avoids this.

## 5. Vercel-specific

- **Install command:** Keep `NODE_ENV=development npm install` in `vercel.json`. Changing it to `npm ci` or changing Node version (e.g. `engines` / `.nvmrc`) has broken deploys in the past. See `docs/VERCEL_DEPLOYMENT.md`.

---

**Summary:** Rely on the pre-push hook so typecheck + build run before every push. Commit new imported files, and don’t remove exports that are still used. That keeps CI, Vercel, and Railway from failing on bad commits.
