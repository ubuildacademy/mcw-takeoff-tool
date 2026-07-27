#!/usr/bin/env python3
"""
assembly_extract.py — parses an ASSEMBLY sheet into a native assembly proposal
(Stage 2 bootstrap importer, task I3; see docs/ASSEMBLIES_DESIGN.md).

Read-only, pure stdlib zip/XML. NEVER openpyxl (see assembly_write.py's
docstring for why). Reuses that module's OOXML plumbing rather than
reimplementing it.

CLI:
    assembly_extract.py <src.xlsx>      -> {"success": true, "proposal": {...}}
    assembly_extract.py --selftest      -> runs the synthetic fixture suite

Output is a PROPOSAL, not a saved assembly: every field carries flags where the
sheet was ambiguous, and the import review screen (task I5) is what turns it
into rows. The guiding rule is that a parser which reads confidently and
wrongly is worse than one that fails loudly — so anything uncertain is emitted
WITH a flag rather than silently dropped or guessed.

Five detector rules here differ from the scoping script (scope_assembly_parse.py)
that measured viability. Each is a bug that measurement found, quantified in
docs/ASSEMBLIES_DESIGN.md under "I0 — parse-accuracy spot-check":

 1. Component rows are anchored on the ROUNDUP(qty/yield) QUANTITY formula, not
    on the INDEX/MATCH price lookup. 60 rows across 16 workbooks have a code, a
    yield and a quantity formula but a price that was pasted as a literal; the
    lookup-anchored detector skipped them while still reporting the workbook
    complete, which silently undercounts material.
 2. Quantity formulas wrapped in IF()/IFERROR() count (55 rows / 38 workbooks) —
    those components are optional or capacity-gated, not absent.
 3. Columns are resolved from the block's header text, never fixed letters.
    Column F is the packaging unit in the 218-workbook layout and the YIELD unit
    in the 13-workbook shifted layout.
 4. An assembly has MANY named quantity inputs, each with its own waste %
    (74% of the library). Each component binds to the one its formula divides.
 5. Packaging never gates completeness — it is not used in the cost math.

CONFIDENTIALITY: assembly workbooks contain MCW's confidential pricing. This
script prints extracted values because that is its job, but nothing here should
ever be committed, and the fixtures used by --selftest are synthetic.
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from assembly_write import (  # noqa: E402
    ASSEMBLY_SHEET_NAME,
    _attr,
    _iter_sheet_cells,
    _opening_tag,
    col_to_index,
    get_cell_text,
    index_to_col,
    parse_shared_strings,
    sheet_name_to_path,
)

# ── block / label detection ────────────────────────────────────────────

MATERIALS_HDR_RE = re.compile(r"^materials\s*:?$", re.I)
BLOCK_END_RE = re.compile(r"^total$", re.I)
JOB_QUANTITY_RE = re.compile(r"job\s*quantity", re.I)
UOM_RE = re.compile(r"unit\s*of\s*measurement", re.I)
WASTE_RE = re.compile(r"^waste", re.I)
BLOCK_TOTAL_RE = re.compile(r"^total$", re.I)

# Header roles inside the materials block. Order matters: the first pattern
# that matches a header cell wins, so "Total" must not swallow "Material Total".
HEADER_ROLES = [
    ("cost", re.compile(r"^cost$", re.I)),
    ("packaging", re.compile(r"^packaging$", re.I)),
    ("yield", re.compile(r"^yield$", re.I)),
    ("quantity", re.compile(r"^quantity$", re.I)),
    ("total", re.compile(r"^total$", re.I)),
    ("code_description", re.compile(r"^cpc\s*description", re.I)),
]

DAY_RATE_RE = re.compile(r"day\s*rate\s*per\s*man", re.I)
CREW_SIZE_RE = re.compile(r"how\s*many\s*men", re.I)
LABOR_BURDEN_RE = re.compile(r"^\s*labor\s*burden\s*$", re.I)
PROD_RATE_HDR_RE = re.compile(r"production\s*rate\s*breakdown", re.I)
PROD_RATE_END_RE = re.compile(r"^(total|day\(s\)\s*required)$", re.I)
MARGINS_HDR_RE = re.compile(r"^margins$", re.I)
INSURANCE_RE = re.compile(r"^insurance$", re.I)
ESCALATION_RE = re.compile(r"price\s*escalation", re.I)
SURCHARGE_RE = re.compile(r"^surcharge$", re.I)
TAX_RE = re.compile(r"^tax$", re.I)

# ── formula patterns ───────────────────────────────────────────────────

# A bare ROUNDUP is unconditional; anything else wraps it in logic, which means
# the component is optional or gated.
BARE_ROUNDUP_RE = re.compile(
    r"^ROUNDUP\(\s*\$?[A-Za-z]{1,3}\$?\d+\s*/\s*\$?[A-Za-z]{1,3}\$?\d+\s*,?\s*\)$", re.I
)
ROUNDUP_START_RE = re.compile(r"ROUNDUP\(", re.I)
# Price lookup against the Pricing DB, keyed on some cell. Unanchored from
# column A on purpose — the code column moves with the layout.
CODE_LOOKUP_RE = re.compile(
    r"MATCH\(\s*(?:ASSEMBLY!)?(\$?[A-Za-z]{1,3}\$?\d+)\s*,\s*INDIRECT\(\s*\"'Pricing DB'!B:B\"",
    re.I,
)
CELL_REF_ONLY_RE = re.compile(r"^\$?([A-Za-z]{1,3})\$?(\d+)$")
YIELD_PLACEHOLDER_RE = re.compile(r"enter\s*yield", re.I)


def norm_ref(ref: str) -> str:
    return ref.replace("$", "").upper()


def split_ref(ref: str):
    m = CELL_REF_ONLY_RE.match(ref.replace("$", ""))
    if not m:
        return None, None
    return m.group(1).upper(), int(m.group(2))


def _balanced_slice(text: str, open_idx: int):
    """Content between the parenthesis at `open_idx` and its match."""
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1 : i]
    return None


def _split_top_level_div(expr: str):
    """Split on the LAST top-level '/' — the yield division. Returns
    (numerator, denominator) or None when there is no top-level division."""
    depth = 0
    last = -1
    for i, ch in enumerate(expr):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "/" and depth == 0:
            last = i
    if last < 0:
        return None
    return expr[:last], expr[last + 1 :]


def parse_quantity_formula(formula: str):
    """Pull (numerator expression, yield ref) out of a component's quantity
    formula, or None if this is not one.

    The numerator is deliberately allowed to be an EXPRESSION, not a single
    cell: real component rows divide compound quantities such as
    `ROUNDUP((D23+D17)/G27,)` (a base area plus a pile-collar area) and
    `ROUNDUP(((I11*D11)/G27),)`. An earlier single-ref pattern skipped those
    rows entirely, which drops real material.

    The denominator must resolve to one cell — that is the yield. This is also
    what keeps production-rate formulas out: `ROUNDUP(IF(D30,B13/D30,),)` has
    no top-level division, so it does not parse as a component.
    """
    for match in ROUNDUP_START_RE.finditer(formula):
        open_idx = match.end() - 1
        inner = _balanced_slice(formula, open_idx)
        if inner is None:
            continue
        expr = inner.rstrip()
        while expr.endswith(","):
            expr = expr[:-1].rstrip()
        # `ROUNDUP((<expr>),)` — unwrap a fully parenthesised body
        while expr.startswith("(") and _balanced_slice(expr, 0) == expr[1:-1]:
            expr = expr[1:-1].strip()
        split = _split_top_level_div(expr)
        if not split:
            continue
        numerator, denominator = split
        denominator = denominator.strip()
        while denominator.startswith("(") and denominator.endswith(")"):
            denominator = denominator[1:-1].strip()
        if not CELL_REF_ONLY_RE.match(denominator.replace("$", "")):
            continue
        return numerator.strip(), norm_ref(denominator)
    return None


def refs_in(expr: str):
    """Cell references appearing in an expression, in order, de-duplicated."""
    seen = []
    for m in re.finditer(r"\$?([A-Za-z]{1,3})\$?(\d+)", expr):
        ref = f"{m.group(1).upper()}{m.group(2)}"
        if ref not in seen:
            seen.append(ref)
    return seen


def cell_numeric(cell_xml: str):
    """Numeric <v> of a cell with no t= (or t="n") — a literal or a formula's
    cached result. None for string cells, so a text placeholder like
    '*Enter yield here*' never reads as a number."""
    t = _attr(_opening_tag(cell_xml), "t")
    if t not in (None, "n"):
        return None
    m = re.search(r"<v>([^<]*)</v>", cell_xml)
    if not m or not m.group(1):
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


class Sheet:
    """One pass over the ASSEMBLY sheet, indexed for repeated lookups."""

    F_RE = re.compile(r"<f[^>]*>(.*?)</f>", re.DOTALL)

    def __init__(self, sheet_xml: str, shared_strings: list):
        self.by_row: dict[int, dict[str, dict]] = defaultdict(dict)
        self.text_cells: list[tuple[int, int, str, str]] = []

        for row_num, col_idx, addr, c_text, has_formula in _iter_sheet_cells(sheet_xml):
            text = get_cell_text(c_text, shared_strings)
            formula = ""
            if has_formula:
                m = self.F_RE.search(c_text)
                formula = m.group(1) if m else ""
            self.by_row[row_num][addr.upper()] = {
                "addr": addr.upper(),
                "row": row_num,
                "col_idx": col_idx,
                "text": text,
                "formula": formula,
                "has_formula": has_formula,
                "raw": c_text,
            }
            if text:
                self.text_cells.append((row_num, col_idx, addr.upper(), text))

    def cell(self, addr: str):
        _, row_num = split_ref(addr)
        if row_num is None:
            return None
        return self.by_row.get(row_num, {}).get(norm_ref(addr))

    def numeric_at(self, addr: str):
        cell = self.cell(addr)
        return cell_numeric(cell["raw"]) if cell else None

    def text_at(self, addr: str) -> str:
        cell = self.cell(addr)
        return cell["text"].strip() if cell else ""

    def at(self, row_num: int, col_idx: int):
        return self.by_row.get(row_num, {}).get(f"{index_to_col(col_idx)}{row_num}")

    def find_labels(self, pattern: "re.Pattern", after_row: int = 0):
        """Every (row, col_idx, text) whose text matches, in row order.

        The same label legitimately appears more than once on these sheets —
        "Labor Burden" is both an input in the Labor Cost breakdown and a line
        in the Labor Cost Summary beside it. Callers that want a value must try
        each occurrence rather than trusting the first.
        """
        return [
            (row_num, col_idx, text)
            for row_num, col_idx, _addr, text in sorted(self.text_cells)
            if row_num > after_row and pattern.search(text.strip())
        ]

    def find_label(self, pattern: "re.Pattern", after_row: int = 0):
        """First (row, col_idx, text) whose text matches, scanning in row order."""
        hits = self.find_labels(pattern, after_row)
        return hits[0] if hits else None

    def labelled_value(self, pattern: "re.Pattern", after_row: int = 0):
        """The first readable numeric value belonging to any occurrence of a
        label. Returns (value, row, col_idx) or (None, None, None)."""
        for row_num, col_idx, _text in self.find_labels(pattern, after_row):
            cell = self.value_right_of(row_num, col_idx)
            value = cell_numeric(cell["raw"]) if cell else None
            if value is not None:
                return value, row_num, col_idx
        return None, None, None

    def value_right_of(self, row_num: int, col_idx: int, allow_formula: bool = False):
        """First cell to the right of a label, in the same row, carrying a value.
        Mirrors the adjacency heuristic the Stage 1 scanner already uses."""
        row_cells = sorted(
            (c for c in self.by_row.get(row_num, {}).values() if c["col_idx"] > col_idx),
            key=lambda c: c["col_idx"],
        )
        for cell in row_cells:
            if cell["has_formula"] and not allow_formula:
                continue
            if cell_numeric(cell["raw"]) is not None or cell["text"]:
                return cell
        return None


# ── percentages ────────────────────────────────────────────────────────


def as_rate(value, flags: list, label: str):
    """Workbooks store waste and tax as fractions (0.05) but margins as whole
    percents (22 with a '%' label beside them). Normalise to a fraction, and
    flag the ambiguous middle so review can confirm rather than trust it."""
    if value is None:
        return None
    if value > 1:
        if value > 100:
            flags.append(f"{label}: rate of {value} is out of range, left unscaled")
            return None
        return value / 100.0
    return value


# ── quantity inputs (rule 4) ───────────────────────────────────────────


def extract_quantity_inputs(sheet: Sheet, flags: list):
    """The named quantity inputs of the assembly.

    A quantity block is a "Unit of Measurement" row naming each input column,
    optionally a "Job Quantity" row of entered quantities, optionally a
    "Waste %" row (waste is per input, not per assembly), and a totals row of
    formulas — which is what component formulas actually divide.

    A workbook may have MORE THAN ONE such block, and a second block need not
    have a Job Quantity row at all: Grace's Preprufe sheets carry a
    pile-geometry block (pile count x circumference, its own waste row, a
    derived total) above the ordinary block, and components divide both. Anchor
    on "Unit of Measurement" rather than on "Job Quantity" so those inputs are
    not invisible.

    Every cell address in a block's quantity and total rows is mapped to its
    input, so a component binds by the exact cell its formula references.
    """
    uom_rows = sheet.find_labels(UOM_RE)
    if not uom_rows:
        flags.append("No 'Unit of Measurement' row found — quantity inputs could not be read")
        return [], {}

    inputs: list[dict] = []
    ref_to_input: dict[str, int] = {}

    for block_index, (name_row, label_col, _text) in enumerate(uom_rows):
        # Rows belonging to this block: up to the next block's header, bounded
        # so a malformed sheet cannot run away.
        next_row = uom_rows[block_index + 1][0] if block_index + 1 < len(uom_rows) else None
        limit = min(next_row - 1, name_row + 6) if next_row else name_row + 6

        qty_row = waste_row = total_row = None
        for row_num in range(name_row + 1, limit + 1):
            label = ""
            cell = sheet.at(row_num, label_col)
            if cell:
                label = cell["text"].strip()
            if qty_row is None and JOB_QUANTITY_RE.search(label):
                qty_row = row_num
            elif waste_row is None and WASTE_RE.search(label):
                waste_row = row_num
            elif total_row is None and (
                BLOCK_TOTAL_RE.match(label)
                or (
                    not label
                    and any(c["has_formula"] for c in sheet.by_row.get(row_num, {}).values())
                )
            ):
                total_row = row_num

        # The row that actually carries the entered quantities: the Job
        # Quantity row when there is one, otherwise the totals row (blocks
        # computed from geometry have no entry row).
        value_row = qty_row or total_row
        if value_row is None:
            continue
        if total_row is None:
            total_row = value_row

        for cell in sorted(sheet.by_row.get(value_row, {}).values(), key=lambda c: c["col_idx"]):
            if cell["col_idx"] <= label_col:
                continue
            if cell_numeric(cell["raw"]) is None and not cell["has_formula"]:
                continue
            col_idx = cell["col_idx"]
            col = index_to_col(col_idx)
            name_cell = sheet.at(name_row, col_idx)
            waste_cell = sheet.at(waste_row, col_idx) if waste_row else None
            name = (name_cell["text"].strip() if name_cell else "") or col
            waste = cell_numeric(waste_cell["raw"]) if waste_cell else None

            entry = {
                "seq": len(inputs) + 1,
                "name": name,
                "unit": None,
                "wastePct": as_rate(waste, flags, f"waste for input '{name}'") or 0.0,
                "quantityCell": cell["addr"],
                "totalCell": f"{col}{total_row}",
                "column": col,
                "block": block_index + 1,
                # A quantity cell that is itself a formula is derived from
                # other inputs (Emseal's "Post Stucco Sealant" doubles the
                # joint length). Kept, because components do divide it, but
                # flagged: it is not something an estimator types in.
                "derived": bool(cell["has_formula"]),
            }
            if entry["derived"]:
                flags.append(f"Quantity input '{name}' is computed from another input, not entered")
            inputs.append(entry)
            for row_ref in {value_row, total_row}:
                ref_to_input.setdefault(f"{col}{row_ref}", entry["seq"])

    if not inputs:
        flags.append("Quantity block found but no input columns carried a value")
    return inputs, ref_to_input


# ── materials block (rules 1, 2, 3, 5) ─────────────────────────────────


def resolve_block_columns(sheet: Sheet, header_row: int, header_col: int):
    """Map header text -> column index for the materials block (rule 3).

    Also records, for the packaging and yield roles, that the UNIT string sits
    in the column immediately to the right of the value column. That holds in
    both observed layouts and is why fixed letters are wrong: column F is the
    packaging unit when the block starts at C, and the yield unit when it
    starts at A.
    """
    roles = {}
    for cell in sorted(sheet.by_row.get(header_row, {}).values(), key=lambda c: c["col_idx"]):
        text = cell["text"].strip()
        if not text:
            continue
        for role, pattern in HEADER_ROLES:
            if role in roles:
                continue
            if pattern.match(text):
                roles[role] = cell["col_idx"]
                break
    roles.setdefault("description", header_col)
    return roles


def find_materials_block(sheet: Sheet, flags: list):
    hit = sheet.find_label(MATERIALS_HDR_RE)
    if not hit:
        flags.append("No 'MATERIALS' header found — no components could be read")
        return None
    header_row, header_col, _ = hit

    end_row = None
    for row_num, col_idx, _addr, text in sorted(sheet.text_cells):
        if row_num > header_row and col_idx == header_col and BLOCK_END_RE.match(text.strip()):
            end_row = row_num
            break
    if end_row is None:
        end_row = header_row + 40
        flags.append("Materials block has no closing 'Total' row — scanned a bounded range")
    return header_row, header_col, end_row


def _row_description(sheet: Sheet, row_num: int, col_idx: int) -> str:
    cell = sheet.at(row_num, col_idx)
    if not cell:
        return ""
    text = cell["text"].strip()
    if not text and cell["has_formula"]:
        ref = cell["formula"].strip()
        if CELL_REF_ONLY_RE.match(ref):
            return sheet.text_at(ref)
    return text


def _fallback_component(sheet: Sheet, row_num: int, row_cells: dict, roles: dict, header_col: int):
    """A materials-block row that is clearly a component but whose quantity is
    not `ROUNDUP(quantity / yield)`. Returns a proposal entry with the quantity
    rule flagged for review, or None if the row is not a component at all."""
    quantity_col = roles.get("quantity")
    if quantity_col is None:
        return None
    qty_cell = sheet.at(row_num, quantity_col)
    if not qty_cell or not qty_cell["has_formula"]:
        return None

    code = None
    for cell in row_cells.values():
        if cell["has_formula"]:
            m = CODE_LOOKUP_RE.search(cell["formula"])
            if m:
                code = sheet.text_at(norm_ref(m.group(1))) or None
                break
    if code is None:
        left = [
            c
            for c in row_cells.values()
            if c["col_idx"] < header_col and c["text"].strip() and not c["has_formula"]
        ]
        if left:
            code = min(left, key=lambda c: c["col_idx"])["text"].strip()
    if code is None:
        return None  # no code and no lookup — not a component line

    formula = qty_cell["formula"].strip()
    if CELL_REF_ONLY_RE.match(formula):
        rule = f"quantity copies {norm_ref(formula)}"
    else:
        rule = "quantity comes from a helper cell elsewhere in the workbook"

    return {
        "sourceRow": row_num,
        "quantityInputSeq": None,
        "quantityBasis": formula,
        "description": _row_description(sheet, row_num, roles.get("description", header_col)) or None,
        "productCode": code,
        "unitPrice": None,
        "coverageYield": None,
        "yieldUnit": None,
        "packagingUnit": None,
        "isOptional": False,
        "flags": [f"{rule}, not a coverage yield — set its quantity rule before pricing"],
    }


def extract_components(sheet: Sheet, block, col_to_input, flags: list):
    header_row, header_col, end_row = block
    roles = resolve_block_columns(sheet, header_row, header_col)
    components = []

    for row_num in range(header_row + 1, end_row):
        row_cells = sheet.by_row.get(row_num, {})
        if not row_cells:
            continue

        qty_cell = None
        parsed = None
        for cell in sorted(row_cells.values(), key=lambda c: c["col_idx"]):
            if not cell["has_formula"]:
                continue
            parsed = parse_quantity_formula(cell["formula"])
            if parsed:
                qty_cell = cell
                break
        if parsed is None:
            # Not yield-driven. Some real component rows take their quantity
            # from elsewhere: a tape that ships one-to-one with the membrane
            # above it (`I19=I18`), or an initiator counted per pail of another
            # product (`I20=M14`). They are components — they have a code, a
            # price and a line total — so they are emitted with no yield and a
            # flag, rather than dropped for not matching the expected shape.
            fallback = _fallback_component(sheet, row_num, row_cells, roles, header_col)
            if fallback:
                fallback["seq"] = len(components) + 1
                components.append(fallback)
            continue

        row_flags = []
        basis_expr, yield_ref = parsed

        # --- which named quantity input does this component divide? ---
        # The numerator may reference several cells (a base area plus a collar
        # area, a count times a circumference). Resolve every reference and
        # bind to the input it lands on; when it lands on more than one, bind
        # to the first and say so rather than silently picking.
        basis_refs = refs_in(basis_expr)
        matched = []
        for ref in basis_refs:
            seq = col_to_input.get(ref)
            if seq is not None and seq not in matched:
                matched.append(seq)
        if not matched:
            # Fall back to column: some sheets divide a different row of the
            # same input column.
            for ref in basis_refs:
                ref_col, _ = split_ref(ref)
                for known_ref, seq in col_to_input.items():
                    if split_ref(known_ref)[0] == ref_col and seq not in matched:
                        matched.append(seq)
                        break
                if matched:
                    break

        quantity_input_seq = matched[0] if matched else None
        if quantity_input_seq is None:
            row_flags.append(
                f"quantity is based on {basis_expr.strip()}, which is not one of the inputs"
            )
        elif len(matched) > 1:
            names = ", ".join(str(s) for s in matched)
            row_flags.append(
                f"quantity combines inputs {names}; bound to the first — check before pricing"
            )

        # --- yield ---
        coverage_yield = sheet.numeric_at(yield_ref)
        if coverage_yield is None:
            placeholder = sheet.text_at(yield_ref)
            if placeholder and YIELD_PLACEHOLDER_RE.search(placeholder):
                row_flags.append("yield is blank in the workbook and must be entered per project")
            else:
                row_flags.append(f"yield at {yield_ref} could not be read")
        elif coverage_yield <= 0:
            row_flags.append(f"yield at {yield_ref} is {coverage_yield}")
            coverage_yield = None

        # --- optional / gated (rule 2) ---
        is_optional = not BARE_ROUNDUP_RE.match(qty_cell["formula"].strip())
        if is_optional:
            row_flags.append("quantity is conditional in the workbook; imported as optional")

        # --- price source (rule 1) ---
        product_code = None
        unit_price = None
        code_ref = None
        for cell in row_cells.values():
            if cell["has_formula"]:
                m = CODE_LOOKUP_RE.search(cell["formula"])
                if m:
                    code_ref = norm_ref(m.group(1))
                    break
        if code_ref:
            product_code = sheet.text_at(code_ref) or None
            if not product_code:
                row_flags.append(f"price lookup keys on {code_ref}, which is empty")
        else:
            # No lookup. A code may still sit to the LEFT of the block's
            # description column — that is the flattened-lookup case, which the
            # scoping detector dropped entirely.
            left = [
                c
                for c in row_cells.values()
                if c["col_idx"] < header_col and c["text"].strip() and not c["has_formula"]
            ]
            if left:
                product_code = min(left, key=lambda c: c["col_idx"])["text"].strip()
                row_flags.append(
                    "price lookup was replaced by a pasted value in the workbook; "
                    "the code was kept and will reprice from the product list"
                )
            else:
                cost_col = roles.get("cost")
                cost_cell = sheet.at(row_num, cost_col) if cost_col else None
                unit_price = cell_numeric(cost_cell["raw"]) if cost_cell else None
                if unit_price is None:
                    row_flags.append("no product code and no price could be read")
                else:
                    row_flags.append("hand-priced in the workbook; imported as a fixed price")

        # --- description, packaging, yield unit (rules 3 and 5) ---
        description = _row_description(sheet, row_num, roles.get("description", header_col))

        def unit_right_of(role: str):
            col_idx = roles.get(role)
            if col_idx is None:
                return None
            cell = sheet.at(row_num, col_idx + 1)
            return (cell["text"].strip() or None) if cell else None

        components.append(
            {
                "seq": len(components) + 1,
                "sourceRow": row_num,
                "quantityInputSeq": quantity_input_seq,
                "quantityBasis": basis_expr.strip(),
                "description": description or None,
                "productCode": product_code,
                "unitPrice": unit_price,
                "coverageYield": coverage_yield,
                "yieldUnit": unit_right_of("yield"),
                "packagingUnit": unit_right_of("packaging"),
                "isOptional": is_optional,
                "flags": row_flags,
            }
        )

    if not components:
        flags.append("Materials block found but no component rows matched a quantity formula")
    return components


# ── labor, margins, material adjustments ───────────────────────────────


def extract_labor(sheet: Sheet, flags: list):
    labor = {"dayRatePerMan": None, "crewSize": None, "laborBurdenPct": None, "productionRates": []}

    for key, pattern in (
        ("dayRatePerMan", DAY_RATE_RE),
        ("crewSize", CREW_SIZE_RE),
        ("laborBurdenPct", LABOR_BURDEN_RE),
    ):
        if not sheet.find_labels(pattern):
            flags.append(f"{key} label not found")
            continue
        value, _row, _col = sheet.labelled_value(pattern)
        if value is None:
            flags.append(f"{key} label found but its value cell is empty")
            continue
        if key == "laborBurdenPct":
            labor[key] = as_rate(value, flags, key)
        elif key == "crewSize":
            labor[key] = int(value) if float(value).is_integer() else value
        else:
            labor[key] = value

    hdr = sheet.find_label(PROD_RATE_HDR_RE)
    if hdr:
        hdr_row, hdr_col, _ = hdr
        for row_num in range(hdr_row + 1, hdr_row + 25):
            cells = sheet.by_row.get(row_num, {})
            if not cells:
                continue
            # The block's closing "Total" / "Day(s) required" label does NOT
            # sit in the header's own column (Aquafin heads the block at C28
            # and closes it at E33), so the terminator is looked for in any
            # column. Without this the scan runs on into the labor and margin
            # blocks and reads their inputs as production rates.
            if any(
                PROD_RATE_END_RE.match(c["text"].strip())
                for c in cells.values()
                if c["text"].strip()
            ):
                break
            label = _row_description(sheet, row_num, hdr_col)
            rate_cell = sheet.at(row_num, hdr_col + 1)
            rate = cell_numeric(rate_cell["raw"]) if rate_cell and not rate_cell["has_formula"] else None
            if rate is None:
                continue
            unit_cell = sheet.at(row_num, hdr_col + 2)
            labor["productionRates"].append(
                {
                    "description": label or None,
                    "ratePerDay": rate,
                    "unit": (unit_cell["text"].strip() or None) if unit_cell else None,
                    "sourceRow": row_num,
                }
            )
    else:
        flags.append("Production rate breakdown not found")

    return labor


def extract_margin_chain(sheet: Sheet, flags: list):
    """The ordered divide-through chain (Safety, Over Head, Profit).

    Rates are stored as WHOLE PERCENTS here (2, 22, 20 beside a '%' label),
    unlike waste and tax which are fractions in the same sheet.
    """
    hit = sheet.find_label(MARGINS_HDR_RE)
    if not hit:
        flags.append("Margins block not found")
        return [], None
    hdr_row, hdr_col, _ = hit

    chain = []
    for row_num in range(hdr_row + 1, hdr_row + 15):
        label_cell = sheet.at(row_num, hdr_col)
        if not label_cell or not label_cell["text"].strip():
            continue
        label = label_cell["text"].strip()
        if BLOCK_END_RE.match(label):
            break
        rate_cell = sheet.at(row_num, hdr_col + 1)
        rate = cell_numeric(rate_cell["raw"]) if rate_cell and not rate_cell["has_formula"] else None
        if rate is None:
            continue
        normalised = as_rate(rate, flags, f"margin '{label}'")
        if normalised is not None:
            chain.append({"name": label, "rate": normalised})

    if not chain:
        flags.append("Margins block found but no rates could be read")

    # Insurance sits below the chain with its own base cell and is applied
    # differently per workbook. Captured, never folded into the chain.
    insurance_pct = None
    ins_hit = sheet.find_label(INSURANCE_RE, after_row=hdr_row)
    if ins_hit:
        for row_num in range(ins_hit[0], ins_hit[0] + 5):
            label_cell = sheet.at(row_num, ins_hit[1])
            if not label_cell or "margin" not in label_cell["text"].lower():
                continue
            rate_cell = sheet.at(row_num, ins_hit[1] + 1)
            rate = cell_numeric(rate_cell["raw"]) if rate_cell else None
            insurance_pct = as_rate(rate, flags, "insurance margin")
            break
        if insurance_pct is None:
            flags.append("Insurance block found but its margin rate could not be read")
    return chain, insurance_pct


def extract_material_adjustments(sheet: Sheet, block, flags: list):
    """Escalation, surcharge and tax sit just below the materials block."""
    result = {"escalationPct": None, "surchargePct": None, "taxPct": None}
    if block is None:
        return result
    _header_row, header_col, end_row = block
    for key, pattern in (
        ("escalationPct", ESCALATION_RE),
        ("surchargePct", SURCHARGE_RE),
        ("taxPct", TAX_RE),
    ):
        value, row_num, _col = sheet.labelled_value(pattern, after_row=end_row - 1)
        if value is None or row_num is None or row_num > end_row + 12:
            flags.append(f"{key} not found below the materials block")
            continue
        result[key] = as_rate(value, flags, key)
    return result


# ── top level ──────────────────────────────────────────────────────────


def load_sheet(path: Path):
    with zipfile.ZipFile(path, "r") as zin:
        names = zin.namelist()
        if "xl/workbook.xml" not in names:
            raise ValueError("not a valid xlsx (missing xl/workbook.xml)")
        workbook_xml = zin.read("xl/workbook.xml").decode("utf-8", errors="replace")
        rels_xml = zin.read("xl/_rels/workbook.xml.rels").decode("utf-8", errors="replace")
        sheet_path = sheet_name_to_path(workbook_xml, rels_xml, ASSEMBLY_SHEET_NAME)
        if sheet_path not in names:
            raise ValueError(f"no {ASSEMBLY_SHEET_NAME} sheet")
        sheet_xml = zin.read(sheet_path).decode("utf-8", errors="replace")
        shared_strings = []
        if "xl/sharedStrings.xml" in names:
            shared_strings = parse_shared_strings(
                zin.read("xl/sharedStrings.xml").decode("utf-8", errors="replace")
            )
    return Sheet(sheet_xml, shared_strings)


def extract_assembly(path: Path) -> dict:
    sheet = load_sheet(path)
    flags: list[str] = []

    quantity_inputs, col_to_input = extract_quantity_inputs(sheet, flags)
    block = find_materials_block(sheet, flags)
    components = extract_components(sheet, block, col_to_input, flags) if block else []
    labor = extract_labor(sheet, flags)
    margin_chain, insurance_pct = extract_margin_chain(sheet, flags)
    adjustments = extract_material_adjustments(sheet, block, flags)

    # Inputs nothing divides are usually derived totals sitting in the same row
    # (e.g. a "Total Floor+Walls" column). Reported, not removed — review
    # decides, because removing a real input silently is the worse failure.
    used = {c["quantityInputSeq"] for c in components}
    for entry in quantity_inputs:
        if entry["seq"] not in used:
            flags.append(f"Quantity input '{entry['name']}' has no components")

    proposal = {
        "sourceFile": path.name,
        "name": path.stem,
        "quantityInputs": quantity_inputs,
        "components": components,
        "dayRatePerMan": labor["dayRatePerMan"],
        "crewSize": labor["crewSize"],
        "laborBurdenPct": labor["laborBurdenPct"],
        "productionRates": labor["productionRates"],
        "marginChain": margin_chain,
        "insuranceMarginPct": insurance_pct,
        "escalationPct": adjustments["escalationPct"],
        "surchargePct": adjustments["surchargePct"],
        "taxPct": adjustments["taxPct"],
        "flags": flags,
    }
    proposal["componentFlagCount"] = sum(len(c["flags"]) for c in components)
    proposal["isClean"] = not flags and proposal["componentFlagCount"] == 0
    return proposal


def main() -> None:
    args = sys.argv[1:]
    if args and args[0] == "--selftest":
        from assembly_extract_selftest import run_selftest  # noqa: PLC0415

        sys.exit(0 if run_selftest() else 1)

    if len(args) != 1:
        print(json.dumps({"success": False, "error": "Usage: assembly_extract.py <src.xlsx>"}))
        sys.exit(1)

    try:
        proposal = extract_assembly(Path(args[0]))
    except Exception as exc:  # noqa: BLE001 - CLI boundary, report every failure as JSON
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)

    print(json.dumps({"success": True, "proposal": proposal}))


if __name__ == "__main__":
    main()
