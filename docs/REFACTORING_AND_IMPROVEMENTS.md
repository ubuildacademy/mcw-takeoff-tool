# Refactoring and Improvements

Tracking doc for refactoring (structure, hooks, components) and broader improvements (UX, types, performance, DevOps, accessibility). Use this to record progress and decide what to do next.

**Goals:** Make Meridian Takeoff a **professional-grade construction takeoff app** that is **robust** (reliable, good error handling, tests), **well-written** (clear types, maintainable structure), and **fast/efficient** (responsive UI, sensible loading, optional scale improvements).

---

## Done (this session)

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

## 1. Further component refactors (by impact)

| Target | Lines | Suggestion |
|--------|-------|------------|
| **PDFViewer.tsx** | ~2,498 | **Done:** All SVG markup renderers in **`pdfViewerRenderers.ts`**; **`usePDFViewerInteractions`** provides **`getCssCoordsFromEvent`**, **`handleWheel`**, **`handleKeyDown`**, and all mouse handlers (**`handleMouseDown`**, **`handleMouseUp`**, **`handleMouseMove`**, **`handleClick`**, **`handleDoubleClick`**, **`handleCanvasDoubleClick`**, **`handleSvgClick`**, **`handleSvgDoubleClick`**). PDFViewer reduced from ~4,735 to ~2,498 lines; interactions hook ~1,608 lines. |
| **SheetSidebar.tsx** | ~1,823 | **Done:** Filter in **`useSheetSidebarFilter`**; **`SheetSidebarHeader`** (upload, bulk actions, search, filter); **`useSheetSidebarSheetEditing`** (sheet name/number inline edit); **`SheetSidebarDialogs`** (Labeling, Bulk Analysis, Rename). Optional: extract **SheetSidebarDocumentList** / **SheetSidebarPageRow** to shrink further. |
| **TakeoffSidebar.tsx** | ~743 | Already refactored (useTakeoffExport, TakeoffSidebarConditionList). Optional: extract more tool UI if needed. |

---

## 2. Type safety

- **Reduced `any` usage:** PDFViewer (viewport → PageViewport, error → unknown), TakeoffWorkspace (file/upload types, getErrorMessage), SheetSidebar (result/updateData types, filterBy), stores (condition/project/measurement error → unknown, project map typed), CreateConditionDialog (TakeoffCondition), BackupDialog/ProjectSettingsDialog/ProjectCreationDialog (Project, BackupFileMetadata), ProjectList (Project), serverOcrService (formatSearchResults, getDocumentData OcrResultRow/OCRResult[]), cvTakeoffService (PageDetectionResult, checkStatus, error handling). **Done:** commonUtils, ocrService (PDFDocumentProxy/PDFPageProxy/PageViewport, TesseractLoggerMessage/TesseractRecognizeData/TesseractWord, CDN config omit), supabaseService (ProjectWithCounts, TakeoffFileRow, ProjectFile import), hybridDetectionService (ValidationMessage, HybridDetectionValidation, ocrData types, detectWithYOLOOnly/getYOLOStats return types), AdminPanel/ChatTab/SearchTab, pdfExportUtils. No remaining type `any` in code (only in comments).
- **Done:** PDFViewer `file` prop is now `ProjectFile` (from `../types`); all `file?.id` / `file?.originalName` and casts removed. `usePDFLoad` accepts `ProjectFile | string | File | null | undefined` and uses `PDFDocumentProxy | null` for document state. PDFViewer uses `PDFPageProxy`, `PageViewport` from pdfjs-dist for refs and callbacks; `localTakeoffMeasurements` is `Measurement[]` with full Measurement shape from store maps; `error: any` → `error: unknown` in catch; redundant `condition.type === 'auto-count'` check removed.
- **apiService:** Replaced all `any` with proper types: `ApiFileRow`, `ApiConditionRow`, `ApiMeasurementRow` for raw API responses; `Partial<Project>`, `Partial<TakeoffCondition>`, `Partial<TakeoffMeasurement>` for updates; `Omit<TakeoffCondition, 'id'> | Partial<TakeoffCondition>` for createCondition; `Omit<TakeoffMeasurement, 'id'> | Partial<TakeoffMeasurement>` for createTakeoffMeasurement; `Record<string, unknown>` for updateSheet/updateSettings; `unknown` for updateSetting value and submitClientResults results. Takeoff-workspace hooks have no `any`.

---

## 3. Performance

- **Zustand:** Selectors are already narrow. If a component only needs one field, use `(s) => s.field` to avoid re-renders when unrelated state changes.
- **Heavy children:** Consider `React.memo` on `PDFViewer` and `TakeoffSidebar` only if profiling shows them as hot. Prefer "fewer state updates" (already improved by hooks) over memo everywhere.
- **Code splitting:** **Done.** `vite.config` chunks `pdfjs`. **CVTakeoffAgent** is lazy-loaded in `TakeoffWorkspaceDialogs` via `React.lazy()` (loads when user opens the dialog). **CalibrationDialog** and **ScaleApplicationDialog** are lazy-loaded in `PDFViewerDialogs` (load when user opens calibration flow). **Excel/PDF export:** `useTakeoffExport` dynamically imports `exceljs` inside `exportToExcel` and `jspdf`, `pdf-lib`, `pdfExportUtils` inside `exportToPDF`, so those libraries load only when the user triggers an export. Initial bundle is smaller; heavy UI and export libs load on demand.

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

- **Unified error handling:** Many components still use `alert()` for errors (TakeoffWorkspace, TakeoffSidebar, useTakeoffExport, AdminPanel, SheetSidebar, dialogs, etc.). Introduce a toast/notification system (e.g. sonner or Radix Toast) and replace `alert()` with consistent, non-blocking feedback.
- **Loading state consistency:** Loading indicators exist in many places; consider standardizing naming (`loading` vs `isLoading`) and patterns so async flows are predictable.
- **Accessibility:** Only a few `alt` attributes in the app; no ARIA labels/roles or focus management in modals. Add `alt` on images, ARIA where needed, focus trap/return in modals, and ensure keyboard navigation works in critical flows.
- **Form library & validation:** No shared form library; validation is manual and inconsistent. Optional: adopt react-hook-form (or similar) for complex forms and consistent error display. Add debouncing on search inputs (e.g. condition search, OCR search) using existing `commonUtils.debounce` where appropriate.

---

## 7. Testing & DevOps gaps

- **E2E tests:** Playwright is installed but not configured; no E2E tests yet. Add `playwright.config.ts` and at least one smoke E2E (e.g. login → open project → view PDF).
- **CI/CD:** No GitHub Actions (or equivalent). Add a pipeline for: run unit tests, (optionally) E2E, lint, and optional security/dependency checks before merge or deploy.
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
