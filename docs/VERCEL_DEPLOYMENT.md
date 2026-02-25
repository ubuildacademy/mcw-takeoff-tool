# Vercel deployment

This project deploys the **frontend only** to Vercel. For a short checklist so commits don’t break CI, Vercel, or Railway, see **[Deploy checklist](DEPLOY_CHECKLIST.md)**. The API is hosted elsewhere (e.g. Railway); `vercel.json` rewrites `/api/*` to that backend.

## Invite emails and FRONTEND_URL

When admins invite users via email (Microsoft Graph), the invite link in the email is built on the **backend** (Railway). The backend must know your production frontend URL via `FRONTEND_URL`.

**Railway (backend) env:**
- `FRONTEND_URL` – Set to your production frontend URL, e.g. `https://mcw-takeoff-tool.vercel.app`
- Without this, invite links default to `http://localhost:3000` and users get 404s when they click accept.

## Build setup (known working)

- **Install:** `NODE_ENV=development npm install` (in `vercel.json`). This ensures devDependencies are installed so typecheck and Vite build succeed. Do not switch to `npm ci` or change this without checking Vercel build logs—a previous attempt with `npm ci` caused deploy failures.
- **Build:** `npm run build` → `copy-pdf-worker` → `typecheck` → `vite build`.
- **Output:** `dist/`.

## Why a deploy might fail (without access to logs)

Inferred from which commits deployed vs failed:

1. **TypeScript / typecheck** – If the commit touches code and typecheck fails in CI (GitHub Actions), the same error will fail the Vercel build because `npm run build` runs typecheck. Fix the type error and push again.
2. **Install or config change** – Changing `installCommand` (e.g. to `npm ci`), adding `engines` in package.json, or adding `.nvmrc` has been observed to break Vercel deploys even when the same build works locally. Keep the install command as `NODE_ENV=development npm install` unless you can confirm a new config works via build logs.

## If you get access to Vercel logs

1. Open the failed deployment → **Building** (or **Logs**) and use the exact error message.
2. **Typecheck:** Fix the reported file/line (should match GitHub Actions if it failed there too).
3. **Install:** If the error is about package-lock.json or `npm ci`, revert to `NODE_ENV=development npm install`.
4. **Reproduce locally:** `rm -rf node_modules dist && npm install && npm run build`. If it passes locally, the issue is likely Vercel environment (Node version, install command, or cache).
