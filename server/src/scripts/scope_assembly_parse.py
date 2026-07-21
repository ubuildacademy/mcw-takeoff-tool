#!/usr/bin/env python3
"""
SCOPING SCRIPT — NOT wired into the app. Measurement-only tool for task
STAGE2-SCOPE (docs/IMPLEMENTATION_PLAN.md): measures whether MCW's existing
assembly workbooks can be parsed automatically into native assemblies
(components, yields, labor params) — the assumption Stage 2 of the
assemblies roadmap rests on. This script does NOT build an importer and is
not called from any production path.

Read-only: every workbook is opened with zipfile.ZipFile(path, 'r') and
never written, moved, or renamed. Reuses the OOXML plumbing already proven
out in assembly_write.py (sheet_name_to_path, shared-string handling, the
label-scanning technique) instead of reimplementing it — see that module's
docstring for why this is stdlib zip/XML and never openpyxl.

Formula-pattern hypothesis under test (docs/ASSEMBLIES_DESIGN.md): component
rows are an INDEX/MATCH lookup against a 'Pricing DB' sheet keyed by a
product-code cell, paired with a ROUNDUP(quantity/yield) formula. Treat this
as a hypothesis, not fact — measure it, don't assume it holds.

Usage:
    python3 scope_assembly_parse.py <workbook_folder> [csv_out_path]

    <workbook_folder> is recursed for *.xlsx. [csv_out_path] defaults to a
    path under the OS temp dir (NEVER under the repo — this CSV can contain
    real product codes and must never be committed; see the confidentiality
    note below).

Output: human-readable aggregate report to stdout (classification counts,
structural-variance clustering, field reliability, no real dollar amounts
or supplier codes — those stay out of anything that might get committed or
pasted around). Per-workbook detail (including raw product codes, for
Jeff's own inspection) goes to the CSV only.

CONFIDENTIALITY: component costs, labor rates, margins, and supplier codes
are MCW's confidential pricing data. This script never prints a dollar
value. The CSV is written outside the repo and is the caller's
responsibility not to commit; nothing here should ever land in a commit.
"""
from __future__ import annotations

import csv
import os
import re
import sys
import tempfile
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from assembly_write import (  # noqa: E402
    ASSEMBLY_SHEET_NAME,
    _attr,
    _iter_sheet_cells,
    _opening_tag,
    build_proposal,
    get_cell_text,
    parse_shared_strings,
    sheet_name_to_path,
)

# --- formula-pattern detectors ---------------------------------------------

# Component row anchor: an INDEX/MATCH lookup keyed on a code cell against
# 'Pricing DB'!B:B. This is the most structurally consistent pattern found
# during manual inspection of 5 vendor sample sheets (Henry, Sika, Grace,
# Euclid, Dow) — every component row has one, at a stable column offset.
#
# Anchored to column A specifically: the same MATCH(...'Pricing DB'!B:B...)
# shape is also used by an unrelated header lookup (the "Quote #" cells near
# the top of the sheet, keyed on the manufacturer-name cell in column H) —
# a full-dataset column tally (2312 A-column hits vs 615 H-column hits, plus
# a long tail of 24 one-off J/I/F hits) confirmed A is where real component
# rows live and H is that other lookup, not a component.
CODE_LOOKUP_RE = re.compile(
    r"MATCH\(\s*(?:ASSEMBLY!)?\$?[Aa]\$?(\d+)\s*,\s*INDIRECT\(\s*\"'Pricing DB'!B:B\"",
)

# Component quantity formula: ROUNDUP(<job-qty-ref>/<yield-ref>,) with no
# nesting. Deliberately anchored/strict so it does NOT match the superficially
# similar production-rate-per-day formulas seen in the same sheets, e.g.
# ROUNDUP(IF(D34,E16/D34,),) — those wrap an IF and mean something different
# (days required for a line item, not units needed).
QTY_FORMULA_RE = re.compile(
    r"^ROUNDUP\(\s*\$?[A-Za-z]{1,3}\$?\d+\s*/\s*(\$?[A-Za-z]{1,3}\$?\d+)\s*,?\s*\)$",
    re.IGNORECASE,
)
# A component row that just copies another row's already-computed quantity
# (e.g. I18=I17) — still an extractable quantity, just not via its own yield.
SIMPLE_REF_RE = re.compile(r"^\$?([A-Za-z]{1,3})\$?(\d+)$")

# Division-chain formulas (e.g. G184=F57/E179, G185=G184/E180) are the
# fingerprint of the "divide-through" margin structure the design doc
# describes: cost / (1 - margin%) chained across Safety / Overhead / Profit.
# Plain "<ref>/<ref>" is rare elsewhere in these sheets (most formulas are
# SUM/IFERROR/INDEX/MATCH/multiplication), so >=2 hits is a reasonable,
# if approximate, signal — verified by hand on the sampled workbooks below.
DIVCHAIN_RE = re.compile(r"^\$?[A-Za-z]{1,3}\$?\d+\s*/\s*\$?[A-Za-z]{1,3}\$?\d+$")

MARGINS_HDR_RE = re.compile(r"^margins$", re.IGNORECASE)
DAY_RATE_LABEL_RE = re.compile(r"day\s*rate\s*per\s*man", re.IGNORECASE)
CREW_SIZE_LABEL_RE = re.compile(r"how\s*many\s*men", re.IGNORECASE)
LABOR_BURDEN_LABEL_RE = re.compile(r"^\s*labor\s*burden\s*$", re.IGNORECASE)
PROD_RATE_HDR_RE = re.compile(r"production\s*rate\s*breakdown", re.IGNORECASE)
PROD_RATE_END_RE = re.compile(r"^(total|day\(s\)\s*required)$", re.IGNORECASE)

# Ordered landmark patterns for the structural-variance signature. Each text
# cell is matched against these (first hit wins) to build a canonical token
# sequence for the sheet, independent of row numbers (which shift with
# component-row count) and independent of any dollar/product-code content.
LANDMARKS = [
    (re.compile(r"^job name\s*:?$", re.I), "JOB_NAME"),
    (re.compile(r"scope of work", re.I), "SCOPE"),
    (re.compile(r"^notes\s*:?$", re.I), "NOTES"),
    (re.compile(r"total job cost", re.I), "TOTAL_JOB_COST"),
    (re.compile(r"^assembly$", re.I), "ASSEMBLY_HDR"),
    (re.compile(r"unit of measurement", re.I), "UOM"),
    (re.compile(r"job quantity", re.I), "JOB_QTY"),
    (re.compile(r"^waste", re.I), "WASTE"),
    (re.compile(r"warranty", re.I), "WARRANTY"),
    (re.compile(r"materials\s*:", re.I), "MATERIALS_HDR"),
    (re.compile(r"price escalation", re.I), "PRICE_ESC"),
    (re.compile(r"^surcharge$", re.I), "SURCHARGE"),
    (re.compile(r"material total with price escalation", re.I), "MATERIAL_TOTAL"),
    (re.compile(r"material cost per", re.I), "MATERIAL_COST_PER"),
    (PROD_RATE_HDR_RE, "PROD_RATE_HDR"),
    (re.compile(r"surface prep", re.I), "SURFACE_PREP"),
    (re.compile(r"pressure cleaning", re.I), "PRESSURE_CLEAN"),
    (re.compile(r"day\(s\)\s*required", re.I), "DAYS_REQUIRED"),
    (re.compile(r"labor cost breakdown", re.I), "LABOR_HDR"),
    (DAY_RATE_LABEL_RE, "DAY_RATE"),
    (CREW_SIZE_LABEL_RE, "CREW_SIZE"),
    (re.compile(r"labor burden", re.I), "LABOR_BURDEN"),
    (re.compile(r"total day rate.*burden", re.I), "TOTAL_DAY_RATE"),
    (re.compile(r"equipment rental", re.I), "EQUIPMENT_HDR"),
    (re.compile(r"incidentals", re.I), "INCIDENTALS"),
    (re.compile(r"metro'?s equipment charge", re.I), "METRO_EQUIP"),
    (re.compile(r"sundries", re.I), "SUNDRIES"),
    (re.compile(r"misc.*parking", re.I), "MISC_PARKING"),
    (MARGINS_HDR_RE, "MARGINS_HDR"),
    (re.compile(r"^safety$", re.I), "SAFETY"),
    (re.compile(r"over\s*head", re.I), "OVERHEAD"),
    (re.compile(r"^profit$", re.I), "PROFIT"),
    (re.compile(r"insurance", re.I), "INSURANCE"),
    (re.compile(r"total.*material.*labor.*equipment", re.I), "TOTAL_MLE"),
    (re.compile(r"^summary$", re.I), "SUMMARY_HDR"),
    (re.compile(r"job total", re.I), "JOB_TOTAL_HDR"),
]


def get_cell_raw_numeric(cell_xml: str) -> "float | None":
    """Numeric <v> content for a cell with no t= attribute (or t="n") — i.e.
    a plain number, whether it's a literal input or a formula's cached
    result. Returns None for string/shared-string/inlineStr cells."""
    open_tag = _opening_tag(cell_xml)
    t = _attr(open_tag, "t")
    if t not in (None, "n"):
        return None
    m = re.search(r"<v>([^<]*)</v>", cell_xml)
    if not m or not m.group(1):
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def col_letters(ref: str) -> str:
    m = re.match(r"^\$?([A-Za-z]+)\$?\d+$", ref)
    return m.group(1).upper() if m else ""


def row_num_of(ref: str) -> "int | None":
    m = re.match(r"^\$?[A-Za-z]+\$?(\d+)$", ref)
    return int(m.group(1)) if m else None


class SheetIndex:
    """One pass over the ASSEMBLY sheet's cells, indexed for repeated
    label/row lookups without re-scanning the XML each time."""

    def __init__(self, sheet_xml: str, shared_strings: list):
        self.by_row: dict[int, dict[str, dict]] = defaultdict(dict)
        self.text_cells: list[tuple[int, int, str, str]] = []  # row, col, addr, text
        self.formula_cells: list[tuple[int, str, str]] = []  # row, addr, formula_text
        F_RE = re.compile(r"<f[^>]*>(.*?)</f>", re.DOTALL)

        for row_num, col_idx, addr, c_text, has_formula in _iter_sheet_cells(sheet_xml):
            text = get_cell_text(c_text, shared_strings)
            formula = ""
            if has_formula:
                m = F_RE.search(c_text)
                formula = m.group(1) if m else ""
            self.by_row[row_num][addr] = {
                "col_idx": col_idx,
                "text": text,
                "formula": formula,
                "has_formula": has_formula,
                "raw": c_text,
            }
            if text:
                self.text_cells.append((row_num, col_idx, addr, text))
            if formula:
                self.formula_cells.append((row_num, addr, formula))

    def cell(self, addr: str) -> "dict | None":
        row_num = row_num_of(addr)
        if row_num is None:
            return None
        return self.by_row.get(row_num, {}).get(addr.upper())

    def numeric_at(self, addr: str) -> "float | None":
        cell = self.cell(addr)
        if cell is None:
            return None
        return get_cell_raw_numeric(cell["raw"])


def find_label_row(idx: SheetIndex, pattern: "re.Pattern") -> "int | None":
    for row_num, _col_idx, _addr, text in idx.text_cells:
        if text and pattern.search(text.strip()):
            return row_num
    return None


def first_non_formula_after(idx: SheetIndex, row_num: int, label_col_idx: int) -> "dict | None":
    """First cell to the right of the label, in the same row, that isn't
    itself a formula — mirrors the adjacency heuristic build_proposal()
    already uses for the Job Quantity label."""
    row_cells = idx.by_row.get(row_num, {})
    candidates = sorted(
        (c for c in row_cells.values() if c["col_idx"] > label_col_idx),
        key=lambda c: c["col_idx"],
    )
    for c in candidates:
        if not c["has_formula"]:
            return c
    return None


def scan_labor_params(idx: SheetIndex) -> dict:
    result = {"dayRate": False, "crewSize": False, "laborBurden": False}
    for key, pattern in (
        ("dayRate", DAY_RATE_LABEL_RE),
        ("crewSize", CREW_SIZE_LABEL_RE),
        ("laborBurden", LABOR_BURDEN_LABEL_RE),
    ):
        for row_num, col_idx, _addr, text in idx.text_cells:
            if pattern.search(text.strip()):
                cell = first_non_formula_after(idx, row_num, col_idx)
                if cell is not None:
                    result[key] = True
                    break
    return result


def scan_production_rate_slots(idx: SheetIndex) -> int:
    """Counts non-formula, numeric-typed input cells between the
    'Production Rate breakdown' header and its closing Total/Day(s)
    required rows — i.e. how many per-line-item production rates look
    like they're sitting in fillable input cells (populated or not)."""
    hdr_row = find_label_row(idx, PROD_RATE_HDR_RE)
    if hdr_row is None:
        return 0
    end_row = None
    for row_num, _col_idx, _addr, text in idx.text_cells:
        if row_num > hdr_row and PROD_RATE_END_RE.match(text.strip()):
            if end_row is None or row_num < end_row:
                end_row = row_num
    if end_row is None:
        end_row = hdr_row + 20  # fallback bound
    count = 0
    for row_num in range(hdr_row + 1, end_row):
        for cell in idx.by_row.get(row_num, {}).values():
            if not cell["has_formula"] and get_cell_raw_numeric(cell["raw"]) is not None:
                count += 1
                break  # one rate slot per row
    return count


def scan_margin_chain(idx: SheetIndex) -> bool:
    if find_label_row(idx, MARGINS_HDR_RE) is None:
        return False
    hits = sum(1 for _row, _addr, formula in idx.formula_cells if DIVCHAIN_RE.match(formula.strip()))
    return hits >= 2


def scan_components(idx: SheetIndex) -> list[dict]:
    components = []
    seen_rows = set()
    for row_num, addr, formula in idx.formula_cells:
        m = CODE_LOOKUP_RE.search(formula)
        if not m:
            continue
        if row_num in seen_rows:
            continue
        seen_rows.add(row_num)
        code_addr = f"A{m.group(1)}"
        code_cell = idx.cell(code_addr)
        code_text = code_cell["text"].strip() if code_cell else ""

        yield_addr = None
        derived_from = None
        for other_addr, cell in idx.by_row.get(row_num, {}).items():
            if not cell["has_formula"]:
                continue
            qm = QTY_FORMULA_RE.match(cell["formula"].strip())
            if qm:
                yield_addr = qm.group(1)
                break
            rm = SIMPLE_REF_RE.match(cell["formula"].strip())
            if rm and cell["col_idx"] >= idx.by_row[row_num].get(code_addr, {}).get("col_idx", 0):
                derived_from = f"{rm.group(1).upper()}{rm.group(2)}"

        yield_value = idx.numeric_at(yield_addr) if yield_addr else None

        # Packaging unit: in every sampled vendor (Henry, Sika, Grace,
        # Euclid, Dow) this sits in column F of the same component row.
        pkg_cell = idx.by_row.get(row_num, {}).get(f"F{row_num}")
        packaging_unit = pkg_cell["text"].strip() if pkg_cell else ""

        components.append(
            {
                "row": row_num,
                "has_code": bool(code_text),
                "has_yield": yield_value is not None,
                "has_packaging": bool(packaging_unit),
                "derived_qty": derived_from is not None and yield_addr is None,
                "fully_extractable": bool(code_text) and yield_value is not None and bool(packaging_unit),
            }
        )
    return components


def build_layout_signature(idx: SheetIndex) -> tuple:
    tokens = []
    for _row, _col, _addr, text in idx.text_cells:
        stripped = text.strip()
        if not stripped:
            continue
        for pattern, token in LANDMARKS:
            if pattern.search(stripped):
                if not tokens or tokens[-1] != token:
                    tokens.append(token)
                break
    return tuple(tokens)


def scan_workbook(path: Path) -> dict:
    row = {
        "path": str(path),
        "reachable": False,
        "has_assembly_sheet": False,
        "classification": "FAILED",
        "reason": "",
        "num_components": 0,
        "num_components_full": 0,
        "day_rate_present": False,
        "crew_size_present": False,
        "labor_burden_present": False,
        "production_rate_slots": 0,
        "margin_chain_detected": False,
        "quantity_cell_found": False,
        "layout_signature": (),
    }

    try:
        with zipfile.ZipFile(path, "r") as zin:
            names = zin.namelist()
            if "xl/workbook.xml" not in names:
                row["reason"] = "not a valid xlsx (missing xl/workbook.xml)"
                return row
            row["reachable"] = True

            workbook_xml = zin.read("xl/workbook.xml").decode("utf-8", errors="replace")
            rels_xml = zin.read("xl/_rels/workbook.xml.rels").decode("utf-8", errors="replace")
            try:
                sheet_path = sheet_name_to_path(workbook_xml, rels_xml, ASSEMBLY_SHEET_NAME)
            except ValueError:
                row["reason"] = "no ASSEMBLY sheet"
                return row
            if sheet_path not in names:
                row["reason"] = "no ASSEMBLY sheet"
                return row
            row["has_assembly_sheet"] = True

            sheet_xml = zin.read(sheet_path).decode("utf-8", errors="replace")
            shared_strings = []
            if "xl/sharedStrings.xml" in names:
                shared_strings = parse_shared_strings(
                    zin.read("xl/sharedStrings.xml").decode("utf-8", errors="replace")
                )
    except zipfile.BadZipFile:
        row["reason"] = "not a valid zip (corrupt, or password-protected OLE-format xlsx)"
        return row
    except KeyError as exc:
        row["reason"] = f"missing required zip member: {exc}"
        return row
    except Exception as exc:  # noqa: BLE001 - scoping tool, report all failures
        row["reason"] = f"unexpected error opening workbook: {exc}"
        return row

    idx = SheetIndex(sheet_xml, shared_strings)

    proposal = build_proposal(sheet_xml, shared_strings)
    row["quantity_cell_found"] = proposal is not None

    components = scan_components(idx)
    row["num_components"] = len(components)
    row["num_components_full"] = sum(1 for c in components if c["fully_extractable"])

    labor = scan_labor_params(idx)
    row["day_rate_present"] = labor["dayRate"]
    row["crew_size_present"] = labor["crewSize"]
    row["labor_burden_present"] = labor["laborBurden"]
    row["production_rate_slots"] = scan_production_rate_slots(idx)
    row["margin_chain_detected"] = scan_margin_chain(idx)
    row["layout_signature"] = build_layout_signature(idx)

    missing = []
    if row["num_components"] == 0:
        missing.append("no components detected")
    elif row["num_components_full"] < row["num_components"]:
        missing.append(
            f"{row['num_components'] - row['num_components_full']}/{row['num_components']} "
            "components missing code/yield/packaging"
        )
    if not labor["dayRate"]:
        missing.append("day rate")
    if not labor["crewSize"]:
        missing.append("crew size")
    if not labor["laborBurden"]:
        missing.append("labor burden")
    if row["production_rate_slots"] == 0:
        missing.append("production rate slots")
    if not row["margin_chain_detected"]:
        missing.append("margin chain")

    if not missing:
        row["classification"] = "FULL"
    elif row["num_components"] > 0 or any([labor["dayRate"], labor["crewSize"], labor["laborBurden"]]):
        row["classification"] = "PARTIAL"
    else:
        row["classification"] = "FAILED"
    row["reason"] = "; ".join(missing) if missing else "all fields extractable"
    return row


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: scope_assembly_parse.py <workbook_folder> [csv_out_path]")
        sys.exit(1)

    folder = Path(sys.argv[1])
    if not folder.is_dir():
        print(f"Not a directory: {folder}")
        sys.exit(1)

    if len(sys.argv) > 2:
        csv_path = Path(sys.argv[2])
    else:
        csv_path = Path(tempfile.gettempdir()) / "scope_assembly_parse_report.csv"

    repo_root = Path(__file__).resolve().parents[3]
    try:
        csv_path.resolve().relative_to(repo_root)
        print(f"Refusing to write CSV inside the repo ({repo_root}): {csv_path}")
        sys.exit(1)
    except ValueError:
        pass  # not inside repo_root, good

    xlsx_paths = sorted(folder.rglob("*.xlsx"))
    print(f"Found {len(xlsx_paths)} .xlsx file(s) under {folder}")
    print()

    rows = []
    for p in xlsx_paths:
        r = scan_workbook(p)
        try:
            r["vendor"] = p.relative_to(folder).parts[0]
        except (ValueError, IndexError):
            r["vendor"] = "(root)"
        rows.append(r)

    # --- classification counts ---------------------------------------------
    class_counts = Counter(r["classification"] for r in rows)
    total = len(rows)
    print("=== Classification ===")
    for cls in ("FULL", "PARTIAL", "FAILED"):
        n = class_counts.get(cls, 0)
        pct = (100 * n / total) if total else 0
        print(f"  {cls}: {n}/{total} ({pct:.1f}%)")
    print()

    # --- reachability breakdown ---------------------------------------------
    unreachable = [r for r in rows if not r["reachable"]]
    no_assembly = [r for r in rows if r["reachable"] and not r["has_assembly_sheet"]]
    print("=== Reachability ===")
    print(f"  Opens cleanly: {total - len(unreachable)}/{total}")
    print(f"  Fails to open (corrupt/password/not-xlsx): {len(unreachable)}/{total}")
    if unreachable:
        reason_counts = Counter(r["reason"] for r in unreachable)
        for reason, n in reason_counts.most_common():
            print(f"    - {reason}: {n}")
    print(f"  Opens but no ASSEMBLY sheet: {len(no_assembly)}/{total}")
    print()

    # --- field reliability ---------------------------------------------
    reachable_rows = [r for r in rows if r["has_assembly_sheet"]]
    n_reach = len(reachable_rows)
    print("=== Field reliability (of workbooks with an ASSEMBLY sheet) ===")
    if n_reach:
        with_components = sum(1 for r in reachable_rows if r["num_components"] > 0)
        total_components = sum(r["num_components"] for r in reachable_rows)
        total_components_full = sum(r["num_components_full"] for r in reachable_rows)
        print(f"  >=1 component row detected: {with_components}/{n_reach} ({100 * with_components / n_reach:.1f}%)")
        if total_components:
            print(
                f"  Of {total_components} detected component rows, "
                f"{total_components_full} ({100 * total_components_full / total_components:.1f}%) "
                "have code+yield+packaging all extractable"
            )
        print(
            f"  Job quantity cell found: "
            f"{sum(1 for r in reachable_rows if r['quantity_cell_found'])}/{n_reach}"
        )
        print(
            f"  Day rate slot present: {sum(1 for r in reachable_rows if r['day_rate_present'])}/{n_reach}"
        )
        print(
            f"  Crew size slot present: {sum(1 for r in reachable_rows if r['crew_size_present'])}/{n_reach}"
        )
        print(
            f"  Labor burden slot present: {sum(1 for r in reachable_rows if r['labor_burden_present'])}/{n_reach}"
        )
        print(
            f"  >=1 production-rate slot present: "
            f"{sum(1 for r in reachable_rows if r['production_rate_slots'] > 0)}/{n_reach}"
        )
        print(
            f"  Margin chain detected: {sum(1 for r in reachable_rows if r['margin_chain_detected'])}/{n_reach}"
        )
    print()

    # --- structural variance clustering ---------------------------------------------
    print("=== Structural variance (layout-signature clustering) ===")
    sig_counter: Counter = Counter()
    sig_examples: dict[tuple, str] = {}
    for r in reachable_rows:
        sig = r["layout_signature"]
        sig_counter[sig] += 1
        sig_examples.setdefault(sig, r["vendor"])
    print(f"  {len(sig_counter)} distinct layout signature(s) across {n_reach} workbook(s) with an ASSEMBLY sheet")
    for i, (sig, count) in enumerate(sig_counter.most_common(), start=1):
        pct = 100 * count / n_reach if n_reach else 0
        preview = " > ".join(sig[:6]) + (" > ..." if len(sig) > 6 else "")
        print(f"  Cluster {i}: {count} workbook(s) ({pct:.1f}%), first seen in vendor '{sig_examples[sig]}'")
        print(f"    signature preview: {preview}")
    print()

    # --- vendor breakdown ---------------------------------------------
    print("=== By vendor folder ===")
    by_vendor = defaultdict(Counter)
    for r in rows:
        by_vendor[r["vendor"]][r["classification"]] += 1
    for vendor in sorted(by_vendor):
        counts = by_vendor[vendor]
        n = sum(counts.values())
        print(f"  {vendor}: {n} workbook(s) — FULL {counts.get('FULL', 0)}, PARTIAL {counts.get('PARTIAL', 0)}, FAILED {counts.get('FAILED', 0)}")
    print()

    # --- CSV dump (scratch, not committed) ---------------------------------------------
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "vendor",
        "path",
        "reachable",
        "has_assembly_sheet",
        "classification",
        "reason",
        "num_components",
        "num_components_full",
        "day_rate_present",
        "crew_size_present",
        "labor_burden_present",
        "production_rate_slots",
        "margin_chain_detected",
        "quantity_cell_found",
        "layout_signature_len",
    ]
    with csv_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            out_row = {k: r[k] for k in fieldnames if k in r}
            out_row["layout_signature_len"] = len(r["layout_signature"])
            writer.writerow(out_row)
    print(f"Per-workbook CSV written to: {csv_path}")
    print("(scratch file — do not commit; contains file paths only, no pricing data)")


if __name__ == "__main__":
    main()
