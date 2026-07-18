# Meridian Takeoff — Senior Review & Implementation Plan

*2026-07-13. Written as a senior-review deliverable: ranked problems + self-contained task
instructions sized for a cheaper model to execute **one task at a time**. Read the
"Execution rules" section before starting any task.*

---

## Execution rules (read first, every session)

1. **One task per session.** Finish it, verify it, commit it. Do not start the next task.
2. **Read before writing.** Every task lists its files — read them fully before editing.
   Match the file's existing style, naming, and comment density.
3. **Verify:** `npx tsc --noEmit` at repo root (client) AND in `server/` must pass.
   If a task touches export logic, generate a real export and open it (success criteria say how).
4. **Never touch these without an explicit task:** `server/src/scripts/table_extract.py`,
   auth/middleware, migration files already applied, `useTakeoffExport.ts` sections not named
   in your task.
5. `useTakeoffExport.ts` is ~1,430 lines. **Do not grow it.** New export surfaces go in new
   modules under `src/components/takeoff-sidebar/export/` and are called from the hook.
6. Formulas in the workbook reference `Quantities!` ranges and hidden helper columns
   (`COL.isTotalRow`, `COL.pageKey`). If you add worksheets, add them **after** the existing
   ones and never rename existing sheets.
7. Commit messages: conventional commits, explain *why* in the body.
8. **Help docs ship with the code (Jeff, 2026-07-16).** The in-app Help renders
   `docs/WHATS_NEW.md`, `docs/WORKSPACE_GUIDE.md`, and `docs/QUICKSTART_AND_HOTKEYS.md`
   (bundled via `?raw` imports in `src/components/help/HelpGuidePage.tsx`). Any task that
   changes user-facing behavior MUST update the relevant sections of those files in the
   same commit — a WHATS_NEW entry at minimum, WORKSPACE_GUIDE when a workflow changes,
   QUICKSTART_AND_HOTKEYS when keys/buttons change. Leaving help stale = task not done.

---

## State of the product (2026-07-13)

**Solid, in production:** navigation/auto-scale, batch hyperlinking (vector, self-cleaning),
arcs + vertex editing, click-to-fill magic wand, ⌘K palette, condition templates + team
sharing, revision compare + carry-forward, PDF markup export options, DB persistence,
AI chat (Ollama free tier), per-request token usage logging + admin AI Usage tab (merged
to main 2026-07-13).

**Dev-gated, needs refinement:** Schedule → takeoff (branch `feat/schedule-ocr-fallback`,
held from main). OCR extraction now works (PSM 11 sparse + grayscale + rotation-correct
lattice), but real-world use produced messy condition names and an unintuitive review
dialog (see Workstream B evidence).

**Shelved:** whole-sheet room-proposal sweep (over-detected; magic wand covers rooms).

**Parked pending design review with Jeff:** assemblies/pricing (see
`docs/ASSEMBLIES_DESIGN.md` — Stage 1 workbook bridge is scoped and has 4 open questions).

**Data-gated:** AI provider decision (Ollama Cloud vs OpenRouter vs direct DeepSeek).
Token usage instrumentation is live; revisit when ~2–4 weeks of beta data exists in the
admin AI Usage tab. Privacy note on file: client plan data should not go to China-hosted
APIs without an explicit decision.

---

## Ranked problems

| # | Problem | Impact | Workstream |
|---|---------|--------|------------|
| P1 | Excel export lacks the views estimators actually pivot on (flat data sheet, per-sheet breakdown, category grouping) | Every demo, every bid | A |
| P2 | Export is unbranded — can't white-label for "top dollar" positioning | Sales | A |
| P3 | Schedule tool creates garbage condition names from mis-mapped columns; junk rows apply silently; dialog demands manual mapping with no preview | Feature is 70% built but 0% trusted | B |
| P4 | Assemblies = the biggest revenue feature, blocked only on a design review | Revenue | C |
| P5 | AI chat has no paid fallback and each message burns ~23k prompt tokens | Cost/reliability, not urgent | D |
| P6 | PDF summary report is a plain-text dump next to a rich Excel | Perception | A (last) |

Recommended order: **A1 → A2 → A3 → A4 → B1 → B2 → C (review session) → then C tasks → D → A5.**

---

## Workstream A — Excel export polish

Current state (read these files first):
- `src/components/takeoff-sidebar/useTakeoffExport.ts` — all export logic. Workbook has
  `Executive Summary` (protected, branded text-only), `Quantities` (grouped by condition,
  TOTAL row + outline-level-1 measurement rows, live formulas, hidden helper cols 19–20,
  frozen panes, editable amber input cells), `_Calc` (veryHidden).
- `src/components/TakeoffSidebar.tsx` — Reports/Costs tabs, export dropdown.
- `src/services/apiService.ts` — `settingsService` (key/value app settings, admin-writable).
- Condition folders exist (`conditionFolderService` in apiService; `create_condition_folders_table.sql`).

### Task A1 — Flat "Data" worksheet (pivot-ready)

**Goal:** estimators pivot raw data in Excel; give them a clean flat table.

**Files:** new `src/components/takeoff-sidebar/export/buildDataSheet.ts`;
call it from `useTakeoffExport.ts` `exportToExcel` after `_Calc` is built.

**Do:**
1. New worksheet named `Data`, added last. One row per measurement (reuse the
   `allMeasurements` array already built in `exportToExcel` — pass it in).
2. Columns (plain values, no formulas, no merged cells): Condition, Category (folder name
   or "Uncategorized"), Type, Quantity (net value), Unit, Sub-Qty Total, Sub-Qty Unit,
   Area (SF), Perimeter (LF), Height, Sheet Number, Sheet Name, Page, Multiplier,
   Waste %, Material $/Unit, Equipment $, Description, Measured At (ISO date).
3. Folder name: look up via the condition's folder id → `conditionFolderService` data that
   is already in the condition store (`useConditionStore`) — verify the actual field names
   by reading `src/store/slices/conditionSlice.ts` and `src/types/index.ts` first.
4. Header row styled with the existing `headerStyle`; apply `worksheet.autoFilter` across
   the header; freeze row 1. No sheet protection on `Data`.
5. Number formats: quantities `#,##0.00`, money `"$"#,##0.00`.

**Success criteria:**
- `npx tsc --noEmit` clean.
- Export from a project with ≥2 conditions on ≥2 sheets: `Data` sheet exists, row count =
  measurement count, autofilter works, a pivot table on Condition×Sheet sums to the same
  grand totals as the `Quantities` TOTAL rows.
- Existing sheets byte-for-byte unchanged in structure (spot-check: Exec Summary totals
  still compute, Quantities outline still collapses).

### Task A2 — "By Sheet" summary worksheet

**Goal:** answer "what's on A-101?" without pivoting.

**Files:** new `src/components/takeoff-sidebar/export/buildBySheetSheet.ts`; call from
`exportToExcel`.

**Do:**
1. Worksheet `By Sheet`, added after `Data`. Long format: one row per (sheet, condition)
   pair with columns Sheet Number, Sheet Name, Condition, Quantity, Unit.
2. Group rows by sheet: a bold sheet header row (Sheet Number + Name, `conditionSummaryStyle`),
   then its condition rows at `outlineLevel = 1`, then a blank spacer. Sheets ordered by
   sheet number (natural sort: A1.01 < A1.02 < A10.01 — write a small comparator, don't
   lexicographic-sort).
3. Source the numbers from the same `reportData` used elsewhere (per-condition `pages`
   records) — do not recompute from stores.

**Success criteria:** tsc clean; export shows every sheet that has measurements; per-sheet
condition quantities match the Quantities sheet page totals; collapsing outline shows one
row per sheet.

### Task A3 — Branding (white-label header)

**Goal:** company name + accent color on every export; logo if configured.

**Files:** `src/components/AdminPanel.tsx` (AI Settings tab area — add a small "Report
Branding" section, admin-only), `src/services/apiService.ts` (settingsService already
does key/value), `useTakeoffExport.ts` (Exec Summary title block), new
`src/components/takeoff-sidebar/export/branding.ts`.

**Do:**
1. Settings keys: `report-company-name` (string), `report-accent-color` (hex string),
   `report-logo` (base64 PNG ≤ 200KB, optional). Admin panel section with two inputs +
   file picker; save via `settingsService.updateSetting`. Validate size/type client-side.
2. `branding.ts`: `getReportBranding(): Promise<{name, accentARGB, logoBase64|null}>` —
   fetch settings with sane fallbacks (name → current "MERIDIAN TAKEOFF", accent →
   existing blue `FF3B82F6`).
3. In `exportToExcel`: title cell text = `${name} — TAKEOFF REPORT`; the medium/thick
   border accents currently hardcoded `FF3B82F6` use the accent color; if logo present,
   `workbook.addImage` + place top-left of Exec Summary (rows 1–2, keep title readable).
4. Non-admin users just get the branding — no UI exposure outside admin panel.

**Success criteria:** tsc clean; with settings unset export is pixel-identical to today
except title; with name+color+logo set, export shows all three; corrupt/oversized logo is
rejected with a toast and never breaks export (try/catch around addImage, fall back to
no logo).

### Task A4 — Category (folder) grouping in Quantities

**Goal:** conditions grouped under their folder with a folder subtotal row.

**Files:** `useTakeoffExport.ts` (the `conditionGroups` loop, lines ~613–723).

**Do (surgical — this is the riskiest A task):**
1. Order `conditionGroups` entries by folder name (Uncategorized last), then condition name.
2. Before the first condition of each folder, write a folder header row: name in col 1,
   `_sectionHeaderStyle`-like bold, `isTotalRow` helper = 2 (new sentinel, so existing
   SUMPRODUCTs that test `=1`/`=0` are unaffected — **verify every formula that reads the
   helper column still filters correctly**).
3. Folder subtotal: quantity col = SUM of the folder's TOTAL-row quantities (formula over
   explicit row refs, not ranges, to avoid catching measurement rows).
4. Outline: folder header level 0, condition TOTAL rows stay level 0, measurements level 1.
   (Do not try to make conditions collapsible under folders — ExcelJS outline is row-based
   and the current TOTAL rows already use level 0; adding a level would reflow everything.)

**Success criteria:** tsc clean; export with 2 folders + uncategorized conditions shows
headers and correct subtotals; Exec Summary Material/Equipment/Waste totals unchanged
from pre-task export of the same project (the SUMPRODUCT filters must not pick up the
new sentinel rows); outline collapse still works.

### Task A5 — PDF summary report upgrade (do last, optional)

**Goal:** PDF report tables instead of text runs.

**Files:** `useTakeoffExport.ts` `exportToPDF`; add dependency `jspdf-autotable` (verify
license MIT and bundle impact first; if >50KB gzip added to the main chunk, lazy-import it
exactly like jsPDF already is).

**Do:** cover block (branding from A3), then autotable: Conditions summary (Condition,
Category, Qty, Unit, Material $, Equipment $), then per-sheet table (from A2's data shape).
Keep the existing markup-pages rendering that follows.

**Success criteria:** tsc clean; PDF opens in Preview/Acrobat; tables paginate cleanly
across ≥2 pages; totals match Excel.

---

## Workstream B — Schedule → takeoff refinement

Branch context: all schedule work lives on `feat/schedule-ocr-fallback` (NOT merged to
main; feature is dev-gated behind `import.meta.env.DEV`). Work these tasks **on that
branch**.

Evidence of the problem (2026-07-13 beta test, glazing schedule): conditions created with
names like `"D NOA # EXPIRATION DATE ZONE 4 ZONE 5"`, `"STC—42 0.70 0.60 #190002-R1 FL 30,
EXPIRES JUNE 2019 —50.2 —50.2 -92.0 +50.2"`, `"e"`, `"Z2e oS Ow"`. Extraction found real
data; mapping and hygiene failed.

Read first: `src/utils/scheduleTableMapping.ts` (header detection, column labeling,
qty-mode inference), `src/components/ScheduleReviewDialog.tsx`,
`src/components/TakeoffWorkspace.tsx` (handleScheduleApply, ~lines 190–260).

### Task B1 — Name hygiene + junk-row suppression

**Files:** `src/utils/scheduleTableMapping.ts` (add pure functions + unit tests in a
sibling `.test.ts`), `ScheduleReviewDialog.tsx` (use them).

**Do:**
1. `cleanConditionName(raw: string): string` — collapse whitespace; strip leading/trailing
   punctuation and stray pipes/brackets; cap at 60 chars on a word boundary with ellipsis.
2. `isJunkRow(row: string[], nameCol: number): boolean` — true when the name cell has
   fewer than 3 alphabetic characters, OR >50% of its characters are non-alphanumeric,
   OR every data cell is empty/dashes.
3. Dialog: junk rows render greyed-out and **default unchecked** (user can still check);
   name column cells render through `cleanConditionName` and the Result column shows the
   cleaned name that will be created.
4. Improve name-column auto-pick: prefer the column whose header matches
   /room|name|mark|type|desc/i; fall back to the column with the highest share of
   alpha-dominant cells (≥3 alpha chars). Current pick grabbed a remarks/NOA column.
5. Unit tests: the four garbage names from the evidence above must come out clean or
   their rows flagged junk; a good door-schedule row must survive untouched.

**Success criteria:** `npm test` passes incl. new tests; tsc clean; re-run against the
beta glazing schedule creates zero conditions with `#`/`EXPIRES`/single-letter names
unless manually checked.

### Task B2 — Inline rename + apply-preview

**Files:** `ScheduleReviewDialog.tsx`, `TakeoffWorkspace.tsx` (`ScheduleApplyGroup` flow).

**Do:**
1. Result column becomes an editable text input (defaults to cleaned name); edits carry
   into the created condition name. Keep it keyboard-friendly (tab through rows).
2. Above the Apply button, a live summary line: "Will create N conditions, M markers"
   recomputed from current checkboxes/grouping — the user should never be surprised by
   what Apply does.
3. Apply button disabled when N = 0.

**Success criteria:** tsc clean; renaming a row then applying creates the renamed
condition; summary line matches actual created counts (verify via toast numbers).

### Task B3 — Column-mapping presets (only after B1+B2 feel good)

**Files:** `scheduleTableMapping.ts`, `ScheduleReviewDialog.tsx`.

**Do:** a preset dropdown — Door schedule / Glazing schedule / Finish schedule / Custom —
that pre-picks name column regexes and qty mode (door → count-across-level-columns when
grouped headers detected; glazing → one-per-row). Presets only set defaults; user can
override everything.

**Success criteria:** tsc clean; selecting Door on the beta door schedule reproduces the
good mapping with zero manual dropdown changes.

**Ship gate for Workstream B:** after B1+B2 land, Jeff runs both beta schedules end-to-end.
If output requires < ~1 min of cleanup, remove the dev gate and merge the branch;
otherwise iterate. Do not merge on green tests alone.
*Gate result 2026-07-13: "works decently — maybe OK for beta, still room for improvement;
some OCR characters wrong." → B4 queued; dev gate stays on until B4 + re-test.*

### Task B4 — OCR character-accuracy pass (queued from beta feedback 2026-07-13)

**Goal:** cut per-character OCR errors on outlined schedules ("some OCR characters wrong").

**Files:** `server/src/scripts/table_extract.py` (`_ocr_words`, `_ocr_fill_grid`).

**Do (measure each step against the Tru Hilton page-53 door schedule before keeping it):**
1. Low-confidence cell retry: for cells whose min token confidence ≤ 70, re-OCR just that
   cell's crop at 2× the region DPI with `--psm 7` (single line) and keep whichever read
   has higher confidence. Bounded: only retry cells that had text, cap ~100 retries/region.
2. Domain normalization pass (deterministic, post-OCR, per cell): common CAD-schedule
   confusions — `O↔0` in door numbers, `l/I↔1`, `S↔5` only when the rest of the cell is
   digits; normalize quote glyphs (`”→"`, `’→'`) in dimension cells matching
   /^\d+['-‐–]/; strip lone trailing `.` after integers.
3. Optional per-column charset hints: after mapping, dimension-like columns
   (/width|height|thickness/i header) re-validated against /^[\d'"‐–\-⁄/ .]+$/ — mismatch
   lowers cellConfidence so the amber flag fires, never silently rewrites.

**Success criteria:** on the page-53 schedule, high-confidence (>70) cell share increases
and dimension columns read >90% correct by manual spot-check of 20 cells; extraction time
stays under ~20s/region; existing tests pass. Jeff re-runs the ship gate after this lands.

*Gate result #2 (2026-07-15): FAIL — but root cause is selection logic, not OCR. Dialog
auto-picked "0: Door" as name column; door numbers live in oval bubbles OCR can't read,
so col 0 is empty on every clean row → all clean rows flagged junk/unchecked, while the
one OCR-garbage row ("Vai va") had noise in col 0 → the ONLY row checked. Perfectly
inverted selection from one bad column guess. Jeff also confused by amber affordance
("am I supposed to fix it?"). Dev gate stays. → B5.*

### Task B5 — Fix name-column guess + selection re-derive (queued 2026-07-15)

**Goal:** the review dialog must never invert selection like gate #2. No OCR changes.

**Files:** `src/utils/scheduleTableMapping.ts` (`guessNameColumn`),
`src/components/ScheduleReviewDialog.tsx` (selection reset), tests alongside existing ones.

**Do:**
1. `guessNameColumn`: a column only qualifies if ≥60% of its body rows are non-empty
   (after trim). Among qualifying columns, keep the current header-regex-then-
   alpha-dominance logic. Add tests: the gate-#2 shape (col 0 empty except one noise row,
   room names in a later column) must pick the room-name column.
2. `ScheduleReviewDialog`: when the user changes the Name column dropdown, re-derive the
   junk flags AND the checked set (same render-phase reset pattern already used for
   table/headerRows — no useEffect). Manual toggles reset on column change; that is
   acceptable and predictable.
3. Amber affordance copy: change the subtitle to explain the action, e.g. "amber = low
   OCR confidence — click the row's name to fix it before applying". One sentence, no
   new UI.

**Success criteria:** unit test reproducing gate #2 passes (clean rows checked, noise row
unchecked); changing name column visibly re-derives checks; tsc + all tests green.
Jeff runs gate #3 after this lands.
*B5 DONE 2026-07-15 (6078154d, schedule branch).*

**WORKSTREAM B CUT (Jeff, 2026-07-17):** "The schedule tool is terrible and not useful
still — I think we need to cut it. Even if it successfully read a schedule, it's not
going to go through the whole set and apply those window/door types to auto count them
in the drawings... I don't see that happening quickly and accurately enough to trust."
Decision: feature removed, not parked. All B/OCR work preserved under git tag
`archive/schedule-ocr-fallback` (38 commits, pushed to origin); branch retired; live
dev checkout moved back to `main`. The dev-gated remnants on main (ScheduleReviewDialog,
scheduleTableMapping utils + tests, table_extract.py, tableExtractor.ts, the
/table-extract route, the workspace entry point) are dead weight → removal task below.
**Far-future idea worth keeping (Jeff's bar for ever reviving this):** schedule row →
auto-count placement across the whole drawing set (marry schedule types to the existing
Auto Count/visual search) — that's the version that would actually help estimators; pure
table extraction was never the valuable part. Requires trust-level accuracy that doesn't
exist yet; do not attempt without a fundamentally different approach.

*DONE 2026-07-14 (branch feat/schedule-ocr-fallback, on top of 42b0433d). All 3 steps
implemented as specified. Measured against the real page-53 door schedule (rotated
/Rotate 270, 87×23 `ruled_ocr` grid, 1094 non-empty cells):
- High-confidence (>70) share: 82.6% → 82.8% (904/1094 → 906/1094). Small, not the clear
  jump the criterion implies.
- Time: ~19.3s/region, under the ~20s budget — but only after the retry step (1) got a
  wall-clock cap on top of the ~100-retry count cap. Per-retry cost is dominated by
  pytesseract spawning a fresh `tesseract` subprocess (~120ms fixed overhead) — at a full
  100 retries this pushed a single region to ~27s. Added `OCR_RETRY_TIME_BUDGET_SEC`
  (4.5s) so the retry pass stops early under load; the ~100 cap is now a ceiling, not a
  target.
- Dimension columns, 20-cell manual spot-check (WIDTH/HEIGHT/THICKNESS, straight-vs-curly
  quote treated as equivalent): **10/20 (50%) both before and after — criterion not met.**
  Cause: on this page the dominant errors are Tesseract confidently misreading glyphs
  outside the spec'd confusion set — `¾` read as `%`, digit substitutions like `1`→`4`,
  and HEIGHT-column reads (`6'-8"`) losing characters down to `6-8` or `8"`. These land at
  78-94% confidence, so step 1's retry never fires on them (not ≤70) and step 2's
  normalization list doesn't cover them (spec scoped it to `O↔0`, `l/I↔1`, `S↔5`, quote
  glyphs, trailing dot). Step 3 (charset validation) is implemented and unit-tested but
  never fires on this specific page either — the grouped header row OCRs as pure garbage
  (`"° > Ww"`, `"an S65"`, etc.), so the `/width|height|thickness/i` header match never
  finds the WIDTH/HEIGHT/THICKNESS columns to validate.
- What step 2 *did* fix, verified: curly quote/apostrophe glyphs in dimension cells now
  come out straight (`3'-0"` instead of `3'-0"`/`3'-0"` mixed), consistently across the
  region.
- `existing tests pass`: no prior Python tests existed for this file; added
  `server/src/scripts/test_table_extract.py` (stdlib `unittest`, no PDF/Tesseract needed)
  covering `_normalize_cell_text` and `_validate_dimension_columns` — 8/8 pass. `server`
  `npx tsc --noEmit` was not re-verified clean in this worktree (node_modules was never
  installed here — pre-existing, unrelated to this change; no .ts files touched).

**Recommendation before Jeff re-runs the ship gate:** the 3 steps as spec'd don't move
page-53's dimension-column accuracy. Worth a follow-up task to either (a) widen the
normalization list once more real confusions are catalogued (¾/%, digit-for-digit
misreads), or (b) accept that the outlined/rotated schedule's HEIGHT column and header
row need a different approach (e.g. a header-position heuristic instead of header-text
matching, since header OCR is unreliable here) — flagging rather than deciding, since
scope was fixed to the 3 listed steps.*

---

## Workstream C — Assemblies (Stage 1 bridge)

**Design review COMPLETE (2026-07-13). Decisions locked — C tasks are executable.**
Read `docs/ASSEMBLIES_DESIGN.md` for full background (Stage 1 workbook bridge vs
Stage 2 native engine; per-org registry, no MCW-specific assumptions).

**Locked decisions:**
1. **Input cells:** a workbook maps to a **list** of `(label, cellAddress)` quantity
   inputs. Audit of all 235 live 2026 MCW workbooks: 227 have exactly one "Job Quantity"
   input, 3 have two (`Cover plates.xlsx`, `Eucopoxy Tufcoat and BM Corotech on
   walls.xlsx`), 5 have none detectable (manual mapping). Label cell address varies
   (C13×170, C12×30, C14×11, A12/A13/A14) — per-workbook mapping is mandatory, no
   default address.
2. **Job info:** yes — mapping optionally includes job-info cells (project name, client,
   address); generate writes them.
3. **Multi-condition, same workbook:** **sum** the mapped conditions' net quantities into
   the input cell — one priced workbook per product line per project. (Jeff 2026-07-13:
   "same product/assembly with two quantities → combined.") Show the per-condition
   breakdown in the generate confirmation so the sum is auditable.
4. **Pricing DB sheet:** never touched by the app; workbooks stay current via MCW's
   Pricing Manager.
5. **Runtime:** Python OOXML writer at `server/src/scripts/assembly_write.py`, invoked
   like `table_extract.py` (execFile wrapper service). Zip-level surgical rewrite —
   **never openpyxl for writing** (mangles formatting/charts). openpyxl is also broken
   in the current venv (pip ImportError) — pure stdlib zipfile+ElementTree works and is
   already proven by the audit script.

**Direction note (Jeff, 2026-07-13):** long-term convergence with condition templates —
"open an assembly as a condition template" so the template creates the condition already
wired to its assembly mapping. That is Stage 2 (ASSEMBLIES_DESIGN.md already plans
assembly-linked templates / trade packs). Stage 1 keeps registry and templates separate,
but **C1's schema must not preclude it**: `assembly_mappings` keys on condition *name
pattern or template id*, not only concrete condition ids.

Tasks (execute in order, one per session):
- **C1** Schema: `assembly_workbooks` (org-scoped file refs: filename, storage path,
  uploaded_by, org) + `assembly_mappings` (workbook id ↔ condition ref, `inputs` jsonb
  array of {label, cell}, optional `job_info_cells` jsonb map). RLS mirrors
  `condition_templates` sharing model. Migration file + typed service.
- **C2** Server: upload/list/delete endpoints (reuse project-file storage patterns);
  `server/src/scripts/assembly_write.py` (stdlib zip/OOXML: replace cell values in the
  ASSEMBLY sheet XML, drop calcChain, leave every other zip entry byte-identical);
  `POST /assemblies/generate` — resolve mapped conditions' net quantities (sum per
  decision 3), copy workbook, invoke writer, return download.
  *DONE 2026-07-14 (eaca0e4a). Review: `--selftest` passes; real-file smoke vs
  `Aquafin-2K M.xlsx` → exactly one zip entry changed (ASSEMBLY sheet, style
  preserved, `t="s"` correctly dropped for numeric write), all others
  byte-identical; server tsc clean. Two flags for C3/C4: (a) sheet name is
  hardcoded `ASSEMBLY` — non-MCW workbooks may differ, add optional
  `sheetName` to mapping when a real case appears; (b) a mapping with multiple
  quantity inputs writes the SAME summed total to every input cell — fine for
  the 227 single-input workbooks, wrong for the 3 dual-input ones; C3 UI
  should either restrict to one input per mapping or map conditions→inputs.*
- **C3** Client: registry UI (upload + map to condition + input cells + job-info cells)
  in a new sidebar Costs-tab section; "Generate assembly" button on mapped conditions
  with a confirmation showing the per-condition quantity breakdown and the sum.
  *DONE 2026-07-14 (65ee764b). Review: tsc clean, 7 matching-util tests green,
  admin gating via authHelpers.isAdmin, multi-input note shown, job-info limited
  to the 3 server-resolved fields, Generate All sequential. Not yet exercised
  against live Supabase — tables from create_assembly_workbooks_tables.sql must
  be applied before the upload flow works (C4 covers E2E).*
- **C4** E2E test against a copy of `Aquafin-2K M.xlsx` (path in ASSEMBLIES_DESIGN.md;
  live set at `~/Library/Mobile Documents/com~apple~CloudDocs/Business/MCW/Assembly
  Work/4.14.26 Assembly Update/2026 Assemblies 4-14-26/`): generated workbook opens in
  Excel without repair, quantity + job info in the right cells, every other zip entry
  byte-identical (compare entry-by-entry).
  *DONE 2026-07-15. `server/src/scripts/test_assembly_e2e.py`, stdlib-only, skips
  gracefully unless `ASSEMBLY_E2E_WORKBOOK` points at a real copy (never committed —
  contains MCW pricing). Real cells verified by reading the workbook first: C13/A13
  from the illustrative example don't hold user data in this file (C13 is the label
  itself, no A13) — used the actual input cells instead, D13 (numeric "Job Quantity",
  no formula) and C8 (empty "Notes" text field). Entry-by-entry zip diff confirms only
  the ASSEMBLY sheet changes (this workbook has no calcChain.xml, so that drop path
  isn't exercised here — covered by `--selftest`); dest zip CRC-checks clean and both
  workbook.xml and the touched sheet parse as XML. Manually opened the generated file
  in Numbers (via computer-use, user-approved): ASSEMBLY tab showed Notes="E2E Test
  Job", Job Quantity=6,200, and the dependent TOTAL/Total Job Cost formulas
  recalculated correctly (6,510 = 6200×1.05) — no repair dialog, only Numbers' routine
  "unsupported formulas replaced by last calculated value" notice that appears on
  every complex xlsx opened there, unrelated to this write. Did not test in real
  Excel (not available in this environment) — Numbers opening cleanly with correct
  values and live recalculation is the visual evidence obtained. No bugs found in
  assembly_write.py; zero server/src changes. server tsc skipped — no node_modules in
  this worktree.*

---

### Task D0 — Knowledge-base section-aware packing (queued from beta feedback 2026-07-13)

**Problem:** a trade KB over the 25,000-char context budget is tail-truncated at chat time
(observed: 29,191-char waterproofing KB — the ASTM standards section never reaches the
model). The admin UI warns, but the runtime fix is selection, not a bigger dump.

**Files:** find the KB injection point first (grep `KB_CHAR_BUDGET` — defined in
`src/constants/chatPresets.ts`, consumed where chat context is assembled) and
`knowledgeBaseService`. Pure packing function + unit tests in a new util module.

**Do:** split KB content on its existing `=== SECTION ===` / `---SECTION---` header
convention (tolerate both, and content with no headers = one section). Score each section
against the user's question with the same rare-term style scoring the page retrieval uses
(read that implementation and reuse/extract, don't reinvent). Pack highest-scoring
sections into the budget whole (never mid-section cuts); always include a section whose
header matches the question directly; if everything fits, behavior is identical to today.

**Success criteria:** unit tests: over-budget KB + dimension question → the relevant
section survives packing even when it lives at the tail; under-budget KB → byte-identical
to current behavior. tsc + npm test clean. No change to admin UI (its truncation warning
stays as the authoring signal).

## Workstream D — AI provider fallback (data-gated)

**Trigger:** ≥2 weeks of AI Usage data in the admin tab (merged to main 2026-07-13;
migration `create_ai_token_usage_table.sql` must be applied in Supabase first).

**Decision inputs:** tokens/day × per-token price for (a) Ollama Cloud sub tiers,
(b) OpenRouter (DeepSeek-class + Haiku-class), (c) direct DeepSeek. Weigh the standing
privacy constraint: customer plan text → China-hosted API needs Jeff's explicit sign-off,
default to US-hosted.

**Pre-scoped task D1 (after decision):** provider abstraction in
`server/src/routes/ollama.ts` — extract the upstream call into a small
`chatProvider.ts` with `{ollama, openrouter?}` implementations behind env-var config,
preserving the NDJSON streaming contract and token-usage logging (the `done`-frame stats
parsing must keep working for whichever provider; OpenRouter returns OpenAI-style
`usage` — map it into the same `logAiTokenUsage` call).

**Success criteria:** chat works with either provider by env switch; token logging rows
appear for both; streaming unchanged in the client; no provider key ever reaches the
client bundle.

---

## Workstream F — Batch hyperlinking: bubble targets (queued from beta feedback 2026-07-15)

**Problem (Jeff):** batch hyperlinking improved, but "still doesnt grab all the sections,
detail, and elevation tags. Mostly works on matchlines and easier things not in
bubbles/symbols — which are the high value auto-hyperlink targets."

**Scoping verdict (2026-07-15, READ-ONLY session, no product code changed):** the app
already has two bubble-detection passes wired into Auto-hyperlink —
`server/src/scripts/vector_callout_pass.py` (circle/hexagon geometry via
`get_drawings()`, paired with PDF text-layer words) and
`server/src/scripts/bubble_ocr_pass.py` (HoughCircles on a raster render + Tesseract,
for bubbles whose glyphs are vector strokes with no text layer). Both are real and
already merged — the gap isn't "no bubble detection exists," it's that neither pass
resolves real cross-sheet references on an actual beta set. Measured against the 80-page
"Architectural Combined" beta PDF (`server/temp/pdf-processing/`, doc
`b12fc9c4-1c4c-47bd-a27e-ed520b9c7453.pdf`) with a new scoping script
(`server/src/scripts/scope_bubble_callouts.py`, reproduces `vector_callout_pass`'s own
shape/dedupe heuristic read-only):

- **Geometry detection is not the bottleneck.** 6,756 circle/hexagon-shaped candidates
  in the callout size/aspect band, found across all 80 pages in ~28s — cheap, already
  fast enough to run on every Auto-hyperlink invocation (`vector_callout_pass.py`
  already does this).
- **91.0% of those candidates (6,145/6,756) have zero PDF text-layer words inside them.**
  Confirmed both by the aggregate count and by rendering crops of specific bubbles
  (`bubble_crop_0.png`-style checks): a bubble's detail number is drawn as vector-stroke
  glyphs, not an embedded text object, on the large majority of real callouts in this
  set. A coordinate-space bug (text-layer vs. drawing-layer using different
  rotated/unrotated coordinate spaces on this rotation=270 document) was checked and
  ruled out — both APIs share the same unrotated coordinate space here.
- **Of the 611 candidates that DO have text-layer words, only 8 (0.1% of all
  candidates) cleanly parse as a genuine sheet-ref pattern**, and 265 (43% of the
  text-bearing set) are single short alpha tags (`SD`, `HS`, `J`, `USB`, `D`) —
  visually confirmed as MEP/life-safety equipment symbols (smoke detector, heat sensor,
  junction box), not detail/section/elevation callouts. They happen to land in the same
  circle size/aspect band and are false positives for this feature.
- **`vector_callout_pass.py`'s own classification finds only 9 "reference" (cross-sheet)
  callouts in the entire 80-page doc, and 8 of those 9 are false positives**: a
  wall-type/fire-rating tag ("F1", rendered with a leader line to a wall, real text-layer
  word) trivially matches the same permissive `SHEET_REF_RE` used to accept genuine sheet
  refs like "A9.31". Only **1 genuine cross-sheet detail reference was correctly
  resolved via the text layer in the whole document.**
- **The existing raster fallback (`bubble_ocr_pass.py`, unmodified) was run directly
  against a real "Details" sheet (page 65 / A9.51) via a single-page PDF extract**:
  HoughCircles found 95 circles, 87 were OCR'd, and only 6 passed the sheet-ref accept
  regex — all 6 were false-positive misreads of nearby furniture/fixture legend text
  (e.g. `"FRAMED HEADBOAR GR-216"`, where `GR-216` coincidentally matches the
  `[A-Z]{1,3}-\d{2,3}` accept pattern). **Zero genuine hyperlink targets were recovered
  on that page by the raster pass either.**
- **Section/elevation triangle markers (circle+triangle) have no detection at all
  today** — `vector_callout_pass.py` only recognizes `circle` and `hexagon` shapes. A
  naive geometric triangle heuristic (3-4 line-segment closed paths in the same 8-90pt
  band) was tried during scoping and produced 4,623 candidates doc-wide — completely
  swamped by arrowheads, hatch ticks, and other line-art noise. Not usable as a cheap
  signal without expensive angle-based filtering, and any real section marker found this
  way would hit the identical "vector-glyph, no text layer" problem for its number/sheet
  content (same as circles above).

**Conclusion:** this is not a detection-coverage gap, it's a precision/OCR gap. Bubble
shapes are already found cheaply and accurately; the blocker is reading the number and
sheet-ref glyphs *inside* them (91% have no text layer) without also matching unrelated
same-shaped symbols (equipment tags, fixture legends, wall-type tags). F1 targets that
precision gap directly, scoped to circles only (the dominant shape, and where the raster
pass already has working plumbing). F2 (triangle/section support) is explicitly gated on
F1's results, since it depends on the same OCR precision work and isn't worth doing
first against 4,623 mostly-noise candidates.

### Task F1 — Precision-targeted bubble OCR (replace independent Hough scan)

**Goal:** recover real cross-sheet references from circle callouts whose glyphs are
vector-only (91% of candidates per the scoping numbers above), without reintroducing the
false-positive rate the current raster pass has (6/6 false positives on the page-65
test).

**Files:** `server/src/scripts/bubble_ocr_pass.py` (replace `_detect_circles` /
`_process_single_page`'s independent HoughCircles scan), `server/src/scripts/
vector_callout_pass.py` (expose its deduped circle candidate list for reuse — the two
scripts currently duplicate shape-candidate logic independently), `server/src/services/
bubbleOcrExtractor.ts` (no interface change expected, but confirm output shape survives).

**Do:**
1. Feed `vector_callout_pass.py`'s geometry-qualified, deduped circle list (candidates
   that pass shape/size but resolve to `kind: unlabeled` or find zero words — i.e.
   already-classified `reference`/`detail_title` callouts don't need OCR, they're
   already correctly resolved from the text layer) as the crop targets for OCR, instead
   of `bubble_ocr_pass.py`'s independent `HoughCircles` pass. On the page-65 test this
   drops the candidate set from 95 (Hough, noisy) to 32 (vector geometry, precise) —
   fewer OCR calls and fewer chances for an unrelated circle (furniture tag, fixture
   symbol) to produce a false-positive match.
2. Render each candidate's crop in isolation at a much higher effective resolution than
   today's full-page `RENDER_SCALE = 1.5` (e.g. render just that bubble's bbox, padded,
   at 8-12x PDF points) — affordable because there are only ~500-1,000 candidates in an
   80-page set, not a full-page raster; today's fixed low-res full-page render is why
   Tesseract has so little signal on a ~20pt bubble.
3. Tighten the accept filter from "OCR text contains a substring matching a sheet-ref
   regex anywhere" (today's bug — lets `"FRAMED HEADBOAR GR-216"` through) to a
   structural check: the crop's OCR output must decompose into a top token (detail
   label: digits/letters, short) and a bottom token (sheet ref: matches the stricter
   pattern) with nothing else recognized in between — reject multi-word prose matches.
4. Keep the existing single-letter-tag exclusion implicit: candidates already resolved
   via the text layer as a short alpha-only word (`SD`, `HS`, `J`, etc.) must not be
   re-sent through OCR at all — they already have text, so they're skipped by step 1's
   "already-classified" filter.

**Success criteria:** hand-label ground truth on pages 31-38 (elevations) + 55-68
(details) of the beta doc — every real circle-with-sheet-ref bubble Jeff would expect
linked. Re-run against that ground truth: recall on genuine cross-sheet references
measurably higher than today's 1/80-page-doc baseline, and zero false positives from
equipment-tag/fixture-legend circles (vs. today's 6/6 false-positive rate on the page-65
sample). `server` `npx tsc --noEmit` clean; `scope_bubble_callouts.py`'s numbers
re-measured post-change and reported in the session's follow-up.

*F1 DONE 2026-07-16 (claude/charming-jemison-606a81 worktree branch, unmerged).*
Hand-labeled 62 genuine circle callouts across the 22 scoped pages (1807 geometry
candidates total) by visually reviewing every candidate as rendered crops — a much
richer set than the scoping session's own text-layer-only count suggested, because 61/62
are vector-glyph-only (no text layer at all), exactly the case F1 targets. Fixture:
`server/src/scripts/fixtures/f1_bubble_ground_truth.json`.

Two non-obvious bugs found and fixed along the way, both load-bearing for F1 and
worth knowing about for any future rotated-page work on this doc set:
- **Rotation-space bug in crop rendering**: `get_drawings()`/`get_text()` return
  UNROTATED page coordinates, but `get_pixmap(clip=...)` expects the ROTATED
  `page.rect` space. This doc is rotation=270 on 69/80 pages. Using the raw unrotated
  bbox as `clip` silently renders the wrong region (or an empty one). Fix:
  `callout_geometry.rotated_clip()` transforms through `page.rotation_matrix` first.
  This bug does not affect `vector_callout_pass.py`'s own candidate/word-pairing logic
  (both `get_drawings()` and `get_text()` share the same unrotated space, confirmed by
  the original scoping session) — it only bites code that renders a crop from those
  coordinates, which is new in F1.
- **The bubble's own outline stroke wrecks Tesseract**: even a trivially clean "04"
  crop OCR'd as garbage until the circle/hexagon's own arc was excluded from the crop.
  Padding OUTWARD (the original approach) makes this worse by also pulling in adjacent
  compound "flag"/pointer geometry. Fix: crop to the TIGHT geometry bbox (no outward
  padding — adjacent shapes are separate paths and fall outside it for free), then inset
  INWARD by 14% on every side to drop the outline stroke, leaving just the interior
  text. Tuned empirically against the ground truth fixture.

Measured results (`bubble_ocr_pass.py`, real pipeline, not a simulation):
- **Recall**: 18/62 (29.0%) exact detail-label+sheet-ref match on held-out ground
  truth, vs. the baseline's 1 genuine reference in the entire 80-page document — an
  order-of-magnitude improvement on the stated success criterion, though still far
  from complete (OCR digit-confusion noise on CAD glyph fonts remains the binding
  precision constraint; see below).
- **False positives**: zero. Every emitted bubble's position was cross-checked
  against the ground truth bbox set; on every page with zero genuine callouts
  (including the 326-candidate UL fire-rating detail page that produced the original
  6/6 false-positive baseline), the new pass emitted zero bubbles. The 26 non-exact
  emissions on pages that DO have genuine callouts are digit-level OCR misreads at the
  *correct* bubble position (e.g. `17` read as `47`, `01` read as `601`/`6O1`, `O`/`0`
  and `Z`/`2` confusions) — not false accepts of unrelated equipment-tag/fixture-legend
  geometry. A light lookalike-normalizer (`O→0`, `Z→2`, `S→5`, `B→8` in the numeric
  portion of an already-plausible sheet ref) is applied but doesn't catch everything
  (e.g. `6`→`E` misreads aren't in the map, kept deliberately small to avoid papering
  over genuine errors).
- **Throughput**: full 80-page doc in 163.8s wall-clock (6 worker processes), 225
  total callouts found (already-resolved-via-text-layer + newly-OCR'd), well within
  the 15-minute extraction budget.
- `server` `npx tsc --noEmit` clean; `bubbleOcrExtractor.ts`'s interface unchanged.

Net: the false-positive problem F1 set out to fix is solved cleanly. The recall gap
that remains is a pure OCR-accuracy problem on thick-stroke CAD glyph fonts, not a
detection or false-positive problem — a good candidate for a future targeted pass
(per-character template matching, or a second OCR engine) if Jeff wants to push
recall further, but not blocking merge consideration on its own terms.

### Task F2 — Section/elevation triangle marker support (gated on F1)

**Goal:** extend detection to circle+triangle section/elevation callouts. **Do not start
until F1 lands and its OCR precision is proven** — scoping showed naive triangle
geometry alone produces ~13x more noise than signal (4,623 candidates doc-wide vs. 582
even loosely-classified circle callouts), and any real section marker still needs the
same OCR precision work F1 builds.

**Files:** `server/src/scripts/vector_callout_pass.py` (`_shape_candidates` — add a
compound-shape case), F1's new targeted-crop OCR path (reuse, don't duplicate).

**Do:**
1. Instead of an independent triangle-shape regex (proven noisy in scoping), detect
   triangles only as a *proximity check against an already-qualified circle*: a 3-4
   line-segment closed path whose bbox touches or sits within ~1 circle-radius of a
   circle candidate's bbox edge. This uses the circle pass (precise, low-noise) as the
   anchor and the triangle as a secondary signal, instead of scanning for triangles
   doc-wide.
2. Route the combined circle+triangle bbox through F1's targeted-crop OCR path
   unchanged — same crop/OCR/structural-accept logic, just a different candidate
   source.
3. Re-run `scope_bubble_callouts.py` (extended to tally circle+adjacent-triangle pairs)
   against the beta doc to get a real candidate count before writing detection code
   further than the proximity check.

**Success criteria:** measured candidate count for circle+triangle pairs on the beta doc
before deciding scope further; if real section/elevation markers are rare in this
particular beta set, say so plainly rather than over-building — recommend against
further investment if the hand-labeled true-positive count is in the single digits.
`server` `npx tsc --noEmit` clean.

---

## Workstream G — Navigation & dialog polish (queued from beta feedback 2026-07-16)

### Task G1 — Hyperlink landing: zoom-to-detail + fit-to-window regression

**Problem (Jeff):** clicking a link to "detail 26 on A9.8" should land on that detail
blown up; if not feasible, at least fit the target page to the window. Currently BROKEN:
"my fit to window logic has drifted — when I click through the sheets my pages are
appearing at 100% even though that doesn't fit in my window."

**Files:** `src/components/PDFViewer.tsx` (fitToWindow ~line 3198; the suspicious
default is ~line 3356 `zoom: viewState.scale || 1` — no saved per-page view state falls
back to literal 100% instead of a fit computation), `usePDFViewerInteractions.ts`,
hyperlink click/navigation path (`onHyperlinkClick` wiring), hyperlink records (check
whether the stored link carries the source/target bubble bbox — F1's pass captures
bubble bboxes at scan time).

**Do:**
1. Fix the regression first: navigating to a page with no saved view state must fit to
   window, never default to 100%. Keep saved per-page zoom when the user set one.
2. Zoom-to-detail: at CLICK time (zero added scan cost — the data already exists), if
   the hyperlink record (or the F1 emission it came from) carries a target region for
   the destination detail, land with that region centered at a sensible zoom (e.g.
   region + padding filling ~60% of viewport). If no region data exists on the link,
   fall back to fit-to-window. Do NOT add work to the scan/link-creation pass.
3. If target-region data is NOT currently persisted on hyperlink records, scope what a
   minimal schema/pass change costs and report back before building it — don't silently
   grow the scan.

**Landing precedence (Jeff, 2026-07-16 — binding for review):**
1. Link WITH stored view (region/zoom) → that view wins, zoom inherited.
2. Link WITHOUT stored view → fit-to-window.
3. Plain navigation (no link): user's last position+zoom on that sheet persists — this
   existing behavior must NOT regress while fixing the fit bug.
4. Fit-to-window is the default only when neither a link view nor saved page state exists.

**Success criteria:** clicking through 10 sheet links on the beta project: every landing
either fits the window or centers the target detail; zero 100% landings on
larger-than-window pages; plain-navigation position memory still works; existing zoom
controls unaffected; tsc + tests green.

### Task G2 — Auto-hyperlink progress bar — DONE 2026-07-17 (cc61b719, merged 4e3e19e6)

**Landed:** in-memory run-status map keyed by a client-minted runId + 700 ms polling
(no SSE — dodges proxy buffering; no DB writes). Server `autoHyperlinkProgress.ts`
keeps a monotonic pagesDone counter (correct under the vector pass's 3 concurrent
workers), TTL-swept. Extractors' `extractAllPages` take optional `onPage` parsing the
existing `[bubble-ocr] page N/M:` stderr lines — no python changes. Client owns the
denominator (Σ pages across queued passes); poller torn down in `finally` and pegged
full before the matching phase so a late tick can't drag the bar back. Bar shows phase
label, current sheet (`file p N/M`), and honest callouts-found count (real link count
only exists post-match, kept in the completion summary). Cancel: none existed mid-run;
none added. Chip session was blocked from committing by a Bash-classifier outage;
gates (tsc both sides, 260 vitest) run and commit made by the reviewer session.

**Problem (Jeff):** the run dialog "doesn't really tell much" during a ~5-minute scan.
The python passes already emit per-page stderr progress lines (see
vectorCalloutExtractor.ts / bubbleOcrExtractor.ts stream handling).

**Do:** surface real progress to the client: per-doc + per-page counts (e.g. "Doc 2/6 —
page 41/80 — 137 links found so far"), streamed (SSE or polling an in-memory job status
keyed by run id — match existing patterns in the codebase for long jobs). Progress bar
fills by pages-processed/total-pages across the run. Keep the existing completion
summary. No fake/indeterminate animation posing as progress.

**Success criteria:** full-project run on the beta set shows a bar that moves page-by-
page and a live link count; cancel (if it exists today) still works; tsc both sides.

### Task G3 — Adaptive dialog sizing

**Problem (Jeff):** "pop up dialog windows are sometimes a bit small/crowded. If there's
room on the screen they should take advantage — not the whole space, but if they only
need to stretch side to side a little to show the entire content, they should."

**Do:** audit the shared dialog primitives (ui/base-dialog and whatever Radix/shadcn
wrapper the app uses) — introduce a size variant (or content-driven max-width, e.g.
`max-w-[min(90vw,64rem)]` with width fitting content) applied to the crowded dialogs
first: Schedule review, assembly generate confirm, preflight, template pickers. Dialogs
must never exceed ~90vw/85vh, keep internal scroll for overflow, and small dialogs must
NOT balloon. List every dialog touched in the commit message.

**Success criteria:** the previously crowded dialogs show content without horizontal
squeeze on a 13" laptop; no dialog fills the whole screen; visual spot-check screenshots
in the session; tsc + tests green.

---

## Task H0 — Help-docs catch-up sweep — DONE 2026-07-17 (4fd34485, merged d1bb6ee8)

**Landed:** WHATS_NEW gained four entries (Assembly Workbooks, Excel Data/By Sheet +
branding, unprotected Quantities sheet, one-click Auto-hyperlink setup) and the
section header updated; WORKSPACE_GUIDE gained an Excel-export sheet table, a full
Assembly Workbooks section, and a Running Auto-hyperlink walkthrough (incl. the
progress bar); QUICKSTART got an Auto-hyperlink line; helpContent.ts gained three
FAQ entries + refreshed hub-card highlights. Documented from live UI/source, plain
language, no internal codenames. tsc both sides + 243 vitest green.

**Problem:** the 2026-07 sprint changed user-facing behavior faster than the help docs:
Excel export (new Data/By Sheet sheets, folder grouping, branding, Quantities now
unprotected/editable), Assembly Workbooks (entire new Costs-tab feature incl. C5
auto-mapping on upload), Auto-hyperlink (simplified dialog, automatic bubble/callout
scanning, nested scope group), AI chat KB packing. None of it is reflected in
`docs/WHATS_NEW.md`, `docs/WORKSPACE_GUIDE.md`, or `docs/QUICKSTART_AND_HOTKEYS.md`.

**Do:** one sweep session after G1–G3 merge (so the auto-hyperlink + dialog behavior is
stable): read the three help files fully, read the current UI for each changed feature
(don't document from this plan — document what the app actually shows), update all three
files. WHATS_NEW gets a dated section per feature; WORKSPACE_GUIDE gets the Assembly
Workbooks workflow + updated hyperlink/export sections; QUICKSTART gets any changed
buttons/flows. Verify rendering in the in-app Help (SimpleMarkdown — check tables/lists
render; `npx vitest run src/components/help` for the markdown tests).

**Success criteria:** every feature listed above appears correctly in Help; help search
finds "assembly", "auto-hyperlink", "Data sheet"; markdown tests green. Going forward
rule 8 (execution rules) keeps docs in sync per-task — this sweep clears the backlog.

---

## Final QA checklist (run before any production deploy)

- [ ] `npm run ci:local` passes (typecheck, build, lint, test, server build).
- [ ] Excel export from a real beta project: opens without repair warnings in Excel AND
      Google Sheets; Exec Summary totals = Quantities totals = Data pivot totals.
- [ ] Excel input cells (waste %, material $, equipment $, profit rate) editable; formulas
      recompute; protection blocks structural edits.
- [ ] PDF export renders and paginates on a ≥10-sheet project.
- [ ] Email report (SendReportModal) delivers with attachment and link modes.
- [ ] Schedule tool (dev build): both beta schedules produce clean names, junk rows
      unchecked, marker counts match the summary line.
- [ ] AI chat: normal question streams; admin AI Usage tab shows the request with sane
      token counts.
- [ ] Admin panel: all tabs load; branding settings persist and reflect in a fresh export.
- [ ] No new console errors on: project open, sheet nav, condition create, measurement
      draw, export, chat.
- [ ] `git status` clean; no stray temp/debug files committed.

---

## Standing decisions log

- 2026-07: features stay LLM-free where deterministic works (cost control).
- 2026-07: room-proposal sweep shelved; magic wand is the rooms tool.
- 2026-07-13: token-usage instrumentation merged to main; provider decision deferred to data.
- 2026-07-13: schedule branch held from main pending B1/B2 + Jeff's ship gate.
- 2026-07-13: assemblies Stage 1 approach confirmed in principle; blocked on design review.
