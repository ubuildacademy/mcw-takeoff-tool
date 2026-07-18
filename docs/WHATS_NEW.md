# What's new

Every update to Meridian Takeoff since the beta program started, newest first. Check back after each release — this page updates alongside the app.

---

## Assembly Workbooks, Excel export, and dialog fixes — 2026-07

**New: Assembly Workbooks turn takeoff quantities into priced assemblies.**
Upload your own pricing spreadsheet (.xlsx or .xlsm) from the **Costs** tab and Meridian fills in your takeoff quantities for you. On upload, the app scans the file and proposes a mapping — confirm or adjust the condition pattern it found. Map a workbook to a condition by exact name or a wildcard (e.g. "Aquafin*" matches every condition starting with "Aquafin"), then click **Generate assembly** to download a filled-in copy. When two or more workbooks are mapped, **Generate All** downloads every one in a single click.

**Excel export adds a Data sheet, a By Sheet summary, and your branding.**
Every Excel report now includes two new tabs alongside Executive Summary and Quantities: **Data** (one flat row per measurement — condition, category/folder, sheet, quantities, costs — ready to drop into a PivotTable) and **By Sheet** (quantities grouped by drawing sheet, collapsible so you can see everything on one sheet at a glance). Conditions in a folder also roll up into a folder subtotal on the Quantities sheet now. If your deployment has set a company name, logo, or accent color (Admin → report branding), exports use those instead of the stock Meridian look.

**Quantities sheet in Excel exports is now fully editable.**
The Quantities tab is no longer sheet-protected — waste %, material $, equipment $, and every other cell are open for direct edits (Excel disables its outline +/- collapse buttons on any protected sheet, so this keeps the folder grouping usable). Executive Summary stays protected, aside from the profit-margin-rate cell.

**Auto-hyperlink's setup step is down to one click.**
Running **Auto-hyperlink** no longer asks you to configure OCR passes or scan modes — pick a scope (entire project or current document), click **Run auto-hyperlink**, and it shows a one-line estimate ("Will scan 12 PDFs (340 pages) — about 2 minutes") before you confirm. The review-before-apply step afterward is unchanged.

**Condition templates now sync to your account.**
Templates you save under **Templates** (Conditions tab) follow you to any device you sign in on — no longer tied to one browser. Turn on **Shared** on a template to publish it to your whole team; teammates see a **Shared** badge and can apply it, while only you (or an admin) can edit it. Templates you saved before this update import automatically the first time you open the dialog.

**AI Chat gives better answers.**
Chat now picks out the most relevant pages of your uploaded sheets for each question instead of skimming everything at once — ask about a specific sheet number (like **A-101**) and it focuses there. Answers come back with real tables for quantity breakdowns and cite the sheet/page they came from. New: **Stop** and **Copy** buttons, and suggested questions to get you started.

**Auto-hyperlink now reads detail and section bubbles.**
The scan reads the number inside circled detail/section callouts — the tags estimators actually navigate by — even when the drawing's text isn't selectable, and links them to the right sheet. It only creates a link when it's confident in the read, so you won't get links pointing at the wrong sheet; matchlines and plain text references still work like before.

**Sheet links land the right way.**
Clicking a hyperlink now fits the whole target page to your window (or jumps to the link's saved view and zoom, when one is set) instead of sometimes opening at 100% zoom on a page too big to fit. Plain navigation is untouched: leave a sheet zoomed into a corner, come back, and you're still there.

**Auto-hyperlink stopped placing links on blank space.**
A bug caused batch-generated hyperlinks to sometimes land on an empty part of a sheet instead of the actual callout bubble. Fixed — re-run auto-hyperlink on an affected project and the bad links clean themselves up.

**Auto-hyperlink now shows a real progress bar.**
Running auto-hyperlink across a whole project used to sit on "Running…" with no sense of how far along it was. Now the run dialog shows a bar that fills page-by-page, the current sheet being scanned, and a running count of callouts found — so you can see it working through a long scan.

**Dialogs now size to their content.**
Dialogs with a lot to show — like the auto-hyperlink review table — now stretch to use available screen space instead of squeezing everything into a fixed small window. Simple dialogs stay compact.

---

## Phases 1–6: the initial beta build — 2026-07

**Faster, smoother navigation.** Zoom and pan were reworked to feel instant on both mouse and touch.

**Scale calibration checks itself.** Calibrate now scans for a printed scale note and flags sheets that look like a half-size or fit-to-page reprint, so you catch a bad scale before it throws off a whole job.

**Batch hyperlinking, done right.** Section and detail callouts are read directly from the PDF's vector drawing data — no OCR guessing. A review table shows exactly what will link before anything is created, and links can jump straight to the referenced detail, already zoomed in.

**Arc tool.** Bow a wall segment into a curve by dragging its midpoint handle. Quantities update correctly with the curve, and arcs show up in PDF exports too.

**Protected vertex editing.** An explicit "Edit vertices" mode lets you reshape a measurement's corners without risking an accidental drag.

**Magic wand room fill.** Click inside a room and get an instant area measurement — no manual tracing.

**Command palette.** Press **⌘K** / **Ctrl+K** to jump to any sheet, activate a condition, or run an action from anywhere in the workspace.

**Condition templates.** Save a project's conditions as a reusable template and apply it to any new project in one click.

**Revision compare.** Compare two issues of the same sheet side by side, see exactly what changed, and carry your existing takeoffs onto the new revision automatically.

**PDF export options.** Choose whether reports show a legend, where it sits on the page, and what your markup labels display.

**Move guard for markups.** Measurements and annotations now require an explicit **Move** action (right-click or the **M** key) before they can be dragged, so an accidental click can't nudge your takeoff.

---

Have feedback on any of this? Use **Submit Feedback** in the Help menu — it's the fastest way to reach us.
