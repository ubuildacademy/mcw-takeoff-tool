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

This runs typecheck, build, lint, and test. Run it before pushing if you want to double-check, or if you temporarily disabled the hook.

## 3. Commit any new files that are imported

If you add a **new file** that other code imports (e.g. `src/lib/apiAuth.ts`), it **must** be committed. Otherwise CI and Vercel don’t have it and typecheck fails with “Cannot find module …”.

- After adding a new module, run `git status` and `npm run typecheck`.
- If typecheck passes only when the file exists, add and commit that file in the same commit (or an immediate follow-up).

## 4. Don’t remove exported types used elsewhere

If you remove or rename an **export** (e.g. `SelectionBox` from `PDFViewer.types.ts`), ensure nothing else imports it. Otherwise the build fails. A quick search for the symbol (e.g. `SelectionBox`) before removing it avoids this.

## 5. Vercel-specific

- **Install command:** Keep `NODE_ENV=development npm install` in `vercel.json`. Changing it to `npm ci` or changing Node version (e.g. `engines` / `.nvmrc`) has broken deploys in the past. See `docs/VERCEL_DEPLOYMENT.md`.

## 6. `TRUST_PROXY_HOPS` must match the real proxy chain

The API sets Express's `trust proxy` from `TRUST_PROXY_HOPS` (default `1`). Express
walks `X-Forwarded-For` right-to-left, skips that many hops, and the address it lands
on becomes `req.ip` — which is the rate limiter's bucket key. So this number decides
whether the login limiter works.

- **1** — the browser calls Railway directly, i.e. `VITE_API_BASE_URL` is set in Vercel
  to the Railway host. Railway's edge is the only proxy.
- **2** — the browser calls `/api/...` on the Vercel domain and the `rewrites` rule in
  `vercel.json` proxies to Railway. Vercel is a second proxy.

Set it **too high** and a client can forge the address the limiter counts, which is the
bug this replaced. Set it **too low** and every request appears to come from the proxy's
own IP, so one busy client exhausts the limit for everyone.

**Settled 2026-08-21: the value is 1, and the default is already correct.**
`VITE_API_BASE_URL` is set in Vercel, so Vite constant-folded `getApiBaseUrl` in the
deployed bundle down to a single `return "https://mcw-takeoff-tool-production-28fb.up.railway.app/api"`
— the `/api` fallback branch is dead code and Vercel is not in the API path at all. The
live API confirms one hop in front: `server: railway-hikari` with a single
`x-railway-edge`, no `via:` chain.

Re-check this only if `VITE_API_BASE_URL` is ever removed from Vercel or the
`vercel.json` rewrite starts carrying API traffic — either flips the answer to 2. The
quickest check needs no dashboard access: fetch the deployed bundle and look at what
`getApiBaseUrl` returns.

```bash
curl -s https://mcw-takeoff-tool.vercel.app/assets/$(curl -s https://mcw-takeoff-tool.vercel.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js') | grep -o 'up\.railway\.app'
```

A hit means the Railway URL is baked in — direct, 1 hop. No hit means the bundle falls
back to a relative `/api` and goes through Vercel's rewrite — 2 hops.

## 7. iCloud sync conflicts can break the Railway build while CI stays green

This repo lives under `~/Library/Mobile Documents`. When iCloud hits a sync conflict it
saves a second copy beside the original as `name 2.ts`. On 2026-08-21 one of those —
`server/src/middleware/rateLimit.test 2.ts` — was swept up by `git add -A`, committed,
and failed two Railway deploys with:

```
error TS2307: Cannot find module 'vitest' or its corresponding type declarations
```

Three things had to line up, and all three are worth knowing:

1. `" 2.ts"` does not match `"**/*.test.ts"`, the exclude in `server/tsconfig.json`, so
   tsc compiled a test file it was meant to skip.
2. `vitest` is a dev dependency of the **root** package, not of `server/`.
3. Railway installs production dependencies only, so the import that resolves fine on a
   dev machine is unresolvable there.

**That last point is the general trap: `ci:local` cannot catch this class of failure.**
Locally, `vitest` resolves through the hoisted root `node_modules`, so `npm run
build:server` passes on exactly the tree that fails on Railway. A green `ci:local` is not
by itself evidence that the server will build in production.

Both specific holes are now plugged — `.gitignore` refuses `* [0-9].*`, and the tsconfig
exclude has `"**/* [0-9].ts"` — but if a server build ever fails on Railway with a module
it can find locally, check whether the import is reachable from `server/package.json`
alone rather than from the root.

---

**Summary:** Rely on the pre-push hook so typecheck, build, lint, and test run before every push. Commit new imported files, and don’t remove exports that are still used. That keeps CI, Vercel, and Railway from failing on bad commits.
