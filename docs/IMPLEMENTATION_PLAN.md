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
- **C3** Client: registry UI (upload + map to condition + input cells + job-info cells)
  in a new sidebar Costs-tab section; "Generate assembly" button on mapped conditions
  with a confirmation showing the per-condition quantity breakdown and the sum.
- **C4** E2E test against a copy of `Aquafin-2K M.xlsx` (path in ASSEMBLIES_DESIGN.md;
  live set at `~/Library/Mobile Documents/com~apple~CloudDocs/Business/MCW/Assembly
  Work/4.14.26 Assembly Update/2026 Assemblies 4-14-26/`): generated workbook opens in
  Excel without repair, quantity + job info in the right cells, every other zip entry
  byte-identical (compare entry-by-entry).

---

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
