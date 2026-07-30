#!/usr/bin/env python3
"""
assembly_costing_golden.py — builds golden test cases for the costing engine
(Stage 2 task I4; see docs/ASSEMBLIES_DESIGN.md).

Read-only, pure stdlib. Nobody has to supply expected values: a priced assembly
workbook carries BOTH the inputs and the answer. Excel stores each formula's
last-calculated result next to the formula, so the workbook's own
"TOTAL Job COST" is the number the native engine has to reproduce, and the
workbook's own "Pricing DB" sheet holds the prices it used to get there.

For each workbook this emits one case:
  - the extracted assembly (via assembly_extract.py),
  - the quantities currently entered in it,
  - the prices its components resolve to, read from its own Pricing DB,
  - the equipment and miscellaneous costs it carries on its own rows,
  - and its cached totals: material, cost of material+labor+equipment,
    margins, insurance, and the job total.

CLI:
    assembly_costing_golden.py <workbook-or-folder> [...] --out <cases.json>

CONFIDENTIALITY: the emitted cases contain real MCW prices and totals. The
script REFUSES to write inside the repo. The TypeScript golden test reads the
file named by ASSEMBLY_GOLDEN_CASES and skips when it is absent, so the gate is
reproducible without the data ever being committed.
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from assembly_write import (  # noqa: E402
    ASSEMBLY_SHEET_NAME,
    parse_shared_strings,
    sheet_name_to_path,
)
from assembly_extract import (  # noqa: E402
    Sheet,
    cell_numeric,
    extract_assembly,
    find_materials_block,
    resolve_block_columns,
)

PRICING_DB_SHEET = "Pricing DB"

# Summary-block labels. Anchored so "Total Job Cost" in the header banner (a
# mirror of the real cell) does not win over the summary row itself.
COST_MLE_RE = re.compile(r"^total\s*-\s*material,\s*labor,\s*equipment", re.I)
MARGINS_TOTAL_RE = re.compile(r"^total\s*-\s*margins", re.I)
INSURANCE_TOTAL_RE = re.compile(r"^total\s*-\s*insurance", re.I)
JOB_TOTAL_RE = re.compile(r"^total\s*job\s*cost", re.I)
MATERIAL_TOTAL_RE = re.compile(r"^material total with price escalation", re.I)
LABOR_SUMMARY_RE = re.compile(r"labor\s*cost\s*summary", re.I)
EQUIPMENT_HDR_RE = re.compile(r"equipment\s*rental", re.I)
MISC_HDR_RE = re.compile(r"equipment charge|miscellaneous", re.I)
TOTAL_RE = re.compile(r"^total$", re.I)


def load_sheet(path: Path, sheet_name: str):
    with zipfile.ZipFile(path, "r") as zin:
        names = zin.namelist()
        workbook_xml = zin.read("xl/workbook.xml").decode("utf-8", errors="replace")
        rels_xml = zin.read("xl/_rels/workbook.xml.rels").decode("utf-8", errors="replace")
        sheet_path = sheet_name_to_path(workbook_xml, rels_xml, sheet_name)
        if sheet_path not in names:
            raise ValueError(f"missing sheet: {sheet_name}")
        sheet_xml = zin.read(sheet_path).decode("utf-8", errors="replace")
        shared_strings = []
        if "xl/sharedStrings.xml" in names:
            shared_strings = parse_shared_strings(
                zin.read("xl/sharedStrings.xml").decode("utf-8", errors="replace")
            )
    return Sheet(sheet_xml, shared_strings)


def read_pricing_db(path: Path) -> dict:
    """code -> net price, from the workbook's OWN price sheet.

    Component formulas are `INDEX(INDIRECT("'Pricing DB'!E:E"),
    MATCH(<code cell>, INDIRECT("'Pricing DB'!B:B"), 0))` — code in column B,
    price in column E. Using these prices rather than the app's product table
    is deliberate: the comparison must isolate the ENGINE, not also test
    whether an import happened to be up to date.
    """
    sheet = load_sheet(path, PRICING_DB_SHEET)
    prices = {}
    for row_num, cells in sheet.by_row.items():
        code_cell = cells.get(f"B{row_num}")
        price_cell = cells.get(f"E{row_num}")
        if not code_cell or not price_cell:
            continue
        code = (code_cell["text"] or "").strip()
        price = cell_numeric(price_cell["raw"])
        if code and price is not None:
            prices.setdefault(code, price)
    return prices


def value_right_of(sheet: Sheet, row_num: int, col_idx: int):
    row = sheet.by_row.get(row_num, {})
    for cell in sorted((c for c in row.values() if c["col_idx"] > col_idx), key=lambda c: c["col_idx"]):
        value = cell_numeric(cell["raw"])
        if value is not None:
            return value
    return None


def labelled_total(sheet: Sheet, pattern, last: bool = False):
    hits = [
        (row_num, col_idx)
        for row_num, col_idx, _addr, text in sorted(sheet.text_cells)
        if pattern.search(text.strip())
    ]
    if not hits:
        return None
    for row_num, col_idx in reversed(hits) if last else hits:
        value = value_right_of(sheet, row_num, col_idx)
        if value is not None:
            return value
    return None


def block_total(sheet: Sheet, header_pattern):
    """The 'Total' row belonging to a block, found by scanning down from the
    block's header rather than by absolute row."""
    header = None
    for row_num, col_idx, _addr, text in sorted(sheet.text_cells):
        if header_pattern.search(text.strip()):
            header = (row_num, col_idx)
            break
    if not header:
        return None
    header_row, _header_col = header
    for row_num, col_idx, _addr, text in sorted(sheet.text_cells):
        if header_row < row_num <= header_row + 15 and TOTAL_RE.match(text.strip()):
            value = value_right_of(sheet, row_num, col_idx)
            if value is not None:
                return value
    return None


def column_block_total(sheet: Sheet, header_pattern):
    """Total of a block whose total sits under a "Total" COLUMN header rather
    than beside a "Total" row label.

    The equipment block is laid out this way: `Equipment Rental` heads the
    block, `Total` is a column header on the same row, and the block's total is
    the last value in that column. Reading it with the row-label rule instead
    picks up the NEXT block's total, which silently double-counts.
    """
    header = None
    for row_num, col_idx, _addr, text in sorted(sheet.text_cells):
        if header_pattern.search(text.strip()):
            header = (row_num, col_idx)
            break
    if not header:
        return None
    header_row, _ = header

    total_col = None
    for row_num, col_idx, _addr, text in sheet.text_cells:
        if row_num == header_row and TOTAL_RE.match(text.strip()):
            total_col = col_idx
            break
    if total_col is None:
        return None

    last_value = None
    for row_num in range(header_row + 1, header_row + 12):
        for cell in sheet.by_row.get(row_num, {}).values():
            if cell["col_idx"] != total_col:
                continue
            value = cell_numeric(cell["raw"])
            if value is not None:
                last_value = value
    return last_value


def build_case(path: Path) -> dict:
    proposal = extract_assembly(path)
    sheet = load_sheet(path, ASSEMBLY_SHEET_NAME)
    prices = read_pricing_db(path)

    quantities = {}
    for entry in proposal["quantityInputs"]:
        # The quantity the workbook was last calculated with. Derived inputs
        # carry a formula; their cached value is what the components divided.
        quantities[str(entry["seq"])] = sheet.numeric_at(entry["quantityCell"])

    # The workbook's own per-line package count and extended cost, so a
    # mismatch can be traced to the component that caused it instead of only
    # showing up as a wrong grand total.
    block = find_materials_block(sheet, [])
    expected_lines = {}
    if block:
        header_row, header_col, _end = block
        roles = resolve_block_columns(sheet, header_row, header_col)
        for component in proposal["components"]:
            row_num = component["sourceRow"]
            qty_col = roles.get("quantity")
            total_col = roles.get("total")
            expected_lines[str(component["seq"])] = {
                "packages": (
                    cell_numeric(sheet.at(row_num, qty_col)["raw"])
                    if qty_col and sheet.at(row_num, qty_col)
                    else None
                ),
                "extendedCost": (
                    cell_numeric(sheet.at(row_num, total_col)["raw"])
                    if total_col and sheet.at(row_num, total_col)
                    else None
                ),
            }

    # PRICES MUST COME FROM THE CACHED COST CELLS, NOT THE Pricing DB SHEET.
    #
    # The Pricing Manager updates a workbook by rewriting ONLY the sheet named
    # "Pricing DB" — every other sheet keeps the values Excel last calculated.
    # So a workbook's cached totals reflect the prices in force when it was
    # last opened, while its Pricing DB sheet may already hold newer ones.
    # Pricing components from the DB sheet and comparing against those totals
    # measures how stale the workbook is, not whether the engine is correct.
    #
    # The cost cell on each component row holds the price the workbook actually
    # used, so that is what the comparison feeds in. (The DB sheet is still the
    # fallback for a row whose cost cell never calculated.)
    # The days each rate line last calculated to. Used ONLY to tell whether a
    # toggled line was switched on or off — the toggle is an input to the
    # assembly, and re-evaluating arbitrary Excel conditions is out of scope.
    # The day counts themselves are still computed by the engine.
    rate_days = {}
    prod_hdr = None
    for row_num, col_idx, _addr, text in sorted(sheet.text_cells):
        if re.search(r"production\s*rate\s*breakdown", text, re.I):
            prod_hdr = (row_num, col_idx)
            break
    if prod_hdr:
        for rate in proposal["productionRates"]:
            days_cell = sheet.at(rate["sourceRow"], prod_hdr[1] + 3)
            rate_days[str(rate["sourceRow"])] = cell_numeric(days_cell["raw"]) if days_cell else None

    case_prices = {}
    missing_prices = []
    if block:
        header_row, header_col, _end = block
        roles = resolve_block_columns(sheet, header_row, header_col)
        cost_col = roles.get("cost")
        for component in proposal["components"]:
            code = component["productCode"]
            if not code or code in case_prices:
                continue
            cached = None
            if cost_col:
                cost_cell = sheet.at(component["sourceRow"], cost_col)
                if cost_cell:
                    cached = cell_numeric(cost_cell["raw"])
            if cached is None:
                cached = prices.get(code)
            if cached is None:
                missing_prices.append(code)
            else:
                case_prices[code] = cached
    missing_prices = sorted(set(missing_prices))

    return {
        "sourceFile": path.name,
        "proposal": proposal,
        "quantitiesBySeq": quantities,
        "pricesByCode": case_prices,
        "missingPrices": missing_prices,
        "expectedLines": expected_lines,
        "rateDaysBySourceRow": rate_days,
        # Equipment and sundries are job-level figures the workbook carries on
        # its own rows (a sundries line is literally days x $15). They are not
        # assembly properties, so the engine takes them as inputs and the
        # comparison feeds it the workbook's own values.
        "equipmentCost": column_block_total(sheet, EQUIPMENT_HDR_RE) or 0,
        "miscCost": block_total(sheet, MISC_HDR_RE) or 0,
        "expected": {
            "materialTotal": labelled_total(sheet, MATERIAL_TOTAL_RE),
            "laborTotal": block_total(sheet, LABOR_SUMMARY_RE),
            "costMLE": labelled_total(sheet, COST_MLE_RE),
            "marginsTotal": labelled_total(sheet, MARGINS_TOTAL_RE),
            "insuranceTotal": labelled_total(sheet, INSURANCE_TOTAL_RE),
            # The banner near the top mirrors the real job total; take the LAST
            # occurrence, which is the summary row itself.
            "jobTotal": labelled_total(sheet, JOB_TOTAL_RE, last=True),
        },
    }


def main() -> None:
    args = sys.argv[1:]
    if "--out" not in args:
        print("Usage: assembly_costing_golden.py <workbook-or-folder> [...] --out <cases.json>")
        sys.exit(1)
    out_index = args.index("--out")
    out_path = Path(args[out_index + 1])
    targets = args[:out_index] + args[out_index + 2 :]

    repo_root = Path(__file__).resolve().parents[3]
    try:
        out_path.resolve().relative_to(repo_root)
        print(f"Refusing to write golden cases inside the repo ({repo_root}): {out_path}")
        print("These cases contain real prices and totals. Write them outside the repo.")
        sys.exit(1)
    except ValueError:
        pass

    paths: list[Path] = []
    for target in targets:
        p = Path(target)
        if p.is_dir():
            paths.extend(sorted(p.rglob("*.xlsx")))
        else:
            paths.append(p)

    cases = []
    skipped = []
    for path in paths:
        try:
            case = build_case(path)
        except Exception as exc:  # noqa: BLE001 - a workbook we cannot read is a skip, not a crash
            skipped.append((path.name, str(exc)))
            continue
        if case["expected"]["jobTotal"] is None:
            skipped.append((path.name, "no cached job total"))
            continue
        cases.append(case)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"cases": cases}, indent=1))

    print(f"Wrote {len(cases)} case(s) to {out_path}")
    if skipped:
        print(f"Skipped {len(skipped)}:")
        for name, reason in skipped[:20]:
            print(f"  {name}: {reason}")
    print("(contains real pricing — do not commit)")


if __name__ == "__main__":
    main()
