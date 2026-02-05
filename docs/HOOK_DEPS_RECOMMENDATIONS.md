# Hook dependency audit — recommendations

Recommendations for each item in `HOOK_DEPS_AUDIT.md`: **Add deps** vs **Omit + document**, with brief rationale. Use this when applying fixes.

---

## SheetSidebar.tsx

| Line | Hook | Recommendation | Rationale |
|------|------|----------------|-----------|
| 240 | useEffect | **Omit + document** | Effect is intentionally driven by `projectMeasurementsCount` (and `onDocumentsUpdate` / `updateHasTakeoffs`), not by `documents`. Adding `documents` would re-run on every reference change and can cause update loops (effect calls `onDocumentsUpdate(updatedDocuments)`). Comment: "Run when project measurement count changes; omit documents to avoid loops." |
| 281 | useCallback (_processOCR) | **Add deps** | Callback reads `documents` and calls `onDocumentsUpdate(updatedDocuments)`. It should depend on `documents` and `onDocumentsUpdate`. If parent doesn’t memoize `onDocumentsUpdate`, either have parent wrap it in `useCallback` or temporarily omit + document until that’s done. Prefer **add** if parent is already stable. |

---

## TakeoffWorkspace.tsx

| Line | Hook | Recommendation | Rationale |
|------|------|----------------|-----------|
| 246 | useEffect (beforeunload) | **Omit + document** | You already depend on `currentPdfFile?.id` and `setDocumentLocation`. Linter wants `currentPdfFile`; the effect only needs the id for `setDocumentLocation`. Using `currentPdfFile?.id` is correct. Comment: "Only need file id for persist; omit full currentPdfFile." |
| 283 | useCallback (handleConditionSelect) | **Omit + document** | Uses `setSelectedCondition` (and visualSearch setters). React state setters are stable. Comment: "Setters stable; omit." |
| 367 | useCallback (handleDocumentsUpdate) | **Omit + document** | Only calls `setDocuments`. Setter is stable. Comment: "Setter stable; omit." |
| 515 | useCallback (handleCalibrateScale) | **Add deps** | Callback uses `isDev` for `console.warn`. Add `isDev` so the callback stays in sync with dev mode. Safe and accurate. |

---

## useTakeoffWorkspaceDocumentView.ts

| Line | Hook | Recommendation | Rationale |
|------|------|----------------|-----------|
| 96 | useEffect (restore page/scale/rotation) | **Add deps** | Effect reads `currentPdfFile`, `currentPage`, `rotation`, `scale`, and calls `getDocument*`, `setCurrentPage`, `setRotation`, `setScale`, `setSelectedPageNumber`. Either add the minimal set (e.g. `currentPdfFile`, `currentPage`, `rotation`, `scale` plus store getters/setters you use) or, if the intent is “only when file id changes”, keep `currentPdfFile?.id` and **omit + document**: "Run only when file id changes; store getters/setters stable." Prefer **add** with the values it actually reads so behavior is correct when page/rotation/scale change elsewhere. |
| 103 | useEffect (reset initial render flag) | **Omit + document** | Only needs to run when the file identity changes. You already use `currentPdfFile?.id`. Comment: "Run when file id changes; currentPdfFile?.id sufficient." |

---

## useTakeoffWorkspaceProjectInit.ts

| Line | Hook | Recommendation | Rationale |
|------|------|----------------|-----------|
| 77 | useEffect (re-apply rehydrated view) | **Omit + document** | Intended to run once when `documentViewRehydrated` and `currentPdfFile?.id` are set; uses ref to prevent re-run. Store setters and `getDocument*` are stable. Comment: "Run once per file when rehydrated; ref guards; omit store setters/getters." |
| 125 | useEffect (load project files) | **Omit + document** | Intentionally runs only when `projectId` (and isDev for logging) changes; ref guards re-entry. All other deps are store setters or stable getters. Comment: "Run once per projectId; ref guards; omit store setters/getters." |
| 177 | useEffect (set current project, load calibrations/measurements) | **Omit + document** | Same pattern: run once per `projectId`, ref guard. `clearProjectCalibrations`, `loadProjectTakeoffMeasurements`, `setCalibration`, `setCurrentProject` are stable. Comment: "Run once per projectId; ref guards; omit store/load functions." |

---

## PDFViewer.tsx

| Line | Hook | Recommendation | Rationale |
|------|------|----------------|-----------|
| 380 | useEffect (enable ortho when calibrating) | **Omit + document** | Only missing `setIsOrthoSnapping`. Setter is stable. Comment: "Setter stable; omit." |
| 578 | useEffect (box selection mode → selection state) | **Omit + document** | Missing setters: `setIsSelectingSymbol`, `setSelectionBox`, `setSelectionStart`. All stable. Comment: "Setters stable; omit." |
| 586 | useEffect (cutout mode → clear cutout) | **Omit + document** | Missing `setCurrentCutout`. Setter stable. Comment: "Setter stable; omit." |
| 632 | useEffect (file change cleanup) | **Omit + document** | Missing `setLocalTakeoffMeasurements` (and other setters used in cleanup). Effect is keyed by `file.id`; setters stable. Comment: "Run on file.id change; setters stable; omit." |
| 663 | useCallback (updateCanvasDimensions) | **Remove unnecessary dep** | Remove `file.id` from deps if the callback doesn’t need to change when only `file.id` changes (it uses refs and viewport). If it truly only cares about identity for a different reason, keep and document. Prefer **remove** `file.id` if not read inside. |
| 1066 | useCallback (renderTakeoffAnnotations) | **Add deps** (or narrow) | Callback reads many things: `applyOrthoSnapping`, `calibrationValidation`, `isAnnotating`, `isOrthoSnapping`, `measurementDebug`, `pageCommittedPolylineRefs`, `selectedMarkupIds`, `viewState.rotation`, etc. Either add the real dependencies so re-renders stay correct, or if the list is intentionally reduced for performance, **omit + document** with a clear comment. Prefer **add** for correctness unless profiling shows a need to narrow. |
| 1299 | useCallback (rotation/scale → re-render markups) | **Omit + document** | Missing `renderMarkupsWithPointerEvents`. That callback is updated elsewhere and often stored in a ref for renderPDFPage; adding it could cause cascading re-runs. Comment: "Re-render on scale/rotation; renderMarkupsWithPointerEvents via ref / intentional omit to avoid cascade." |
| 1314 | useEffect (force re-render when viewport changes) | **Add deps** | Effect uses `currentMeasurement.length`, `isAnnotating`, `isCalibrating`, `isMeasuring`, `showTextInput` in the “rendersBlocked” check. Add these so the effect doesn’t use stale values. **Add.** |
| 1553 | useCallback (renderPDFPage) | **Omit + document** | Missing refs and `onPDFRendered`, `isDrawingBoxSelection`, `isInitialRenderComplete`, `showTextInput`. This is a large render callback; refs are intentionally used to avoid dependency churn. Comment: "Refs and parent callback intentionally omitted to avoid cascade; refs kept in sync elsewhere." |
| 1602 | useCallback (createRubberBandElement) | **Omit + document** | Missing `getSelectedCondition`, `pageRubberBandRefs`, `setRubberBandElement`. Refs + setter; listing refs doesn’t match ref semantics. Comment: "Refs and setter stable; omit." |
| 1787 | useCallback (completeMeasurement) | **Omit + document** | Missing refs and setters: `calibrationViewportRef`, `currentViewport`, `isCompletingMeasurementRef`, `lastCompletionTimeRef`, `setCurrentMeasurement`, `setMousePosition`. Refs intentionally omitted; setters stable. Comment: "Refs and setters; omit." |
| 1928 | useCallback (completeCutout) | **Omit + document** | Missing `calibrationViewportRef`, `setCurrentCutout`, `setLocalTakeoffMeasurements`. Same pattern. Comment: "Ref and setters stable; omit." |
| 1951 | useCallback (cleanupContinuousDrawing) | **Omit + document** | Missing `pageRubberBandRefs`, `setActivePoints`, `setIsContinuousDrawing`, `setRubberBandElement`, `setRunningLength`. Refs + setters. Comment: "Refs and setters stable; omit." |
| 1981 | useCallback (same as 1951) | **Omit + document** | Same as 1951. Comment: "Refs and setters stable; omit." |
| 2023 | useEffect (cleanup rubber band / polylines on page change) | **Omit + document** | Effect only needs to run when `currentPage` changes. It uses `pageCommittedPolylineRefs` and `pageRubberBandRefs` for cleanup; refs shouldn’t be in deps. Comment: "Run on currentPage change; refs used for cleanup only; omit refs." |
| 2082 | useCallback (fitToWindow) | **Add deps** | Uses `currentPage` (e.g. in setPageViewports). Add `currentPage` so fit-to-window always targets the current page. **Add.** |
| 2170 | useEffect (page change → set viewport, render) | **Add deps** | Uses `viewState.rotation` (and scale) when getting viewport. Already has `viewState.scale`, `viewState.rotation` in the dependency array in the snippet — if linter still flags `viewState.rotation`, ensure `viewState` or both scale and rotation are in deps. **Add** if missing. |
| 2240 | useEffect (clear measurement on page change) | **Omit + document** | Only missing `setMeasurements`, `setCurrentMeasurement`, `setMousePosition`. Setters stable. Comment: "Run on currentPage; setters stable; omit." |
| 2297 | useEffect (viewport fallback) | **Omit + document** | Same: setters and possibly refs. Comment: "Setters stable; omit." |
| 2326 | useEffect (optimized re-render on view state change) | **Add deps** | Uses `applyInteractiveZoomTransforms` inside the effect. Add it so the effect stays in sync. If that callback is unstable and causes loops, have the parent stabilize it or **omit + document** with "applyInteractiveZoomTransforms intentionally omitted to avoid cascade." Prefer **add** if the callback is memoized. |
| 2415 | useEffect (set measurement type when condition selected) | **Omit + document** | Many setters; all stable. Comment: "Setters stable; omit." |
| 2430 | useEffect (set annotation mode) | **Omit + document** | Setters stable. Comment: "Setters stable; omit." |
| 2441 | useEffect (calibration request listener) | **Omit + document** | Missing `setShowCalibrationDialog`. Setter stable. Comment: "Setter stable; omit." |
| 2462 | useEffect (cleanup on unmount) | **Fix ref in cleanup** | Don’t add refs to deps. At the **start** of the effect, do `const canvas = pdfCanvasRef.current` and in the cleanup use `canvas` (and same for SVG overlay below). That satisfies both correctness and the linter. **Fix pattern.** |
| 2472 | useEffect (same cleanup) | **Fix ref in cleanup** | Same as 2462: capture `const svg = svgOverlayRef.current` at top of effect, use `svg` in cleanup. **Fix pattern.** |

---

## usePDFViewerInteractions.ts

| Line | Hook | Recommendation | Rationale |
|------|------|----------------|-----------|
| 572 | useCallback (handleKeyDown) | **Omit + document** | Missing: `onPageShownRef`, `renderMarkupsWithPointerEventsRef`, `setIsContinuousDrawing`, `svgOverlayRef`, `updateMarkupPointerEventsRef`. All refs or one setter. Comment: "Refs and setter stable; omit." |
| 574 | useCallback (same) | **preserve-manual-memoization** | **Omit + document**: manual deps list is intentional for this key handler. Comment: "Manual deps intentional for key handler; compiler list differs." |
| 708 | useCallback (handleMouseDown) | **Omit + document** | Missing `pdfCanvasRef`. Ref used for guard only. Comment: "Ref used for guard only; omit." |
| 710 | useCallback (same) | **preserve-manual-memoization** | **Omit + document**: keep manual list. Comment: "Manual deps intentional." |
| 966 | useCallback (handleMouseUp) | **Omit + document** | Missing refs and `setLocalAnnotations`: `annotationDragJustCompletedRef`, `annotationMoveJustCompletedRef`, `completeMeasurementRef`, `measurementDragJustCompletedRef`, `measurementMoveJustCompletedRef`, `pdfCanvasRef`, `setLocalAnnotations`. Refs + setter. Comment: "Refs and setter stable; omit." |
| 968 | useCallback (same) | **preserve-manual-memoization** | **Omit + document**: manual deps intentional. Comment: "Manual deps intentional." |
| 1176 | useCallback (handleMouseMove) | **Add deps** | Uses `isOrthoSnapping` (e.g. for ortho snapping behavior). Add `isOrthoSnapping`. `pdfCanvasRef` omit. So: **add** `isOrthoSnapping`; **omit + document** for `pdfCanvasRef`. |
| 1178 | useCallback (same) | **preserve-manual-memoization** | **Omit + document**: manual deps intentional. Comment: "Manual deps intentional." |
| 1416 | useCallback (handleClick) | **Omit + document** | Missing `pdfCanvasRef`, `pdfPageRef`, `setIsDeselecting`. Refs + setter. Comment: "Refs and setter stable; omit." |
| 1418 | useCallback (same) | **preserve-manual-memoization** | **Omit + document**: manual deps intentional. Comment: "Manual deps intentional." |
| 1489 | useCallback (handleDoubleClick) | **Omit + document** | Missing refs: `completeContinuousLinearMeasurementRef`, `completeCutoutRef`, `completeMeasurementRef`. Callbacks are invoked via refs on purpose. Comment: "Completion callbacks via refs; omit." |
| 1491 | useCallback (same) | **preserve-manual-memoization** | **Omit + document**: manual deps intentional. Comment: "Manual deps intentional." |
| 1588 | useCallback (handleSvgClick) | **Omit + document** | Missing refs: `annotationMoveJustCompletedRef`, `isSelectionModeRef`, `measurementDragJustCompletedRef`, `measurementMoveJustCompletedRef`. All refs. Comment: "Refs for completion/selection state; omit." |
| 1590 | useCallback (same) | **preserve-manual-memoization** | **Omit + document**: manual deps intentional. Comment: "Manual deps intentional." |

---

## Summary

- **Add deps:** SheetSidebar 281 (if parent is stable), TakeoffWorkspace 515, useTakeoffWorkspaceDocumentView 96 (or omit with clear comment), PDFViewer 1314, 2082, 2170 (if missing), 2326 (if callback stable), usePDFViewerInteractions 1176 (`isOrthoSnapping` only).
- **Fix ref-in-cleanup pattern (no omit):** PDFViewer 2462, 2472 — capture ref at start of effect, use variable in cleanup.
- **Remove unnecessary dep:** PDFViewer 663 — remove `file.id` if not needed.
- **Omit + document:** Everything else in the table above where the missing deps are refs, React state setters, or intentionally excluded to avoid loops/cascades.

After applying each change, run `npm run lint` and update `HOOK_DEPS_AUDIT.md` Decision/Notes as you go.
