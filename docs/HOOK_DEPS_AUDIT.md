# Hook dependency audit

Track and fix React hook dependency warnings (exhaustive-deps, preserve-manual-memoization) one at a time. No band-aids—either add missing deps (and fix any bad behavior) or intentionally omit and document why.

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
| 380 | useEffect | exhaustive-deps | setIsOrthoSnapping | | |
| 578 | useEffect | exhaustive-deps | setIsSelectingSymbol, setSelectionBox, setSelectionStart | | |
| 586 | useEffect | exhaustive-deps | setCurrentCutout | | |
| 632 | useEffect | exhaustive-deps | setLocalTakeoffMeasurements | | |
| 663 | useCallback | exhaustive-deps | Unnecessary: file.id | | |
| 1066 | useCallback | exhaustive-deps | applyOrthoSnapping, calibrationValidation, isAnnotating, isOrthoSnapping, measurementDebug, pageCommittedPolylineRefs, selectedMarkupIds, viewState.rotation | | |
| 1299 | useCallback | exhaustive-deps | renderMarkupsWithPointerEvents | | |
| 1314 | useEffect | exhaustive-deps | currentMeasurement.length, isAnnotating, isCalibrating, isMeasuring, showTextInput | | |
| 1553 | useCallback | exhaustive-deps | isDrawingBoxSelection, isInitialRenderComplete, onPDFRendered, showTextInput | | |
| 1602 | useCallback | exhaustive-deps | getSelectedCondition, pageRubberBandRefs, setRubberBandElement | | |
| 1787 | useCallback | exhaustive-deps | calibrationViewportRef, currentViewport, isCompletingMeasurementRef, lastCompletionTimeRef, setCurrentMeasurement, setMousePosition | | |
| 1928 | useCallback | exhaustive-deps | calibrationViewportRef, setCurrentCutout, setLocalTakeoffMeasurements | | |
| 1951 | useCallback | exhaustive-deps | pageRubberBandRefs, setActivePoints, setIsContinuousDrawing, setRubberBandElement, setRunningLength | | |
| 1981 | useCallback | exhaustive-deps | (same as 1951) | | |
| 2023 | useEffect | exhaustive-deps | pageCommittedPolylineRefs, pageRubberBandRefs | | |
| 2082 | useCallback | exhaustive-deps | currentPage | | |
| 2170 | useEffect | exhaustive-deps | viewState.rotation | | |
| 2240 | useEffect | exhaustive-deps | setMeasurements | | |
| 2297 | useEffect | exhaustive-deps | setCurrentMeasurement, setMeasurements, setMousePosition | | |
| 2326 | useEffect | exhaustive-deps | applyInteractiveZoomTransforms | | |
| 2415 | useEffect | exhaustive-deps | setCurrentMeasurement, setIsMeasuring, setIsSelectionMode, setMeasurementType, setMeasurements, setMousePosition, setSelectedMarkupIds | | |
| 2430 | useEffect | exhaustive-deps | setCurrentAnnotation, setIsAnnotating, setIsSelectionMode, setMousePosition, setSelectedMarkupIds | | |
| 2441 | useEffect | exhaustive-deps | setShowCalibrationDialog | | |
| 2462 | useEffect | exhaustive-deps | Ref in cleanup: copy pdfCanvasRef.current to variable inside effect, use in cleanup | | |
| 2472 | useEffect | exhaustive-deps | Ref in cleanup: copy svgOverlayRef.current to variable inside effect, use in cleanup | | |

### SheetSidebar.tsx

| Line | Hook | Rule | What's missing / issue | Decision | Notes |
|------|------|------|------------------------|----------|--------|
| 240 | useEffect | exhaustive-deps | documents | | |
| 281 | useCallback | exhaustive-deps | documents, onDocumentsUpdate | | |

### TakeoffWorkspace.tsx

| Line | Hook | Rule | What's missing / issue | Decision | Notes |
|------|------|------|------------------------|----------|--------|
| 246 | useEffect | exhaustive-deps | currentPdfFile | | |
| 283 | useCallback | exhaustive-deps | setSelectedCondition | | |
| 367 | useCallback | exhaustive-deps | setDocuments | | |
| 515 | useCallback | exhaustive-deps | isDev | | |

### usePDFViewerInteractions.ts

| Line | Hook | Rule | What's missing / issue | Decision | Notes |
|------|------|------|------------------------|----------|--------|
| 572 | useCallback | exhaustive-deps | onPageShownRef, renderMarkupsWithPointerEventsRef, setIsContinuousDrawing, svgOverlayRef, updateMarkupPointerEventsRef | | |
| 574 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | | |
| 708 | useCallback | exhaustive-deps | pdfCanvasRef | | |
| 710 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | | |
| 966 | useCallback | exhaustive-deps | annotationDragJustCompletedRef, annotationMoveJustCompletedRef, completeMeasurementRef, measurementDragJustCompletedRef, measurementMoveJustCompletedRef, pdfCanvasRef, setLocalAnnotations | | |
| 968 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | | |
| 1176 | useCallback | exhaustive-deps | isOrthoSnapping, pdfCanvasRef | | |
| 1178 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | | |
| 1416 | useCallback | exhaustive-deps | pdfCanvasRef, pdfPageRef, setIsDeselecting | | |
| 1418 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | | |
| 1489 | useCallback | exhaustive-deps | completeContinuousLinearMeasurementRef, completeCutoutRef, completeMeasurementRef | | |
| 1491 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | | |
| 1588 | useCallback | exhaustive-deps | annotationMoveJustCompletedRef, isSelectionModeRef, measurementDragJustCompletedRef, measurementMoveJustCompletedRef | | |
| 1590 | useCallback | preserve-manual-memoization | Compiler deps differ from manual list | | |

### useTakeoffWorkspaceDocumentView.ts

| Line | Hook | Rule | What's missing / issue | Decision | Notes |
|------|------|------|------------------------|----------|--------|
| 96 | useEffect | exhaustive-deps | currentPage, currentPdfFile, getDocument*, rotation, scale, setCurrentPage, setRotation, setScale, setSelectedPageNumber | | |
| 103 | useEffect | exhaustive-deps | currentPdfFile | | |

### useTakeoffWorkspaceProjectInit.ts

| Line | Hook | Rule | What's missing / issue | Decision | Notes |
|------|------|------|------------------------|----------|--------|
| 77 | useEffect | exhaustive-deps | currentPdfFile, getDocument*, setCurrentPage, setRotation, setScale, setSelectedPageNumber | | |
| 125 | useEffect | exhaustive-deps | getDocument*, getLastViewedDocumentId, setCurrentPage, setCurrentPdfFile, setProjectFiles, setRotation, setScale, setSelectedDocumentId, setSelectedPageNumber | | |
| 177 | useEffect | exhaustive-deps | clearProjectCalibrations, loadProjectTakeoffMeasurements, setCalibration, setCurrentProject | | |

---

## set-state-in-effect (already handled)

These already have an eslint-disable with a short comment in code:

- `usePDFViewerData.ts` ~103 and ~149: intentional reset of local state when deps change.

---

## Progress

- **Total items in this checklist:** ~45 (some useCallback lines have both exhaustive-deps and preserve-manual-memoization; fixing exhaustive-deps may clear or change preserve-manual-memoization).
- **Done:** 0 (use this table as you fix; update Decision and Notes, then tick or delete the row when done).
- **Suggested order:** Start with SheetSidebar and TakeoffWorkspace (fewer, simpler), then useTakeoffWorkspaceDocumentView / useTakeoffWorkspaceProjectInit, then PDFViewer and usePDFViewerInteractions.
