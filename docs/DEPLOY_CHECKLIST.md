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

To check which applies, hit any API route in production and look at the request's
`X-Forwarded-For`: the hop count is the number of addresses appended *after* the
client's own. Confirm it after any change to `vercel.json`'s rewrites or to
`VITE_API_BASE_URL`.

---

**Summary:** Rely on the pre-push hook so typecheck, build, lint, and test run before every push. Commit new imported files, and don’t remove exports that are still used. That keeps CI, Vercel, and Railway from failing on bad commits.
