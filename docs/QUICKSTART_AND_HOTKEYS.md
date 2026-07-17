# Meridian Takeoff — Quick start & keyboard reference

Use this sheet to get productive quickly. Shortcuts that use **Cmd** apply on macOS; use **Ctrl** on Windows and Linux the same way.

**In the app:** open **Help** from the project dashboard or press **?** in the takeoff workspace for a quick FAQ and links to these guides.

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
- **Top:** grouped command bar for project navigation, undo/redo, page navigation, view controls, calibration, annotations, help, tools, and saved status.

For a full walkthrough of every panel and tab, see the **[Workspace guide](/help/workspace)**.

### Command palette (⌘K)

Press **Cmd/Ctrl+K** anywhere in the workspace to open the command palette. Type to filter:

- **Sheets** — jump to any page by sheet number or sheet name.
- **Conditions** — activate a condition for drawing.
- **Actions** — **Calibrate scale** / **Recalibrate scale**, **Magic wand**, **Compare sheet revisions…**, **Fit sheet to window**.

Use **Arrow Up/Down** to move the highlight, **Enter** to run the highlighted item, and **Escape** to close the palette without doing anything.

---

## User Profile & Tools (settings)

Settings are split between **your account** (on the project list) and **takeoff preferences** (inside the workspace).

### User Profile (account)

- **Where to open it:** After you sign in, on the **project dashboard** (the page that lists your projects), use the **Profile** button in the **top-right** of the header (next to **New Project** and related actions).
- **From inside a project:** Use **Back to Projects** in the top command bar (top left) to return to the dashboard, then click **Profile**.

**What you can do there**

| Area | Contents |
|------|----------|
| **Profile information** | Edit **full name** and **company**. Your **role** (User or Administrator) is shown read-only. |
| **Change password** | Set a new password (with confirmation). |
| **Account actions** | **Sign out**, or **Delete account** (permanent; includes your projects and data). |

### Tools (preferences while taking off)

- **Where to open it:** With a project open in the **takeoff workspace**, look at the **top command bar** on the **right**. Click the **wrench** icon (**Tools**). This opens the **Tools** dialog (“Preferences and tools for takeoff and navigation”).
- **What’s inside**

**Preferences** (saved in your browser for this device — they persist between visits):

- **Appearance** — Choose **System**, **Light**, or **Dark** mode. Dark mode changes the app chrome and panels while keeping PDF sheets readable.
- **Crosshairs** — Shown when drawing takeoff, calibrating, or annotating: optional **full-screen crosshairs**, **color**, and **line thickness**.
- **Enable ortho snapping by default** — New measure/calibrate sessions start with horizontal/vertical snapping on when this is checked; you can still toggle snapping while working (see **Control** in the shortcuts table below).
- **Show labels on completed measurements** — Values (e.g. length, area) on finished measurements.
- **Show running length while drawing** — Live length while using continuous linear drawing.
- **Magnifier** — Optional zoomed follow-cursor view for precise clicks; **2×**, **3×**, or **4×** when enabled.

**Hyperlinks** (same dialog)

- **Add hyperlink** — Same as pressing **Shift+H** (draw a region and pick a destination sheet).
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
| **Annotation** tools (text, arrow, rectangle, circle, highlighter) | **Exits** the annotation tool immediately and clears any in-progress draw state. |
| **Selected annotation or markup** (in selection mode, not in a drawing tool) | **Clears** the selection. |
| **Calibration** | Removes the **last** calibration point; if none remain, **exits** calibration and clears calibration state. |
| **Measuring** (including continuous linear) | Removes the **last** point; if none remain (or immediately after finishing a segment), **exits draw mode** and returns to selection mode. |
| **Magic wand** | Exits magic wand mode. |
| **Move armed** (after pressing **M** or choosing **Move** from the context menu) | Disarms the move — the selection stays, but dragging no longer moves it. |
| **Vertex edit mode** | Cancels an in-progress handle drag; pressing it again (or clicking away) exits vertex edit mode. |
| **Command palette** | Closes the palette. |

**Text annotation input** (small text box on the PDF): **Escape** cancels; **Enter** saves.

**Dialogs and menus**: **Escape** closes many overlays, context menus, and modal dialogs (e.g. calibration dialog instructions mention Escape to cancel).

---

## Takeoff & canvas shortcuts

| Action | Shortcut |
|--------|-----------|
| **Command palette** | Cmd/Ctrl+**K** — jump to a sheet, activate a condition, or run an action (calibrate, magic wand, revision compare, fit to window). Arrow keys + Enter to run, Escape to close. |
| **Undo** | Cmd/Ctrl+**Z** |
| **Redo** | Cmd/Ctrl+**Shift**+**Z** or Cmd/Ctrl+**Y** |
| **Copy** selected markups | Cmd/Ctrl+**C** (when markups are selected in selection mode) |
| **Paste** copied markups | Cmd/Ctrl+**V** |
| **Paste as New Condition** | Cmd/Ctrl+**Shift**+**V** — pastes copied markups into a brand-new condition cloned from the source (named "[Original] - COPY", new distinct color). Auto-selects the new condition so you can rename it immediately. |
| **Delete** selected markups | **Delete** or **Backspace** (with markups selected in selection mode) |
| **Arm/disarm Move** | **M** (with one or more markups selected, in selection mode) — arms dragging for the selection; press **M** again, **Escape**, or change the selection to disarm. Same as right-click → **Move**. Works for measurements and annotations. |
| **Add hyperlink** mode | **Shift+H** (when not typing in a field) |
| **Toggle ortho snapping** (horizontal/vertical alignment while drawing or calibrating) | **Control** — press to toggle while in measure or calibration mode |

### Annotation tools (no takeoff condition selected)

With **no** condition selected and **not** typing in a field, single letter keys toggle annotation tools (press the same key again to turn off). All shortcuts are shown next to each tool in the **Annotate** menu.

| Key | Tool |
|-----|------|
| **H** | Highlighter (freehand — click and drag to draw) |
| **R** | Rectangle |
| **C** | Circle |
| **A** | Arrow |
| **T** | Text |

**Filled toggle (rectangle & circle):** While the rectangle or circle tool is active, re-open the Annotate menu to reveal a **Filled** toggle. When on, the shape is filled with your annotation color at 30% opacity. The setting persists — you only need to set it once.

**Escape** exits any active annotation tool immediately (or clears a selected annotation if no tool is active).

These shortcuts do **not** run when a condition is active in the sidebar (the app prioritizes takeoff for that case).

---

## Mouse & zoom

| Action | Control |
|--------|---------|
| **Zoom** | **Cmd/Ctrl** + **scroll wheel** (or equivalent trackpad zoom) — zooms toward the pointer |
| **Pan** | **Middle mouse button**: click and drag to pan the sheet |

Zoom is clamped to a sensible range so very large zoom does not freeze the viewer.

---

## Touch & tablet (iPad)

On **iPad** and other touch devices, use these gestures on the PDF canvas. For layout (drawer sidebars, Home Screen app), see the **[Workspace guide](/help/workspace)** — section *Tablet & touch*.

### Gestures

| Action | Touch control |
|--------|----------------|
| **Pan** | One-finger drag (when not drawing) |
| **Zoom** | Two-finger pinch (silently ignored if drawing — keeps the active measurement safe) |
| **Place point** | Tap (or Apple Pencil) while measuring / calibrating / annotating |
| **Draw a region / shape** | Drag while in cutout, hyperlink, or annotation-shape mode |
| **Select a markup** | Tap it (in selection mode, not drawing) |
| **Move a markup** | Tap to select, then long-press → **Move** (arms the move), then drag to new position |
| **Finish** measurement | **Double-tap**, or **Finish** on the floating toolbar (tablet only) |
| **Context menu** on markup | **Long-press** (~½ second) on the markup |
| **Open markup context menu** (desktop) | Right-click |

### Markup right-click context menu

Right-clicking a markup (or long-pressing on tablet) opens a context menu with the following actions. If multiple markups are selected, clipboard and move actions apply to **all selected markups**.

| Action | What it does |
|--------|--------------|
| **Copy** | Copies the selected markup(s) to the clipboard (same as Cmd/Ctrl+C). |
| **Paste** | Pastes clipboard markups onto the current page with a small offset (disabled if clipboard is empty). |
| **Paste as New Condition** | Pastes clipboard markups into a new condition cloned from the source — named "[Original] - COPY" with a new auto-assigned color. The new condition is auto-selected for immediate renaming. Disabled if clipboard is empty. |
| **Bring forward / Send backward / Send to back** | Adjusts the z-order (layer stacking) of the markup on the page. |
| **Move** | Arms move mode for the selected markup(s) — the next drag repositions them. Same as pressing **M**. Press **M** again, **Escape**, or change the selection to disarm. Works for measurements and annotations. |
| **Edit vertices** | Enters vertex edit mode for the markup: drag a square handle to move a corner, or drag a round mid-segment handle off the line to bow that segment into an arc (drag back onto the line to straighten). Quantities recompute on release. Not offered for count markers. |
| **Select all similar** | Selects all markups on the current page that belong to the same condition. |
| **Move to condition →** | Reassigns the selected markup(s) to a different condition. A flyout lists all compatible conditions (same type AND unit — linear LF cannot move to linear-with-height SF). Color and styling update immediately. Useful when you accidentally draw under the wrong condition. |
| **Delete** (annotations) | Deletes the right-clicked annotation. Measurements are deleted via their condition (Delete/Backspace with the markup selected). |

Annotations also gained a right-click menu — **Move** and **Delete** — separate from the takeoff/annotation drawing tools.

### Floating toolbar (tablet only)

While any drawing mode is active on a narrow screen (<1024 px), a bottom toolbar offers **Undo**, **Cancel**, and (for multi-point measurements) **Finish** — the touch equivalents of Cmd/Ctrl+Z, Escape, and double-click.

**Modes that show the toolbar:** measuring, calibrating, annotation tools (text, arrow, rectangle, circle, highlighter), cutout drawing, hyperlink region drawing.

The toolbar is hidden on desktop and on wide iPad landscape (with an attached keyboard).

### Touch ↔ keyboard mapping

| Desktop | Touch / tablet |
|---------|----------------|
| **Space** — start drawing for selected condition | Tap the condition in the left sidebar (drawer), then draw on the plan |
| **Escape** — back one step / exit mode | **Cancel** on floating toolbar, or attached keyboard **Esc** |
| **Cmd/Ctrl+Z** — undo | **Undo** on floating toolbar, or keyboard shortcut |
| **Double-click** — finish multi-point measurement | **Double-tap**, or **Finish** on floating toolbar |
| **Right-click** markup | **Long-press** markup |
| **M** — arm/disarm Move | Long-press markup → **Move**, then drag |
| **Cmd/Ctrl** + scroll — zoom | **Pinch** |
| **Middle-mouse drag** — pan | **One-finger drag** (idle mode) |
| **Shift+H** — hyperlink mode | **Tools** (wrench) → **Add hyperlink**, or attach a keyboard and press Shift+H |
| **Cmd/Ctrl+K** — command palette | Attach a keyboard and press Cmd/Ctrl+K (no dedicated touch gesture) |

With an **external keyboard**, desktop shortcuts apply. Touch gestures still work on the canvas at the same time.

---

## Tabs

- Click a **tab** to switch drawings.
- **Right‑click** a tab for tab actions (e.g. close others).
- When a tab has keyboard focus, **Enter** or **Space** activates that tab.

---

## Tips

- If a shortcut “does nothing,” click the PDF or a neutral area so focus is not inside an input, then try again.
- On **iPad**, use the **floating toolbar** or gestures above when no keyboard is attached.
- Condition card action icons remain visible in the left sidebar/drawer; tap the eye, scissors, copy, pencil, or trash icons for condition-specific actions.
- Use **Escape** (or **Cancel** on tablet) to step back one point at a time instead of canceling the entire operation when possible.
- Keep **calibration** on a clear, known dimension for best accuracy.
- The **Calibrate** dialog auto-detects printed scale notations and flags half-size or fit-to-page reprints, but it never applies a scale for you — always click both ends of a printed dimension to confirm before it's used.
- **Count conditions** can carry a fixed measurement per marker — set **Quantity per Count** (type, unit, value) in the condition form. Example: 5 windows × 10 LF each = 50 LF tracked in Reports and priced in Costs. See the workspace guide for details.
- Not sure where a feature lives? Press **Cmd/Ctrl+K** and type — sheets, conditions, and actions like Magic wand or Compare sheet revisions are all reachable from the palette.

---

## Exporting this document as PDF

- **macOS**: Open this file in **Preview**, **Chrome**, or **VS Code** print preview → **Print** → **Save as PDF**.
- **Windows**: Open in Edge or Chrome → **Print** → **Microsoft Print to PDF** (or similar).
- **VS Code / Cursor**: Right‑click the Markdown preview → print, or use a Markdown PDF extension if you prefer.

*This guide reflects Meridian Takeoff’s in-app behavior as implemented in the product codebase.*
