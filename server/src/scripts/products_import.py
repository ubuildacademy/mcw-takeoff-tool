#!/usr/bin/env python3
"""
products_import.py — parses a product price list into import rows
(Stage 2 task I2; see docs/ASSEMBLIES_DESIGN.md).

Read-only, pure stdlib. Accepts the MCW Pricing Manager's "Export DB" output
(.xlsx) or a .csv with the same columns. Reuses assembly_write.py's OOXML
plumbing rather than reimplementing it, and never openpyxl.

CLI:
    products_import.py <file.xlsx|file.csv>   -> {"success": true, "rows": [...], "stats": {...}}
    products_import.py --selftest

Two properties of the real export drive the parsing:

 1. **The file does not end where the products do.** `export_clean_master()`
    writes the products, then a BLANK SEPARATOR ROW, then the preserved
    category-header rows — manufacturer and category names such as "AQUAFIN"
    or "BACKER ROD" carried at the bottom of the master DB. Those rows have a
    populated CODE column and would import as 1-per-manufacturer phantom
    products with no price. Parsing stops at the blank row and reports how many
    rows were left behind, so the skip is visible rather than silent.

 2. **Columns are matched by alias, not position.** Any company's price list
    can be imported, and the Pricing Manager itself does alias-based mapping on
    supplier uploads. Headers that match no alias are REPORTED, never silently
    dropped — a price list whose price column is called something unexpected
    must fail loudly rather than import every product with a null price.
"""
from __future__ import annotations

import csv
import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from assembly_write import (  # noqa: E402
    _iter_sheet_cells,
    get_cell_text,
    parse_shared_strings,
)
from assembly_extract import cell_numeric  # noqa: E402

# Field -> accepted header spellings, compared case-insensitively with runs of
# non-alphanumerics collapsed (so "ITEM #", "item_no" and "Item No." all match).
COLUMN_ALIASES = {
    "code": ["code", "cpc", "cpcid", "cpc id", "productcode", "product code", "sku", "partnumber", "part number"],
    "item": ["item", "item #", "itemno", "item no", "itemnumber", "item number", "mfgitem", "mfg item"],
    "description": ["description", "desc", "productdescription", "product description", "name"],
    "netPrice": ["netprice", "net price", "net", "price", "unitprice", "unit price", "cost"],
    "date": ["date", "pricedate", "price date", "effectivedate", "effective date", "asof", "as of"],
    "f4": ["f4"],
}

# The columns without which an import is meaningless.
REQUIRED_FIELDS = ["code", "netPrice"]

DATE_RE = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})")
US_DATE_RE = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s*$")


def normalise_header(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").strip().lower())


NORMALISED_ALIASES = {
    field: {normalise_header(alias) for alias in aliases} for field, aliases in COLUMN_ALIASES.items()
}


def map_columns(header_cells: dict):
    """{column key -> header text} -> (field -> column key, unmapped headers)."""
    mapping: dict[str, str] = {}
    unmapped: list[str] = []
    for key, text in header_cells.items():
        if not (text or "").strip():
            continue
        normalised = normalise_header(text)
        matched = None
        for field, aliases in NORMALISED_ALIASES.items():
            if normalised in aliases and field not in mapping:
                matched = field
                break
        if matched:
            mapping[matched] = key
        else:
            unmapped.append(text.strip())
    return mapping, unmapped


def normalise_date(value: str):
    """ISO date, or None. The Pricing Manager writes ISO already; US-style
    dates are accepted because other companies' lists use them."""
    if not value:
        return None
    text = str(value).strip()
    m = DATE_RE.match(text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = US_DATE_RE.match(text)
    if m:
        month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if year < 100:
            year += 2000
        return f"{year:04d}-{month:02d}-{day:02d}"
    return None


def parse_price(text: str, numeric):
    if numeric is not None:
        return numeric
    if not text:
        return None
    cleaned = re.sub(r"[^0-9.\-]", "", str(text))
    if not cleaned or cleaned in ("-", "."):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


# ── xlsx ───────────────────────────────────────────────────────────────


def read_xlsx_grid(path: Path):
    """[{column letter: {'text': str, 'numeric': float|None}}] per row, in order."""
    with zipfile.ZipFile(path, "r") as zin:
        names = zin.namelist()
        sheet_paths = sorted(n for n in names if n.startswith("xl/worksheets/sheet"))
        if not sheet_paths:
            raise ValueError("no worksheets found in workbook")
        sheet_xml = zin.read(sheet_paths[0]).decode("utf-8", errors="replace")
        shared_strings = []
        if "xl/sharedStrings.xml" in names:
            shared_strings = parse_shared_strings(
                zin.read("xl/sharedStrings.xml").decode("utf-8", errors="replace")
            )

    rows: dict[int, dict] = {}
    for row_num, _col_idx, addr, c_text, _has_formula in _iter_sheet_cells(sheet_xml):
        column = re.match(r"([A-Za-z]+)", addr).group(1).upper()
        rows.setdefault(row_num, {})[column] = {
            "text": get_cell_text(c_text, shared_strings),
            "numeric": cell_numeric(c_text),
        }
    if not rows:
        return []
    # Return every row number from the first to the last, filling GAPS with
    # empty rows. A writer may emit an empty row for a blank line or omit the
    # row element entirely; both mean the same thing to a reader, and the blank
    # line is what separates the products from the category headers. Keying off
    # only the rows that exist would silently run the two sections together.
    return [rows.get(row_num, {}) for row_num in range(min(rows), max(rows) + 1)]


def read_csv_grid(path: Path):
    grid = []
    with path.open("r", newline="", encoding="utf-8-sig", errors="replace") as handle:
        for record in csv.reader(handle):
            row = {}
            for index, value in enumerate(record):
                row[chr(ord("A") + index) if index < 26 else f"A{index}"] = {
                    "text": value,
                    "numeric": None,
                }
            grid.append(row)
    return grid


# ── extraction ─────────────────────────────────────────────────────────


def row_is_blank(row: dict) -> bool:
    return not any(
        (cell["text"] or "").strip() or cell["numeric"] is not None for cell in row.values()
    )


def find_header_row(grid):
    """First row that maps at least two known columns. Scans a bounded prefix
    so a title or logo row above the table does not defeat the import."""
    for index, row in enumerate(grid[:20]):
        texts = {key: cell["text"] for key, cell in row.items()}
        mapping, _unmapped = map_columns(texts)
        if len(mapping) >= 2:
            return index, mapping
    return None, {}


def extract_products(path: Path) -> dict:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        grid = read_csv_grid(path)
    elif suffix in (".xlsx", ".xlsm"):
        grid = read_xlsx_grid(path)
    else:
        raise ValueError(f"unsupported file type: {suffix or path.name}")

    header_index, mapping = find_header_row(grid)
    if header_index is None:
        raise ValueError("no header row found — expected columns such as CODE and NET PRICE")

    header_texts = {key: cell["text"] for key, cell in grid[header_index].items()}
    _mapping, unmapped = map_columns(header_texts)

    header_list = sorted(t.strip() for t in header_texts.values() if t.strip())
    missing = [field for field in REQUIRED_FIELDS if field not in mapping]
    if missing:
        # A raw SUPPLIER price list is the likeliest wrong file to drop here:
        # it carries the CPC code under "Product Number" alongside a vendor and
        # customer column. It must NOT be imported directly — supplier prices
        # go through the Pricing Manager's diff-and-confirm workflow, which is
        # the system of record. Mapping it silently would bypass that review
        # and could regress prices, so this stays an error and explains itself.
        normalised_headers = {normalise_header(t) for t in header_list}
        looks_like_supplier_list = "productnumber" in normalised_headers and (
            "vendorname" in normalised_headers or "customernumber" in normalised_headers
        )
        if looks_like_supplier_list:
            raise ValueError(
                "this looks like a raw supplier price list, not a master price list. "
                "Run it through the MCW Pricing Manager first (Upload & Diff), then "
                'import the "Export DB" file it produces.'
            )
        raise ValueError(
            f"price list is missing required column(s): {', '.join(missing)}. "
            f"Headers found: {', '.join(header_list)}"
        )

    rows = []
    skipped_no_code = 0
    trailing_rows = 0
    stopped_at_blank = False

    for row in grid[header_index + 1 :]:
        if row_is_blank(row):
            # The separator that precedes the category-header rows. Everything
            # past it is not a product.
            stopped_at_blank = True
            continue
        if stopped_at_blank:
            trailing_rows += 1
            continue

        def field(name: str):
            key = mapping.get(name)
            return row.get(key) if key else None

        code_cell = field("code")
        code = ((code_cell or {}).get("text") or "").strip()
        if not code and code_cell and code_cell.get("numeric") is not None:
            code = str(code_cell["numeric"]).rstrip("0").rstrip(".")
        if not code:
            skipped_no_code += 1
            continue

        price_cell = field("netPrice") or {}
        date_cell = field("date") or {}
        item_cell = field("item") or {}
        description_cell = field("description") or {}

        item_text = (item_cell.get("text") or "").strip()
        if not item_text and item_cell.get("numeric") is not None:
            item_text = str(int(item_cell["numeric"]))

        rows.append(
            {
                "code": code,
                "item": item_text or None,
                "description": (description_cell.get("text") or "").strip() or None,
                "netPrice": parse_price(price_cell.get("text"), price_cell.get("numeric")),
                "priceDate": normalise_date(date_cell.get("text")),
            }
        )

    # A code repeated inside one file is the caller's problem to see: keep the
    # LAST occurrence (matching an upsert's behaviour) and report the count.
    by_code: dict[str, dict] = {}
    duplicates = 0
    for row in rows:
        if row["code"] in by_code:
            duplicates += 1
        by_code[row["code"]] = row

    return {
        "rows": list(by_code.values()),
        "stats": {
            "sourceFile": path.name,
            "headerRow": header_index + 1,
            "mappedColumns": {field: key for field, key in mapping.items()},
            "unmappedColumns": unmapped,
            "productRows": len(by_code),
            "duplicateCodesInFile": duplicates,
            "skippedNoCode": skipped_no_code,
            # Rows after the blank separator: the preserved category headers.
            "skippedAfterSeparator": trailing_rows,
            "missingPrice": sum(1 for row in by_code.values() if row["netPrice"] is None),
        },
    }


def main() -> None:
    args = sys.argv[1:]
    if args and args[0] == "--selftest":
        from products_import_selftest import run_selftest  # noqa: PLC0415

        sys.exit(0 if run_selftest() else 1)

    if len(args) != 1:
        print(json.dumps({"success": False, "error": "Usage: products_import.py <file.xlsx|file.csv>"}))
        sys.exit(1)

    try:
        result = extract_products(Path(args[0]))
    except Exception as exc:  # noqa: BLE001 - CLI boundary, report every failure as JSON
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)

    print(json.dumps({"success": True, **result}))


if __name__ == "__main__":
    main()
