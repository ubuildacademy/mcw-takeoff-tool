#!/usr/bin/env python3
"""
Self-test suite for products_import.py. Run via `products_import.py --selftest`.

Fixtures are synthetic and built at run time. The real MCW export contains
confidential pricing and is never committed — but each fixture reproduces a
property of it that was verified against the live file (1,151 products followed
by a blank row and 29 category-header rows).
"""
from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from assembly_write import _make_xlsx  # noqa: E402
from assembly_extract_selftest import Checker, sheet_xml  # noqa: E402
from products_import import extract_products, normalise_date  # noqa: E402


def grid_to_cells(rows: list[list]) -> dict:
    """[[row1col1, row1col2, ...], ...] -> {cellAddress: value}, skipping Nones
    so a blank row really is blank."""
    cells = {}
    for row_index, row in enumerate(rows, start=1):
        for col_index, value in enumerate(row):
            if value is None:
                continue
            cells[f"{chr(ord('A') + col_index)}{row_index}"] = value
    return cells


def build(tmp_dir: str, name: str, rows: list[list]) -> Path:
    return Path(_make_xlsx(tmp_dir, name, {"Pricing DB": sheet_xml(grid_to_cells(rows))}))


# The shape of `export_clean_master()`: header, products, ONE BLANK ROW, then
# the preserved category-header rows.
EXPORT_ROWS = [
    ["ITEM", "CODE", "DESCRIPTION", "F4", "NET PRICE", "DATE"],
    ["604581", "AQU2KMG46", "AQUAFIN 2K/M STANDARD GRAY", None, 46.25, "2026-07-17"],
    ["603665", "CARLS10", "CAR EPDM LAP SEALANT 10OZ", None, 9.37, "2025-07-15"],
    ["740114", "GRAP300RP102", "PREPRUFE 300R+ 4X102", None, 145.63, "2026-06-05"],
    [None, None, None, None, None, None],
    ["1023755", "AQUAFIN", "AQUAFIN", None, None, "2025-07-15"],
    ["1025823", "BACKER ROD", "BACKER ROD", None, None, "2025-07-15"],
]


def check_export_shape(c: Checker, tmp_dir: str) -> None:
    result = extract_products(build(tmp_dir, "export.xlsx", EXPORT_ROWS))
    stats = result["stats"]

    # The category-header rows have a populated CODE and would otherwise import
    # as phantom products with no price.
    c.equal(stats["productRows"], 3, "export: product count stops at the blank row")
    c.equal(stats["skippedAfterSeparator"], 2, "export: category-header rows counted, not imported")
    c.equal(
        [row["code"] for row in result["rows"]],
        ["AQU2KMG46", "CARLS10", "GRAP300RP102"],
        "export: codes",
    )
    c.check(
        all(row["code"] not in ("AQUAFIN", "BACKER ROD") for row in result["rows"]),
        "export: a category header must never become a product",
    )

    first = result["rows"][0]
    c.equal(first["netPrice"], 46.25, "export: price")
    c.equal(first["priceDate"], "2026-07-17", "export: date")
    c.equal(first["item"], "604581", "export: item")
    c.equal(first["description"], "AQUAFIN 2K/M STANDARD GRAY", "export: description")
    c.equal(stats["unmappedColumns"], [], "export: every column mapped")
    c.equal(stats["missingPrice"], 0, "export: no missing prices")


def check_alias_mapping(c: Checker, tmp_dir: str) -> None:
    """Another company's price list: different spellings, different order, and
    a column we do not understand."""
    rows = [
        ["Product Code", "Unit Price", "Product Description", "Warehouse"],
        ["ABC123", 10.5, "Widget", "Denver"],
        ["DEF456", 20, "Gadget", "Denver"],
    ]
    result = extract_products(build(tmp_dir, "aliases.xlsx", rows))
    stats = result["stats"]

    c.equal(stats["productRows"], 2, "aliases: rows")
    c.equal(result["rows"][0]["code"], "ABC123", "aliases: code by alias")
    c.equal(result["rows"][0]["netPrice"], 10.5, "aliases: price by alias")
    c.equal(result["rows"][0]["description"], "Widget", "aliases: description by alias")
    # An unrecognised column is reported so an import can never quietly ignore
    # a column that mattered.
    c.equal(stats["unmappedColumns"], ["Warehouse"], "aliases: unmapped column reported")


def check_missing_required_column(c: Checker, tmp_dir: str) -> None:
    """A price list with no price column must fail loudly, not import every
    product with a null price."""
    rows = [["CODE", "DESCRIPTION"], ["ABC123", "Widget"]]
    path = build(tmp_dir, "no_price.xlsx", rows)
    try:
        extract_products(path)
        c.check(False, "missing price column should raise")
    except ValueError as exc:
        c.check("netPrice" in str(exc), f"missing price column message should name it, got: {exc}")


def check_supplier_list_rejected(c: Checker, tmp_dir: str) -> None:
    """A raw supplier price list carries the CPC code as "Product Number" and
    could technically be mapped — but importing it here would bypass the
    Pricing Manager's diff-and-confirm review, which is the system of record
    for prices. It must be refused, with an explanation."""
    rows = [
        ["Customer Number", "Customer Name", "Item Number", "Product Number", "Vendor Name", "Item Description", "UNIT PRICE"],
        ["601781", "MCW RESTORATION SERVICES", "740114", "3MM7100185121", "3M", "3M 2090-48NC BLUE", 11.75],
    ]
    try:
        extract_products(build(tmp_dir, "supplier.xlsx", rows))
        c.check(False, "supplier list should be refused")
    except ValueError as exc:
        c.check(
            "Pricing Manager" in str(exc),
            f"supplier list refusal should point at the Pricing Manager, got: {exc}",
        )


def check_title_row_above_header(c: Checker, tmp_dir: str) -> None:
    rows = [
        ["MCW RESTORATION SERVICES - ALL PROJECTS PRICING", None, None],
        [None, None, None],
        ["CODE", "DESCRIPTION", "NET PRICE"],
        ["ABC123", "Widget", 10.5],
    ]
    result = extract_products(build(tmp_dir, "titled.xlsx", rows))
    c.equal(result["stats"]["headerRow"], 3, "title row: header found below the title")
    c.equal(result["stats"]["productRows"], 1, "title row: product read")


def check_csv(c: Checker, tmp_dir: str) -> None:
    path = Path(tmp_dir) / "list.csv"
    path.write_text(
        "CODE,DESCRIPTION,NET PRICE,DATE\n"
        "ABC123,Widget,\"$1,250.00\",7/16/2026\n"
        "DEF456,Gadget,20,2026-07-17\n"
    )
    result = extract_products(path)
    c.equal(result["stats"]["productRows"], 2, "csv: rows")
    # Currency formatting and US dates are what a hand-made CSV looks like.
    c.equal(result["rows"][0]["netPrice"], 1250.0, "csv: currency-formatted price")
    c.equal(result["rows"][0]["priceDate"], "2026-07-16", "csv: US date normalised to ISO")
    c.equal(result["rows"][1]["priceDate"], "2026-07-17", "csv: ISO date preserved")


def check_row_hygiene(c: Checker, tmp_dir: str) -> None:
    rows = [
        ["CODE", "DESCRIPTION", "NET PRICE"],
        ["ABC123", "First", 10],
        [None, "No code at all", 5],
        ["ABC123", "Duplicate wins", 12],
    ]
    result = extract_products(build(tmp_dir, "hygiene.xlsx", rows))
    stats = result["stats"]

    c.equal(stats["skippedNoCode"], 1, "hygiene: row without a code skipped")
    c.equal(stats["duplicateCodesInFile"], 1, "hygiene: duplicate reported")
    c.equal(stats["productRows"], 1, "hygiene: duplicate collapsed")
    # Last occurrence wins, matching what the upsert would do anyway.
    c.equal(result["rows"][0]["description"], "Duplicate wins", "hygiene: last duplicate kept")


def check_date_normalisation(c: Checker) -> None:
    c.equal(normalise_date("2026-07-17"), "2026-07-17", "date: ISO")
    c.equal(normalise_date("2026-07-17 00:00:00"), "2026-07-17", "date: ISO with time")
    c.equal(normalise_date("7/16/2026"), "2026-07-16", "date: US")
    c.equal(normalise_date("7/6/26"), "2026-07-06", "date: two-digit year")
    c.equal(normalise_date("not a date"), None, "date: unparseable")
    c.equal(normalise_date(""), None, "date: empty")


def run_selftest() -> bool:
    tmp_dir = tempfile.mkdtemp(prefix="products_import_selftest_")
    c = Checker()
    try:
        check_export_shape(c, tmp_dir)
        check_alias_mapping(c, tmp_dir)
        check_missing_required_column(c, tmp_dir)
        check_supplier_list_rejected(c, tmp_dir)
        check_title_row_above_header(c, tmp_dir)
        check_csv(c, tmp_dir)
        check_row_hygiene(c, tmp_dir)
        check_date_normalisation(c)
    except Exception as exc:  # noqa: BLE001 - a crash is a failure, report it as one
        import traceback

        c.failures.append(f"exception during selftest: {exc}\n{traceback.format_exc()}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    if c.failures:
        print(f"FAIL — {len(c.failures)} of {c.checks} checks failed:")
        for failure in c.failures:
            print(f"  - {failure}")
        return False
    print(f"OK — {c.checks} checks passed")
    return True


if __name__ == "__main__":
    sys.exit(0 if run_selftest() else 1)
