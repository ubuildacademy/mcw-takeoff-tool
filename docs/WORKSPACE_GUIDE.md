# Meridian Takeoff — User guide (workspace & features)

A concise walkthrough of the app **as implemented today**: where things live, what they do, and how the pieces fit together. For keyboard shortcuts and the Tools/Profile dialogs, see [QUICKSTART_AND_HOTKEYS.md](./QUICKSTART_AND_HOTKEYS.md).

---

## 1. Before you open a project

After you **sign in**, you land on the **project dashboard** (`/app`).

- **New Project** — Create a job and optionally attach PDFs immediately.
- **Open Existing** — Import a shared/backup project when that flow is available.
- **Profile** — Account details, password, sign out (see quick reference doc).
- Your projects appear as **cards**; open one to enter the takeoff workspace.

The takeoff workspace URL is `/project/<projectId>`.

---

## 2. Workspace layout (three columns)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Top bar: Back to Projects · Undo/Redo · Page & view · Calibrate · Annotate · Tools │
├──────────────┬──────────────────────────────────────────────┬───────────────┤
│              │  PDF sheet tabs (one tab per open sheet)      │               │
│   TAKEOFF    │  [Optional mode banners: Auto Count / Titleblock]            │
│   (left)     ├──────────────────────────────────────────────┤   RIGHT       │
│              │                                               │   SIDEBAR     │
│  Conditions  │            PDF viewer (plan)                  │  (optional)   │
│  Reports     │                                               │               │
│  Costs       │                                               │  Documents |  │
│              │                                               │  Search |     │
│              │                                               │  AI Chat      │
├──────────────┴──────────────────────────────────────────────┴───────────────┤
│  Status bar: sheet · project · active condition · OCR / export / measure hints │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Zone | What it is |
|------|------------|
| **Left — Takeoff** | **Always available** (you can hide it with the **narrow chevron** on its right edge). This is **not** the documents list. |
| **Center** | **Sheet tabs** at the top of the viewer area, then **banners** when special modes are on, then the **PDF**. |
| **Right — Documents / Search / AI Chat** | **Optional panel**. It starts **closed**; use the **chevron** on the **right edge** of the window to **open** it. Inside, three **tabs** switch between **Documents**, **Search**, and **AI Chat**. |

**Collapsing panels**

- **Left edge chevron** (beside the takeoff panel): hide or show the **Takeoff** column.
- **Right edge chevron** (beside the viewer): hide or show the **Documents / Search / AI Chat** column.

---

## 3. Left sidebar — Takeoff (Conditions, Reports, Costs)

Use this panel to define **what** you are measuring, see **quantities**, and see **costs**.

### Tabs at the top of this panel

1. **Conditions** — Your takeoff **line items** (linear, area, volume, count, visual/auto-count flows where enabled).
2. **Reports** — **Quantity** rollups by condition and sheet/page; **export** actions live here.
3. **Costs** — **Money** rollups when conditions include cost fields; **Profit Margin** shortcut to project-level margin settings.

### Conditions tab

- **+** — **Create condition**. The dialog lets you set type, units, color, waste, costs, and other fields depending on type (including experimental **CV / auto-count** entry points when offered).
- **Search** box — Filters conditions by **name** or **description**.
- **Click** a condition to **select** it for drawing on the plan; **click again** to clear selection.
- **Totals on each card** are scoped to the **active sheet tab** and **current page** in the viewer (so numbers track what you see).

**Row actions** (icons on each condition)

| Icon | Purpose |
|------|---------|
| **Eye** | **Hide/show** that condition’s markups on the drawing. |
| **Scissors** | **Cutout** mode ( **area** / **volume** only ): subtract a region from existing measurements. |
| **Copy** | **Duplicate** the condition. |
| **Pencil** | **Edit** the condition. |
| **Trash** | **Delete** the condition (confirmed). |

**Visual / auto-count** style conditions may show **search imagery** and **match thumbnails** when applicable.

### Reports tab

- Expandable **quantity** breakdown by condition and by **sheet/page**.
- **Click a sheet name** in the report to **jump** the viewer to that page.
- **Export** menu: **Excel**, **PDF**, and **Email report** (opens the send flow).
- When cost data exists, a **project cost summary** may appear at the top of this tab.

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
- When connected, the assistant receives **context** built from: project metadata, **conditions**, **measurement summary**, **recent measurements**, and **OCR text** from documents (when retrievable).
- **Clear** and **Export** (downloads a `.txt` transcript) appear when there are messages.
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

- **Pan**: middle-mouse drag (see hotkey doc).
- **Zoom**: Ctrl/Cmd + scroll wheel; also **View** menu / zoom buttons in the header.
- **Measure** only after you **select a condition** on the left and follow the tool’s click/drag behavior for that type.
- **Hyperlinks**, **cutouts**, and **annotations** integrate here (shortcuts in the quick reference).

---

## 6. Top toolbar (summary)

| Area | What to use it for |
|------|---------------------|
| **Back to Projects** | Return to `/app`. |
| **Undo / Redo** | History (also Cmd/Ctrl+Z etc.). |
| **Previous / Next page** | Page navigation. |
| **View** (smaller screens) or inline zoom | Zoom %, **Reset view**, **Rotate** CW/CCW. |
| **Calibrate Scale** / **Recalibrate** | Set real-world scale from a known dimension (dialog + two clicks on the PDF). |
| **Annotate** | Non-takeoff markup: text, arrow, rectangle, circle, color, **clear annotations**. |
| **Tools** (wrench) | **Preferences** (crosshair, labels, magnifier, ortho default, hyperlinks). |
| **Ortho** badge | Visible when ortho snapping is on while measuring or calibrating. |
| **Green dot** | “All changes saved” indicator. |

---

## 7. Bottom status bar

- **Left**: Current **sheet** name and **page**, and **project** name.
- **Center**: **Selected condition** and type, or a prompt to select a condition.
- **Right** (priority order when multiple things happen): **Excel/PDF export** progress, **titleblock extraction** progress (with cancel when shown), **OCR** jobs (**purple** bar with %), or **Uploading…**, or **Calibrating / Measuring** hints, or **Ready**.

---

## 8. Related documentation

- **[QUICKSTART_AND_HOTKEYS.md](./QUICKSTART_AND_HOTKEYS.md)** — Shortcuts, Space/Escape, Profile, Tools dialog.

*This guide is meant to match the current Meridian Takeoff UI. If your deployment hides or changes features (e.g. Ollama endpoints), some labels or availability may differ.*
