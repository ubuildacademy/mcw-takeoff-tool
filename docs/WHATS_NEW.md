# What's new

Every update to Meridian Takeoff since the beta program started, newest first. Check back after each release — this page updates alongside the app.

---

## Start a condition from an assembly — 2026-07

**New: your assemblies are condition templates.** Open **Templates** at the top of the Conditions tab and your imported assemblies are listed there. Pick "Aquafin 2K" and the conditions it needs arrive ready to draw — linked to the assembly, with the right measurement type and unit, and no cost fields to fill in. Draw anything and the Costs tab prices the whole assembly.

An assembly that prices several quantities adds one condition per quantity, named after it, so nothing is left unmeasured by accident. Waste stays at zero on the condition because the assembly carries its own.

**Mapping a workbook is now a tick-list.** The **Condition pattern** box under Assembly Workbooks is gone — you tick the conditions the workbook prices instead of typing a name and hoping it matches. On upload, the conditions matching the filename come pre-ticked. Mappings you already made keep working, wildcards and all.

---

## Assembly budgets you can hand to accounting — 2026-07

**New: download the Material and Labor budgets straight from the Costs tab.** Under **Assembly Pricing**, click **Download budgets (.xlsx)** and you get the same two sheets your assembly workbooks produce — same columns, same order, in your report branding.

**Material Budgets** lists every component as a purchase line: product, cost code, quantity, price with tax, packaging, cost type. Your workbooks leave the Qty column empty for someone to fill in from the P.O. — Meridian already knows the package count, so it fills it in.

**Labor budgets** breaks the job total into the buckets accounting posts against: regular pay, payroll tax, workers' comp, material, equipment, misc, general liability, and overhead & profit as the remainder. It's a decomposition of the total, not a second estimate, so the buckets always add back up to it — and the sheet carries a live cell showing that, which stays at $0.00 unless someone edits a figure.

A **Notes** sheet comes with every download: how to read the report, anything worth checking before filing it, and a plain statement of the two places Meridian's figures differ from the workbook's.

Tick **Restoration liability rate** before downloading if the job is restoration rather than waterproofing. The three accounting rates now live under **Admin → Cost Defaults**, in their own section — changing them moves money between columns on this report and never changes what a job is priced at.

---

## Live assembly pricing on the Costs tab — 2026-07

**New: a condition can be priced by an assembly, live.** Open any condition and pick one under **Price with assembly**. The **Costs** tab then prices it from your actual takeoff quantity — materials by coverage yield against your price list, labor from the assembly's production rates and crew, then its margin chain and insurance — and the number moves as you measure. Expand a condition to see every component line, package counts, and each margin step.

If the assembly prices more than one quantity, you're asked which one the condition measures. If it prices only one, you're not asked at all.

**It says what it doesn't know.** Link a condition to an assembly's floor quantity while nothing measures its wall quantity, and the wall components show as $0 with a note naming them — rather than a confident-looking total with a third of the assembly missing. The same goes for a component whose price is missing or a production rate that couldn't be matched to a quantity.

Waste comes from the assembly rather than the condition: your workbook already carries a waste percentage for each quantity it prices, and applying the condition's on top would order extra without saying so.

---

## Assemblies and cost defaults — 2026-07

**New: import your priced workbooks into Meridian.** Under **Admin → Assemblies**, upload one of your assembly spreadsheets and Meridian reads it — components, coverage yields, the quantity inputs it prices against, production rates, crew and margins — and shows you everything it found *before* saving anything. Fix what it flags, name it, then import.

It flags rather than guesses. A component whose price was pasted over the lookup, a quantity that copies another row, a crew size that's obviously a typo — all called out in the review, and an assembly with unresolved rows is saved flagged rather than quietly priced.

**New: Cost Defaults.** The rates every assembly shares — day rate, labor burden, escalation, tax, insurance and your margin chain — now live once under **Admin → Cost Defaults**. Change the day rate there and every assembly reprices, except the ones that deliberately set their own; each field tells you how many those are. Crew size and production rates stay with the assembly, because they genuinely differ job to job.

---

## Product pricing list — 2026-07

**New: your price list now lives in Meridian, under Admin → Product Pricing.**
Import the **Export DB** file from the MCW Pricing Manager and the app keeps a copy of every product code, description, price, and price date. The table shows what it holds and when it was last imported, with a filter box for finding a code quickly.

The Pricing Manager stays in charge of prices — change one there and re-import here. Because of that, the tab is read-only apart from the import, and dropping in a raw *supplier* price list is refused with a note telling you to run it through the Pricing Manager's diff-and-confirm step first.

Importing tells you exactly what changed — "42 new, 7 updated, 1,102 unchanged" — and re-importing the same file changes nothing. Rows the file can't be read from are reported rather than skipped quietly: unrecognised columns, rows with no product code, and the category-header rows at the bottom of the export are each counted back to you.

This is the price list assemblies will be costed against as the native assembly engine lands.

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
