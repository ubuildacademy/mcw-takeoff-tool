# Hook dependency audit

**Audit complete.** All checklist items have been addressed; lint passes with 0 hook-dependency warnings. This doc is kept for reference—the table below records the decision and rationale for each fix (useful when reading `eslint-disable` comments in code).

Original purpose: track and fix React hook dependency warnings (exhaustive-deps, preserve-manual-memoization) one at a time. No band-aids—either add missing deps (and fix any bad behavior) or intentionally omit and document why.

---

## How to use this doc

1. **Pick one row** (e.g. start at the top, or pick an easy file like SheetSidebar / TakeoffWorkspace).
2. **Open the file at the given line** and read the `useEffect` or `useCallback` and its dependency array.
3. **Decide:**
   - **Add deps:** Add the missing (or remove the unnecessary) dependency. If the effect/callback then runs too often or causes a loop, fix that (e.g. wrap a parent callback in `useCallback`, or narrow what the effect does).
   - **Omit and document:** If you intentionally keep the current deps (e.g. “run once on mount”, “refs/setters stable”, “would cause loops”), add a one-line comment above the dependency array: `// eslint-disable-next-line react-hooks/exhaustive-deps -- reason`.
4. **Update this table:** Set **Decision** to `Add deps` or `Omit + document`, and **Notes** to a short note (e.g. “Added setX; no extra runs” or “Run once on mount; omit refs”).
5. **Run `npm run lint`** to confirm that warning is gone and no new ones appear.
6. Repeat for the next row.

---

## Decision guide (when to add vs omit)

| Situation | Prefer | Why |
|-----------|--------|-----|
| Missing: **setState setters** (e.g. `setIsOrthoSnapping`) | Usually **omit + document** | React guarantees setters are stable; adding them is redundant. |
| Missing: **refs** (e.g. `pdfCanvasRef`, `pageRubberBandRefs`) | Usually **omit + document** | Refs are mutable; listing them doesn’t match how refs work. Capture in a variable in the effect if the warning is about cleanup. |
| Missing: **callback from parent** (e.g. `onPDFRendered`, `onDocumentsUpdate`) | **Add dep** and have parent wrap in `useCallback`, or **omit + document** if adding would cause loops and parent can’t be changed yet. | If parent re-creates the callback every render, adding it makes the effect run every time; fix at parent or document. |
| Missing: **store getters/setters** (e.g. from Zustand) | Usually **add** (getters/setters are typically stable), or **omit + document** if you want “run only when X changes”. | Store identity is usually stable; adding is often safe. |
| **Unnecessary dependency** (e.g. `file.id` when effect only needs to run when `file` changes) | **Remove** the unnecessary dep. | Keeps the list accurate and avoids extra runs. |
| **Ref in cleanup** (“ref will likely have changed by the time cleanup runs”) | **Fix:** At the start of the effect, do `const node = pdfCanvasRef.current` and use `node` in the cleanup. | Correct pattern for cleanup that uses a ref. |
| **preserve-manual-memoization** | Often **omit + document** (eslint-disable with “manual deps intentional”) or align deps with what the callback actually reads. | Compiler’s suggested deps may differ from the manual list; either sync the list or keep and document. |

---

## Checklist (file → line → rule → decision)

Format: **File** | **Line** | **Hook** | **Rule** | **What’s missing / issue** | **Decision** | **Notes**

### PDFViewer.tsx

| Line | Hook | Rule | What's missing / issue | Decision | Notes |
|------|------|------|------------------------|----------|--------|
| 380 | useEffect | exhaustive-deps | setIsOrthoSnapping | Omit + document | Setter stable; omit |
| 578 | useEffect | exhaustive-deps | setIsSelectingSymbol, setSelectionBox, setSelectionStart | Omit + document | Setters stable; omit |
| 586 | useEffect | exhaustive-deps | setCurrentCutout | Omit + document | Setter stable; omit |
| 632 | useEffect | exhaustive-deps | setLocalTakeoffMeasurements | Omit + document | Run on file.id change; setters stable; omit |
| 663 | useCallback | exhaustive-deps | Unnecessary: file.id | Remove dep | Removed file.id; deps [] |
| 1066 | useCallback | exhaustive-deps | applyOrthoSnapping, calibrationValidation, isAnnotating, isOrthoSnapping, measurementDebug, pageCommittedPolylineRefs, selectedMarkupIds, viewState.rotation | Omit + document | Large render callback; refs/some deps omitted to avoid cascade |
| 1299 | useCallback | exhaustive-deps | renderMarkupsWithPointerEvents | Omit + document | Re-render on scale/rotation; omit to avoid cascade |
| 1314 | useEffect | exhaustive-deps | currentMeasurement.length, isAnnotating, isCalibrating, isMeasuring, showTextInput | Add deps | Added all five |
| 1553 | useCallback | exhaustive-deps | isDrawingBoxSelection, isInitialRenderComplete, onPDFRendered, showTextInput | Omit + document | Refs and parent callback omitted to avoid cascade |
| 1602 | useCallback | exhaustive-deps | getSelectedCondition, pageRubberBandRefs, setRubberBandElement | Omit + document | Refs and setter stable; omit |
| 1787 | useCallback | exhaustive-deps | calibrationViewportRef, currentViewport, isCompletingMeasurementRef, lastCompletionTimeRef, setCurrentMeasurement, setMousePosition | Omit + document | Refs and setters stable; omit |
| 1928 | useCallback | exhaustive-deps | calibrationViewportRef, setCurrentCutout, setLocalTakeoffMeasurements | Omit + document | Ref and setters stable; omit |
| 1951 | useCallback | exhaustive-deps | pageRubberBandRefs, setActivePoints, setIsContinuousDrawing, setRubberBandElement, setRunningLength | Omit + document | Refs and setters stable; omit |
| 1981 | useCallback | exhaustive-deps | (same as 1951) | Omit + document | Refs and setters stable; omit |
| 2023 | useEffect | exhaustive-deps | pageCommittedPolylineRefs, pageRubberBandRefs | Omit + document | Run on currentPage change; refs for cleanup only; omit refs |
| 2082 | useCallback | exhaustive-deps | currentPage | Add deps | Added currentPage; removed unnecessary forceMarkupReRender, localTakeoffMeasurements |
| 2170 | useEffect | exhaustive-deps | viewState.rotation | Add deps | Added viewState.rotation to applyInteractiveZoomTransforms callback |
| 2240 | useEffect | exhaustive-deps | setMeasurements | Omit + document | Run on currentPage; setters stable; omit |
| 2297 | useEffect | exhaustive-deps | setCurrentMeasurement, setMeasurements, setMousePosition | Omit + document | Setters stable; omit (viewport fallback) |
| 2326 | useEffect | exhaustive-deps | applyInteractiveZoomTransforms | Omit + document | applyInteractiveZoomTransforms omitted to avoid cascade |
| 2415 | useEffect | exhaustive-deps | setCurrentMeasurement, setIsMeasuring, setIsSelectionMode, setMeasurementType, setMeasurements, setMousePosition, setSelectedMarkupIds | Omit + document | Setters stable; omit |
| 2430 | useEffect | exhaustive-deps | setCurrentAnnotation, setIsAnnotating, setIsSelectionMode, setMousePosition, setSelectedMarkupIds | Omit + document | Setters stable; omit |
| 2441 | useEffect | exhaustive-deps | setShowCalibrationDialog | Omit + document | Setter stable; omit |
| 2462 | useEffect | exhaustive-deps | Ref in cleanup: copy pdfCanvasRef.current to variable inside effect, use in cleanup | Fix pattern | Captured canvas/svg at effect start; use in cleanup |
| 2472 | useEffect | exhaustive-deps | Ref in cleanup: copy svgOverlayRef.current to variable inside effect, use in cleanup | Fix pattern | Same as 2462 |

### SheetSidebar.tsx

| Line | Hook | Rule | What's missing / issue | Decision | Notes |
|------|------|------|------------------------|----------|--------|
| 240 | useEffect | exhaustive-deps | documents | Omit + document | Run when project measurement count changes; omit documents to avoid loops |
| 281 | useCallback | exhaustive-deps | documents, onDocumentsUpdate | Add deps | Added documents, onDocumentsUpdate; parent wraps onDocumentsUpdate in useCallback |

### TakeoffWorkspace.tsx

| Line | Hook | Rule | What's missing / issue | Decision | Notes |
|------|------|------|------------------------|----------|--------|
| 246 | useEffect | exhaustive-deps | currentPdfFile | Omit + document | Only need file id for persist; omit full currentPdfFile |
| 283 | useCallback | exhaustive-deps | setSelectedCondition | Omit + document | Setters stable; omit |
| 367 | useCallback | exhaustive-deps | setDocuments | Omit + document | Setter stable; omit |
| 515 | useCallback | exhaustive-deps | isDev | Add deps | Added isDev |

### usePDFViewerInteractions.ts

| Line | Hook | Rule | What's missing / issue | Decision | Notes |
|------|------|------|------------------------|----------|--------|
| 572 | useCallback | exhaustive-deps | onPageShownRef, renderMarkupsWithPointerEventsRef, setIsContinuousDrawing, svgOverlayRef, updateMarkupPointerEventsRef | Omit + document | Refs and setter stable; omit |
| 574 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | (same fix) | — |
| 708 | useCallback | exhaustive-deps | pdfCanvasRef | Omit + document | Ref used for guard only; omit |
| 710 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | (same fix) | — |
| 966 | useCallback | exhaustive-deps | annotationDragJustCompletedRef, annotationMoveJustCompletedRef, completeMeasurementRef, measurementDragJustCompletedRef, measurementMoveJustCompletedRef, pdfCanvasRef, setLocalAnnotations | Omit + document | Refs and setter stable; omit |
| 968 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | (same fix) | — |
| 1176 | useCallback | exhaustive-deps | isOrthoSnapping, pdfCanvasRef | Add + omit | Added isOrthoSnapping; omit pdfCanvasRef |
| 1178 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | (same fix) | — |
| 1416 | useCallback | exhaustive-deps | pdfCanvasRef, pdfPageRef, setIsDeselecting | Omit + document | Refs and setter stable; omit |
| 1418 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | (same fix) | — |
| 1489 | useCallback | exhaustive-deps | completeContinuousLinearMeasurementRef, completeCutoutRef, completeMeasurementRef | Omit + document | Completion callbacks via refs; omit |
| 1491 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | (same fix) | — |
| 1588 | useCallback | exhaustive-deps | annotationMoveJustCompletedRef, isSelectionModeRef, measurementDragJustCompletedRef, measurementMoveJustCompletedRef | Omit + document | Refs for completion/selection state; omit |
| 1590 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | (same fix) | — |

### useTakeoffWorkspaceDocumentView.ts

| Line | Hook | Rule | What's missing / issue | Decision | Notes |
|------|------|------|------------------------|----------|--------|
| 96 | useEffect | exhaustive-deps | currentPage, currentPdfFile, getDocument*, rotation, scale, setCurrentPage, setRotation, setScale, setSelectedPageNumber | Omit + document | Run only when file id changes; store getters/setters stable |
| 103 | useEffect | exhaustive-deps | currentPdfFile | Omit + document | Run when file id changes; currentPdfFile?.id sufficient |

### useTakeoffWorkspaceProjectInit.ts

| Line | Hook | Rule | What's missing / issue | Decision | Notes |
|------|------|------|------------------------|----------|--------|
| 77 | useEffect | exhaustive-deps | currentPdfFile, getDocument*, setCurrentPage, setRotation, setScale, setSelectedPageNumber | Omit + document | Run once per file when rehydrated; ref guards; omit store setters/getters |
| 125 | useEffect | exhaustive-deps | getDocument*, getLastViewedDocumentId, setCurrentPage, setCurrentPdfFile, setProjectFiles, setRotation, setScale, setSelectedDocumentId, setSelectedPageNumber | Omit + document | Run once per projectId; ref guards; omit store setters/getters |
| 177 | useEffect | exhaustive-deps | clearProjectCalibrations, loadProjectTakeoffMeasurements, setCalibration, setCurrentProject | Omit + document | Run once per projectId; ref guards; omit store/load functions |

---

## set-state-in-effect (already handled)

These already have an eslint-disable with a short comment in code:

- `usePDFViewerData.ts` ~103 and ~149: intentional reset of local state when deps change.

---

## Progress

- **Total items in this checklist:** ~45 (some useCallback lines have both exhaustive-deps and preserve-manual-memoization; fixing exhaustive-deps may clear or change preserve-manual-memoization).
- **Done:** All. SheetSidebar, TakeoffWorkspace, useTakeoffWorkspaceDocumentView, useTakeoffWorkspaceProjectInit, PDFViewer, and usePDFViewerInteractions checklist items have been addressed; Decision and Notes updated.
- **Suggested order:** Start with SheetSidebar and TakeoffWorkspace (fewer, simpler), then useTakeoffWorkspaceDocumentView / useTakeoffWorkspaceProjectInit, then PDFViewer and usePDFViewerInteractions.
