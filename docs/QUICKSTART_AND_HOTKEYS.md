# Meridian Takeoff — Quick start & keyboard reference

Use this sheet to get productive quickly. Shortcuts that use **Cmd** apply on macOS; use **Ctrl** on Windows and Linux the same way.

---

## Get started in a few steps

1. **Sign in** to your account.
2. **Open or create a project** from the project dashboard.
3. **Upload PDFs** — drag files into the project or use **Browse and upload PDF** when no sheets are open. You can add more anytime from the **Documents** tab in the **right** sidebar (open the sidebar with the edge chevron if it is hidden).
4. **Open a sheet** — pick a document in the sidebar so it appears in the viewer. Multiple drawings can stay open as **tabs** across the top of the viewer.
5. **Calibrate scale** (before relying on lengths and areas) — use the calibration flow in the app: enter a **known real-world distance** (feet/inches), then **click two points** on the drawing along that distance. Prefer a dimension line, scale bar, or a long known run. Escape cancels or steps back while calibrating (see below).
6. **Create takeoff conditions** in the **left** Takeoff sidebar (name, type, color, rates as needed), then **select a condition** and draw measurements on the plan.

After calibration, measurements use your scale. If you rotate a page after calibrating, re-calibrate for accuracy.

### Workspace layout (where things live)

- **Left:** **Takeoff** — **Conditions**, **Reports**, and **Costs** (create/select line items, quantities, pricing).
- **Right (optional panel, open with the edge chevron):** **Documents**, **Search** (OCR full-text), and **AI Chat**.

For a full walkthrough of every panel and tab, see **[WORKSPACE_GUIDE.md](./WORKSPACE_GUIDE.md)**.

---

## User Profile & Tools (settings)

Settings are split between **your account** (on the project list) and **takeoff preferences** (inside the workspace).

### User Profile (account)

- **Where to open it:** After you sign in, on the **project dashboard** (the page that lists your projects), use the **Profile** button in the **top-right** of the header (next to **New Project** and related actions).
- **From inside a project:** Use **Back to Projects** in the takeoff toolbar (top left) to return to the dashboard, then click **Profile**.

**What you can do there**

| Area | Contents |
|------|----------|
| **Profile information** | Edit **full name** and **company**. Your **role** (User or Administrator) is shown read-only. |
| **Change password** | Set a new password (with confirmation). |
| **Account actions** | **Sign out**, or **Delete account** (permanent; includes your projects and data). |

### Tools (preferences while taking off)

- **Where to open it:** With a project open in the **takeoff workspace**, look at the **top toolbar** on the **right**. Click the **wrench** icon (**Tools**). This opens the **Tools** dialog (“Preferences and tools for takeoff and navigation”).
- **What’s inside**

**Preferences** (saved in your browser for this device — they persist between visits):

- **Crosshairs** — Shown when drawing takeoff, calibrating, or annotating: optional **full-screen crosshairs**, **color**, and **line thickness**.
- **Enable ortho snapping by default** — New measure/calibrate sessions start with horizontal/vertical snapping on when this is checked; you can still toggle snapping while working (see **Control** in the shortcuts table below).
- **Show labels on completed measurements** — Values (e.g. length, area) on finished measurements.
- **Show running length while drawing** — Live length while using continuous linear drawing.
- **Magnifier** — Optional zoomed follow-cursor view for precise clicks; **2×**, **3×**, or **4×** when enabled.

**Hyperlinks** (same dialog)

- **Add hyperlink** — Same as pressing **H** (draw a region and pick a destination sheet).
- **Clear all hyperlinks** — Removes manual links on the current scope as implemented in the app.

---

## Spacebar

Space is a **workspace shortcut** when focus is **not** in a text field, search box, or other editable control (typing in those places uses a normal space character).

| Situation | What Space does |
|-----------|------------------|
| A **condition is selected** and the app is in a neutral state (not measuring, not calibrating, not in cutout/hyperlink/annotation/title-block picker/visual search, and not an **auto-count** condition) | **Starts drawing** for that condition (moves from “highlighted on the plan” into active takeoff mode). |
| A **condition is selected** but the above “neutral” case does not apply (e.g. you are already measuring or in another mode) | **Clears** the condition selection (you can bring it back — see next row). |
| **No condition** is selected, but you **just** cleared one with Space | **Re-selects** that same condition (toggle). |
| **No condition** selected and nothing to restore | Nothing. |

---

## Escape

Escape **backs out** of the current mode or selection, usually one step at a time.

| Mode | What Escape does |
|------|-------------------|
| **Hyperlink** placement | Exits hyperlink mode and cancels any in-progress link. |
| **Cutout** drag | Cancels the cutout rectangle. |
| **Annotation** tools (shapes, arrows, etc.) | Removes the **last** placed point; if nothing is left, **exits** the annotation tool. |
| **Calibration** | Removes the **last** calibration point; if none remain, **exits** calibration and clears calibration state. |
| **Measuring** (including continuous linear) | Removes the **last** point; if none remain, **stops** measuring. |
| **Markup selection** (items selected on the canvas, not typing) | **Clears** the selection. |

**Text annotation input** (small text box on the PDF): **Escape** cancels; **Enter** saves.

**Dialogs and menus**: **Escape** closes many overlays, context menus, and modal dialogs (e.g. calibration dialog instructions mention Escape to cancel).

---

## Takeoff & canvas shortcuts

| Action | Shortcut |
|--------|-----------|
| **Undo** | Cmd/Ctrl+**Z** |
| **Redo** | Cmd/Ctrl+**Shift**+**Z** or Cmd/Ctrl+**Y** |
| **Copy** selected markups | Cmd/Ctrl+**C** (when markups are selected in selection mode) |
| **Paste** copied markups | Cmd/Ctrl+**V** |
| **Delete** selected markups | **Delete** or **Backspace** (with markups selected in selection mode) |
| **Add hyperlink** mode | **H** (when not typing in a field) |
| **Toggle ortho snapping** (horizontal/vertical alignment while drawing or calibrating) | **Control** — press to toggle while in measure or calibration mode |

### Annotation tools (no takeoff condition selected)

With **no** condition selected and **not** typing in a field, single letter keys toggle **markup** tools (press again to turn off):

| Key | Tool |
|-----|------|
| **R** | Rectangle |
| **T** | Text |
| **C** | Circle |
| **A** | Arrow |

These do **not** run when a condition is active in the sidebar (the app prioritizes takeoff for that case).

---

## Mouse & zoom

| Action | Control |
|--------|---------|
| **Zoom** | **Cmd/Ctrl** + **scroll wheel** (or equivalent trackpad zoom) — zooms toward the pointer |
| **Pan** | **Middle mouse button**: click and drag to pan the sheet |

Zoom is clamped to a sensible range so very large zoom does not freeze the viewer.

---

## Tabs

- Click a **tab** to switch drawings.
- **Right‑click** a tab for tab actions (e.g. close others).
- When a tab has keyboard focus, **Enter** or **Space** activates that tab.

---

## Tips

- If a shortcut “does nothing,” click the PDF or a neutral area so focus is not inside an input, then try again.
- Use **Escape** to step back one point at a time instead of canceling the entire operation when possible.
- Keep **calibration** on a clear, known dimension for best accuracy.

---

## Exporting this document as PDF

- **macOS**: Open this file in **Preview**, **Chrome**, or **VS Code** print preview → **Print** → **Save as PDF**.
- **Windows**: Open in Edge or Chrome → **Print** → **Microsoft Print to PDF** (or similar).
- **VS Code / Cursor**: Right‑click the Markdown preview → print, or use a Markdown PDF extension if you prefer.

*This guide reflects Meridian Takeoff’s in-app behavior as implemented in the product codebase.*
