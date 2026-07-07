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

## Open questions for Jeff
1. Input cell(s) per workbook: is job quantity always a single cell on ASSEMBLY (e.g. D13), or do some workbooks take multiple quantities?
2. Should Stage 1 write BASIC JOB INFO fields too (project name, client)?
3. Multi-condition jobs: one workbook per condition, or one workbook fed the sum?
4. Pricing DB inside bridged copies: leave as-is (already updated by Pricing Manager), or refresh from the app at generate time?
