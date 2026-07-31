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

## I3 — extractor built 2026-07-27; the parse gap is closed

`server/src/scripts/assembly_extract.py` implements the five I0 corrections and was
measured the same way I0 was — structural component count (what a human reads off the
sheet) versus what the parser returns, across all 232 workbooks.

**1239 structural rows, 1243 extracted, 1 missed, 5 "extra"; 226/232 workbooks (97.4%)
match exactly** — against 1162 / 81 missed / 202 exact before. The five extras are rows
the *structural* baseline missed, not parser inventions: real components whose code cell
and description are both blank (e.g. the backer-rod line in the Dow open-yield sheets).
The single remaining miss is `Tremco EWS - Vehicular.xlsx` row 29, a coded line with no
quantity formula anywhere — exactly one such row exists in the whole library, so it is
left for manual entry rather than widening the detector to admit stray coded rows.

Building it surfaced four more sheet behaviours that measurement alone had not:

### Compound quantity numerators

Components divide expressions, not just cells: `ROUNDUP((D23+D17)/G27,)` (a base area
plus a pile-collar area) and `ROUNDUP(((I11*D11)/G27),)` (count x circumference). The
parser now splits on the *last top-level* division, so the numerator may be arbitrary and
the denominator must be a single cell. This also keeps production-rate formulas out
without a special case: `ROUNDUP(IF(D30,B13/D30,),)` has no top-level division.

### A sheet can have more than one quantity block, and a block need not have a "Job Quantity" row

Grace's Preprufe sheets carry a pile-geometry block — its own "Unit of Measurement" names,
its own waste row, a derived total computed from pile count and circumference — *above*
the ordinary block, and components divide both. Anchoring on "Job Quantity" makes those
inputs invisible, so the reader anchors on "Unit of Measurement" and walks each block.

### Some component quantities are not yield-driven at all

26 rows take their quantity from somewhere else: `I19=I18` (a tape that ships one-to-one
with the membrane above it, 9 rows) or `I20=M14` (an initiator counted per pail of another
product, 17 rows). They are unmistakably components — code, price lookup, line total — so
they are emitted with a null yield and a flag rather than dropped.

**Schema implication, not yet built:** `assembly_components` assumes
`ROUNDUP(quantity / yield)`. These rows need a quantity *rule* ("same as component N",
"fixed", "per unit of component N"). Until that exists they import flagged and cannot
price, which is the honest state. Add the rule column in I5 rather than migrating again
mid-stream.

### Layout traps that silently misread rather than fail

- The production-rate block's closing "Total" is **not in the block header's column**
  (Aquafin heads at C28, closes at E33). Terminating on the header column alone runs the
  scan into the labor and margin blocks and reads *their* inputs as production rates.
  Caught by a synthetic fixture, not by the live sweep — the numbers looked plausible.
- "Labor Burden" appears **twice**: once as an input and once as a summary line whose
  value cell is a formula. Taking the first match reads an empty value, so label lookups
  try every occurrence and keep the first that yields a number.
- Margins are stored as **whole percents** (2, 22, 20) while waste and tax in the same
  sheet are **fractions** (0.05, 0.07). Both are normalised to fractions on the way out.
- **Insurance is not part of the divide-through chain** — it has its own base cell and is
  applied differently per workbook. Captured as `insuranceMarginPct` and left for I4.

90 of 232 workbooks now extract with no flag of any kind. The rest flag rather than guess;
the most common flags are hand-priced components (77), conditional/optional quantities
(69) and missing day rates (17), all of which are properties of the workbooks rather than
parser failures.

## I4 — the costing engine reproduces the books. GATE PASSED 2026-07-27

The question Stage 2 actually rested on: does a native engine produce the same numbers
MCW's workbooks do? The task's bar was **five** workbooks matching to the cent.

**Result: 144 of 165 comparable workbooks (87%) match on every figure** — material total,
labor, cost of material+labor+equipment, margins, insurance, and the job total.
Labor matches on 159/165 and material on 147/165.

Nobody had to supply expected values. A priced workbook carries both the inputs and the
answer: Excel stores each formula's last-calculated result, so the workbook's own
"TOTAL Job COST" is the number to reproduce. `assembly_costing_golden.py` extracts each
workbook, reads its entered quantities and cached totals, and emits a case; the engine
runs against it in `assemblyCosting.golden.test.ts`. Cases hold real prices, so they are
never committed — the test skips unless `ASSEMBLY_GOLDEN_CASES` points at a generated file.

### The comparison was wrong before the engine was

The first run matched 41/165. Most of that was not an engine fault: **the workbooks'
cached totals are stale with respect to their own Pricing DB sheet.** The Pricing Manager
updates a workbook by rewriting only the sheet named "Pricing DB", so every other sheet
keeps the values Excel last calculated. Pricing components from the DB sheet and comparing
against those totals measures how out-of-date the workbook is, not whether the engine is
right. Reading each component's own cached cost cell instead took material from 52 to 145.

That staleness is itself an argument for the native engine: a workbook can show a total
that no longer reflects its own prices until someone opens it in Excel.

### What the gate found in the engine

Five real bugs, each of which produced a plausible wrong number rather than an error:

1. **Labor billed man-days instead of calendar days.** The workbook computes
   `crewCost x ROUNDUP(manDays / crewSize)` — its hidden helper is labelled "Job Duration
   is N Days with N Man/Men". Billing `crewCost x manDays` counts the crew twice; Aquafin
   came out at 1344 instead of 1210.
2. **Per-line day rounding is not universal.** Aquafin wraps every production-rate line in
   ROUNDUP; Henry's Blueskin sheets wrap none and round only the summed total. Assuming
   either way misprices the other family, so the flag is read per line.
3. **Waste was applied twice** on quantity blocks that have no "Job Quantity" row — their
   value cell IS the block total, with waste already folded in.
4. **Compound numerators divide the SUM of several inputs**, each carrying its own waste %
   (17% and 5% in the same component). Binding to the first input alone under-bought.
5. **The margin chain swallowed the insurance block** in workbooks whose margin block has
   no closing Total row, reading "Insurance cost at 79 Dollars per Thousand" as a 79%
   margin and inflating totals by an order of magnitude.

Insurance also turned out to be fully determined rather than workbook-specific:
`ROUNDUP(ratePerThousand x cost / 1000)`, then its own divide-through margin, added
alongside the chain — `F77 = ROUNDUP(F59 + insurance + margins)`.

Two extractor bugs surfaced too: the day rate's label cell is empty in a family of
workbooks (the caption beside it reads "Standard Labor rate" in some and "Davis Bacon" in
others, so the rate is found positionally, directly above the crew size), and
`Cover plates.xlsx` labels its waste row "Job Quantity" and its total row "Warranty" — so
the waste cell is now read from the TOTAL FORMULA (`total = qty + qty * waste`), which
names it regardless of what the labels say.

### The remaining 21, and why they are not being chased

- **Geometry-driven quantities.** `ROUNDUP((I11*D11)/G27)` — collar area times pile count,
  cells that are not quantity inputs at all. These need the quantity-rule column already
  recorded as an I5 follow-up; until it exists they cannot be expressed.
- **A residual waste-attribution edge case** in a handful of multi-block sheets, where a
  third block's quantity row is not being found and its waste therefore reads as zero.

Both are extraction gaps, not arithmetic gaps: every case whose cost of
material+labor+equipment is right has a correct job total, margins and insurance —
144/144. The margin, insurance and rounding rules are exactly right wherever the inputs
reach them.

## I7 — the budget report, and where the accounting rates were hiding

The rates that split a job total for accounting are **not on the `ASSEMBLY` sheet**. They
sit in the top-left corner of `Labor budgets`, which is why I0–I4 never saw them: every
sweep to that point read `ASSEMBLY` and the pricing helpers around it.

Swept across every workbook carrying the sheet: **P/R Tax 11.33%, W/Comp 7.72%,
G/Liability 12.73% — 478 out of 478, on all three.** Not 98%, not 231/232. No exceptions
whatsoever, which is a stronger signal than anything I10 measured, so they went straight
into `organization_cost_defaults` rather than onto assemblies.

### The labor budget is a reconciliation, not an estimate

This is the thing to understand before reading the sheet. It does not price anything. It
takes the total the engine already produced and carves it into buckets:

```
Reg. Pay        = manDays x dayRate          (manDays = crew x calendar days)
$P/R Tax        = Reg. Pay x 11.33%
$W/Comp         = Reg. Pay x 7.72%
$ Labor         = Reg. Pay + $P/R Tax + $W/Comp
$G/Liab         = TotalCost x 12.73%          <- on the TOTAL, not on pay
OH&P            = TotalCost - $ Labor - Material - Equipment - Misc.Exp - $G/Liab
```

OH&P is the plug. That makes the sheet self-checking — the buckets must sum back to
`TotalCost` — and `reconciliationError` asserts exactly that, in code and again as a live
formula in the delivered file so the recipient can watch it too.

The `manDays` subtlety is the same trap I4 hit from the other side: `Reg. Pay` has **no
crew factor**, so the crew has to already be inside `manDays`. It is crew x calendar days,
not the raw production-rate sum. Billing the production-rate figure would underpay a
multi-man crew by exactly the crew size.

### The Material column reads $0 in all 478 workbooks

`Labor budgets` reads its Material column from `ASSEMBLY!K59`, and that cell is empty in
every workbook in the library. So material cost is not lost — it falls through into the
OH&P residual, because OH&P is whatever is left. The job total is right either way.

Meridian posts the real material total there instead, and says so on the report's Notes
sheet. Recorded as open item 12: if MCW's accounting has years of history with material
inside OH&P, matching the workbook may matter more than being correct.

### Davis-Bacon: a prompt with nothing behind it

All 478 workbooks contain the literal string `*Enter DB Classification*` beside a day rate
labelled "Standard Labor rate". **Not one has it filled in.** A prevailing-wage job is
evidently handled by typing over the day rate.

So there is no toggle to reproduce — the "Davis-Bacon toggle where present" in the task
description turns out to describe an empty prompt cell. The report records the labor basis
and stops there. Open item 13 covers what a real implementation would need.
