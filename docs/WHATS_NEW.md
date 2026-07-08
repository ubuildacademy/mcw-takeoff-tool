# What's new

Every update to Meridian Takeoff since the beta program started, newest first. Check back after each release — this page updates alongside the app.

---

## Templates, AI Chat, and schedule takeoff fixes — 2026-07

**Condition templates now sync to your account.**
Templates you save under **Templates** (Conditions tab) follow you to any device you sign in on — no longer tied to one browser. Turn on **Shared** on a template to publish it to your whole team; teammates see a **Shared** badge and can apply it, while only you (or an admin) can edit it. Templates you saved before this update import automatically the first time you open the dialog.

**AI Chat gives better answers.**
Chat now picks out the most relevant pages of your uploaded sheets for each question instead of skimming everything at once — ask about a specific sheet number (like **A-101**) and it focuses there. Answers come back with real tables for quantity breakdowns and cite the sheet/page they came from. New: **Stop** and **Copy** buttons, and suggested questions to get you started.

**Auto-hyperlink stopped placing links on blank space.**
A bug caused batch-generated hyperlinks to sometimes land on an empty part of a sheet instead of the actual callout bubble. Fixed — re-run auto-hyperlink on an affected project and the bad links clean themselves up.

**Schedule → takeoff (dev preview) now handles real door/window schedules.**
Multi-row headers (like "Door Number" split across five level columns) are understood automatically, and a new "count filled cells across columns" mode reads schedules that show one door number per level with no separate quantity column. Rows with the same name — every unit's entrance door, for example — can be grouped into a single condition with the total count. Note: a schedule whose entire body was converted to non-text graphics by the PDF export can't be read by this tool yet — you'll get a clear message instead of bad data if that happens.

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
