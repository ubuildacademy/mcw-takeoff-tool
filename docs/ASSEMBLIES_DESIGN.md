# Assemblies: MCW integration analysis & design

*2026-07. Basis: read-only analysis of the MCW Pricing Manager (`/Users/jeff/Code/MCW Pricing Manager`) and a live assembly workbook (`Aquafin-2K M.xlsx`). Decision doc for the next-cycle assemblies flagship.*

## What exists today (MCW side)

**Pricing Manager** (Python/Dash desktop app, SQLite at `~/mcw_pricing/mcw_pricing.db`):
- Canonical product table: `ITEM, CODE (PK/CPC_ID), DESCRIPTION, F4, NET PRICE, DATE` + category-header rows + full update audit trail (`update_history`/`update_rows`).
- Supplier `.xlsx` uploads → alias-based column auto-mapping → diff engine (CODE match → compare; ITEM reassignment; truly-new detection across history; 0.001 price tolerance; cosmetic-diff-insensitive text compare) → styled diff report → human confirms → upsert.
- Bulk workbook update: recursive folder scan → **surgical OOXML rewrite of only the sheet named "Pricing DB"** (zip-level, shared-string interning at stable indices, calcChain dropped). Everything else in each workbook survives byte-identical. No named ranges — formulas use whole-column `INDIRECT('Pricing DB'!B:B)` so row count can vary.

**Assembly workbook** (one workbook ≈ one product line, e.g. Aquafin-2K):
- `ASSEMBLY` sheet = the cost engine. Inputs: unit (SF), **job quantity**, waste %, escalation %, tax %, production rate (SF/day), day rate/man, crew size, labor burden %, equipment, margins (Safety 2 / Overhead 22 / Profit 20), insurance.
- Component lines: CPC code → `INDEX/MATCH` into Pricing DB → unit cost; coverage yield → `ROUNDUP(adjustedQty / yield)` → extended cost.
- Margins applied **divide-through** (cost ÷ (1−m), chained), NOT simple multiply — any native engine must replicate this exactly or totals won't match MCW's books.
- Surrounding sheets: WORK ORDER, P.O., Material/Labor budgets (accounting cost codes, Davis-Bacon toggle), job info. This is the "does a LOT" part — months to replicate, low differentiation.
- ~60% generic assembly math / ~40% MCW-specific paperwork + margin conventions.

## The seam

The workbook consumes exactly one number the takeoff app produces: **job quantity**. Everything downstream (materials, labor, margins, paperwork) already works in Excel and is trusted. That seam defines the integration.

## Recommendation: two stages

### Stage 1 — Workbook bridge (days of work, ship with next cycle's first batch)

"Send quantity to assembly workbook":
1. Per-company **assembly registry**: upload/associate workbooks (stored like project files, org-scoped), map each to conditions (e.g. condition "Aquafin 2K deck – SF" → `Aquafin-2K M.xlsx`, input cell for job quantity, optional job-info cells).
2. One click on a condition (or "Generate all"): server copies the workbook, surgically writes the condition's net quantity (+ project name/job info) into the mapped input cells using the same zip/OOXML technique the Pricing Manager already proves out (NOT openpyxl — it mangles formatting/charts), returns the filled workbook(s) for download.
3. Excel remains the cost engine and paperwork generator. Zero risk to MCW's trusted math; instant real-world value: takeoff → priced assembly in one click.

Multi-tenant: registry is per-organization; each company uploads its own workbooks and cell mappings. No assumptions about MCW's layout beyond what the mapping captures.

### Stage 2 — Native assembly engine (the multi-week flagship)

- Org-scoped `products` table mirroring the Pricing Manager schema (CODE PK, ITEM, DESCRIPTION, NET PRICE, DATE) + supplier-update import (port the diff/confirm workflow into the admin panel eventually; until then, CSV/xlsx import from the Pricing Manager's "Export DB").
- `assemblies` + `assembly_components`: component = product code ref, coverage yield, packaging unit; assembly = labor params (production rate, day rate, crew, burden), margin model (**divide-through chain**), escalation/tax.
- Conditions reference an assembly; Costs tab computes the full breakdown live from takeoff quantities; Excel export mirrors the workbook's Material/Labor budget shapes.
- **Bootstrap importer**: parse the `ASSEMBLY` sheet of existing workbooks (formula patterns are consistent `INDEX/MATCH` + `ROUNDUP(qty/yield)`) to extract component codes + yields + labor params → native assemblies with review screen. Stage 1's registry becomes the import source.
- Assembly templates shareable via the existing condition-templates mechanism (extended), so "trade packs" can ship with costs.

### Non-goals
- Replicating WORK ORDER / P.O. / budget paperwork sheets (Excel keeps that job indefinitely).
- Replacing the Pricing Manager's supplier-diff workflow near-term (it works; integrate by import).

## Open questions for Jeff — ANSWERED (design review 2026-07-13)
1. Input cell(s): audit of all 235 live 2026 workbooks — 227 have exactly one "Job Quantity"
   input, 3 have two, 5 undetectable; label cell address varies (C13×170, C12×30, C14×11,
   A12/A13/A14). → mapping stores a **list** of {label, cell}; per-workbook, no default.
2. Job info: **yes** — mapping optionally includes job-info cells; generate writes them.
3. Multi-condition, same workbook: **sum** into one input cell, one priced workbook per
   product line per project; the generate confirmation shows the per-condition breakdown.
4. Pricing DB: **never touched** by the app; Pricing Manager keeps it current.
5. (added) Writer runtime: Python stdlib zip/XML at `server/src/scripts/assembly_write.py`
   (pattern of `table_extract.py`). Never openpyxl for writing.

Task breakdown C1–C4 with success criteria: `docs/IMPLEMENTATION_PLAN.md` Workstream C.
C1 (schema + registry service) landed 2026-07-13 (46c908a0). RLS note: policy is
authenticated-only (no organizations table yet) — acceptable single-tenant; MUST tighten
to org scoping before multi-tenant sale.

## Stage 1 UX (agreed 2026-07-13)

**One-time setup (admin, per company):** Costs tab → "Assembly Workbooks" section →
upload the company's own priced workbooks (Aquafin-2K, Dow 790, …) → map each one:
which conditions feed it (a condition **name pattern** like "Aquafin*" or a template id —
never a concrete condition id, so Stage 2 template convergence stays open), which cell(s)
take the job quantity, optional job-info cells (project name, client, address). MCW's
235 workbooks work day one; any other company uploads theirs — nothing MCW-shaped.

**Per project (estimator):**
1. Takeoff as normal; condition "Aquafin 2K deck" ends at, say, 6,200 SF.
2. Conditions matching a mapping show a **"Generate assembly"** button.
3. Click → confirmation: `Pool deck 5,000 + Balcony 1,200 = 6,200 SF → Aquafin-2K M.xlsx
   (cell C13)` plus the job-info fields being written.
4. Confirm → download the priced workbook. Every byte identical to the uploaded original
   except the mapped cells (quantity + job info); formulas, margins, macros, formatting
   untouched. Excel remains the cost engine.
5. **"Generate all"** at project level → one zip, every mapped condition.

Pitch line: takeoff → priced bid in one click, using the company's *own trusted
workbooks* — vs. STACK-style assemblies that force the vendor's database and math.

**Stage 2 hook (Jeff's direction):** assemblies become openable as condition templates —
pick "Aquafin 2K" from templates, the condition arrives pre-wired to its mapping, and the
Costs tab prices live in-app. The C1 schema (`condition_ref` = name pattern/template id)
was designed so this requires no rebuild.

## Stage 1 verdict + next-level ladder (Jeff beta feedback, 2026-07-15)

C1–C4 shipped and E2E-proven, but Jeff's read after real use: **for a single condition,
manually typing the quantity into Excel is fewer clicks than upload→map→generate** — as
built, it adds work instead of removing it. Stage 1 only pays off at batch scale
("Generate All" across 10–15 product lines, zero transcription errors, auditable
breakdown). Treat Stage 1 as plumbing, not product. Direction confirmed by Jeff: goal is
everything in-system, eventually replacing the 200+ workbooks with beautified in-app
reports/downloads.

Agreed ladder:
- **C5 — auto-map on upload** (next, small): on workbook upload, scan the ASSEMBLY sheet
  XML for the "Job Quantity" label (audit: detectable in 227/235 workbooks), propose the
  adjacent VALUE cell (e.g. label C13 → input D13 — C4 proved the label/value split) and
  a name-derived condition pattern. Upload → one confirm dialog → mapped. Kills the
  manual form for the common case; form remains as fallback for the 8 odd workbooks.
- **C6 — kill the pattern box**: replace free-text pattern with a multi-select dropdown
  of the project's actual conditions; plus assembly-as-condition-template (the Stage 2
  hook) so new conditions are born pre-wired.
- **Stage 2 — native engine** (own planning session; break into chip-sized tasks like
  Workstreams A–C before any code): bootstrap importer parses all ASSEMBLY sheets
  (consistent INDEX/MATCH + ROUNDUP(qty/yield) patterns) → native assemblies
  (components, yields, labor params, divide-through margin chain) → Costs tab prices
  live during takeoff → branded in-app report downloads. The workbook library becomes a
  one-time import source, not a runtime dependency. Registry + writer stay as the escape
  hatch for companies that keep Excel.

## Stage 2 viability — MEASURED 2026-07-21, verdict GO

The bootstrap importer was the load-bearing assumption of Stage 2: if the ASSEMBLY
sheets don't parse, the workspace is a data-entry surface rather than an import-review
surface — a materially different product. Measured before designing, via
`server/src/scripts/scope_assembly_parse.py` (dev-only, read-only, reproducible) against
all 236 workbooks in "2026 Assemblies 7-14-26".

**Result: the importer is viable.** Raw classification is FULL 130 (55.1%) / PARTIAL 101
(42.8%) / FAILED 5 (2.1%), but the raw split understates it:

- **No genuine workbook failed.** The 5 FAILED are `Composite clean up`, `Off site
  parking`, `Subcontractor`, `Submittals` — administrative, non-material line items with
  no ASSEMBLY sheet — plus one stray non-assembly file that was sitting in the folder.
- **PARTIAL decomposes into unlike things:** ~8 missing only a day rate (effectively
  complete), ~74 missing 1–2 components out of 4–9 (importable with the gap flagged), and
  19 with zero components — of which 7 sit in folders named "…Need to request pricing by
  Project" and are *expected* to be empty.
- Effective: **~138 clean, ~212 usable (90%), ~12 genuinely needing manual entry (5%)**.

Field-level support is near-universal: margin chain 232/232, crew size / labor burden /
production rate 231/232, day rate 215/232, job-quantity cell 225/232. Of 1162 detected
component rows, 1053 (90.6%) yield code + yield + packaging.

Structural variance: 19 layout signatures, but 158 workbooks (68.1%) share one, and
several clusters' signature previews are identical for their visible prefix — the
clustering likely over-splits on trivia. Not a long tail of bespoke sheets.

The documented formula hypothesis holds literally (verified in `Aquafin-2K M.xlsx`):
`ROUNDUP(D15/G19,)` paired with `IFERROR(INDEX(INDIRECT("'Pricing DB'!c:c"), MATCH(...`.

### SCHEMA CONSTRAINT — the same product can appear multiple times in one assembly

`Aquafin-2K M.xlsx` rows 19 and 20 carry the **same product code** (`AQU2KMG46`) with
**different yield cells** (`ROUNDUP(D15/G19,)` vs `ROUNDUP(D15/G20,)`) — one product
applied in two coats at two coverage rates. If `assembly_components` is uniquely keyed on
`(assembly_id, product_code)`, those two rows collapse into one and the material quantity
**silently halves**, underpricing every bid that uses the assembly. Components need their
own identity (surrogate PK + sequence/coat), never a natural key on the product code.

### Known caveats on the measurement

- Packaging unit is detected at a **hardcoded column F** ("in every sampled vendor this
  sits in column F"). It is one of the three fields gating "fully extractable", so a
  vendor that differs would skew the number either way. Untested assumption.
- Extraction *accuracy* was hand-verified on one workbook (component count matched the
  sheet exactly). Extraction rate is not the same as correctness — before building, spot-
  check the ~12 real zero-component cases and a few PARTIALs. A parser that reads
  confidently and wrongly is worse than one that fails loudly.

An internal review workbook listing every flagged file (not an assembly / needs manual
entry / missing labor fields / incomplete components) was generated for the estimating
team on 2026-07-21; it contains file paths and counts only, no pricing data.

## I0 — parse-accuracy spot-check, MEASURED 2026-07-27, verdict GO WITH CORRECTIONS

The viability measurement above answered "how much can be extracted". I0 asks the
different question it explicitly deferred: **is what gets extracted correct?** Method:
derive a *structural* component count independent of the formula detectors — the rows
between the `MATERIALS :` header and the block's `Total` row that a human reads as
component lines — and compare it to `scan_components()` across all 232 workbooks with an
ASSEMBLY sheet, then hand-read the sheets behind every mismatch class. (Scratch audit
scripts were session-local and are not committed; they only need `scope_assembly_parse.py`
plus a structural row reader to reproduce.)

**Headline: 1162 detected vs 1239 structural component rows. 202/232 workbooks (87.1%)
match exactly; 81 rows are missed, 4 spurious.** The importer is still viable — but the
misses are not distributed the way the earlier measurement implied, and one class is
dangerous.

### Finding 1 (BLOCKING) — silent material undercount on flattened price lookups

**60 rows across 16 workbooks** carry a product code, a yield, and a `ROUNDUP` quantity
formula, but their price cell has been flattened from `INDEX/MATCH` to a pasted literal.
`CODE_LOOKUP_RE` anchors on that lookup, so the row is skipped — and because every *other*
row in the sheet parses, the workbook is still classified **FULL**. Example:
`Euclid/Eucopoxy Tufcoat and duralkote 240 at walls - Light Gray.xlsx` has 6 component
rows; row 22 (`Granusil 2040`, code `UCPGRNSLJC2040SS`, yield 350, `ROUNDUP(G15/G22,)`)
was pasted as values, so the extractor reports 5 components and "all fields extractable".

This is the same failure shape as the two-coat halving constraint: it does not fail
loudly, it produces a smaller assembly that looks clean. **The extractor must anchor
component rows on the quantity formula (`ROUNDUP(<qty>/<yield>)`) rather than on the
price lookup**, and treat a missing lookup as "price is a literal, flag for review",
not as "not a component".

### Finding 2 (BLOCKING) — an assembly has N named quantity inputs, not one

**171/231 workbooks (74%) have components dividing more than one quantity cell.** These
are not helper cells; they are named, per-column inputs with their own waste %. In
`Euclid/…Light Gray.xlsx` row 12 reads `SF-Floor | LF | SF-Walls | Sand (Optional) |
Total Floor+Walls`, row 13 the quantities, row 14 a waste % per column, row 15 the
per-column total each component divides. `Emseal/EJ.xlsx` has six (`Joint LF`, `Cover
plate LF`, `Inside corner (Each)`, `Outside corner (Each)`, `Intermediate pieces (Each)`,
`Post Stucco Sealant`), one of them itself derived from another via an include toggle.
Distribution of distinct bases per workbook: 1→60, 2→84, 3→32, 4→20, 5→6, 6→12, 7→13,
8→2, 9→1, 11→1.

This is consistent with — not contradicted by — Stage 1's "227/235 have exactly one Job
Quantity input": that audit counted the *label*, which appears once and spans several
value columns. It is also the root of the C2 flag that a multi-input mapping writes the
same summed total into every input cell.

Consequence for Stage 2: an assembly is `{named quantity input → waste %}` **plural**,
and each component references one of them by name. Modelling one quantity per assembly
would misprice roughly three quarters of the library. A condition therefore maps to a
*named input of* an assembly, not to the assembly as a whole, and several conditions can
feed different inputs of the same assembly.

### Finding 3 — column F is populated but not always the packaging unit

Column F carries text on 1193/1195 real component rows (99.8%), so the hardcoded column
never comes up empty — but its *meaning* moves with the layout. In the majority layout
(`MATERIALS :` in column C, 218 workbooks) F is the packaging unit (`lb/bag`, `gal kit`)
and H is the yield unit (`SF/bag`). In the shifted layout (`MATERIALS :` in column A,
13 workbooks, e.g. `Emseal/EJ.xlsx`) packaging sits in D and F holds the *yield* unit.
Reading F blind mislabels those 13 workbooks. Fix: locate the block's header row and
resolve `Cost / Packaging / Yield / Quantity / Total` by header text, never by fixed
letter. Note also that packaging is informational — cost depends on price ×
`ROUNDUP(qty/yield)` — so it should never gate "fully extractable" as it does today.

### Finding 4 — two PARTIAL classes are by design, not parse failures

- **Manual-priced workbooks (19).** Component rows exist and are complete, with literal
  costs and no Pricing DB lookup anywhere — e.g. `Penetron - 2 COATS.xlsx` (2 rows),
  `Hydrotech/Monolithic membrane 6125 - Deck System - 20 years.xlsx` (14 rows). Today
  these read as "no components detected". Under Finding 1's fix they import fully, with
  prices as fixed literals rather than product references. These account for essentially
  all of the "~12 needing manual entry" — the estimate was pessimistic.
- **Open-yield templates (8).** Yield cells literally contain `*Enter yield here*`
  (e.g. `Dow 790 and Backer Rod Open Yield.xlsx`). Intentionally blank pending
  project-specific yield. Import with the yield field empty and required at use time.

### Finding 5 — 55 conditional quantity rows across 38 workbooks

Quantity formulas wrapped in `IF(...)`/`IFERROR(...)` rather than a bare `ROUNDUP`:
optional components behind an include toggle (`IF($K$24=VALUES!AA1, ROUNDUP(D15/G24,),
0)` — "Include Styrofoam") and capacity gates (`IF(E15+D15<G19, 0, ROUNDUP(D15/G20,))`).
The current strict regex skips these. Extract them as components with an `optional` flag
defaulting to included; do not attempt to port the toggle's cell logic.

### Verdict

GO. Every miss traced back to a detector rule, not to sheet chaos — no workbook was
found to be genuinely unparseable, and the effective usable share is **higher** than the
earlier estimate once Findings 1 and 4 are fixed. Two corrections are mandatory before
I3/I5: anchor on the quantity formula (Finding 1) and resolve columns by header text
(Finding 3). One is a schema change that must land in I1: per-assembly named quantity
inputs with per-input waste (Finding 2).

Not checked here: whether extracted yields and prices produce the workbook's own totals.
That is I4's job and remains the real gate.
