# Roadmap & backlog

Living list of **larger features**, **quality improvements**, and **outstanding work**. Small fixes ship without updating this doc.

**Priority:** Active → Backlog → Hygiene. Remove or move items to "Recently shipped" when done.

---

## Active

| Item | Notes |
|------|--------|
| **Batch sheet hyperlinks** | Pipeline in `src/services/batchHyperlink/` + server/visual-search helpers. Recent PyMuPDF/bubble OCR work landed; still needs a **correctness pass** on real project sets (sheet index, occurrence merge, OCR/word-box alignment with viewer rotation, server callout pass). Expand tests once behavior is stable. |

---

## Backlog

### Features & scale

| Item | Notes |
|------|--------|
| **API list pagination** | `GET /api/projects` and project conditions return full lists. Add cursor/`limit` only if admin dashboards or large accounts hit payload limits. |
| **E2E smoke test** | Playwright removed intentionally; add one smoke path later (e.g. login → open project → view PDF) if manual QA becomes a bottleneck. |

### Quality & maintainability

| Item | Notes |
|------|--------|
| **Server TypeScript strictness** | Enable `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` incrementally in `server/tsconfig.json`. |
| **Accessibility** | Optional focus trap in custom modals; keyboard navigation in critical takeoff flows. |
| **Large-file refactors** *(optional)* | Split by concern only when touching that area: `usePDFViewerInteractions.ts`, `SheetSidebar.tsx`, `AdminPanel.tsx`. |
| **Performance profiling** | Deferred while app feels fast; profile with React DevTools if specific flows regress. Prefer fewer state updates over blanket `React.memo`. |

### Ops & security

| Item | Notes |
|------|--------|
| **Supabase Auth hardening** | See `docs/SUPABASE_SECURITY_CHECKLIST.md` and `server/migrations/supabase_security_advisor_fixes.sql` (leaked-password protection, MFA, etc.). |

---

## Hygiene (quick wins)

Lower effort; tackle in batches.

| Item | Notes |
|------|--------|
| **Production log gating** | Use `server/src/lib/devLog.ts` in OCR/storage/health paths; gate client logs with `import.meta.env.DEV`. |
| **Lint server code** | `.eslintrc.cjs` ignores `server/`; extend lint or add a server config. |
| **Server validation tests** | Vitest coverage for `server/src/middleware/validation.ts` (pure helpers). |
| **Backup export concurrency** | Cap parallel file downloads in `server/src/routes/projects.ts` export (avoid OOM on large projects). |
| **`isAdmin` cache** | Short TTL in-memory cache; dedupe `requireAuth` + `requireAdmin` DB lookups. |
| **Remove `@types/pdfjs-dist`** | pdfjs 5 ships types; drop stale v2 typings from root `package.json`. |
| **Lower ESLint `--max-warnings`** | Reduce gradually in `package.json` as warnings are fixed. |

---

## Recently shipped

| Item | When |
|------|------|
| Ollama `/models` requires auth | 2026-05 |
| Removed public `/uploads` static serving | 2026-05 |
| Contact form single rate-limit; `CONTACT_EMAIL` required in prod | 2026-05 |
| Server `tsc` build in CI and `ci:local` | 2026-05 |
| Major refactors (PDF viewer hooks, store slices, toasts, CI, auth middleware) | Pre-2026 backlog |
