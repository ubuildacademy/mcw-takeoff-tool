# Meridian Takeoff — User guide (workspace & features)

A concise walkthrough of the app **as implemented today**: where things live, what they do, and how the pieces fit together. For keyboard shortcuts and the Tools/Profile dialogs, see the [Quick start & shortcuts guide](/help/shortcuts).

**In the app:** click the **?** icon in the top command bar (or press **?** on your keyboard) for common questions without leaving your project.

---

## 1. Before you open a project

After you **sign in**, you land on the **project dashboard** (`/app`).

- **New Project** — Create a job and optionally attach PDFs immediately.
- **Open Existing** — Opens the **restore-from-backup** flow (same dialog as backing up projects: pick a Meridian backup/export file and import it into your account).
- **Profile** — Account details, password, sign out (see quick reference doc).
- Your projects appear as **cards**; open one to enter the takeoff workspace.

The takeoff workspace URL is `/project/<projectId>`.

---

## 2. Workspace layout (three columns)

{{workspace-layout}}

| Zone | What it is |
|------|------------|
| **Left — Takeoff** | **Always available** (you can hide it with the **narrow chevron** on its right edge). This is **not** the documents list. |
| **Center** | **Sheet tabs** at the top of the viewer area, then **banners** when special modes are on, then the **PDF**. |
| **Right — Documents / Search / AI Chat** | **Optional panel**. It starts **closed**; use the **chevron** on the **right edge** of the window to **open** it. Inside, three **tabs** switch between **Documents**, **Search**, and **AI Chat**. |

**Collapsing panels**

- **Left edge chevron** (beside the takeoff panel): hide or show the **Takeoff** column.
- **Right edge chevron** (beside the viewer): hide or show the **Documents / Search / AI Chat** column.

**Tablet layout (iPad, narrow screens)**

On viewports **under 1024px wide** (typical iPad portrait, phone, or a narrow browser window):

- Both sidebars behave as **slide-over drawers** over the PDF instead of fixed columns.
- The **left drawer** opens from the left edge chevron; the **right drawer** opens from the right edge chevron.
- Tap the **semi-transparent backdrop** behind an open drawer to close it and return to the full canvas.
- The left drawer **starts closed** when you enter tablet layout so the drawing area is maximized.
- Header and status bar respect **safe areas** (notch, home indicator) when added to the Home Screen.

With an **external keyboard** attached on a wide iPad (landscape, ≥1024px), the app uses the **desktop layout** and keyboard shortcuts; touch gestures still work on the canvas.

---

## 3. Left sidebar — Takeoff (Conditions, Reports, Costs)

Use this panel to define **what** you are measuring, see **quantities**, and see **costs**.

### Tabs at the top of this panel

1. **Conditions** — Your takeoff **line items** (linear, area, volume, count, **auto-count** via **visual search** on symbols when you use that condition type).
2. **Reports** — **Quantity** rollups by condition and sheet/page; **export** actions live here.
3. **Costs** — **Money** rollups when conditions include cost fields; **Profit Margin** shortcut to project-level margin settings.

### Conditions tab

- **+** — **Create condition**. The dialog lets you set type, units, color, waste, multiplier, costs, and other fields depending on type (**auto-count / visual search** is a distinct condition type when you need template-based counting).
- **Templates** — Save or apply a **condition template** (see [Condition templates](#condition-templates) below).
- **Search** box — Filters conditions by **name** or **description**.
- **Click** a condition to **select** it for drawing on the plan; **click again** to clear selection.
- **Totals on each card** are scoped to the **active sheet tab** and **current page** in the viewer (so numbers track what you see).

**Condition card controls**

Each condition card is compact so large projects can show many line items. The colored rail identifies the condition color, the unit pill shows the measurement unit, and the total on the card is scoped to the active sheet/page. Quick action icons are grouped in the card action row so they stay easy to scan and tap without opening another menu.

| Icon | Purpose |
|------|---------|
| **Type icon** (area, linear, count, etc.) | Shows the condition type. |
| **Eye** | **Hide/show** that condition's markups on the drawing. |
| **Scissors** | **Cutout** mode ( **area** / **volume** only ): subtract a region from existing measurements. |
| **Copy** | **Duplicate** the condition. |
| **Pencil** | **Edit** the condition. |
| **Trash** | **Delete** the condition (confirmed). |

**Visual / auto-count** style conditions may show **search imagery** and compact **match thumbnails** when applicable.

### Condition folders

Group conditions into named folders to keep large projects organized.

| Action | How |
|--------|-----|
| **Create a folder** | Click the **folder +** button in the Conditions toolbar → type a name → **Enter** or click ✓. |
| **Move a condition into a folder** | **Right-click** the condition card → **Move to folder** → pick a folder from the searchable flyout. |
| **Remove a condition from its folder** | Right-click → **Move to folder** → **Remove from folder** (appears when already in a folder). |
| **Rename a folder** | Hover the folder header → click the **pencil** icon → edit inline → **Enter** to confirm, **Escape** to cancel. |
| **Delete a folder** | Hover the folder header → click the **trash** icon. Conditions in the folder are moved to **Uncategorized** (not deleted). |
| **Collapse / expand** | Click the folder header row. |

Conditions not assigned to any folder appear below all folders under an **Uncategorized** divider.

#### Copying, pasting, and reassigning markups

**Copy & paste** (keyboard or right-click context menu)

Select one or more markups on the canvas (selection mode), then copy and paste:

| Action | How |
|--------|-----|
| **Copy** | Cmd/Ctrl+**C**, or right-click → **Copy** |
| **Paste** (same condition) | Cmd/Ctrl+**V**, or right-click → **Paste** — pastes onto the current page with a small offset so the copy is visible next to the original |
| **Paste as New Condition** | Cmd/Ctrl+**Shift**+**V**, or right-click → **Paste as New Condition** — creates a new condition cloned from the source (type, unit, waste, and settings carried over) named "[Original] - COPY" with a new auto-assigned color, then pastes the markups under it. The new condition is auto-selected so you can rename it immediately. |

**Tip:** Use *Paste as New Condition* when you need to differentiate copied scope — for example, duplicating a material area and then adjusting one variant without redrawing.

**Move to condition** (reassign markups)

If you draw markups under the wrong condition, reassign them without redrawing:

1. Select the markups to move (click, box-select, or right-click → **Select all similar** to grab all markups for a condition on the current page).
2. Right-click any selected markup → **Move to condition →** and pick the target condition from the flyout.

The markups are immediately reassigned — their color, styling, and condition totals update to reflect the new condition. Only conditions with the **same type and unit** appear in the flyout. For example, a linear (LF) markup can only move to another linear (LF) condition — not to a linear-with-height (SF) condition, even though both are technically "linear" type. This prevents silent unit mismatches that would corrupt quantities.

#### Moving markups

Dragging a markup is a **deliberate, two-step action** — select, then arm the move — so a stray click or drag can't nudge a takeoff by accident.

1. Select one or more markups (click, or right-click → **Select all similar**).
2. Arm the move: right-click → **Move**, or press **M**.
3. Drag the selection to its new position.

**Disarming:** press **M** again, press **Escape**, or change the selection — all three disarm the move without undoing anything you've already dragged.

This applies to **measurements and annotations alike**. Annotations (text, arrow, rectangle, circle, highlighter) have their own right-click context menu with **Move** and **Delete**.

#### Edit vertices & arcs

Right-click a measurement (not a count marker) and choose **Edit vertices** to reshape it directly instead of redrawing.

- **Square handles** at each vertex — drag to move that corner.
- **Round mid-segment handles** — drag one **off** the straight line between two vertices to bow that segment into a **circular arc**; drag it back onto the line to straighten the segment again.
- **Quantities recompute** (length, area, perimeter, net) as soon as you release the handle, accounting for arc curvature.
- **Escape** cancels an in-progress handle drag, or exits edit mode entirely if nothing is being dragged.

Entering edit mode is **only** available from the context menu — there's no accidental way to trigger it — and **count** conditions can't be vertex-edited (there are no line segments to reshape). Arcs render in both the viewer and PDF export.

#### Quantity Multiplier

Any condition type supports a **Quantity Multiplier** — an integer you set in the condition form to scale all measured quantities by a fixed factor.

**When to use it**

You've taken off an area (or linear run, or count) in one location and know the exact same scope repeats in N other identical locations. Instead of drawing all N instances, set **Multiplier = N** and the condition reports N× the measured total.

**How it works**

- The multiplier is applied to the **sum of all measurements** for that condition, then waste (if any) is applied on top: `total = measured × multiplier × (1 + waste%)`.
- The multiplied total is what appears in the **condition card**, **Reports tab**, **Costs tab**, and **Excel export**.
- A small amber **×N** badge appears on the condition card name so the multiplier is always visible at a glance.
- Hovering the badge shows a tooltip explaining the multiplier.
- The **Costs tab** breakdown shows `×N multiplier · +X% waste = Y SF` to make the calculation transparent.

**Caution**

The multiplier is a powerful shortcut but easy to forget is active. The amber ×N badge is intentionally prominent. When reviewing an estimate, always confirm multiplied conditions are intentional.

**To remove it**, edit the condition and clear the Multiplier field (or set it back to 1).

#### Count conditions — Quantity per Count

**Count** and **Auto-Count** conditions support an optional **Quantity per Count** field. This lets each marker carry a fixed measurement (linear, area, or volume) so you get both the count and a derived quantity in one condition.

**How to configure it**

1. Create or edit a **Count** (or **Auto-Count**) condition.
2. In the **Quantity per Count** section, choose a **type** (Linear, Area, or Volume).
3. Pick a **unit** (e.g. LF, SF, CY) and enter the **value per count** (e.g. 10).
4. Save the condition.

**How quantities appear**

- **Reports tab**: each condition row shows the count (`5 EA`) and the sub-quantity total (`50 LF`) directly below it.
- **Costs tab**: the quantity row shows both the count and the priced quantity (`= 50 LF (priced)`). Material cost is billed per sub-quantity unit (e.g. `$3/LF × 50 LF = $150`).
- **Excel export**: includes a **Sub-Qty Total** and **Sub-Qty Unit** column on the Quantities sheet.

**To use multiple sub-quantities** (e.g. both LF of trim and SF of glass per window), create separate count conditions — each condition carries one fixed sub-quantity.

**To remove the sub-quantity**, edit the condition, set the Type back to **None**, and save.

#### Condition templates

Reuse a set of conditions across projects instead of rebuilding trade packs by hand.

- **Where to open it:** **Templates** button next to the **Takeoff Conditions** heading, at the top of the Conditions tab.
- **Save a template:** In the dialog, name the template (e.g. "Waterproofing — Div 7" or "Residential drywall") and save. It captures the **current project's** conditions — type, unit, color, waste factor, costs, multiplier, and sub-quantity settings.
- **Apply a template:** Pick a saved template and apply it to seed conditions into the current project. Rows whose **name already exists** in the project are skipped, so applying a template twice (or into a project that already has some of those conditions) will not create duplicates.
- **What is not included:** Auto-count **search images** are not part of a template — auto-count conditions come back without their reference imagery and need it re-added.
- **Where templates live:** Templates are saved to your **account**, so they follow you to any device you sign in on. (Templates created in an older version that lived in the browser are **imported automatically** the first time you open the dialog.)
- **Sharing with your team:** Toggle a template to **Shared** to publish it to everyone in your deployment. Shared templates carry a **Shared** badge and are **read-only** to other users — only the owner (or an admin) can rename, edit sharing, or delete them. Anyone can **apply** a shared template to their own projects.

### Reports tab

- Expandable **quantity** breakdown by condition and by **sheet/page**.
- **Click a sheet name** in the report to **jump** the viewer to that page.
- **Export** menu: **Excel**, **PDF**, and **Email report** (opens the send flow).
- When cost data exists, a **project cost summary** may appear at the top of this tab.

#### PDF export options

**Export PDF Report…** opens a **PDF Export Options** dialog before generating anything:

| Option | Choices |
|--------|---------|
| **Measurement labels on sheets** | **Quantity** (e.g. "1,250 SF"), **Condition name** (e.g. "Deck Coating"), or **None** (markup only). |
| **Per-page legend** | On or off. |
| **Legend content** (when on) | **Name + quantity**, or **Name only**. |
| **Legend position** | An 8-position grid (corners and edge midpoints) so you can pick a spot that keeps the titleblock visible. |

Your choices are **saved per project** and reused automatically the next time you export — including from the **Email report** flow, which shares the same saved options.

### Costs tab

- **Project cost summary** — Subtotals, margin, total (when data exists).
- **Profit Margin** — Opens the project profit-margin flow.
- **Per-condition** breakdown when conditions have **material / equipment / waste** cost fields.

---

## 4. Right sidebar — Documents, Search, AI Chat

**Open this panel first** (right-edge **Show** control) if you do not see it. Then pick a **tab**:

### Documents tab — “Project Documents”

This is the **sheet tree** for the project.

If the project has **no PDFs yet**, the center of the screen may show a large **Browse and upload PDF** control; after the first upload, use **Upload PDF** here or that flow to add more.

- **Upload PDF** — Add files to the **current project** (multiple files allowed).
- **Gear — Document Actions** (header):
  - **Extract Titleblock Info (All)** — Starts titleblock extraction for **every PDF** in the project (see [Titleblock extraction](#titleblock-extraction) below).
  - **Delete All Documents** — Remove every PDF from the project (confirmation).
- **Search Pages** — Filters pages by **page number**, **sheet name**, or **sheet number** text.
- **Filter Pages** — **All**, **With Takeoffs**, or **Without Takeoffs**.

**Each PDF** can be expanded to show **pages**. Per **document** gear:

- **Extract Titleblock Info** — Same tool as above, but only for **that one PDF** (all pages in that file).
- **Rotate all sheets** 90° clockwise or counter-clockwise
- **Delete Document**

**Each page** row shows titleblock fields, takeoff badges, etc. **Page** gear may include **Delete** (single page) where the UI offers it.

**Opening sheets**

- **Click** a page — Opens it in the **active** viewer tab.
- **Ctrl+click** / **⌘+click** — **Opens that page in a new tab**.
- **Right‑click** a page — **Open in new tab**.

#### Titleblock extraction

Use this when sheet **names** and **numbers** in the sidebar are empty or wrong and you want the app to read them from the drawing **titleblock** using OCR (and related processing on the server).

| What you want | Where to start |
|---------------|----------------|
| **One PDF (whole set of sheets in that file)** | Expand the document in the tree → **gear** on that PDF → **Extract Titleblock Info**. |
| **Every PDF in the project** | **Gear — Document Actions** in the **Project Documents** header → **Extract Titleblock Info (All)** (asks for confirmation). |

**What happens on screen**

1. The viewer jumps to a **reference page** (the first page of the PDF you picked, or the first page of the first document when you chose **All**).
2. A **Titleblock Selection** banner appears. You **draw a rectangle** around the **sheet number** field on that reference page, then a second rectangle around the **sheet name** field. Those two boxes define the **template** layout.
3. After both regions are set, the app sends the job to the server. Progress appears in the **bottom status bar** (with **Cancel** while processing). When it finishes, sheet names/numbers update for the processed pages; refresh the document list if needed.

**Tips**

- Pick a **typical** sheet for the template if your set is consistent; if titleblocks differ a lot between sheets, results may need cleanup.
- **All** processes **every document** in the project; **per-document** only processes pages inside **that** file.
- If extraction finishes but labels look empty, check server logs or OCR/LLM setup — the UI may show a warning when no labels were detected.

### Search tab — “Document Search”

**Full-text search** across **OCR** text (not the same as the page tree filter in the Documents tab).

- Requires documents that have **OCR** available (processing runs when PDFs are uploaded; older projects may need a refresh or **Queue OCR**).
- Type at least **2 characters**; search is **debounced** so it does not fire every keystroke.
- **Search in:** **All Documents** or one specific PDF.
- Results list **snippets** and **page numbers**; **click** a result to **open that page** in the viewer.
- Footer shows how many PDFs are searchable; if some lack OCR, use **Queue OCR for N PDF(s)** and watch the **purple OCR progress** in the **bottom status bar**.

### AI Chat tab — “AI Assistant”

A **project-scoped chat** that uses a **local or hosted LLM** via **Ollama** (connection is checked when you open the tab).

- **If Ollama is unavailable**, you’ll see an error and **Retry Connection** (depends on your deployment’s API keys / server).
- **Modes:** A selector at the top switches the assistant’s focus — **General Assistant**, or the **Division 7 Waterproofing Estimator** (a senior-estimator persona with a built-in Div 7 reference knowledge base). Changing mode starts a fresh conversation.
- **Question-aware context:** For each question the assistant is given project metadata, **all conditions**, the **takeoff totals by condition**, the **document list**, and — instead of dumping every page — the **most relevant sheet pages selected for that question**. Name a sheet number (e.g. **A-101**) and it focuses on that sheet. This keeps answers accurate on large sets that would otherwise overflow the model’s context window.
- **Formatted answers:** Replies use **markdown** — quantity breakdowns come back as **tables**, and references cite the **document and page/sheet**.
- **Controls:** **Stop** ends a long reply while keeping the partial text; **Copy** grabs a reply; **suggested-question chips** appear on a fresh chat. **Clear** and **Export** (downloads a `.txt` transcript) appear when there are messages.
- **Limits:** There is a **daily per-user message limit** (admins are exempt); the remaining count shows in the header.
- Chat history for the project is stored in **browser localStorage** (`chat-<projectId>`).

---

## 5. Center — Sheet tabs, viewer, and mode banners

### Sheet tabs (above the PDF)

- One **tab** per open sheet; **click** to switch, **×** to close, **right‑click** for options such as **close other tabs**.
- **Enter** / **Space** on a focused tab selects it (keyboard).

### Mode banners (below tabs, when active)

- **Auto Count Mode** — You are defining a **visual search** box to find/count repeated symbols for the named **condition**. Draw a box on the plan as instructed.
- **Titleblock Selection** — You are drawing boxes around the **sheet number** and **sheet name** regions for [titleblock extraction](#titleblock-extraction) (started from the Documents tab).

### PDF viewer

**Desktop**

- **Pan**: middle-mouse drag (see [shortcuts guide](/help/shortcuts)).
- **Zoom**: Cmd/Ctrl + scroll wheel; also the **View** cluster / zoom buttons in the top command bar.

**Touch (iPad, Apple Pencil)**

- **Pan**: one-finger drag when **not** drawing.
- **Zoom**: two-finger pinch (automatically ignored while actively drawing so a stray thumb cannot cancel a measurement in progress).
- **Draw**: tap or use Apple Pencil when a condition is selected (same as mouse clicks for that measurement type). Hyperlink regions, cutout polygons, and annotation shapes also work with touch.
- **Select a markup**: tap it while in selection mode (not actively drawing).
- **Move a markup**: tap to select, long-press → **Move** to arm the drag, then drag it to its new position. See [Moving markups](#moving-markups) below.
- **Finish** a multi-point measurement: **double-tap** the canvas, or tap **Finish** on the floating toolbar (see [Tablet & touch](#9-tablet--touch-ipad) below).
- **Context menu** on a markup: **long-press** (~½ second) — same actions as right-click on desktop (copy, paste, paste as new condition, stack order, Move, Edit vertices, select all similar, move to condition; annotations show Move and Delete).

- **Measure** only after you **select a condition** on the left and follow the tool’s tap/drag behavior for that type.

### Hyperlinks (deep links & auto-hyperlink)

Sheet hyperlinks can land on an **exact spot at an exact zoom**, not just "open this sheet."

**Setting a target view**

- When creating or editing a link, use **"Create & set view…"** (or **"Update & set view…"** on an existing link), or right-click an existing link → **"Set target view…"**.
- You're taken to the target page — position the view (pan/zoom) the way you want it to open, then click **"Save target view."**
- Clicking the link afterward jumps straight to that position and zoom level, with a brief **highlight pulse** so you know you've arrived.

**Auto-hyperlink can set target views for you.** When it can match a detail callout on the source sheet to the matching detail title on the target sheet, it captures that detail's view automatically — no manual positioning needed for those links.

**Auto-hyperlink review**

Running **Auto-hyperlink** (from Tools) no longer writes links silently — it opens a **review table** first:

- Rows are grouped by **source sheet**, each with its own checkbox so you can accept or skip individual links.
- A separate list shows **unmatched references** with the reason they couldn't be matched (e.g. no sheet with that number in the project, or an ambiguous match across multiple documents).
- Applying **replaces existing auto-hyperlinks**; any links you created **manually** are left untouched.

---

## 6. Command palette & sheet workflows

### Command palette (⌘K)

Press **Cmd/Ctrl+K** anywhere in the workspace to open a searchable palette (`src/components/CommandPalette.tsx`). Type to filter across three groups:

- **Sheets** — jump to any page by sheet number or sheet name; opens it in a new tab.
- **Conditions** — activate a condition for drawing, same as clicking it in the left sidebar.
- **Actions** — **Calibrate scale** / **Recalibrate scale**, **Magic wand**, **Schedule → takeoff**, **Propose rooms on this sheet**, **Compare sheet revisions…**, **Fit sheet to window**.

**Arrow Up/Down** move the highlight, **Enter** runs the highlighted item (and closes the palette), **Escape** closes without doing anything.

### Magic wand (room fill)

The **Wand** button lives in the top command bar. Select an **area** or **volume** condition first, then click inside an enclosed room on the plan — the app fills the room bounded by the surrounding wall linework, traces the boundary, and creates the measurement with full quantity math already applied. It lands on the **inside face** of the walls.

- Requires the sheet to be **calibrated** first.
- If the region is not fully enclosed (an open doorway, a gap in linework), the wand **refuses** and shows a message instead of guessing at a boundary.
- **Escape** exits wand mode; the resulting measurement **undoes** like any other.

### Propose rooms on this sheet

Open from ⌘K → **"Propose rooms on this sheet."** Instead of clicking room-by-room, this scans the **entire sheet** for enclosed regions in one pass and opens a review list with computed areas, **biggest first**. Uncheck anything you don't want (legends, title block cells, and other non-room enclosed shapes can show up), then apply to add the remaining rooms to the selected area/volume condition. Same calibration requirement as the magic wand.

**Known limitation:** the sweep currently proposes **every** enclosed region it finds, so always review the list before applying rather than accepting it wholesale.

### Schedule → takeoff

Open from ⌘K → **"Schedule → takeoff."** Drag a box around a door/window/fixture schedule table on the sheet, including its header row. The table is reconstructed from the sheet's **vector text** (no OCR) — this only works on **vector PDFs**; scanned sheets are refused with a message.

A review dialog follows:

- **Name column** and **Qty column** are auto-guessed from the header text and can be remapped.
- Uncheck any row you don't want.
- Applying creates **one count condition per row**, with **QTY markers** placed beside that row on the schedule itself — so the count is auditable against the printed quantity, and the markers can be dragged onto the plan afterward.

### Compare sheet revisions

Open from ⌘K → **"Compare sheet revisions…"** Pick the **old** and **new** revision of the same sheet (they must share the same sheet size). The dialog overlays both:

- **Red** — linework removed in the new revision.
- **Blue** — linework added in the new revision.
- **Unchanged** linework is faded so the changes stand out.
- Zoom the overlay at **50% / 100% / 200%**.

**Carry takeoffs to new rev** copies every measurement from the old sheet onto the new one — including **cutouts and arcs** — and flags any takeoff sitting on a changed area so you can review it. Each carried measurement can be **undone individually**, like any other takeoff action.

---

## 7. Top command bar (summary)

The top command bar is grouped into clusters so common actions are easier to scan: project/navigation on the left, page/view/markup controls in the center, and help/tools/status on the right. On smaller screens, some view controls collapse into the **View** menu to preserve space.

| Area | What to use it for |
|------|---------------------|
| **Back to Projects** | Return to `/app`. |
| **Undo / Redo** | History (also Cmd/Ctrl+Z etc.). |
| **Previous / Next page** | Page navigation. |
| **View cluster** | Zoom %, **Reset view**, **Rotate** CW/CCW. On narrower screens this appears as a **View** menu. |
| **Calibrate Scale** / **Recalibrate** | Set real-world scale from a known dimension (dialog + two clicks on the PDF). The dialog auto-detects printed scale notations and warns about half-size or fit-to-page reprints — see [Auto-scale detection](#auto-scale-detection) below. |
| **Annotate** | Non-takeoff markup: text, arrow, rectangle, circle, color, **clear annotations**. |
| **Help** (?) | **Common questions**, links to these guides, and context tips. Press **?** on the keyboard to toggle. |
| **Tools** (wrench) | **Preferences** (appearance, crosshair, labels, magnifier, ortho default, hyperlinks). |
| **Ortho** badge | Visible when ortho snapping is on while measuring or calibrating. |
| **All changes saved** chip | Green dot plus saved status. |

### Auto-scale detection

The **Calibrate** dialog scans the sheet for scale information before you calibrate manually:

- It looks for printed **scale notations** on the sheet (e.g. `1/4" = 1'-0"`, `1"=20'`, `1:100`).
- It checks the sheet's **physical size** against standard plot sizes and warns if the sheet looks like a **half-size print** or a **fit-to-page reprint** — either of which would make a printed scale wrong.

**Detected scales are never applied blindly.** Choosing a detected scale still requires you to click both ends of a printed dimension on the drawing and confirm the measured value matches before it's applied. This keeps calibration accurate even when a set has been reduced, enlarged, or reprinted to fit a page.

---

## 8. Bottom status bar

- **Left**: Current **sheet** name and **page**, and **project** name.
- **Center**: **Selected condition** and type, or a prompt to select a condition.
- **Right** (priority order when multiple things happen): **Excel/PDF export** progress, **titleblock extraction** progress (with cancel when shown), **OCR** jobs (**purple** bar with %), or **Uploading…**, or **Calibrating / Measuring** hints, or **Ready**.

---

## 9. Tablet & touch (iPad)

Meridian Takeoff is usable on **iPad and other touch devices** in the browser, or as a **Home Screen web app** for a more app-like experience.

### Add to Home Screen (optional)

In **Safari** on iPad: **Share** → **Add to Home Screen**. The app opens full-screen with the Meridian icon. This uses the same account and data as the browser — no separate install.

### Gestures on the PDF

| Gesture | When | What it does |
|---------|------|----------------|
| **One-finger drag** | Not drawing | **Pan** the sheet |
| **Two-finger pinch** | Not actively drawing | **Zoom** in or out (ignored during drawing to protect the in-progress measurement) |
| **Tap** | Condition selected, drawing mode | Place points (count, linear, area, etc.) |
| **Tap on a markup** | Selection mode (not drawing) | **Select** the markup |
| **Long-press → Move, then drag** | Selection mode, markup(s) selected | **Move** the markup (move must be armed first — see [Moving markups](#moving-markups)) |
| **Drag** | Cutout / hyperlink / annotation shape mode | Draw the region or shape |
| **Double-tap** | Multi-point measurement in progress | **Finish** the measurement (same as double-click on desktop) |
| **Long-press** (~½ s) | On any markup | **Context menu** (bring forward, send backward, Move, Edit vertices, select all similar, move to condition; annotations: Move, Delete) |

### Floating toolbar while drawing

On tablet layout, a **pill toolbar** appears at the bottom of the viewer whenever any drawing or tool mode is active:

| Button | Visible when | Desktop equivalent |
|--------|--------------|-------------------|
| **Undo** | Always (in any active mode) | Cmd/Ctrl+Z |
| **Cancel** | Always (in any active mode) | Escape (exit or step back) |
| **Finish** | Multi-point measurement only (not count, calibration, annotation, cutout, or hyperlink) | Double-click / double-tap |

Modes that show the toolbar: measuring, calibrating, annotation tools (text, arrow, rectangle, circle), cutout drawing, and hyperlink region drawing.

This toolbar does **not** appear on desktop — use the keyboard there.

### Sidebars on tablet

Open **Takeoff** (left) or **Documents / Search / AI Chat** (right) with the **edge chevrons**. Drawers slide over the PDF; tap outside on the dimmed area to close. Condition card action icons (hide, cutout, duplicate, edit, delete) stay visible on the card and use touch-friendly hit areas.

### Keyboard on iPad

If you use a **Magic Keyboard** or Bluetooth keyboard:

- All shortcuts in the [shortcuts guide](/help/shortcuts) work when focus is not in a text field.
- In **wide** landscape (≥1024px), layout matches desktop (no floating toolbar).
- Touch gestures and keyboard shortcuts can be mixed (e.g. pinch zoom, then Space to start measuring).

### Dialogs and the on-screen keyboard

When a dialog asks for text (e.g. calibration distance), the sheet shifts up so fields stay visible above the **software keyboard**.

---

## 10. Related documentation

- **[Quick start & shortcuts](/help/shortcuts)** — Shortcuts, Space/Escape, Profile, Tools dialog.
- **[Help home](/help)** — Search all guides and FAQs; print or save guides as PDF.

Administrators can edit the in-app **FAQ** (questions in the **?** help menu) from **Admin → Help & FAQ** without redeploying the app. Full guides are updated in this documentation folder when features change.

*This guide is meant to match the current Meridian Takeoff UI. If your deployment hides or changes features (e.g. Ollama endpoints), some labels or availability may differ.*
