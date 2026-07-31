# Open items — parking lot

*Started 2026-07-30. Small unknowns, deferred decisions, and defects found in passing
that would slow the current task down if chased immediately. Revisit when a workstream
wraps. Anything with a real deadline or blast radius belongs in `IMPLEMENTATION_PLAN.md`
as a task instead.*

Each item says what is known, what was assumed in the meantime, and what would settle it.

---

## Source-data defects in MCW's assembly workbooks

These are errors in the live Excel files, not in Meridian. They are recorded rather than
fixed: the workbooks are MCW's system of record for bids, and a wrong "fix" is harder to
notice than an obviously absurd value.

### 1. `Preprufe 300R+ for piles.xlsx` — crew size is 224

**Found:** 2026-07-30, by the I4 golden comparison.
The day rate ($200) is in its correct cell, but the "How many Men on the job" cell holds
**224**. The sheet therefore bills a 224-man crew: its own cached labor total is **$60,480**
on a **$208,933** job, roughly 29% of the bid.

**Assumed meanwhile:** Meridian's importer treats an implausible crew size (>20) as a data
entry error, falls back to the library's modal crew of 2, and flags it for review. The
workbook itself is untouched.

**To settle:** Jeff or the estimator confirms the real crew for that pile job (1, 2 or 3),
then the workbook cell is corrected and the assembly re-imported. Jeff 2026-07-30: does
not know it offhand.

### 2. Production-rate lines excluded from the day total

**Found:** 2026-07-30, while reading labor formulas.
Two workbooks sum a narrower range than their rate lines occupy, so the excluded lines
contribute no labor days at all:

- `Preprufe 300R+ for piles.xlsx` — `SUM(F31:F35)` with rate lines running to F37 (two lost)
- `Grace/Bituthene 3000.xlsx` — `SUM(F35:F43)` with a rate line at F44 (one lost)

**Assumed meanwhile:** nothing. Meridian sums every rate line it finds, so an imported
assembly will price slightly MORE labor than the workbook shows. That difference is
correct, but it means these two files will not match in the golden comparison.

**To settle:** widen the ranges in the source workbooks (`F31:F37` and `F35:F44`). The fix
is unambiguous; it needs a decision to edit bid files, not a judgment call.

---

## Costing engine — the 21 workbooks that do not match

The I4 gate matches 144 of 165 comparable workbooks to the cent. The remainder are
extraction gaps, not arithmetic gaps, and split into two causes:

### 3. Quantities driven by geometry cells

e.g. `ROUNDUP((I11*D11)/G27)` — collar area times pile count, where neither cell is a named
quantity input. Cannot be expressed until the `quantity_rule` column added in the I5 schema
is actually wired up by the importer.

**Assumed meanwhile:** these components import flagged and refuse to price, which is the
honest state.

### 4. Residual waste attribution in a few multi-block sheets

A third quantity block's job-quantity row is not being found, so its waste reads as zero and
its components under-buy slightly.

**To settle:** both are worth one focused session after I5's importer lands, re-running the
golden harness to see the number move.

### 5. `Tremco EWS - Vehicular.xlsx` row 29 — coded row with no quantity formula

A real material line (code, price, packaging) with no quantity formula anywhere, so nothing
drives it. Exactly one such row exists in the whole 232-workbook library.

**Assumed meanwhile:** not imported. Widening the detector to admit coded rows without
quantities risks pulling in stray rows across the library for a single case.

---

## Deferred technical debt

### 6. `org_id` is nullable on the Stage 1 registry tables

`assembly_workbooks.org_id` and `assembly_mappings.org_id` were left nullable in the I1
migration so inserts would not break between applying it and deploying a service that
supplies the column. The service still does not supply it.

**To settle:** have the Stage 1 upload/mapping routes set `org_id`, backfill any nulls, then
tighten to `NOT NULL`.

### 6b. `server/src` sits just under its lint warning cap

**Found:** 2026-07-31, at I8 — `npm run ci:local` was failing on `lint:server`, 157 warnings
against `--max-warnings 150`. Not caused by I8: the count was **152 before Workstream I
started** (measured back through twelve commits), so the ratchet had been broken for some
time and the pre-push hook was evidently not stopping it.

**Done meanwhile:** cleaned the twelve warnings in the three files Workstream I owns
(`routes/assemblies.ts`, `routes/products.ts`, `assemblyCosting.golden.test.ts`) — explicit
`req.user` guards instead of `!`, `unknown` instead of `any` on the multer callbacks, and
narrowing instead of assertions in the golden test. 157 → 146, so CI passes with margin.

**Not done:** the other ~146 warnings, almost all `any` and `req.user!` across the older
routes (`ocr.ts` 22, `files.ts` 16, `conditions.ts` 12…). Four more warnings anywhere puts
CI red again for a reason unrelated to whatever change trips it.

**To settle:** one session paying the older routes down, or a deliberate decision on what
the cap is for. Worth checking why the pre-push hook let 152 through in the first place.

### 7. Stage 1 writer hardcodes the sheet name `ASSEMBLY`

Flagged at C2. Every MCW workbook uses that name; a non-MCW customer may not. Add an
optional `sheetName` to the mapping when a real case appears — not before.

### 8. Stage 1 multi-input mappings write the same total to every input cell

Flagged at C2 and confirmed by I0: the three dual-input workbooks receive the summed total
in both cells. Stage 2's named quantity inputs are the real fix; Stage 1 is now the escape
hatch rather than the main path, so this may simply retire.

---

## Product questions

### 9. Workbook totals can be stale against their own prices

Found during I4: the Pricing Manager rewrites only the `Pricing DB` sheet, so every other
sheet keeps the values Excel last calculated. A workbook can therefore display a total that
no longer matches its own price list until someone opens it in Excel.

Not a defect to fix — it is an argument for the native engine, and worth saying out loud in
sales material. Recorded so it is not rediscovered as a bug.

### 10. Does a condition's waste factor apply on top of the assembly's? — needs Jeff

Raised at I6. A condition carries a waste % and so does every assembly quantity input
(read from the source workbook). Applying both compounds them: 10% on the condition and
10% in the workbook orders 21% extra, quietly.

**Assumed for now:** the assembly wins. The quantity sent to the engine is measured value
× the condition's multiplier, *without* the condition's waste factor. One source of waste,
and it is the one the workbook has always used. Confirmed by Jeff 2026-07-31, so I8's
assembly-generated conditions are created with waste 0 — the second place that changes if
this is ever revisited.

**What would settle it:** how Jeff actually bids a job where the field allowance differs
from the product's — is condition waste a second allowance on top (scaffold-dependent
overage), or the same number entered in two places? If it is a genuine second allowance,
the fix is to multiply it in and label both in the Costs panel.

### 11. Assembly-linked conditions still show the flat cost fields

Raised at I6. The condition dialog shows Material Cost and Equipment Cost below the
assembly picker even once an assembly is chosen, and the Costs tab renders both the flat
per-unit summary and the assembly total. Nothing double-counts — they are separate
sections — but a condition could carry a stray $/SF that no longer means anything.

**Assumed for now:** leave both visible. Hiding the flat fields would strand values
already entered on existing conditions.

**What would settle it:** watching a real bid. If the flat fields go unused on linked
conditions, disable them with a note rather than hiding them.

### 12. The Material column: reproduce the workbook's $0, or post the real cost? — needs Jeff

Raised at I7. Every `Labor budgets` sheet in the library reads its Material column from
`ASSEMBLY!K59`, which is empty — so material cost falls through into the OH&P residual and
the Material column reads $0 on all 478 sheets. The job total is unaffected either way,
because OH&P is the plug.

**Assumed for now:** Meridian posts the real material total in the Material column. That is
what the column is for, and the report's Notes sheet says explicitly that it differs from
the workbook here.

**What would settle it:** whether MCW's accounting system expects material under OH&P (in
which case years of history are on that basis and changing it now creates a discontinuity)
or has simply been receiving a $0 it ignores. One question to whoever posts these.

### 13. Davis-Bacon is a prompt with no mechanism behind it

Raised at I7. All 478 workbooks contain the literal text `*Enter DB Classification*` beside
a day rate labelled "Standard Labor rate", and not one has it filled in. A prevailing-wage
job appears to be handled by overriding the day rate by hand.

**Assumed for now:** no toggle. The report records the labor basis and nothing else, since
a mechanism that changed the arithmetic would be invented rather than observed.

**What would settle it:** how Jeff actually bids a Davis-Bacon job today. If there is a
classification table behind it, that is a real feature — per-classification day rates on the
assembly — and worth its own task rather than a checkbox.
