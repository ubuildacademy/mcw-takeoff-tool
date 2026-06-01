# Roadmap & backlog

Living list of **larger features**, **quality improvements**, and **outstanding work**. Small fixes ship without updating this doc.

**Priority:** Active → Backlog → Hygiene. Remove or move items to "Recently shipped" when done.

---

## Active

| Item | Notes |
|------|--------|
| **Batch sheet hyperlinks** | Template callout pass wired on re-scan / current-doc scope; tighter spatial validation reduces blank-space false positives; bubble/callout crops use isolated-box linking. Validate on real project sets (OCR/word-box alignment with rotation). |

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

| Item | Notes |
|------|--------|
| **Lower ESLint `--max-warnings`** | Reduce gradually in `package.json` as warnings are fixed (frontend ~36, server ~136). |
| **More production log gating** | Visual search / PDF conversion / PyMuPDF paths gated; email startup logs still verbose. |

---

## Recently shipped

| Item | When |
|------|------|
| Server ESLint (`lint:server` in CI via `npm run lint`) | 2026-05 |
| Auto-hyperlink strict/loose mode in Tools UI | 2026-05 |
| Auto-hyperlink refresh sheet index + unmatched-ref toast hints | 2026-05 |
| Production log gating (visual search, PDF conversion, PyMuPDF) | 2026-05 |
| Production log gating (OCR routes, storage deletes, health, backup/OCR client) | 2026-05 |
| Backup export concurrency cap (3 parallel file downloads) | 2026-05 |
| `isAdmin` 60s cache + `requireAdmin` reuses `req.user` | 2026-05 |
| Server validation Vitest tests | 2026-05 |
| Removed stale `@types/pdfjs-dist` | 2026-05 |
| Ollama `/models` requires auth | 2026-05 |
| Removed public `/uploads` static serving | 2026-05 |
| Contact form single rate-limit; `CONTACT_EMAIL` required in prod | 2026-05 |
| Server `tsc` build in CI and `ci:local` | 2026-05 |
