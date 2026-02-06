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
- **TakeoffWorkspace** – Reduced from ~2,500 to ~775 lines via hooks + UI extractions.
- **TakeoffSidebar** – Reduced from ~2,456 to ~737 lines: export/report logic in `useTakeoffExport` (~1,100 lines); condition list in `TakeoffSidebarConditionList`.
- **PDFViewer** – Reduced from ~4,735 to ~2,495 lines: SVG renderers in `pdfViewerRenderers.ts` (~1,026 lines); interactions in `usePDFViewerInteractions` (~1,608 lines); calibration in `usePDFViewerCalibration`; measurements/annotations in `usePDFViewerMeasurements`; data loading in `usePDFViewerData`; canvas/overlay in `PDFViewerCanvasOverlay`; dialogs in `PDFViewerDialogs`; status in `PDFViewerStatusView`.
- **SheetSidebar** – Reduced from ~2,323 to ~1,823 lines: filter in `useSheetSidebarFilter`; header in `SheetSidebarHeader`; sheet editing in `useSheetSidebarSheetEditing`; dialogs in `SheetSidebarDialogs`.
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
- **Performance** – N+1 queries fixed (batch queries for measurement counts); code splitting (pdfjs chunk, lazy dialogs, dynamic exceljs/jspdf imports).

---

## Current state

**Heaviest modules (line counts):**
- PDFViewer.tsx: ~2,495 (orchestrates hooks + canvas/overlay)
- usePDFViewerInteractions.ts: ~1,608 (wheel, keyboard, mouse, selection)
- SheetSidebar.tsx: ~1,810 (document list + OCR/labeling)
- AdminPanel.tsx: ~1,378 (tabs: overview, AI prompts, user management)
- useTakeoffExport.ts: ~1,100 (Excel/PDF build; dynamic-imports heavy libs)
- pdfViewerRenderers.ts: ~1,026 (pure SVG render functions)

**What's done:** Toast system, route-level code splitting, narrow store selectors, CI/CD, major component refactors, type safety improvements, accessibility basics, security hardening.

---

## Recommended next steps (by priority)

1. **Performance / large-code** *(deferred: app is fast; only CV auto-count is slow, which is expected)*
   - **Profile first:** Use React DevTools Profiler on typical flows (open project, switch pages, add measurements, export). Note top 3 components by render time.
   - **Then:** Add `React.memo` only where the profile shows real cost; prefer fewer state updates over memo everywhere.
   - **Optional refactors (maintainability, not required for perf):**
     - **usePDFViewerInteractions** (~1,608 lines): Split by concern (e.g. `usePDFViewerWheel`, `usePDFViewerKeyboard`, `usePDFViewerMouse`, `usePDFViewerSelection`) only if refactoring that area.
     - **SheetSidebar list:** Extract `SheetSidebarDocumentList` / `SheetSidebarPageRow` to shrink SheetSidebar.tsx further; logic already in hooks/dialogs.
     - **AdminPanel:** Consider splitting by tab if it becomes hard to work in.

2. **Type safety** – Continue reducing `any` where still noted (error handling, filter/result types). Server TS strictness: enable `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` incrementally in `server/tsconfig.json`.

3. **Accessibility** – Remaining: optional focus trap in custom modals; keyboard navigation in critical flows.

4. **Other improvements (as needed)**
   - **E2E:** Configure Playwright and add at least one smoke test (e.g. login → open project → view PDF).
   - **API pagination:** Add `limit`/`offset` or cursor to `GET /api/projects` and conditions for scale.
   - **Lint:** Gradually fix or disable remaining warnings and lower `--max-warnings` in `package.json`.

---

## Detailed sections

### Type safety

- **Frontend:** Reduced `any` usage across PDFViewer, TakeoffWorkspace, SheetSidebar, stores, dialogs, services. PDFViewer uses proper pdfjs-dist types; error handling uses `unknown`; apiService has typed API responses/updates.
- **Server:** Storage layer uses typed DB rows; error handling uses `unknown` with type guards. Server `npx tsc --noEmit` passes.

### Performance

- **Zustand:** Narrow selectors implemented (see "Store selectors" above). Prefer `(s) => s.field` to avoid re-renders when unrelated state changes.
- **Code splitting:** Route-level lazy load + Suspense; pdfjs chunk; lazy dialogs (CVTakeoffAgent, CalibrationDialog, ScaleApplicationDialog); dynamic exceljs/jspdf imports in `useTakeoffExport`.
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
- **API pagination:** `GET /api/projects` and `GET /api/conditions` return full lists with no pagination. Add `limit`/`offset` or cursor-based pagination for scale.
