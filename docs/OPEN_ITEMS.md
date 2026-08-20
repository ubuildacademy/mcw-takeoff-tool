# Open items — parking lot

*Started 2026-07-30. Small unknowns, deferred decisions, and defects found in passing
that would slow the current task down if chased immediately. Revisit when a workstream
wraps. Anything with a real deadline or blast radius belongs in `IMPLEMENTATION_PLAN.md`
as a task instead.*

Each item says what is known, what was assumed in the meantime, and what would settle it.

---

### 16. Reconsidering the WORK ORDER / P.O. standing non-goal — needs Jeff, big if yes

**Raised:** 2026-07-31, by Jeff, after testing the I7 budget export against a real assembly
workbook. The 2026-07-21 scope decision (`IMPLEMENTATION_PLAN.md` line 893) explicitly
kept WORK ORDER / P.O. paperwork in Excel — the design doc called replicating those sheets
"months to replicate, low differentiation." Jeff's read after using the export: the budget
sheet is a good start but an MCW assembly workbook is more than a cost report — it *is*
the PO to the supplier and *is* the work order, and the app doesn't do either yet.

**Also raised in the same conversation, related but separate:**
- What actually distinguishes an "assembly" (MCW, workbook-sourced, full costing detail)
  from a "template" a non-MCW company would build directly in the app? Working guess:
  level of detail + what reports/paperwork can be pulled from a takeoff (POs, work
  orders) — i.e. this question and item 16 are the same fork, not two.
- Non-MCW companies won't have workbooks to import. They need an in-app assembly/template
  *builder* — create from scratch, not upload-and-extract. That's new UI, not covered by
  I1–I8b (which are all import-shaped). Likely sits on top of I9 (company-admin tier),
  since only a company admin should edit that company's library.
- MCW's full current workbook library (232 files) should be bulk-loaded into the native
  library once, by hand/with Claude assistance — explicitly **not** a dedicated bulk-import
  tool (Jeff declined building one). One-time job. Re-import only if the workbooks
  themselves are hand-edited later; normal path going forward is editing pricing/assemblies
  directly in the app.

**P.O. generator shipped 2026-07-31 (Task I11).** Scoped with Jeff to the smaller half
first: consolidated across the project (not one-per-assembly like the source workbooks),
price left blank matching the source sheet. See I11 in `IMPLEMENTATION_PLAN.md` for what
landed.

**Work Order MVP shipped 2026-08-10 (Task I13).** Job-info header fields + the same
consolidated materials list as the P.O.; Equipment/Incidentals/Accessories/Supplier/Man
Days/Colors left blank to fill by hand, matching how the P.O. left Price blank. See I13
in `IMPLEMENTATION_PLAN.md`.

**Assembly builder shipped 2026-08-10** — "Build from scratch" in the admin Assemblies
tab produces the same `AssemblyProposal` shape a workbook extraction does, then runs
through the exact same preview/review/save pipeline (`POST /assemblies/preview`, new,
mirrors `/extract`'s preview without a file). Settles the assembly-vs-template question
from the same conversation: there isn't a separate "template" concept — an assembly
built by hand and one imported from a workbook are the same row, same pricing engine,
just a different way of getting there.

**MCW bulk workbook load done 2026-08-10** — all 232 files at
`Business/MCW/Assembly Work/2026 Assemblies 7-30-26` walked (brand = top-level folder,
recursing into product-line sub-folders; anything under a folder named "Hold" excluded
per Jeff's own filing convention). 215 imported, 3 already in the library (skipped by
name+brand), 3 failed — `Specialty/Composite clean up.xlsx`, `Off site parking.xlsx`,
`Submittals.xlsx` have no ASSEMBLY sheet; they're admin/overhead line items, not product
assemblies, and were never going to import. 136 components across the batch carry
advisory blockers (unbound quantities, missing product codes) — expected, the same gaps
as open items 3-5, not a regression. Done with a throwaway script reusing the existing
extractor/import service functions directly (not a shipped tool, deleted after the run,
matches Jeff's "no dedicated bulk-import tool" call).

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

### 6. `org_id` is nullable on the Stage 1 registry tables — CLOSED 2026-07-31

`assembly_workbooks.org_id` and `assembly_mappings.org_id` were left nullable in the I1
migration so inserts would not break before a service supplied the column. No service ever
did, and at I8a the routes that would have were removed with the rest of Stage 1. Nothing
writes these tables now; whether they are dropped is item 14.

### 6b. `server/src` sits just under its lint warning cap — CLOSED 2026-08-10

**Found:** 2026-07-31, at I8 — `npm run ci:local` was failing on `lint:server`, 157 warnings
against `--max-warnings 150`. Not caused by I8: the count was **152 before Workstream I
started** (measured back through twelve commits), so the ratchet had been broken for some
time and the pre-push hook was evidently not stopping it.

Paid down the rest 2026-08-10: `server/src` is now at **0 warnings** against the 150 cap.
Same fix throughout — explicit `const caller = req.user; if (!caller) return 401` guards
instead of `req.user!` (the pattern already established for the three files above),
duck-typed interfaces or `Record<string, unknown>` instead of `any`, dropped genuinely-
unused catch bindings/imports. One real find along the way: `pdfjs-dist`'s legacy build
entry point has no usable TS types at all — gave it proper local interfaces
(`simpleOcrService.ts`) instead of the `any` casts it had.

The client budget (`--max-warnings 500`) was not touched — separate, much larger cap,
not part of this item.

### 7. Stage 1 writer hardcodes the sheet name `ASSEMBLY` — CLOSED 2026-07-31

Retired with Stage 1 at I8a. Note that the *extractor* still looks for a sheet named
`ASSEMBLY` when importing a workbook into the library, so the underlying assumption
survives — it is just no longer this item's problem.

### 8. Stage 1 multi-input mappings write the same total to every input cell — CLOSED 2026-07-31

Flagged at C2, confirmed by I0, and fixed the way it was always going to be: Stage 2's
named quantity inputs price each input separately, and Stage 1 was removed at I8a.

### 14. `assembly_workbooks` / `assembly_mappings` still exist in Supabase — CLOSED 2026-08-10

Stage 1's code was removed at I8a; its two tables and the workbook files under the
`assembly-workbooks` storage prefix were left alone. Nothing reads or writes them.

Jeff confirmed 2026-08-10 the mappings are of no further interest.
`drop_stage1_assembly_registry_tables.sql` drops both tables (`CASCADE`, which only drops
the now-orphaned `assemblies.source_workbook_id` FK constraint — the column and its stored
ids are untouched). Verified idempotent on local Postgres; needs Jeff to run it in Supabase.

**Still open, separate:** the workbook files themselves under the `assembly-workbooks`
storage prefix in Supabase Storage — a file deletion, not a SQL migration, left for Jeff to
clear from the dashboard whenever, no code depends on it either way.

### 15. The projects list total does not include assembly pricing — CLOSED 2026-08-11

**Found:** 2026-07-31, at I8a. Two different things compute a project's worth. Inside a
project, `getProjectCostBreakdown` now returns `projectTotal` (flat costs + assemblies).
The projects *list* computes its own total in `supabaseService.ts`, straight from condition
and measurement rows, and has no way to price an assembly — so a job priced through
assemblies still shows its flat-cost total there until it is opened.

**Fix:** took the cheaper of the two settle options instead of a server-side pricing
endpoint. `takeoff_projects.total_value_cache` (nullable numeric,
`add_project_total_value_cache.sql`) holds the last full total the workspace computed.
`useAssemblyPricing.ts` writes it (`supabaseService.updateProjectTotalCache`, no
`last_modified` bump) once the assembly engine settles for a project. `getProjects()`
prefers that cached value when present and falls back to the flat-only calc otherwise —
so a project only shows its true total after it has been opened at least once since
pricing last changed. Good enough for a single-digit-tenant tool; revisit with a real
endpoint if staleness becomes a complaint.

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

### 13. Davis-Bacon is a prompt with no mechanism behind it — CLOSED 2026-08-10

Raised at I7. All 478 workbooks contain the literal text `*Enter DB Classification*` beside
a day rate labelled "Standard Labor rate", and not one has it filled in. A prevailing-wage
job appears to be handled by overriding the day rate by hand.

Jeff confirmed 2026-08-10: hand-overriding the day rate is fine, no classification table
behind it in practice. No mechanism to build — the report continues to record the labor
basis and nothing else.

## Found during the 2026-08-11 UI review

Jeff flagged four things while reviewing the workspace after I9/branding landed. One
(dark-mode summary) was small enough to fix on the spot; the other three are logged here.

### 17. Multi-input assemblies constantly warn "not measured by any condition" — WON'T FIX, Jeff 2026-08-11

An assembly can define more than one `quantityInput` (e.g. SF of wall plus LF of
perimeter, or SF plus a height-driven LF). A condition links to exactly **one** input
(`condition.assemblyQuantityInputId`, see `assemblyPricingItems.ts`). Every other input
on that assembly is therefore never fed by that condition, and `priceCondition` in
`server/src/services/conditionAssemblyPricing.ts:157-163` emits a warning per unfed
input, unconditionally, every time such an assembly prices — this is very likely what
reads to Jeff as "errors on every assembly with unknown quantities."

**Decision:** it's specific to the one assembly using that particular quantity
combination. Letting a condition carry more than one measurement/unit is a real
rewrite of the condition model for a narrow case — not worth it. Leaving as-is; the
warning is cosmetic noise on that assembly, not a pricing error (unfed inputs price at
$0, which is correct if nothing measures them).

### 18. Restoration liability rate checkbox is visible to every company — CLOSED 2026-08-11

`AssemblyCostsSection.tsx:290-299` — the toggle that switches a downloaded budget
report between "waterproofing" and "restoration liability" accounting bases was
rendered unconditionally, with no org check. This is MCW-specific accounting language
(see item 12's discussion of the same report's fixed bucket shape) — a company outside
MCW's group has no use for it and it was just confusing.

**Fix:** `organizations.restoration_liability_enabled` (boolean, default false,
`add_organization_restoration_liability_flag.sql`), same shape as the existing
`assemblies_enabled` gate. Seeded true for MCW Companies only. Threaded through
`getOrganizationForUser`/`GET /users/me` → `MyTier.restorationLiabilityEnabled` →
`TakeoffWorkspace` → `TakeoffSidebar` → `AssemblyCostsSection`, which now only
renders the checkbox when the caller's org has it on. Every other company simply
never sees the control; the report always builds on the waterproofing basis for them.

### 19. Deleting an assembly-linked condition may leave a stale row in the Costs tab — CLOSED 2026-08-11

Jeff observed a deleted condition's assembly pricing row stay in the Costs tab instead
of disappearing live. Root cause: `useAssemblyPricing.ts` only *re-prices* on a
conditions change (debounced 400ms, then a network round trip), and the cache
deliberately keeps the previous `result` on screen while that's in flight or if it
errors ("last-known-good", by design, so a transient blip doesn't blank the summary —
`assemblyPricingSlice.ts:101-118`). Nothing was cross-checking `result.pricings`
against the conditions that currently exist, so a deleted (or unlinked) condition's
row — and its dollars in the Assembly Total — stuck around for however long the next
successful price took, indefinitely if it kept failing.

**Fix:** `pruneRemovedConditions(projectId, liveConditionIds)` on the pricing store —
filters `result.pricings` down to conditions still assembly-linked and resums `totals`
from what's left (plain addition, mirrors `sumConditionPricing` server-side, so no
business logic duplicated). `useAssemblyPricing.ts` calls it synchronously on every
conditions change, ahead of the debounced re-price — so the row (and the total) drop
immediately regardless of network state, and the debounced fetch afterward brings
fresh authoritative numbers for whatever's left. `unknownAssemblyIds` deliberately left
alone — it holds assembly ids, not condition ids, despite the name; filtering it by
condition id would have silently emptied a real warning.

## Found during 2026-08-13 assembly-template testing

Jeff noticed every condition created via "start from a priced assembly" came in as an
SF/area condition, even ones that obviously measure linear or count items.

### 21. Assembly-derived conditions always defaulted to SF/area — CLOSED 2026-08-13

Root cause was two-layered, both in the workbook→condition pipeline:

1. `assembly_extract.py`'s `extract_quantity_inputs` hard-coded `"unit": None` for
   every quantity input — the "Unit of Measurement" cell's text was captured into
   `name` (e.g. "SF-Floor", "Flashing") but never parsed into `unit`. Confirmed via
   direct query: 644/644 `assembly_quantity_inputs.unit` values were `NULL`.
2. `resolveConditionUnit` in `src/utils/assemblyConditionTemplate.ts` silently
   defaulted anything it couldn't map to `type: 'area'` — so a null/unrecognized unit
   became a confident-looking wrong SF condition instead of failing loudly.

**Fix:**
- `inferUnitFromText` (assemblyConditionTemplate.ts) and its Python mirror
  `infer_unit` (assembly_extract.py) scan a name/unit string for a known unit
  token/phrase (SF, LF, SY, CY, CF, EA and common synonyms) instead of requiring an
  exact whole-string match. Used as a fallback layer, never a replacement for an
  exact match.
- `backfill_units_from_components` (assembly_extract.py) resolves the rest by
  reading the *yield-unit* cell of whichever component a quantity input's formula
  divides (e.g. "SF/roll" on a Bituthene row means that input is SF) — real
  same-file signal the workbook author actually typed, not a guess. When bound
  components disagree on unit, it's flagged for review rather than picked.
- `KNOWN_MATERIAL_UNITS` — a short, evidence-gated table (n≥3 occurrences, zero
  disagreement) for the handful of material names with no in-file signal at all
  (Waterstop, Wall Cap, Tie-in, Adcor ES Waterstop, Sealant cove bead).

Re-ran the fixed extractor against all 232 real 2026 workbooks
(`.../Business/MCW/Assembly Work/2026 Assemblies 7-30-26/`) and backfilled the live
`assembly_quantity_inputs.unit` column by matching (assembly name, input name):
573/644 rows (89%) now have a real unit. **71 rows across 24 distinct names have no
unit signal anywhere in their workbook and need Jeff to assign one by hand** in the
Assembly Builder admin form — largest is "Flashing" (20 rows, genuinely
context-dependent: edge flashing vs. area flashing membrane). "AN"/"AO"/"AP"/"AQ" (6
rows each, all in the two Sika Roof Pro workbooks) are blank name-cells picked up as
bare column letters — worth checking whether these are real quantity inputs at all
before assigning them a unit.

### 22. Bond had no mechanism — FIXED 2026-08-13

Jeff asked how bond is handled. It wasn't: `JobInfo.bondRequired` is a free-text
paperwork flag exported on the Work Order, with no $ or % attached anywhere in
the pricing chain.

Checked all 232 real 2026 workbooks — none carry a "Bond" row in their margin
chain (only Safety, Over Head, Profit ever appear), confirming bond is priced
on the whole contract by a surety company, not per material vendor like
insurance is. So it's a project-aggregate rate, not something that flows
through `resolveAssemblyCostSettings`/`CostDefaults`.

**Fix:** org-wide default (`organization_cost_defaults.bond_pct`, edited in
the admin Cost Defaults tab) with an optional per-project override
(`takeoff_projects.bond_pct_override`, mirrors `profitMarginPercent`'s shape —
blank inherits the company rate, 0 means no bond on this job). Applied once in
`getProjectCostBreakdown` against the combined flat-cost + assembly total,
shown as its own line in both copies of Project Cost Summary (Costs and
Reports tabs). Not wired into the budget/work-order exports.

### 20. Project Cost Summary unreadable in dark mode — FIXED 2026-08-11

The **Reports tab** copy of "Project Cost Summary" (`TakeoffSidebar.tsx`, around line
474) used a hardcoded light gradient (`from-blue-50 to-indigo-100`, `border-blue-200`)
and hardcoded light-only accent text (`text-blue-600`, `text-green-600`) with no
`dark:` variants, while `text-foreground` inside it does flip to near-white in dark
mode — white text on a light-blue card. The **Costs tab** copy of the same summary
already had full `dark:` coverage and was fine. Brought the Reports-tab copy in line
with the Costs-tab one (dark gradient, dark border, dark accent text, dark amber
warning boxes). No product decision involved, so fixed directly rather than logged.

### 23. Codebase-wide simplification sweep — DONE 2026-08-20 (slices A-D)

**Raised:** 2026-08-20, by Jeff. Concern: fast iterative ("vibe-coded") feature work
tends to accrete more code than the problem needs — duplicated logic, dead
abstractions, over-parameterized helpers, stale comments — and this app has grown to
a lot of lines of code and real complexity. Worth an audit pass to see whether that's
actually true here, or whether it's already reasonably tight. A clean bill of health
is a fine outcome, not a failure to find something.

**Scope agreed with Jeff:** three mechanical slices (frontend utils/services, server
services/routes, Python scripts), delete-only depth plus efficiency wins where they
are semantics-preserving, honouring the existing "split large files only when touching
that area" rule, one branch per slice with `ci:local` green on each.

**Baseline and gate:** `ci:local` at `9b8c07a4` — 446 tests passed / 8 skipped,
frontend lint 70 warnings, server lint 0. Every slice was required to end on exactly
those numbers, and did.

**Slice A — frontend utils/services (`chore/simplify-slice-a-frontend-utils`).**
12 dead exports deleted, 20 internal-only symbols unexported, `headerStyle`/`QTY_FMT`/
`MONEY_FMT` de-duplicated into `export/sheetStyles.ts`, and five quadratic scans made
linear (assembly price items, three in `measurementSlice`, selection diffing in
`PDFViewer`). 212 lines out, 92 in.

**Slice B — server services/routes (`chore/simplify-slice-b-server`).**
765 lines out, 143 in. Found one real defect: `titleblockExtractionService.extractSheets`
mapped a failed batch to `concurrentBatches[0]` unconditionally (both arms of its
ternary were the same expression), so the wrong pages got "Unknown" placeholders.
Nothing called `extractSheets`, so it and its private `processBatch` were deleted
rather than fixed. Three unused error classes and the unused `startRun`/`endRun` pair
went too. `escapeHtml` (2 copies), the multer upload plumbing (3 copies, ~45 lines
each) and the Python subprocess runner (2 copies, ~125 lines each) were consolidated
into `lib/`. `getAssemblyDetailsForOrg` no longer re-scans every child row once per
assembly.

**Slice C — Python scripts: clean bill of health, no changes.** 7,866 lines across 19
scripts; one uncalled function (`col_letters` in a scoping script) and three clone
sites, of which the two real ones are a deliberate documented mirror of
`vector_callout_pass.py` geometry so scoping counts stay apples-to-apples. Scripts that
look dead say why in their own docstrings (`scope_*.py` are labelled "NOT wired into
the app"; `assembly_write.py` explains its write CLI outlived Stage 1 but its OOXML
primitives are imported by five other scripts). This layer is in good shape.

**Slice D — frontend components (`chore/simplify-slice-d-components`).**
209 lines out, 94 in.

*Correction to the slice C writeup.* Of the three PDFViewer.tsx regions reported as
duplicating its extracted hooks, only one was real. The other two — PDFViewer
1153-1275 against `usePDFViewerInteractions` 312-432, and PDFViewer 502-550 against
`usePDFViewerMeasurements` 379-427 — are a hook's call site against its own
destructuring, and a hook's return list against the component's destructuring. A
120-parameter hook produces identical identifier lists at both ends and the clone
detector matched them. That is a wide interface, not copied logic. Re-running the
detector with bare identifier-list windows filtered dropped `src/` from 55 candidate
clone sites to 15.

The real one: the pasted-measurement payload was built inline four times (context-menu
paste and "paste as new condition" in PDFViewer.tsx, ⌘V and ⌘⇧V in
usePDFViewerInteractions.ts), ~25 identical lines each. Now
`buildPastedMeasurementPayload` in `utils/measurementPaste.ts`. The offset constant had
already started to decay — the hook used a named `PASTE_OFFSET` while PDFViewer.tsx
hardcoded `0.02` twice with an unused `_PASTE_OFFSET` above them.

Also deleted `usePDFViewerInteractions.types.ts`: 107 lines, no importers, sketching a
grouped-props refactor that never landed and has since drifted (its result interface
predates iPad pinch-to-zoom). It read like the hook's type contract, which made it
worse than absent. And `onCalibrationComplete`'s eight positional parameters — five
nullable numbers, where a transposed pair would still type-check — are now named once
as `CalibrationCompleteHandler`.

**Follow-on, shipped the same day (`feat/themed-confirm-dialogs`).** The parked
`ConfirmDialog` question resolved as keep-and-wire-up, per Jeff. All native confirm
boxes are gone. The count was **14, not the 5 first reported** — that figure came from
grepping `window.confirm`, and nine sites called the global bare as `confirm(...)`;
the compiler surfaced the first the moment a local `confirm` shadowed the global.
`hooks/useConfirm.tsx` gives a promise-based `await confirm({...})` so no handler had
to be split around the user's answer. `TitleblockExtractionService.checkAvailability`
stays, per Jeff — a diagnostic is worth having precisely when the thing it diagnoses
breaks.

**Not done, deliberately.** Splitting the large components (`PDFViewer.tsx` at 4,200
lines, `usePDFViewerInteractions.ts` at 2,800) stays under the existing "split by
concern only when touching that area" rule in ROADMAP. There is no component test
coverage to refactor against, and this sweep's whole guarantee was that the test and
lint numbers never moved.

**Tooling note (corrected):** the `karpathy-guidelines` skill is *not* a simplification
auditor — it is preventive guidance for writing code (don't overcomplicate, make
surgical changes). `/simplify` is diff-scoped. Neither does a retrospective whole-repo
sweep, so this ran as a hand-rolled pass: grep-based dead-export detection, a
sliding-window clone detector (with an identifier-list filter, added after the first
run produced the false positives above), and a nested-scan detector for quadratic
loops.
