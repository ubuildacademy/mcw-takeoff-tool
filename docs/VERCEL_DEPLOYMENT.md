# Vercel deployment

This project deploys the **frontend only** to Vercel. The API is hosted elsewhere (e.g. Railway); `vercel.json` rewrites `/api/*` to that backend.

## Build setup

- **Install:** `npm ci` (reproducible; installs devDependencies so typecheck and Vite build succeed).
- **Build:** `npm run build` → `copy-pdf-worker` → `typecheck` → `vite build`.
- **Output:** `dist/`.
- **Node:** Use Node 18+ (see `package.json` `engines` and `.nvmrc`). In Vercel, set **Node.js Version** to 18.x or 20.x if needed (Project Settings → General).

## If the build fails on Vercel

1. **Get the exact error**  
   Vercel dashboard → your project → **Deployments** → failed deployment → **Building** (or **Logs**). The failure is usually at the end of the build or install step.

2. **Typical causes**
   - **TypeScript / typecheck:** Fix the reported file and line (CI typecheck is blocking, so this should match what you see in GitHub Actions).
   - **Missing devDependencies:** Build needs `vite`, `typescript`, etc. We use `npm ci` so the full dependency tree is installed. If you changed the install command, ensure it doesn’t skip devDependencies.
   - **Node version:** Vercel should use Node 18+ (`.nvmrc` and `engines`). If your error is “unsupported” or “syntax,” set Node.js Version in Project Settings to **20.x**.
   - **Out of memory / timeout:** The build is large (pdfjs, exceljs, etc.). If the job runs out of memory or times out, try enabling **Vercel’s “Include source maps”** off to reduce work, or contact Vercel about increasing build resources.

3. **Reproduce locally**  
   From repo root:  
   `rm -rf node_modules dist && npm ci && npm run build`  
   If this fails, fix the error locally first; the same fix should apply on Vercel.
