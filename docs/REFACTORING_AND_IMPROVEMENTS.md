# Refactoring and Improvements

Tracking doc for refactoring (structure, hooks, components) and broader improvements (UX, types, performance, DevOps, accessibility). Use this to record progress and decide what to do next.

**Goals:** Make Meridian Takeoff a **professional-grade construction takeoff app** that is **robust** (reliable, good error handling, tests), **well-written** (clear types, maintainable structure), and **fast/efficient** (responsive UI, sensible loading, optional scale improvements).

---

## Done (this session)

- **Toast/error handling** – Replaced all 71 `alert()` calls with **sonner** toasts. Added `sonner` package; `<Toaster richColors position="top-center" />` in App.tsx; `toast.error()` / `toast.success()` / `toast.warning()` / `toast.info()` used across ProjectSettingsDialog, useTakeoffExport, CVTakeoffAgent, useTakeoffWorkspaceVisualSearch, useSheetSidebarSheetEditing, useTakeoffWorkspaceTitleblock, ChatTab, ProjectList, TakeoffSidebar, AdminPanel, usePDFViewerCalibration, SheetSidebar, CreateConditionDialog, TakeoffWorkspace.
- **Route-level code splitting** – All route components in App.tsx are lazy-loaded via `React.lazy()` (LandingPage, FeaturesPage, PricingPage, LoginPage, SignupPage, ProjectList, TakeoffWorkspace); `<Suspense fallback={...}>` wraps Routes with a simple "Loading…" fallback. Smaller initial JS bundle.
- **Store selectors (step 3)** – TakeoffSidebar: `conditions` → `getProjectConditions(projectId)`, `takeoffMeasurements` → `getProjectTakeoffSummary(projectId)` (effect deps). SheetSidebar: `takeoffMeasurements` → `getProjectTakeoffMeasurements(projectId).length` (projectMeasurementsCount) for hasTakeoffs effect. TakeoffWorkspace: `calibrations` → `getCalibration(projectId, sheetId, currentPage)` (currentCalibration); useTakeoffWorkspaceCalibration now accepts `currentCalibration` instead of `calibrations` array.
- **CI/CD (step 4)** – GitHub Actions workflow (`.github/workflows/ci.yml`): on push/PR to `main`, runs typecheck (blocking), lint (blocking; ESLint with `.eslintrc.cjs`, @typescript-eslint + react-hooks, --max-warnings 500), test (blocking). Added ESLint config and @typescript-eslint/eslint-plugin, @typescript-eslint/parser, eslint-plugin-react-hooks.
- **TakeoffWorkspace** reduced from ~2,500 to ~780 lines via hooks + UI extractions.
- Unused imports/selectors in TakeoffWorkspace removed: `Badge`, `Separator`, `sheetService`, `getProjectTakeoffSummary`, `getProjectTakeoffMeasurements`, `loadProjectConditions`, `Calibration`, `PDFPage`.
- **TakeoffSidebar** – export/report logic extracted into **`useTakeoffExport`** (`src/components/takeoff-sidebar/useTakeoffExport.ts`). Hook provides `getQuantityReportData`, `getQuantityReportDataAsync`, `getCostAnalysisData`, `exportToExcel`, `exportToPDF`. TakeoffSidebar reduced by ~1,200 lines (Excel/PDF build and report aggregation moved into hook).
- **TakeoffSidebar** – Conditions tab list extracted into **`TakeoffSidebarConditionList`** (`src/components/takeoff-sidebar/TakeoffSidebarConditionList.tsx`). Renders search input + condition cards (select, cutout, duplicate, edit, delete, thumbnails, value display). TakeoffSidebar reduced by ~270 lines; `getTypeIcon` / `getTypeColor` removed from sidebar (now in component).
- **PDFViewer** – Calibration flow extracted into **`usePDFViewerCalibration`** (`src/components/pdf-viewer/usePDFViewerCalibration.ts`). Hook owns calibration state (isCalibrating, calibrationPoints, dialogs, pendingScaleData, calibrationData, setCalibrationData, calibrationValidation, internal scale/unit), calibrationViewportRef, restore effect, and handlers (completeCalibration, startCalibration, applyScale). PDFViewer reduced by ~260 lines; CalibrationDialog and ScaleApplicationDialog still rendered in PDFViewer using hook return values.
- **PDFViewer** – All keyboard and mouse interactions moved into **`usePDFViewerInteractions`**: `getCssCoordsFromEvent`, `handleWheel`, `handleKeyDown`, `handleMouseDown`, `handleMouseUp`, `handleMouseMove`, `handleClick`, `handleDoubleClick`, `handleCanvasDoubleClick`, `handleSvgClick`, `handleSvgDoubleClick`. Callbacks defined after the hook (e.g. `renderMarkupsWithPointerEvents`, `onPageShown`, `updateMarkupPointerEvents`) passed via refs to avoid "before initialization" errors. PDFViewer reduced by ~1,100+ lines; hook ~1,608 lines.
- **PDFViewer** – Measurement/annotation/selection state and pure helpers extracted into **`usePDFViewerMeasurements`** (`src/components/pdf-viewer/usePDFViewerMeasurements.ts`). Hook owns measurement state (isMeasuring, measurementType, currentMeasurement, measurements, isCompletingMeasurement, lastClickTime/Position, refs), annotation state (localAnnotations, currentAnnotation, showTextInput, textInputPosition/Value, mousePosition), cutout/visual-search/selection state (currentCutout, isSelectingSymbol, selectionBox, selectionStart, selectedMarkupId, isSelectionMode), continuous linear state (isContinuousDrawing, activePoints, rubberBandElement, runningLength, pageRubberBandRefs, pageCommittedPolylineRefs), ortho snapping (isOrthoSnapping), and helpers (calculateRunningLength, applyOrthoSnapping). PDFViewer reduced by ~120 lines; event handlers remain in PDFViewer and use hook state/setters.
- **PDFViewer** – Canvas/overlay UI split into subcomponents: **`PDFViewerCanvasOverlay`** (`src/components/pdf-viewer/PDFViewerCanvasOverlay.tsx`) wraps the PDF canvas, SVG overlay, loading indicator, and optional text annotation input; **`PDFViewerLoadingIndicator`** and **`PDFViewerTextAnnotationInput`** are used inside the overlay. PDFViewer passes refs, cursor/pointer state, and event handlers (handleClick, handleSvgClick, handleCanvasDoubleClick, handleSvgDoubleClick, etc.) into the overlay. PDFViewer reduced by ~230 lines in the return block.
- **PDFViewer** – Dialogs and status UI extracted: **`PDFViewerDialogs`** (`src/components/pdf-viewer/PDFViewerDialogs.tsx`) renders CalibrationDialog + ScaleApplicationDialog with props from calibration hook; **`PDFViewerStatusView`** (`src/components/pdf-viewer/PDFViewerStatusView.tsx`) renders loading / error / no-document early returns; **`usePDFViewerData`** (`src/components/pdf-viewer/usePDFViewerData.ts`) owns annotations-loading and per-page measurements-loading effects, returns `localTakeoffMeasurements`, `setLocalTakeoffMeasurements`, `measurementsLoading`. PDFViewer reduced by ~180 lines (dialogs block + status returns + three data-loading effects).
- **Window bridge** – **`src/lib/windowBridge.ts`** provides typed getters/setters for PDF viewer globals (`restoreScrollPosition`, `triggerCalibration`, `triggerFitToWindow`). TakeoffWorkspace, PDFViewer, useTakeoffWorkspaceProjectInit, and useTakeoffWorkspaceDocumentView use the bridge instead of `(window as any)`.
- **Error boundary** – TakeoffWorkspace route in `App.tsx` is wrapped with **`ErrorBoundary`** so a single component failure in the workspace doesn't blank the whole UI.
- **SheetSidebar** – Filter/search/expansion in **`useSheetSidebarFilter`** (`sheet-sidebar/useSheetSidebarFilter.ts`); **`SheetSidebarHeader`** (upload, bulk actions, search, filter); **`useSheetSidebarSheetEditing`** (sheet name/number inline edit); **`SheetSidebarDialogs`** (Labeling, Bulk Analysis Confirmation/Progress, Rename Page). SheetSidebar reduced from ~2,323 to ~1,823 lines.
- **Search results** – **`SearchResultsList`** (`src/components/takeoff-workspace/SearchResultsList.tsx`) extracts the "Search Results" list below the PDF viewer; TakeoffWorkspace uses `<SearchResultsList results={searchResults} />`. **`ocrSearchResults`** is now typed as **`SearchResult[]`** (from `../types`); `handleOcrSearchResults`, SheetSidebar, and TakeoffWorkspaceHeader.types use `SearchResult[]` for the callback.
- **Supabase Security Advisor** – Migration **`server/migrations/supabase_security_advisor_fixes.sql`** fixes: (1) function `search_path` for `public.is_admin` and any `update_ocr_training_data*` function; (2) RLS on `public.ocr_training_data` (drops permissive policies, adds authenticated-only). **`docs/SUPABASE_SECURITY_CHECKLIST.md`** covers running the migration plus Dashboard-only steps: enable **Leaked password protection** and **MFA options** in Auth.
- **TypeScript errors** – Fixed all TS errors: added `addAnnotation` to `UsePDFViewerInteractionsOptions` in `usePDFViewerInteractions.ts` and pass-through in PDFViewer; typed `pageRubberBandRefs` and `lastRenderedScaleRef` as `MutableRefObject`; guarded `pageRubberBandRefs.current` with null checks and local `refs` variable; fixed `setPageViewports` callbacks to use `newViewport` (non-null) so state type stays `Record<number, PageViewport>`; removed unused `@ts-expect-error` in `ocrService.ts`. **`npm run typecheck`** passes; CI typecheck is **blocking** (merge fails if there are type errors).
- **Form / label / autocomplete (console issues)** – Addressed "label for doesn't match element id", "form field should have id or name", and "missing autocomplete": added `id` to all `SelectTrigger`s that have a matching `Label htmlFor` (ProjectSettingsDialog status/projectType; CreateConditionDialog type/unit/searchScope; ProjectCreationDialog projectType; ScaleApplicationDialog scope); fixed CalibrationDialog "Known Distance" label (no single input id) via `aria-labelledby` + `<p id="known-distance-label">`; added `id`/`htmlFor`/`name`/`autocomplete` on SheetSidebarHeader search/filter and SheetSidebarDialogs rename input; added `name`/`autocomplete` on AdminPanel (admin-key, chat-prompt, invite-email, invite-role) and SignupPage (email, fullName, company, password, confirmPassword); added `name` on CalibrationDialog feet/inches inputs.
- **Accessibility – custom modals** – All custom modals (non-Radix) now have ARIA and Escape: **SheetSidebarDialogs** (Labeling, Bulk Analysis Confirmation, Bulk Analysis Progress, Rename Page), **CVTakeoffAgent**, **LivePreview**, **ExportProgressOverlay**, **UserProfile** (loading + main). Each has `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to a titled `id`; closeable modals handle Escape on the overlay; icon-only close buttons have `aria-label="Close"`; progress modals use `aria-busy="true"`. Radix-based dialogs already provide focus trap and Escape.
- **SearchTab quick wins** – OCR document search debounced (400ms) via `commonUtils.debounce` so the API is not called on every keystroke; input still updates immediately. Debug `console.log`/`console.error` gated with `import.meta.env.DEV` (dev-only); removed debug useEffect and click-handler logs. Doc updated: CI typecheck described as **blocking** throughout (no continue-on-error); "Fix typecheck" step marked done.

---

## Done (from old audit – architecture & security)

- **Massive components:** **TakeoffWorkspace** reduced from ~2,500 to ~775 lines; **TakeoffSidebar** from ~2,456 to ~743 (export in `useTakeoffExport`, condition list in `TakeoffSidebarConditionList`). **Store** split into slices – `useTakeoffStore.ts` is now a thin re-export (~24 lines); domain state lives in `projectSlice`, `conditionSlice`, `measurementSlice`, `calibrationSlice`, `annotationSlice`, `documentViewSlice`, `undoSlice`. **PDFViewer** reduced from ~4,735 to ~2,498 (SVG renderers in `pdfViewerRenderers.ts`, interactions in `usePDFViewerInteractions`). **SheetSidebar** reduced from ~2,323 to ~1,823 (filter hook, header, sheet-editing hook, dialogs in `sheet-sidebar/`).
- **Auth:** Centralized **`requireAuth`** (and `requireAdmin`, `hasProjectAccess`) in `server/src/middleware/auth.ts`; all relevant API routes use it. No copy-pasted `getAuthenticatedUser()` across route files.
- **N+1 queries:** **`projects.ts`** uses a single batch query for measurement counts (`.in('project_id', projectIds)`) instead of per-project queries.
- **Error swallowing:** Storage layer uses env-based Supabase; route handlers return proper HTTP status and error payloads. (If `storage.ts` still returns empty arrays in `catch` blocks anywhere, that could be audited separately.)
- **Security – credentials:** **Client** (`src/lib/supabase.ts`) and **server** (`server/src/supabase.ts`) use env vars only and throw if missing; no hardcoded fallbacks in source.
- **Security – API auth:** Projects, conditions, takeoff-measurements, files, calibrations, sheets, OCR, users, etc. all use **`requireAuth`** (and admin/project-access where needed) on GET/POST/PUT/DELETE.
- **Security – rate limiting:** **`server/src/middleware/rateLimit.ts`** provides strict (auth), standard (writes), and upload limiters; applied in `server/src/index.ts`.
- **Security – input validation:** **`validateUUIDParam`** on route params; **`sanitizeBody`** for request body fields. UUID and body sanitization in place.

---

## Proposed next steps (by impact)

Use this section to pick the next improvement. All items below are already detailed elsewhere in this doc; this list orders them by **impact for a professional-grade app** (robust, well-written, fast/efficient).

| Priority | Area | What | Why (impact) |
|----------|------|------|---------------|
| **1** | **UX / robustness** | **Toast/error handling** – Replace `alert()` with a unified toast system (e.g. sonner). | Non-blocking, consistent feedback; feels professional; fewer missed errors. See §6 Frontend quality. |
| **2** | **Reliability** | **CI/CD** – GitHub Actions: run unit tests + lint on PRs; optional E2E + security checks. | Catches regressions before merge; enforces quality; required for team/scale. See §7 Testing & DevOps. |
| **3** | **Code quality** | **Types** – Finish reducing `any` where still noted (error handling, filter/result types). | Fewer runtime bugs; better IDE support; easier refactors. See §2 Type safety. |
| **4** | **Optional refactor** | **SheetSidebar list** – Extract **SheetSidebarDocumentList** / **SheetSidebarPageRow** to shrink SheetSidebar.tsx further. | Maintainability only; logic already in hooks/dialogs. See §1 table. |
| **5** | **Performance** | **Measure first** – Use React DevTools profiler; then memo/code-split only where hot. | Avoid premature optimization; app is already code-split. See §3 Performance. |
| **6** | **Inclusion / polish** | **Accessibility** – `alt` text, ARIA, modal focus trap, keyboard navigation in critical flows. | Required for pro/enterprise; better for everyone. See §6 Frontend quality. |
| **7** | **Scale** | **API pagination** – `limit`/`offset` or cursor for `GET /api/projects` and conditions. | Matters when projects/conditions grow. See §7 Testing & DevOps. |
| **8** | **Backend quality** | **Server TS strictness** – Enable `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` incrementally. | Fewer server bugs; safer deploys. See §7. |
| **9** | **E2E** | **Playwright** – Configure and add at least one smoke E2E (e.g. login → open project → view PDF). | Catches integration issues; confidence for releases. See §7. |

**Recommendation:** Do **toast/error handling** next (high impact, moderate effort), then **CI/CD** (foundation for everything else). After that, types and accessibility give the best “professional polish” for the effort.

---

## Current state & performance (tracking)

Consolidated assessment for steps 1–5. Use this to track progress.

**Current state (brief):** Store is slice-based with narrow selectors in many places. Code splitting done (pdfjs chunk, lazy dialogs, dynamic exceljs/jspdf). Heaviest modules: PDFViewer (~2,495), usePDFViewerInteractions (~1,608), SheetSidebar (~1,823), useTakeoffExport (~1,099). Gaps: ~~71 `alert()` calls~~ (replaced with sonner toasts); ~~no route-level code splitting~~ (lazy routes + Suspense in App.tsx); ~~broad store subscriptions~~ (step 3 done); ~~no CI/CD~~ (GitHub Actions: typecheck, lint, test); server TS strictness off.

**What's already good:** Narrow selectors where used; pdfjs + lazy dialogs + dynamic export libs; refs for PDFViewer callbacks; SheetSidebar hash check to avoid update loops.

**Recommended order of work (steps 1–5):**

1. **Toast system** — **Done.** Added sonner; replaced all 71 `alert()` calls with `toast.error()` / `toast.success()` / `toast.warning()` / `toast.info()` as appropriate. `<Toaster richColors position="top-center" />` in App.tsx.
2. **Route-level code splitting** — **Done.** Lazy-load all route components in App.tsx: ProjectList, TakeoffWorkspace, LandingPage, FeaturesPage, PricingPage, LoginPage, SignupPage via `React.lazy()`; wrap `<Routes>` in `<Suspense fallback={...}>` with a simple "Loading…" fallback. Smaller initial bundle; app/chunk loads on first visit to each route.
3. **Store selectors** — **Done.** TakeoffSidebar: `conditions` → `getProjectConditions(projectId)`; `takeoffMeasurements` → `getProjectTakeoffSummary(projectId)` (used in effect deps for thumbnail loading). SheetSidebar: `takeoffMeasurements` → `getProjectTakeoffMeasurements(projectId).length` (projectMeasurementsCount) so effect runs only when project measurement count changes; effect calls updateHasTakeoffs with getter. TakeoffWorkspace: `calibrations` → `getCalibration(projectId, sheetId, currentPage)` (currentCalibration); useTakeoffWorkspaceCalibration now accepts `currentCalibration` instead of `calibrations` array.
4. **CI/CD** — **Done.** GitHub Actions (`.github/workflows/ci.yml`): on push/PR to `main`, run `npm ci`, then typecheck (blocking), lint (ESLint with TypeScript + React hooks; 0 errors, warnings allowed via --max-warnings 500), test (Vitest; blocking). TypeScript errors have been fixed; typecheck passes. CI typecheck is blocking so merge fails on type errors. ESLint config: `.eslintrc.cjs` with @typescript-eslint and react-hooks; optional E2E and security checks can be added later.
5. **Profile** — React DevTools Profiler on typical flows; add `React.memo` or split hooks only where profile shows real cost. Optional later: split usePDFViewerInteractions by concern (wheel/keyboard/mouse/selection) if refactoring that area.

**Quick wins checklist:** [x] Toast system (step 1). [x] Lazy TakeoffWorkspace + ProjectList (step 2). [x] TakeoffSidebar selector(s). [x] TakeoffWorkspace calibrations selector. [ ] One Profiler run, note top 3 components *(deferred – app feels fast; only CV auto-count is slow, which is expected)*.

---

## Re-assessment (current state)

**As of latest review:** Steps 1–4 are done (toast, route-level code splitting, store selectors, CI/CD). The main remaining item from the original outline is **step 5: performance / large-code refactors**.

### Heaviest modules (line counts)

| Module | Lines | Note |
|--------|-------|------|
| **PDFViewer.tsx** | ~2,495 | Orchestrates hooks + canvas/overlay; render logic in pdfViewerRenderers (~1,026). |
| **usePDFViewerInteractions.ts** | ~1,608 | Single hook: wheel, keyboard, mouse, selection, move/drag. Largest single file. |
| **SheetSidebar.tsx** | ~1,810 | Document list + OCR/labeling; filter/header/dialogs already extracted. |
| **AdminPanel.tsx** | ~1,378 | Tabs: overview, AI prompts, user management, sheet-label patterns. |
| **useTakeoffExport.ts** | ~1,100 | Excel/PDF build; already dynamic-imports heavy libs. |
| **pdfViewerRenderers.ts** | ~1,026 | Pure SVG render functions. |
| **TakeoffWorkspace.tsx** | ~775 | Already reduced; uses many hooks. |
| **TakeoffSidebar.tsx** | ~737 | Already reduced; useTakeoffExport + TakeoffSidebarConditionList. |

### What’s done

- **Toast:** All `alert()` replaced with sonner toasts.
- **Code splitting:** Route-level lazy load + Suspense; pdfjs chunk; lazy dialogs; dynamic exceljs/jspdf.
- **Store:** Narrow selectors in TakeoffSidebar, SheetSidebar, TakeoffWorkspace.
- **CI:** GitHub Actions runs typecheck (blocking), lint, test on push/PR to `main`.
- **Existing refactors:** PDFViewer (renderers, calibration, data, measurements, interactions, overlay, dialogs, status); SheetSidebar (filter, header, sheet-editing, dialogs); TakeoffSidebar (export hook, condition list).

### Recommended next steps (by priority)

1. **Step 5 – Performance / large-code** *(deferred: app is fast; only CV auto-count is slow, which is expected)*  
   - **Profile first:** Use React DevTools Profiler on typical flows (open project, switch pages, add measurements, export). Note top 3 components by render time.  
   - **Then:** Add `React.memo` only where the profile shows real cost; prefer fewer state updates over memo everywhere.  
   - **Optional refactors (maintainability, not required for perf):**  
     - **usePDFViewerInteractions** (~1,608 lines): Split by concern (e.g. `usePDFViewerWheel`, `usePDFViewerKeyboard`, `usePDFViewerMouse`, `usePDFViewerSelection`) only if you’re already refactoring that area.  
     - **SheetSidebar list:** Extract **SheetSidebarDocumentList** / **SheetSidebarPageRow** to shrink SheetSidebar.tsx; logic is already in hooks/dialogs.  
     - **AdminPanel:** Consider splitting by tab (e.g. AI prompts, user management, sheet-label patterns) if it becomes hard to work in.

2. **Typecheck in CI** — **Done.** Typecheck is blocking; the workflow has no `continue-on-error` for typecheck. Merge fails if there are type errors.

3. **Other improvements (as needed)**  
   - **Accessibility:** ~~`alt` text~~ (LivePreview img has alt). ~~ARIA, Escape on custom modals~~ — All custom modals (SheetSidebarDialogs x4, CVTakeoffAgent, LivePreview, ExportProgressOverlay, UserProfile x2) now have `role="dialog"`, `aria-modal="true"`, `aria-labelledby`; closeable modals respond to Escape; icon-only close buttons have `aria-label="Close"`. Progress modals use `aria-busy="true"`. Remaining: optional focus trap in custom modals; keyboard nav in critical flows.  
   - **E2E:** Configure Playwright and add at least one smoke test (e.g. login → open project → view PDF).  
   - **API pagination:** Add `limit`/`offset` or cursor to `GET /api/projects` and conditions for scale.  
   - **Server TS strictness:** Enable `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` incrementally in `server/tsconfig.json`.  
   - **Lint:** Gradually fix or disable the ~263 warnings and lower `--max-warnings` in `package.json`.

**Summary:** The only remaining item from the original 5-step outline is **step 5** (profile, then memo/split only where hot). Everything else is optional refactors (splitting large files for maintainability) or other quality items (accessibility, E2E, types, server strictness). Do step 5 when you want to tune performance; do the optional refactors when you’re already touching those files.

---

## 1. Further component refactors (by impact)

| Target | Lines | Suggestion |
|--------|-------|------------|
| **PDFViewer.tsx** | ~2,498 | **Done:** All SVG markup renderers in **`pdfViewerRenderers.ts`**; **`usePDFViewerInteractions`** provides **`getCssCoordsFromEvent`**, **`handleWheel`**, **`handleKeyDown`**, and all mouse handlers (**`handleMouseDown`**, **`handleMouseUp`**, **`handleMouseMove`**, **`handleClick`**, **`handleDoubleClick`**, **`handleCanvasDoubleClick`**, **`handleSvgClick`**, **`handleSvgDoubleClick`**). PDFViewer reduced from ~4,735 to ~2,498 lines; interactions hook ~1,608 lines. |
| **SheetSidebar.tsx** | ~1,823 | **Done:** Filter in **`useSheetSidebarFilter`**; **`SheetSidebarHeader`** (upload, bulk actions, search, filter); **`useSheetSidebarSheetEditing`** (sheet name/number inline edit); **`SheetSidebarDialogs`** (Labeling, Bulk Analysis, Rename). Optional: extract **SheetSidebarDocumentList** / **SheetSidebarPageRow** to shrink further. |
| **TakeoffSidebar.tsx** | ~743 | Already refactored (useTakeoffExport, TakeoffSidebarConditionList). Optional: extract more tool UI if needed. |

---

## 2. Type safety

- **Reduced `any` usage:** PDFViewer (viewport → PageViewport, error → unknown), TakeoffWorkspace (file/upload types, getErrorMessage), SheetSidebar (result/updateData types, filterBy), stores (condition/project/measurement error → unknown, project map typed), CreateConditionDialog (TakeoffCondition), BackupDialog/ProjectSettingsDialog/ProjectCreationDialog (Project, BackupFileMetadata), ProjectList (Project), serverOcrService (formatSearchResults, getDocumentData OcrResultRow/OCRResult[]), cvTakeoffService (PageDetectionResult, checkStatus, error handling). **Done:** commonUtils, ocrService (PDFDocumentProxy/PDFPageProxy/PageViewport, TesseractLoggerMessage/TesseractRecognizeData/TesseractWord, CDN config omit), supabaseService (ProjectWithCounts, TakeoffFileRow, ProjectFile import), hybridDetectionService (ValidationMessage, HybridDetectionValidation, ocrData types, detectWithYOLOOnly/getYOLOStats return types), AdminPanel/ChatTab/SearchTab, pdfExportUtils. No remaining type `any` in frontend (only in comments). **Server (item 3):** storage.ts – added DB row types (ProjectRow, FileRow, ConditionRow, TakeoffMeasurementRow, SheetRow), replaced all `(item: any)` map callbacks with typed row + explicit return type (StoredProject, StoredCondition, etc.); `dbCondition: any` → `Record<string, unknown>`; `(condition as any).aiGenerated` → `condition.aiGenerated` (added `aiGenerated?: boolean` to StoredCondition); `catch (error: any)` → `catch (error: unknown)` with `hasCode(error)` helper for PGRST205. conditions.ts and calibrations.ts – `error: any` → `error: unknown`, db error details via type guard. Server `npx tsc --noEmit` passes.
- **Done:** PDFViewer `file` prop is now `ProjectFile` (from `../types`); all `file?.id` / `file?.originalName` and casts removed. `usePDFLoad` accepts `ProjectFile | string | File | null | undefined` and uses `PDFDocumentProxy | null` for document state. PDFViewer uses `PDFPageProxy`, `PageViewport` from pdfjs-dist for refs and callbacks; `localTakeoffMeasurements` is `Measurement[]` with full Measurement shape from store maps; `error: any` → `error: unknown` in catch; redundant `condition.type === 'auto-count'` check removed.
- **apiService:** Replaced all `any` with proper types: `ApiFileRow`, `ApiConditionRow`, `ApiMeasurementRow` for raw API responses; `Partial<Project>`, `Partial<TakeoffCondition>`, `Partial<TakeoffMeasurement>` for updates; `Omit<TakeoffCondition, 'id'> | Partial<TakeoffCondition>` for createCondition; `Omit<TakeoffMeasurement, 'id'> | Partial<TakeoffMeasurement>` for createTakeoffMeasurement; `Record<string, unknown>` for updateSheet/updateSettings; `unknown` for updateSetting value and submitClientResults results. Takeoff-workspace hooks have no `any`.

---

## 3. Performance

- **Zustand:** **Done (step 3).** Selectors are now narrow for TakeoffSidebar, SheetSidebar, TakeoffWorkspace (see Store selectors bullet below). If a component only needs one field, use `(s) => s.field` to avoid re-renders when unrelated state changes. **To reduce re-renders further:** TakeoffSidebar currently subscribes to full `takeoffMeasurements` and `conditions` — use selectors that return only what the UI needs (e.g. `getProjectTakeoffSummary(projectId)` or length). SheetSidebar subscribes to full `takeoffMeasurements` for hasTakeoffs — consider a stable “fingerprint” selector (e.g. length + projectId) or derived selector. TakeoffWorkspace subscribes to full `calibrations` — use `getCalibration(projectId, sheetId, pageNumber)` if only current-page calibration is needed.
- **Route-level code splitting:** **Done.** All route components (LandingPage, FeaturesPage, PricingPage, LoginPage, SignupPage, ProjectList, TakeoffWorkspace) are lazy-loaded in App.tsx with `<Suspense fallback={...}>`; initial bundle is smaller.
- **Store selectors (step 3):** **Done.** TakeoffSidebar: getProjectConditions(projectId), getProjectTakeoffSummary(projectId). SheetSidebar: getProjectTakeoffMeasurements(projectId).length for hasTakeoffs effect. TakeoffWorkspace: getCalibration(projectId, sheetId, currentPage); useTakeoffWorkspaceCalibration accepts currentCalibration instead of calibrations array.
- **Heavy children:** Consider `React.memo` on `PDFViewer` and `TakeoffSidebar` only if profiling shows them as hot. Prefer "fewer state updates" (already improved by hooks) over memo everywhere. **Measure first** with React DevTools Profiler.
- **Code splitting:** **Done.** `vite.config` chunks `pdfjs`. **CVTakeoffAgent** is lazy-loaded in `TakeoffWorkspaceDialogs` via `React.lazy()` (loads when user opens the dialog). **CalibrationDialog** and **ScaleApplicationDialog** are lazy-loaded in `PDFViewerDialogs` (load when user opens calibration flow). **Excel/PDF export:** `useTakeoffExport` dynamically imports `exceljs` inside `exportToExcel` and `jspdf`, `pdf-lib`, `pdfExportUtils` inside `exportToPDF`, so those libraries load only when the user triggers an export. Initial bundle is smaller; heavy UI and export libs load on demand.
- **Optional:** Split `usePDFViewerInteractions` by concern (wheel, keyboard, mouse, selection) for maintainability; only if refactoring that area or profiling shows it as a hotspot.

---

## 4. Consistency & hygiene

- **Window globals:** ~~TakeoffWorkspace (and possibly PDFViewer) use `(window as any)`~~ → **Done:** `src/lib/windowBridge.ts` with typed getters/setters; all call sites updated.
- **Error boundaries:** ~~Add a React error boundary around the main workspace~~ → **Done:** TakeoffWorkspace route wrapped with ErrorBoundary in App.tsx.
- **Tests:** **Done.** Vitest + @testing-library/react + jsdom added. See `docs/TESTING.md`. First tests: `src/utils/commonUtils.test.ts` (calculateDistance, safeJsonParse, safeJsonStringify, isEmpty, getDefaultUnit) and `src/components/takeoff-workspace/useTakeoffWorkspaceTitleblock.test.ts` (initial state, setTitleblockSelectionMode). Run: `npm run test` or `npm run test:watch`. New hooks remain good candidates for more tests (e.g. useTakeoffWorkspaceOCR, usePDFViewerData).

---

## 5. Optional small wins

- **Search results block:** Done – `SearchResultsList` component; TakeoffWorkspace uses `<SearchResultsList results={searchResults} />`.
- **ocrSearchResults:** Done – typed as `SearchResult[]`; callback and SheetSidebar/Header types updated.

---

## 6. Frontend quality (from audit)

- **Unified error handling:** ~~Many components still use `alert()` for errors~~ → **Done.** Toast/notification system (sonner) added; all `alert()` calls replaced with `toast.error()` / `toast.success()` / `toast.warning()` / `toast.info()` for consistent, non-blocking feedback.
- **Loading state consistency:** Loading indicators exist in many places; consider standardizing naming (`loading` vs `isLoading`) and patterns so async flows are predictable.
- **Accessibility:** Only a few `alt` attributes in the app; no ARIA labels/roles or focus management in modals. Add `alt` on images, ARIA where needed, focus trap/return in modals, and ensure keyboard navigation works in critical flows.
- **Form library & validation:** No shared form library; validation is manual and inconsistent. Optional: adopt react-hook-form (or similar) for complex forms and consistent error display. Add debouncing on search inputs (e.g. condition search, OCR search) using existing `commonUtils.debounce` where appropriate.

---

## 7. Testing & DevOps gaps

- **E2E tests:** Playwright/E2E removed for now; manual testing preferred. Can add again later if desired.
- **CI/CD:** **Done.** GitHub Actions (`.github/workflows/ci.yml`) runs typecheck (blocking), lint, and test on push/PR to `main`. Optional: E2E job and security/dependency checks.
- **Backend TypeScript strictness:** `server/tsconfig.json` has `noImplicitAny: false`, `strictNullChecks: false`, `strictFunctionTypes: false`. Enabling these (incrementally) would improve type safety on the server.
- **API pagination:** `GET /api/projects` and `GET /api/conditions` (including project-scoped) return full lists with no pagination. Add `limit`/`offset` or cursor-based pagination for scale.

---

## Priority order (suggested)

1. ~~**PDFViewer**~~ – Done (hooks, overlay, dialogs, data, measurements). ~~**SheetSidebar**~~ – Done (filter, header, sheet-editing hook, dialogs).
2. **Types** – reduce `any` in new code and in `apiService`/PDFViewer where still noted.
3. ~~**TakeoffSidebar**~~ – Done (useTakeoffExport, TakeoffSidebarConditionList).
4. **Performance** – only after measuring (profiler); memo/code-split where needed.
5. ~~**Window bridge + error boundary**~~ – Done.
6. **Toast/error handling** – replace `alert()` with a unified toast system (e.g. sonner); improves UX and consistency.
7. **CI/CD** – GitHub Actions for test + lint on PRs; optional E2E and security scanning.
8. **Accessibility** – alt text, ARIA, modal focus, keyboard navigation in critical paths.
9. **API pagination** – add pagination to `GET /api/projects` and conditions endpoints for scale.
10. **Backend TS strictness** – enable `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` incrementally in `server/tsconfig.json`.
