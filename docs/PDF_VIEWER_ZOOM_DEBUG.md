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

## Fixed bug (2026-06 v1): canvas jump + crosshair offset — deselect+Space path

### Symptoms

- User is **zoomed in** on the plan.
- User selects an existing takeoff, deselects, then presses **Space** to draw the same condition again (or otherwise re-enters measuring mode).
- On the **first** re-entry only:
  - The PDF **appears to shift** on screen (content no longer where the user left it).
  - The **crosshair is offset** from the cursor — looks like a coordinate bug.
- Second cycle (deselect → Space again) often worked fine.

Also reproducible when toggling measuring mode while `viewState.scale ≠ lastRenderedScaleRef` (e.g. zoomed during `isDeselecting` cooldown, then Space to draw).

---

## Regression (2026-06 v2): canvas jump on fresh sidebar condition select

### Symptoms

- User **zooms in**, pans to their area, then **selects a linear (or any) condition from the sidebar**.
- The page visibly shifts at the moment of selection; crosshairs appear far from cursor.
- No prior deselect cycle required — happens on a fresh condition pick.

### Root cause

The re-render effect (effect 3010) was calling `applyInteractiveZoomTransforms()` **immediately** in both the hard-block path and the soft-block (isMeasuring, no points yet) path every time the effect fired.

When the user selected a condition:
1. `isMeasuring` became `true` → effect 3010 fired.
2. `applyInteractiveZoomTransforms()` was called.  If `lastRenderedScaleRef ≠ viewState.scale` (a 30–500 ms race window where an in-flight render hadn't completed yet), it applied `scale(R)` to the canvas **and** scroll-compensated by `R×(scroll + vw/2) − vw/2`.
3. The in-flight render then completed — `renderPDFPage` cleared the CSS transform **without reversing** the scroll compensation, leaving the viewport at the wrong scroll position.

The `rendersBlockedForZoom` effect (effect 2789) had the same issue: it called `applyInteractiveZoomTransforms()` unconditionally whenever `rendersBlockedForZoom` became `true`, including the first entry into measuring mode.

Additionally, the clear path (when `rendersBlockedForZoom` went back to `false`) never compensated scroll before removing the CSS transform, so every deselect-cooldown cycle that included a zoom left a residual scroll drift.

### Fix (2026-06 v2)

**1. Skip CSS transform on initial block entry** (`PDFViewer.tsx` — effect 2789)

Track `prevRendersBlockedForZoomRef`. When `rendersBlockedForZoom` just became `true` (the `wasBlockedBefore` flag is `false`), return immediately without calling `applyInteractiveZoomTransforms()`.  When scale/rotation changes *while already blocked*, `wasBlockedBefore` is `true` and the transform is applied normally (correct interactive-zoom behaviour).

**2. Compensate scroll when unblocking** (`PDFViewer.tsx` — effect 2789 else branch)

Before clearing CSS transforms when `rendersBlockedForZoom` goes `false`, apply the centre-maintain reversal:
`scrollLeft = (1/P) × (scrollLeft + cw/2) − cw/2` (where P = previous CSS scale).

**3. Remove redundant calls from the render effect** (`PDFViewer.tsx` — effect 3010)

Removed `applyInteractiveZoomTransforms()` from the hard-block (`isActivelyDrawing / isCalibrating / isDeselecting / isAnnotating`) and soft-block (`isMeasuring` only) branches.  All CSS transform management now lives exclusively in effect 2789.  The soft-block path still schedules the 200 ms real re-render (canvas stays crisp and full scroll range is restored).

**4. Compensate scroll in `renderPDFPage`** when clearing transforms after a completed render:
`scrollLeft += cw/2 × (1 − P)` — undoes the shift that was introduced when `scale(P)` was originally applied against the smaller old canvas.

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
- [ ] **Zoom → navigate → click condition in sidebar** → page does NOT move; crosshair appears at cursor on first mousemove. (v2 regression test)

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
