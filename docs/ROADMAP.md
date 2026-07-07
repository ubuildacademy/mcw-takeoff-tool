# Roadmap & backlog

Living list of **larger features**, **quality improvements**, and **outstanding work**. Small fixes ship without updating this doc.

**Priority:** Active → Backlog → Hygiene. Remove or move items to "Recently shipped" when done.

---

## Active

| Item | Notes |
|------|--------|
| **Batch sheet hyperlinks** | **Vector-native pass shipped** (see Recently shipped): callout circles/hexagons read from PDF drawing commands, review table before apply, auto target views. Validate on real project sets. **Rotation:** vector paths (pymupdf extract, vector callouts, table extract) now handle /Rotate 90/270 dims correctly (2026-07 audit); the raster passes (bubble OCR, template matching) are still unvalidated on rotated pages. |

---

## Backlog

### Next cycle (post-production flagships)

| Item | Notes |
|------|--------|
| **Assemblies** | Two stages per `docs/ASSEMBLIES_DESIGN.md` (grounded in MCW Pricing Manager + Aquafin workbook analysis): **Stage 1** — workbook bridge: per-org assembly registry, condition→workbook mapping, one-click surgical write of takeoff quantity into workbook copies (days). **Stage 2** — native engine: org products table (Pricing Manager schema), assembly components w/ coverage yields, divide-through margin math, workbook bootstrap importer (weeks). |
| **Live collaboration** | Supabase Realtime channels: measurement broadcast + presence cursors. Append-mostly conflict model. |
| **AI chat infra overhaul** | Fallback chain, paid tier, rate-limit strategy (currently Ollama Cloud free; DeepSeek swap candidate). Explicitly deferred by owner. |

### Held from production (dev-only until dialed in; beta feedback 2026-07)

| Item | Notes |
|------|--------|
| **Schedule → takeoff** | "Very strange" results on real sets per beta test. Gated behind dev builds (palette entry hidden in prod). Needs: repro assets from real schedules, header-detection hardening, merged-cell handling. |
| **Room proposals** | Gated with schedule tool. See dial-in section below. |

### AI chat overhaul (next major workstream per owner)

| Item | Notes |
|------|--------|
| **Make chat genuinely helpful** | Scope TBD with Jeff: context injection (current project/sheet/conditions?), takeoff-aware answers, KB expansion beyond Div 7, UX. Ties into [ai-infra] fallback chain/paid tier later. |

### Cleanup queue

| Item | Notes |
|------|--------|
| **Condition templates → DB (per-user)** | Currently localStorage (per browser). Move to per-user table like hyperlinks so template libraries follow the estimator across devices; prerequisite for cost/assembly integration later. |
| **Cutout vertex editing** | Beta ask (not urgent): extend vertex edit mode to cutout boundaries (handles per cutout ring; arcs optional). |
| **Wand/proposals: furniture-aware fill** | Rooms with beds/rugs force many clicks (interior linework splits regions). Idea: morphological opening on the raster before fill — erode strokes thinner than N px so furniture outlines stop blocking while thick walls survive. Fixes both wand ergonomics and room-proposal over-segmentation. |

### Room proposals — dial-in (parked 2026-07, revisit after phase 6)

| Item | Notes |
|------|--------|
| **Constrain to building footprint** | Current sweep proposes every enclosed region on the sheet (detail bubbles, legends, titleblock cells). Ideas: only regions inside the largest wall-bounded mass; min/max aspect + solidity filters; ignore regions whose boundary is mostly thin linework (walls are thick strokes). |
| **Identify proposals on-sheet** | Dialog says "Room 1/2/3" with no way to know which is which. Ideas: numbered ephemeral overlay badges on the sheet while the dialog is open (like calibration validation overlay); hover a row → highlight polygon; attach nearest OCR room-label text ("BEDROOM 2") to each proposal. |

### iPad / tablet compatibility

| Item | Notes |
|------|--------|
| **Submit feedback (Help menu)** | Lightweight in-app bug / feedback form for beta testers — distinct from **Contact** (general support). Should capture context (page, project, browser) and route to the team quickly (e.g. email or webhook). Entry point: Help menu. |

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
| **Hyperlinks → database** | Links (manual + auto, incl. deep-link target views) moved from browser localStorage to `sheet_hyperlinks` (run `create_sheet_hyperlinks_table.sql`). Follow the project across devices/browsers/shared members. Optimistic writes with error toasts; client-generated ids; one-time localStorage import per project on first load (toast confirms). Routes under `/api/hyperlinks`; backup/restore and shared-project import persist automatically via the same bulk path. | 2026-07 |
| **Revision compare + takeoff carry** | ⌘K → "Compare sheet revisions…": pick old/new revision of a sheet → client-side render + binarized ink diff with dilation tolerance (`utils/sheetDiff.ts`, `utils/pdfPageRaster.ts`) → overlay (red = removed, blue = added, unchanged faded) with zoom → "Carry takeoffs to new rev" copies every measurement (cutouts + arcs included) onto the new sheet and flags any sitting on changed areas for review. Requires matching sheet sizes. Deterministic, no server round-trip. | 2026-07 |
| **Room proposals (whole-sheet)** | ⌘K → "Propose rooms on this sheet": grid-seeded flood-fill sweep (`proposeRooms` in `floodFillRoom.ts`) finds every enclosed region once (shared visited mask, ~O(page)), filters leaks/dust, review dialog with computed areas → accepted rooms become measurements in the selected area/volume condition. Deterministic, no LLM. | 2026-07 |
| **Schedule → takeoff (no LLM)** | ⌘K → "Schedule → takeoff": drag a box around a door/window/fixture schedule → server `table_extract.py` reconstructs the table from line-grid geometry + exact vector text (word-alignment clustering fallback for borderless schedules) → review dialog with column mapping (name/qty auto-guessed from headers) → each row becomes a count condition with QTY markers placed on its schedule row (auditable, draggable). Route `POST /ocr/table-extract/:documentId`. | 2026-07 |
| **Command palette (⌘K)** | Fuzzy jump to sheets (by number/name), activate conditions, run actions (calibrate, magic wand, fit, schedule takeoff, room proposals). `src/components/CommandPalette.tsx`. | 2026-07 |
| **Condition templates (trade packs)** | Conditions sidebar → "Templates": save the project's condition definitions (costs, waste, units, colors, sub-quantities) as a named template; apply to any project (name-dupes skipped). localStorage library (`conditionTemplatesSlice`). | 2026-07 |
| **Magic wand room fill** | Header "Wand" button: with an area/volume condition selected, click inside an enclosed room → flood fill bounded by wall linework → boundary trace → simplified polygon → measurement created with full quantity math (undo-able). Deterministic raster CV (`src/utils/floodFillRoom.ts` + tests), no ML. Leak-safe: fills that escape through openings or touch the page edge error out with guidance instead of producing garbage polygons. Page raster cached per sheet (~100 dpi, rotation 0). | 2026-07 |
| **Markup interaction safety** | Right-click over the sheet never shows the browser menu (wrapper-level handler + stacking-order hit test). Annotations get a context menu (Move, Delete w/ undo). Moves are gated: select → "Move" menu item or M hotkey arms the drag; Esc/M/selection change disarms — no more accidental nudges. | 2026-07 |
| **Arc segments + vertex edit mode** | Takeoff markups support circular-arc segments (DXF bulge convention, `takeoff_measurements.arcs` JSONB — run `add_arcs_to_takeoff_measurements.sql`). Explicit edit mode via markup context menu "Edit vertices" (accidental-edit safeguard): square handles move vertices, round midpoint handles drag off the chord to bow a segment into an arc (snap back to straighten). Quantities (length/area/perimeter/net) recompute with arc curvature on commit; arcs render in viewer + PDF export. Core math in `src/utils/arcGeometry.ts` (tessellation in uniform pixel space; bulge is scale/rotation invariant) + tests. | 2026-07 |
| **Batch hyperlinks — vector callout pass + review + auto detail views** | New precision path for CAD-exported sets: `vector_callout_pass.py` reads callout circles/hexagons from PDF drawing commands (PyMuPDF `get_drawings()`) and pairs each with exact vector text — no raster, no OCR. Route `POST /ocr/vector-callouts/:documentId` merges reference callouts into stored OCR (`source: 'vector_callout'`) and returns the callout map. Auto-hyperlink now opens a **review table** (per-row accept, unmatched refs with reasons) instead of writing silently, and `resolveTargetViews` matches source detail labels to detail-title bubbles on target sheets so links land zoomed on the exact detail (`targetViewport`). Raster passes remain fallback for flattened pages. | 2026-07 |
| **PDF export legend/label controls** | Options dialog before PDF report export: show/hide per-page legend, legend content (name + qty / name only), legend position (8-anchor grid so titleblocks stay visible), on-sheet measurement label mode (quantity / condition name / none). Persisted per project (`pdfExportPrefsSlice`); emailed reports reuse the saved options. | 2026-07 |
| **Deep hyperlinks (target view)** | `SheetHyperlink.targetViewport` {x, y, zoom}: links land on an exact spot at an exact zoom with a highlight pulse. Capture via "Create/Update & set view…" in the sheet picker or "Set target view…" in the link context menu. Viewer bridge: `centerViewportOnPoint` / `getNormalizedViewportCenter`. | 2026-07 |
| **Auto-scale detection (verify-first)** | Calibration dialog scans sheet vector text for scale notations (architectural / engineering / metric near "SCALE") and size-checks the sheet against standard plot sizes (half-size and fit-to-page reprint warnings). Detected scale is never applied blind: user clicks a printed dimension, confirms the measured value matches, then page/document scope as usual. `src/utils/scaleDetection.ts` + tests. | 2026-07 |
| **Nav feel: rAF-throttled zoom** | Pinch and ctrl/⌘-wheel zoom batched to one update per animation frame (120 Hz devices no longer flood state updates); wheel deltas normalized across deltaMode with exponential response — smooth trackpad, snappy mouse wheel. | 2026-07 |
| **Count sub-quantity** | Fixed measurement (linear, area, or volume) attached per count marker. Set type + unit + value per count on any Count or Auto-Count condition. Reports show both count and sub-quantity total; Costs price on sub-quantity (e.g. 5 windows × 10 LF × $3/LF = $150). Excel export includes Sub-Qty Total and Sub-Qty Unit columns. DB migration: `add_sub_quantity_to_conditions.sql`. | 2026-06 |
| **iPad / tablet — Phase 3 (polish & platform)** | Floating action toolbar (Undo / Cancel / Finish) over the PDF canvas while drawing; long-press on SVG markups opens context menu (right-click equivalent for touch); `useKeyboardHeight` hook shifts dialogs above the software keyboard via Visual Viewport API; PWA `manifest.json` + Apple touch-icon + `theme-color` meta for "Add to Home Screen". | 2026-06 |
| **iPad / tablet — Phase 2 (layout)** | Slide-over drawers for both sidebars below `lg` with semi-transparent backdrop; `viewport-fit=cover`; `env(safe-area-inset-*)` on header and status bar; 44 px minimum tap targets on all primary toolbar and condition-list buttons. | 2026-06 |
| **iPad / tablet — Phase 1 (touch input)** | Pointer Events on canvas/SVG, `touch-action: none`, pinch-to-zoom, single-finger pan, `overscroll-contain` on canvas container. | 2026-06 |
| **PDF zoom / draw-mode stability** | CSS-transform scroll compensation when entering/exiting measuring mode; clear stale crosshair on draw-mode entry (fixes canvas jump and cursor/crosshair offset after Space re-select). See `docs/PDF_VIEWER_ZOOM_DEBUG.md`. | 2026-06 |
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
