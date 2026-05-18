# Refactoring and Improvements

Tracking doc for refactoring (structure, hooks, components) and broader improvements (UX, types, performance, DevOps, accessibility). Use this to record progress and decide what to do next.

**Goals:** Make Meridian Takeoff a **professional-grade construction takeoff app** that is **robust** (reliable, good error handling, tests), **well-written** (clear types, maintainable structure), and **fast/efficient** (responsive UI, sensible loading, optional scale improvements).

---

## Completed improvements

### Core infrastructure
- **Toast/error handling** – Replaced all 71 `alert()` calls with **sonner** toasts. `<Toaster richColors position="top-center" />` in App.tsx; consistent `toast.error()` / `toast.success()` / `toast.warning()` / `toast.info()` across components.
- **CI/CD** – GitHub Actions workflow (`.github/workflows/ci.yml`): on push/PR to `main`, runs typecheck (blocking), lint (ESLint with TypeScript + React hooks), test (Vitest, blocking). Typecheck is blocking; merge fails on type errors.
- **Route-level code splitting** – All route components lazy-loaded via `React.lazy()` (LandingPage, FeaturesPage, PricingPage, LoginPage, SignupPage, ProjectList, TakeoffWorkspace); `<Suspense fallback={...}>` wraps Routes. Smaller initial bundle.
- **Store selectors** – Narrow selectors implemented: TakeoffSidebar uses `getProjectConditions(projectId)`, `getProjectTakeoffSummary(projectId)`; SheetSidebar uses `getProjectTakeoffMeasurements(projectId).length` for hasTakeoffs effect; TakeoffWorkspace uses `getCalibration(projectId, sheetId, currentPage)`. Reduces unnecessary re-renders.

### Component refactoring
Major extractions are **done** (hooks, `src/components/pdf-viewer/` subtree, takeoff sidebar modules). The **historical** “before → after” line counts below are from that milestone; modules have grown again with new capability—see **Current state** for today’s approximate hotspots.

- **TakeoffWorkspace** — Previously reduced from ~2,500 lines to ~775 via hooks + UI extractions (orchestration only in the workspace component).
- **TakeoffSidebar** — Previously reduced from ~2,456 lines to ~737 lines: export/report logic in **`src/components/takeoff-sidebar/useTakeoffExport.ts`**; condition list in `TakeoffSidebarConditionList`.
- **PDFViewer** — Previously reduced from a ~4,700-line monolith; SVG/markup helpers in **`src/components/pdf-viewer/pdfViewerRenderers.ts`**; interactions in **`src/components/pdf-viewer/usePDFViewerInteractions.ts`**; plus dedicated hooks for calibration, measurements, data, overlay, dialogs, status.
- **SheetSidebar** — Filter/header/editing/dialog logic extracted into hooks and subcomponents (`useSheetSidebarFilter`, `SheetSidebarHeader`, etc.).
- **Store** – Split into slices (`projectSlice`, `conditionSlice`, `measurementSlice`, `calibrationSlice`, `annotationSlice`, `documentViewSlice`, `undoSlice`); `useTakeoffStore.ts` is a thin re-export (~24 lines).

### Code quality
- **Type safety** – Reduced `any` usage across frontend and server. PDFViewer uses proper pdfjs-dist types (`PDFPageProxy`, `PageViewport`); error handling uses `unknown`; apiService has proper types for all API responses/updates. Server storage layer uses typed DB rows.
- **Window bridge** – `src/lib/windowBridge.ts` provides typed getters/setters for PDF viewer globals; replaces `(window as any)`.
- **Error boundary** – TakeoffWorkspace route wrapped with `ErrorBoundary` in App.tsx.
- **Accessibility** – All custom modals have ARIA (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`); Escape handling; icon-only close buttons have `aria-label`. Form labels/autocomplete issues addressed.
- **Tests** – Vitest + @testing-library/react + jsdom added. See `docs/TESTING.md`.

### Security & architecture
- **Auth** – Centralized `requireAuth` (and `requireAdmin`, `hasProjectAccess`) in `server/src/middleware/auth.ts`; all API routes use it.
- **Security** – Client/server use env vars only (no hardcoded credentials); rate limiting in place; input validation (`validateUUIDParam`, `sanitizeBody`); Supabase security fixes applied (RLS, function `search_path`).
- **Performance** – N+1 queries fixed (batch queries for measurement counts); code splitting (pdfjs chunk, tesseract/exceljs manualChunks, lazy dialogs: AdminPanel, ChatTab, SearchTab, CalibrationDialog, ScaleApplicationDialog; dynamic exceljs/jspdf imports in `useTakeoffExport`); Zustand `useShallow` for object/array selectors in TakeoffSidebar and ChatTab; preconnect hints for Supabase injected at build time.

### OCR & location-aware extraction
- **Higher-quality OCR pipeline** – Iterated on server-side extraction and processing so text is more reliable on construction drawings.
- **Word boxes + page placement** – OCR results persist **word-level geometry** (and related metadata) tied to **document + page**, so downstream features can resolve text **in PDF space**, not only as a flat string.
- **Consumers** – Location-aware OCR supports search/chat, tooling that walks text by region, and future/batch hyperlinking that reasons about **where** a reference sits on the sheet (not just **what** the string says).

---

## Current state

**Heaviest modules (approximate line counts — refresh with `wc -l` when this feels stale):**
- `PDFViewer.tsx` (~3,330 — orchestrates hooks + canvas/overlay)
- `usePDFViewerInteractions.ts` (`src/components/pdf-viewer/` — wheel, keyboard, mouse, selection; ~2,450 lines)
- `SheetSidebar.tsx` (~1,010 — document list + OCR/labeling)
- `AdminPanel.tsx` (~1,040 — tabs: overview, AI prompts, user management)
- `useTakeoffExport.ts` (`src/components/takeoff-sidebar/` — Excel/PDF build; ~1,380 lines)
- `pdfViewerRenderers.ts` (`src/components/pdf-viewer/` — SVG render helpers; ~1,260 lines)

**What's done:** Toast system, route-level code splitting, narrow store selectors, CI/CD, major component refactors, type safety improvements, accessibility basics, security hardening, **location-aware OCR (word boxes + page linkage)**.

**In progress (not stable yet)** – **Batch sheet hyperlinks:** client pipeline under `src/services/batchHyperlink/` plus server/visual-search helpers; substantial progress but **end-to-end behavior still incorrect** — treat as active debugging until linking matches expectations on real sets.

---

## Recommended next steps (by priority)

1. **Batch sheet hyperlinks** – Finish correctness pass: validate sheet-index building, occurrence merge, OCR/word-box alignment with viewer rotation/zoom, and server callout/hyperlink pass against representative projects. Expand automated tests around edge cases once behavior is nailed down.

2. **Performance / large-code** *(deferred: app is fast; only heavy AI-driven flows such as auto-count are slow, which is expected)*
   - **Profile first:** Use React DevTools Profiler on typical flows (open project, switch pages, add measurements, export). Note top 3 components by render time.
   - **Then:** Add `React.memo` only where the profile shows real cost; prefer fewer state updates over memo everywhere.
   - **Optional refactors (maintainability, not required for perf):**
     - **usePDFViewerInteractions** (`src/components/pdf-viewer/usePDFViewerInteractions.ts`, large file): Split by concern (e.g. wheel, keyboard, mouse, selection) only if refactoring that area.
     - **SheetSidebar list:** Extract `SheetSidebarDocumentList` / `SheetSidebarPageRow` to shrink SheetSidebar.tsx further; logic already in hooks/dialogs.
     - **AdminPanel:** Consider splitting by tab if it becomes hard to work in.

3. **Type safety** – Continue reducing `any` where still noted (error handling, filter/result types). Server TS strictness: enable `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` incrementally in `server/tsconfig.json`.

4. **Accessibility** – Remaining: optional focus trap in custom modals; keyboard navigation in critical flows.

5. **Other improvements (as needed)**
   - **E2E:** Configure Playwright and add at least one smoke test (e.g. login → open project → view PDF).
   - **API list pagination (optional scale-up):** Batched/count fixes are in place for hot paths (e.g. measurement counts across projects). `GET /api/projects` still returns **all** rows for the user/admin scope, and conditions for a project are still a **full list** — no `limit`/`offset`/cursor query params wired in `server/src/routes/projects.ts` / `conditions.ts` as of last doc refresh. Add explicit list pagination **if** dashboards or admins regularly hit hundreds+ of projects and payloads become painful.
   - **Lint:** Gradually fix or disable remaining warnings and lower `--max-warnings` in `package.json`.

---

## Detailed sections

### Type safety

- **Frontend:** Reduced `any` usage across PDFViewer, TakeoffWorkspace, SheetSidebar, stores, dialogs, services. PDFViewer uses proper pdfjs-dist types; error handling uses `unknown`; apiService has typed API responses/updates.
- **Server:** Storage layer uses typed DB rows; error handling uses `unknown` with type guards. Server `npx tsc --noEmit` passes.

### Performance

- **Zustand:** Narrow selectors implemented (see "Store selectors" above). `useShallow` used for selectors returning objects/arrays (`getProjectConditions`, `getProjectTakeoffSummary`) in TakeoffSidebar and ChatTab to avoid unnecessary re-renders.
- **Code splitting:** Route-level lazy load + Suspense; pdfjs, tesseract, exceljs manualChunks; lazy dialogs and tabs (AdminPanel, ChatTab, SearchTab, CalibrationDialog, ScaleApplicationDialog); dynamic exceljs/jspdf imports in `useTakeoffExport`.
- **Preconnect:** Supabase origin injected into `index.html` via Vite plugin for faster auth/API connection.
- **Heavy children:** Consider `React.memo` only if profiling shows them as hot. Prefer fewer state updates over memo everywhere.

### Consistency & hygiene

- **Window globals:** `src/lib/windowBridge.ts` with typed getters/setters.
- **Error boundaries:** TakeoffWorkspace route wrapped with ErrorBoundary.
- **Tests:** Vitest + @testing-library/react + jsdom. See `docs/TESTING.md`.

### Frontend quality

- **Error handling:** Toast system (sonner) replaces all `alert()` calls.
- **Loading states:** Consider standardizing naming (`loading` vs `isLoading`) and patterns.
- **Accessibility:** ARIA on custom modals; form labels/autocomplete addressed. Remaining: focus trap, keyboard navigation.
- **Form library:** Optional: adopt react-hook-form for complex forms and consistent error display.

### Testing & DevOps

- **CI/CD:** GitHub Actions runs typecheck (blocking), lint, test on push/PR to `main`. Optional: E2E job and security/dependency checks.
- **E2E:** Playwright/E2E removed for now; manual testing preferred. Can add again later if desired.
- **Backend TS strictness:** `server/tsconfig.json` has `noImplicitAny: false`, `strictNullChecks: false`, `strictFunctionTypes: false`. Enabling incrementally would improve type safety.
- **API list pagination:** Not implemented on project/condition **list** endpoints (full payload per request). Other batching (e.g. chunked IDs, aggregated counts) reduces N+1 and memory spikes elsewhere; add cursor/`limit` to list routes only when warranted by data size.
