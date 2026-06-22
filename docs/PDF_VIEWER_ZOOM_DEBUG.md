# PDF viewer zoom & draw-mode — debug notes

**Purpose:** Document how interactive zoom works in the takeoff PDF viewer, a **fixed regression** (2026-06) where the canvas jumped and the crosshair drifted from the cursor when re-entering draw mode, and what to verify so it does not come back.

**Related code:** `src/components/PDFViewer.tsx`, `src/components/pdf-viewer/usePDFViewerInteractions.ts`, `src/utils/measurementGeometry.ts` (`canvasPixelExtent`).

---

## How interactive zoom works

The PDF canvas is **not** re-rendered on every zoom while the user is drawing, calibrating, or in the post-deselection cooldown. That avoids flicker. Instead:

1. **`viewState.scale`** — the logical zoom the user requested (toolbar, wheel, pinch).
2. **`lastRenderedScaleRef`** — the scale the canvas bitmap was last rasterized at. Updated only when `renderPDFPage` finishes.
3. **`applyInteractiveZoomTransforms()`** — when `viewState.scale ≠ lastRenderedScaleRef`, applies `transform: scale(targetScale)` with `transform-origin: 0 0` to **both** the PDF `<canvas>` and the SVG overlay so they stay aligned visually.

**“Renders blocked”** (no PDF re-render) when any of:

- `isMeasuring`
- `isCalibrating`
- `currentMeasurement.length > 0`
- `isDeselecting` (500 ms cooldown after clearing condition selection)
- `isAnnotating && !showTextInput`

Two derived flags in `PDFViewer.tsx`:

| Flag | Includes `isDeselecting`? | Used for |
|------|---------------------------|----------|
| `rendersBlocked` | No | Viewport updates, markup rendering |
| `rendersBlockedForZoom` | Yes | Applying/clearing CSS zoom transforms |

Wheel and pinch zoom while blocked update `viewState.scale` and call `applyInteractiveZoomTransforms(newScale, true)` — the second argument skips automatic scroll adjustment because those handlers already adjust scroll around the cursor/focal point.

When renders are **unblocked**, CSS transforms are cleared and `renderPDFPage` eventually runs at the new scale, syncing `lastRenderedScaleRef` with `viewState.scale`.

---

## Fixed bug (2026-06): canvas jump + crosshair offset

### Symptoms

- User is **zoomed in** on the plan.
- User selects an existing takeoff, deselects, then presses **Space** to draw the same condition again (or otherwise re-enters measuring mode).
- On the **first** re-entry only:
  - The PDF **appears to shift** on screen (content no longer where the user left it).
  - The **crosshair is offset** from the cursor — looks like a coordinate bug.
- Second cycle (deselect → Space again) often worked fine.

Also reproducible when toggling measuring mode while `viewState.scale ≠ lastRenderedScaleRef` (e.g. zoomed during `isDeselecting` cooldown, then Space to draw).

### Reproduction (manual QA)

1. Open a project, select a condition, draw or stay in draw mode.
2. Zoom in (toolbar or Cmd+scroll) well past 100%.
3. Click an existing measurement to select it, then deselect (empty click or Space to clear condition).
4. Press **Space** to re-enter draw mode for that condition **without moving the mouse**.
5. **Before fix:** visible jump and crosshair not under cursor. **After fix:** stable viewport; crosshair appears only after mouse moves, aligned with cursor.

### Root cause 1 — CSS transform without scroll compensation

`applyInteractiveZoomTransforms` uses `transform-origin: 0 0`. Changing the CSS `scale()` while **scroll position stays fixed** moves which part of the scaled canvas sits in the viewport — the content **slides toward the top-left** (or the opposite when clearing a transform).

This fired when `isMeasuring` / `isDeselecting` / `rendersBlockedForZoom` changed and effects called `applyInteractiveZoomTransforms()` without adjusting `container.scrollLeft` / `scrollTop`. Wheel/pinch paths were fine; **state-transition** paths were not.

### Root cause 2 — Stale `mousePositionRef`

Crosshair position is stored in **`mousePositionRef`** (not React state) for performance. It is **not** cleared when leaving measuring mode (`setMousePosition(null)` only runs on mouse leave).

When measuring mode turned back on:

1. `paintEphemeralMarkupLayer` drew a crosshair at the **old** ref position.
2. A `useEffect` then applied or changed the CSS transform on the SVG.
3. The crosshair moved with the transform but the **cursor did not** → apparent offset until the next `mousemove`.

Clearing the ref on draw-mode **entry** defers the crosshair until coordinates are fresh.

### Fix (2026-06)

**1. Scroll compensation in `applyInteractiveZoomTransforms`** (`PDFViewer.tsx`)

- Read previous CSS scale from `canvas.style.transform`.
- If `targetScale` changed and `skipScrollAdjust` is not set, adjust scroll so the **viewport centre** stays over the same content:

  `scroll' = ratio × (scroll + clientSize/2) − clientSize/2` where `ratio = targetScale / prevCssScale`.

- Wheel/pinch pass `skipScrollAdjust = true` (they already do cursor-anchored scroll).

**2. Clear crosshair on draw-mode entry** (`PDFViewer.tsx`)

- `setMousePosition(null)` in:
  - `shouldApplySidebarConditionMode` branch (sidebar condition → draw mode)
  - Space handler registered via `onRegisterEnterConditionDrawMode`

### Files touched

| File | Change |
|------|--------|
| `src/components/PDFViewer.tsx` | Scroll compensation + stale crosshair clear |
| `src/components/pdf-viewer/usePDFViewerInteractions.ts` | `applyInteractiveZoomTransforms(..., true)` from wheel/pinch |

---

## Regression checklist

Run these after changing zoom, scroll, measuring mode, `isDeselecting`, or pointer/crosshair code:

- [ ] Zoomed in → deselect condition → Space → **no canvas jump**; crosshair tracks cursor after first move.
- [ ] Zoom with **Cmd+scroll** while measuring → crosshair stays on cursor.
- [ ] **Pinch zoom** on touch while measuring → no double scroll jump.
- [ ] Zoom while **not** measuring → PDF re-renders at new scale; markups and crosshair still align.
- [ ] Select measurement on canvas → Space to draw same condition → stable.
- [ ] Sidebar condition pick while zoomed → draw first point lands under cursor.

---

## Similar bugs to watch for

| Smell | Likely cause |
|-------|----------------|
| Markups and PDF misaligned only when zoomed during draw | `pageViewports` / `currentViewport` updated while `lastRenderedScaleRef` is stale; or SVG transform out of sync with canvas. |
| Crosshair wrong but clicks land correctly | Ephemeral layer using wrong viewport or stale `mousePositionRef`; check `paintEphemeralMarkupLayer` and `canvasPixelExtent`. |
| Jump only when toggling selection/measuring | `applyInteractiveZoomTransforms` called without scroll compensation; check new effects on `isMeasuring` / `isDeselecting`. |
| `getBoundingClientRect()` vs layout size mismatch | `canvasPixelExtent` uses laid-out CSS size; CSS `scale()` affects rect but not always the same math as `viewport.width` — keep transform + scroll logic consistent. |

---

## Key symbols (quick lookup)

```
viewState.scale              — requested zoom
lastRenderedScaleRef         — last rasterized zoom
applyInteractiveZoomTransforms(overrideScale?, skipScrollAdjust?)
rendersBlocked / rendersBlockedForZoom
isDeselecting                — 500 ms after selectedConditionId → null
mousePositionRef             — crosshair; clear on draw-mode entry
paintEphemeralMarkupLayer    — crosshair + previews (reads ref)
```
