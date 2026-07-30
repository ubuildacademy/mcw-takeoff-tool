#!/usr/bin/env python3
"""
Self-test suite for assembly_extract.py. Run via `assembly_extract.py --selftest`.

Every fixture here is SYNTHETIC and built in a temp directory at run time. Real
MCW assembly workbooks contain confidential pricing and must never be committed
as test data — but each fixture reproduces a sheet shape that was measured in
the live library, and the comment on each says which one and how common it is.
"""
from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from assembly_write import _make_xlsx  # noqa: E402
from assembly_extract import extract_assembly  # noqa: E402
from xml.sax.saxutils import escape as xml_escape  # noqa: E402


def cell(addr: str, value) -> str:
    """A worksheet cell. Numbers become <v>, strings inline text, and a value
    given as ('=', formula) becomes a formula cell with a cached result."""
    if isinstance(value, tuple) and value and value[0] == "=":
        cached = f"<v>{value[2]}</v>" if len(value) > 2 else ""
        return f'<c r="{addr}"><f>{xml_escape(value[1])}</f>{cached}</c>'
    if isinstance(value, (int, float)):
        return f'<c r="{addr}"><v>{value}</v></c>'
    return f'<c r="{addr}" t="inlineStr"><is><t>{xml_escape(str(value))}</t></is></c>'


def sheet_xml(cells: dict) -> str:
    """Builds a worksheet from {cellAddress: value}, grouped into rows."""
    rows: dict[int, list] = {}
    for addr, value in cells.items():
        row_num = int("".join(ch for ch in addr if ch.isdigit()))
        rows.setdefault(row_num, []).append((addr, value))
    body = ""
    for row_num in sorted(rows):
        entries = sorted(rows[row_num], key=lambda kv: (len(kv[0]), kv[0]))
        body += f'<row r="{row_num}">' + "".join(cell(a, v) for a, v in entries) + "</row>"
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{body}</sheetData></worksheet>"
    )


def common_tail(base_row: int) -> dict:
    """Escalation/tax, labor and margins, in the arrangement every measured
    workbook shares. `base_row` is the materials block's Total row."""
    r = base_row
    return {
        f"C{r + 1}": "Price Escalation factor",
        f"D{r + 1}": 0.03,
        f"C{r + 2}": "Surcharge",
        f"D{r + 2}": 0,
        f"C{r + 3}": "Tax",
        f"D{r + 3}": 0.07,
        f"C{r + 5}": "Production Rate  breakdown",
        f"D{r + 5}": "Rate per Day",
        f"E{r + 5}": "Unit of Rate",
        f"C{r + 6}": "Pressure Cleaning",
        f"D{r + 6}": 5000,
        f"E{r + 6}": "SF/Day",
        f"E{r + 7}": "Total",
        # "Labor Burden" appears twice on the real sheets — once as an input,
        # once as a summary line whose value cell is a formula. The summary
        # copy comes first in row order, so reading the first match finds an
        # empty value. This fixture keeps both.
        f"F{r + 8}": "Labor Burden",
        f"G{r + 8}": ("=", "G100*D101"),
        f"C{r + 9}": "Day rate per man",
        f"D{r + 9}": 224,
        f"C{r + 10}": "How many Men on the job",
        f"D{r + 10}": 2,
        f"C{r + 11}": "Labor Burden",
        f"D{r + 11}": 0.35,
        # Margins are WHOLE PERCENTS here while waste and tax above are
        # fractions — the extractor has to normalise one and not the other.
        f"C{r + 13}": "Margins",
        f"D{r + 13}": "Percentage",
        f"C{r + 14}": "Safety",
        f"D{r + 14}": 2,
        f"E{r + 14}": "%",
        f"C{r + 15}": "Over Head",
        f"D{r + 15}": 22,
        f"E{r + 15}": "%",
        f"C{r + 16}": "Profit",
        f"D{r + 16}": 20,
        f"E{r + 16}": "%",
        f"C{r + 17}": "Total",
        f"C{r + 18}": "Insurance",
        f"C{r + 19}": "Margin for Insurance",
        f"D{r + 19}": 15,
    }


# ── fixtures ───────────────────────────────────────────────────────────


def fixture_majority() -> dict:
    """The 218-workbook layout: block header in column C, product code in A,
    packaging value in E with its unit in F, yield in G with its unit in H.

    Rows 19/20 are the two-coat case — the same product code at two different
    yields. Row 21 is the flattened-lookup case: a real component whose price
    was pasted as a value, which a lookup-anchored detector drops silently.
    """
    cells = {
        "C12": "Unit of Measurement",
        "D12": "SF",
        "C13": "Job Quantity ",
        "D13": 500,
        "C14": "Waste %",
        "D14": 0.05,
        "C15": "TOTAL",
        "D15": ("=", "D13+(D13*D14)", 525),
        "B18": "CPC Description:",
        "C18": "MATERIALS :",
        "D18": "Cost",
        "E18": "Packaging",
        "G18": "Yield",
        "I18": "Quantity",
        "J18": "Total",
    }
    for row, (code, desc, yield_value) in {
        19: ("AQU2KMG46", "Aquafin 2K/M first coat", 125),
        20: ("AQU2KMG46", "Aquafin 2K/M second coat", 90),
    }.items():
        cells.update(
            {
                f"A{row}": code,
                f"B{row}": (
                    "=",
                    f"IFERROR(INDEX(INDIRECT(\"'Pricing DB'!c:c\"), "
                    f"MATCH(ASSEMBLY!A{row}, INDIRECT(\"'Pricing DB'!B:B\"), 0)), \"\")",
                ),
                f"C{row}": desc,
                f"D{row}": (
                    "=",
                    f"IFERROR(INDEX(INDIRECT(\"'Pricing DB'!E:E\"), "
                    f"MATCH(ASSEMBLY!A{row}, INDIRECT(\"'Pricing DB'!B:B\"), 0)), \"\")",
                ),
                f"E{row}": 77,
                f"F{row}": "lb/bag",
                f"G{row}": yield_value,
                f"H{row}": "SF/bag",
                f"I{row}": ("=", f"ROUNDUP(D15/G{row},)", 5),
                f"J{row}": ("=", f"I{row}*D{row}", 231),
            }
        )
    cells.update(
        {
            "A21": "UCPGRNSLJC2040SS",
            "B21": "COV GRANU 2040 GA 50LB",
            "C21": "Granusil 2040",
            "D21": 14.58,
            "E21": 50,
            "F21": "lb/bag",
            "G21": 350,
            "H21": "SF/bag",
            "I21": ("=", "ROUNDUP(D15/G21,)", 2),
            "J21": 29.16,
            "C22": "Total",
        }
    )
    cells.update(common_tail(22))
    return cells


def fixture_shifted() -> dict:
    """The 13-workbook shifted layout: block header in column A, packaging in
    C with its unit in D, yield in E with its unit in F.

    Column F here is the YIELD unit, where the majority layout has the
    packaging unit — which is why columns are resolved by header text. Also
    covers six named quantity inputs, a derived input, an IF-wrapped
    (optional) quantity, and hand-priced components with no product code.
    """
    cells = {
        "A12": "Unit of Measurement",
        "B12": "Joint LF",
        "C12": "Cover plate LF",
        "D12": "Inside corner (Each)",
        "A13": "Job Quantity ",
        "B13": 100,
        "C13": 40,
        "D13": ("=", "B13*2", 200),
        "A14": "Waste %",
        "B14": 0.05,
        "C14": 0.05,
        "D14": 0.01,
        "A15": "TOTAL",
        "B15": ("=", "B13+(B13*B14)", 105),
        "C15": ("=", "C13+(C13*C14)", 42),
        "D15": ("=", "D13+(D13*D14)", 202),
        "A17": "MATERIALS :",
        "B17": "Cost",
        "C17": "Packaging",
        "E17": "Yield",
        "G17": "Quantity",
        "H17": "Total",
        "A18": "EJ seal",
        "B18": 12.5,
        "C18": 1,
        "D18": "Piece",
        "E18": 4,
        "F18": "LF/Each",
        "G18": ("=", 'IFERROR(ROUNDUP(B15/E18,),"-")', 27),
        "H18": ("=", 'IFERROR(G18*B18,"-")', 337),
        "A19": "Inside corner",
        "B19": 30,
        "C19": 1,
        "D19": "Piece",
        "E19": 1,
        "F19": "Corner",
        "G19": ("=", 'IFERROR(ROUNDUP(D15/E19,),"-")', 202),
        "H19": ("=", "G19*B19", 6060),
        "A20": "Total",
    }
    cells.update(common_tail(20))
    return cells


def fixture_multi_block() -> dict:
    """Two quantity blocks, the second computed from geometry with no "Job
    Quantity" row of its own (the Grace Preprufe shape), plus a component whose
    numerator is a COMPOUND expression and one whose quantity merely copies the
    row above (a tape that ships one-to-one with the membrane).
    """
    cells = {
        "C10": "Unit of Measurement",
        "D10": "Preprufe 300R Piles",
        "C11": "Waste %",
        "D11": 0.05,
        "D12": ("=", "($D$8*I8)+(($D$8*I8)*D11)", 1000),
        "C15": "Unit of Measurement",
        "D15": "Preprufe 300R+",
        "E15": "BLM",
        "C16": "Job Quantity ",
        "D16": 18553,
        "E16": 3374,
        "C17": "Waste %",
        "D17": 0.17,
        "E17": 0.07,
        "C18": "TOTAL",
        "D18": ("=", "D16+(D16*D17)", 21707),
        "E18": ("=", "E16+(E16*E17)", 3610),
        "B20": "CPC Description:",
        "C20": "MATERIALS :",
        "D20": "Cost",
        "E20": "Packaging",
        "G20": "Yield",
        "I20": "Quantity",
        "J20": "Total",
        "A21": "GRAP300RP102",
        "B21": (
            "=",
            "IFERROR(INDEX(INDIRECT(\"'Pricing DB'!c:c\"), "
            "MATCH(ASSEMBLY!A21, INDIRECT(\"'Pricing DB'!B:B\"), 0)), \"\")",
        ),
        "C21": "Preprufe 300R+",
        "D21": (
            "=",
            "IFERROR(INDEX(INDIRECT(\"'Pricing DB'!E:E\"), "
            "MATCH(ASSEMBLY!A21, INDIRECT(\"'Pricing DB'!B:B\"), 0)), \"\")",
        ),
        "F21": "roll",
        "G21": 390,
        "H21": "SF/roll",
        "I21": ("=", "ROUNDUP((D18+D12)/G21,)", 59),
        "J21": ("=", "I21*D21", 1000),
        "A22": "GRAPTHC",
        "B22": (
            "=",
            "IFERROR(INDEX(INDIRECT(\"'Pricing DB'!c:c\"), "
            "MATCH(ASSEMBLY!A22, INDIRECT(\"'Pricing DB'!B:B\"), 0)), \"\")",
        ),
        "C22": "Preprufe Tape HC",
        "D22": (
            "=",
            "IFERROR(INDEX(INDIRECT(\"'Pricing DB'!E:E\"), "
            "MATCH(ASSEMBLY!A22, INDIRECT(\"'Pricing DB'!B:B\"), 0)), \"\")",
        ),
        "F22": "roll",
        "G22": 45,
        "H22": "LF/roll",
        "I22": ("=", "I21", 59),
        "J22": 3543.8,
        "A23": "GRABLMG15",
        "B23": (
            "=",
            "IFERROR(INDEX(INDIRECT(\"'Pricing DB'!c:c\"), "
            "MATCH(ASSEMBLY!A23, INDIRECT(\"'Pricing DB'!B:B\"), 0)), \"\")",
        ),
        "C23": "Bituthene Liquid Membrane",
        "D23": (
            "=",
            "IFERROR(INDEX(INDIRECT(\"'Pricing DB'!E:E\"), "
            "MATCH(ASSEMBLY!A23, INDIRECT(\"'Pricing DB'!B:B\"), 0)), \"\")",
        ),
        "F23": "gal/pail",
        "G23": ("=", "E23/0.1389", 30),
        "H23": "SF/pail",
        "I23": ("=", "IF($K$23=VALUES!AA1,IFERROR(ROUNDUP(E18/G23,),0),0)", 120),
        "J23": ("=", "I23*D23", 500),
        "K23": "Include membrane",
        "C24": "Total",
    }
    cells.update(common_tail(24))
    return cells


# ── assertions ─────────────────────────────────────────────────────────


class Checker:
    def __init__(self):
        self.failures: list[str] = []
        self.checks = 0

    def check(self, condition, message: str):
        self.checks += 1
        if not condition:
            self.failures.append(message)

    def equal(self, actual, expected, message: str):
        self.check(actual == expected, f"{message}: expected {expected!r}, got {actual!r}")


def build(tmp_dir: str, name: str, cells: dict) -> Path:
    return Path(_make_xlsx(tmp_dir, name, {"ASSEMBLY": sheet_xml(cells)}))


def check_majority(c: Checker, tmp_dir: str) -> None:
    p = build(tmp_dir, "majority.xlsx", fixture_majority())
    r = extract_assembly(p)

    c.equal(len(r["quantityInputs"]), 1, "majority: quantity input count")
    c.equal(r["quantityInputs"][0]["name"], "SF", "majority: input name")
    c.equal(r["quantityInputs"][0]["wastePct"], 0.05, "majority: waste stays a fraction")

    c.equal(len(r["components"]), 3, "majority: component count")
    first, second, flattened = r["components"]

    # The two-coat case: same code, different yields, both survive.
    c.equal(first["productCode"], "AQU2KMG46", "majority: first code")
    c.equal(second["productCode"], "AQU2KMG46", "majority: second code")
    c.equal(first["coverageYield"], 125.0, "majority: first yield")
    c.equal(second["coverageYield"], 90.0, "majority: second yield")

    # Columns resolved by header: packaging unit from F, yield unit from H.
    c.equal(first["packagingUnit"], "lb/bag", "majority: packaging unit")
    c.equal(first["yieldUnit"], "SF/bag", "majority: yield unit")

    # The flattened-lookup row is kept, with its code, and flagged.
    c.equal(flattened["productCode"], "UCPGRNSLJC2040SS", "majority: flattened row code")
    c.equal(flattened["coverageYield"], 350.0, "majority: flattened row yield")
    c.check(
        any("pasted value" in f for f in flattened["flags"]),
        "majority: flattened row should be flagged as a pasted price",
    )
    c.check(
        all(not f["flags"] for f in (first, second)),
        f"majority: coat rows should be clean, got {first['flags']} / {second['flags']}",
    )

    # Margins are whole percents in the sheet and fractions in the proposal;
    # waste and tax were already fractions and must not be scaled again.
    c.equal(
        r["marginChain"],
        [
            {"name": "Safety", "rate": 0.02},
            {"name": "Over Head", "rate": 0.22},
            {"name": "Profit", "rate": 0.2},
        ],
        "majority: margin chain",
    )
    c.equal(r["taxPct"], 0.07, "majority: tax")
    c.equal(r["escalationPct"], 0.03, "majority: escalation")
    c.equal(r["insuranceMarginPct"], 0.15, "majority: insurance margin")

    c.equal(r["dayRatePerMan"], 224.0, "majority: day rate")
    c.equal(r["crewSize"], 2, "majority: crew size is an integer")
    # The duplicate "Labor Burden" label whose value cell is a formula must not
    # shadow the real input.
    c.equal(r["laborBurdenPct"], 0.35, "majority: labor burden")
    c.equal(len(r["productionRates"]), 1, "majority: production rate rows")


def check_shifted(c: Checker, tmp_dir: str) -> None:
    p = build(tmp_dir, "shifted.xlsx", fixture_shifted())
    r = extract_assembly(p)

    names = [i["name"] for i in r["quantityInputs"]]
    c.equal(names, ["Joint LF", "Cover plate LF", "Inside corner (Each)"], "shifted: input names")
    c.equal(
        [i["wastePct"] for i in r["quantityInputs"]],
        [0.05, 0.05, 0.01],
        "shifted: waste is per input",
    )
    c.check(r["quantityInputs"][2]["derived"], "shifted: computed input marked derived")

    c.equal(len(r["components"]), 2, "shifted: component count")
    first, second = r["components"]

    # Column F is the YIELD unit in this layout, not the packaging unit.
    c.equal(first["packagingUnit"], "Piece", "shifted: packaging unit from column D")
    c.equal(first["yieldUnit"], "LF/Each", "shifted: yield unit from column F")

    # Hand-priced: no code, price read from the Cost column.
    c.equal(first["productCode"], None, "shifted: no product code")
    c.equal(first["unitPrice"], 12.5, "shifted: literal price")
    c.check(
        any("hand-priced" in f for f in first["flags"]),
        "shifted: hand-priced row should be flagged",
    )

    # Each component binds to the input its own formula divides.
    c.equal(first["quantityInputSeq"], 1, "shifted: first binds to Joint LF")
    c.equal(second["quantityInputSeq"], 3, "shifted: second binds to Inside corner")

    # IFERROR-wrapped quantity means optional, not absent.
    c.check(first["isOptional"], "shifted: IFERROR-wrapped quantity is optional")


def check_multi_block(c: Checker, tmp_dir: str) -> None:
    p = build(tmp_dir, "multi_block.xlsx", fixture_multi_block())
    r = extract_assembly(p)

    names = [i["name"] for i in r["quantityInputs"]]
    c.check(
        "Preprufe 300R Piles" in names,
        f"multi-block: geometry block with no Job Quantity row must be read, got {names}",
    )
    c.equal(names, ["Preprufe 300R Piles", "Preprufe 300R+", "BLM"], "multi-block: input names")
    # The geometry block has no Job Quantity row, so its value cell IS the
    # block total — which already has waste folded in. Reporting the waste
    # again would apply it twice, so it is reported as zero for that input.
    c.equal(
        [i["wastePct"] for i in r["quantityInputs"]], [0.0, 0.17, 0.07], "multi-block: waste"
    )

    c.equal(len(r["components"]), 3, "multi-block: component count")
    compound, copied, gated = r["components"]

    # A compound numerator (D18+D12) divides the SUM of both inputs, so both
    # are recorded — binding to only the first under-buys the component.
    c.equal(compound["quantityInputSeq"], 2, "multi-block: compound numerator's primary input")
    c.equal(
        compound["additionalQuantityInputSeqs"], [1], "multi-block: compound numerator's other input"
    )
    c.check(
        any("sum of inputs" in f for f in compound["flags"]),
        f"multi-block: compound numerator should be flagged, got {compound['flags']}",
    )

    # A row whose quantity copies the row above is a component with no yield.
    c.equal(copied["productCode"], "GRAPTHC", "multi-block: copied-quantity row kept")
    c.equal(copied["coverageYield"], None, "multi-block: copied-quantity row has no yield")
    c.check(
        any("copies" in f for f in copied["flags"]),
        f"multi-block: copied-quantity row should be flagged, got {copied['flags']}",
    )

    # IF-gated quantity, and a yield that is itself a formula.
    c.check(gated["isOptional"], "multi-block: IF-gated component is optional")
    c.equal(gated["coverageYield"], 30.0, "multi-block: yield read from a formula's cached value")
    c.equal(gated["quantityInputSeq"], 3, "multi-block: gated component binds to BLM")


def check_implausible_crew(c: Checker, tmp_dir: str) -> None:
    """`Preprufe 300R+ for piles.xlsx` holds 224 in the crew cell — the day rate
    typed one row too low — and its own labor total is ~29% of the job as a
    result. Importing that verbatim would price a 224-man crew quietly, so an
    absurd crew falls back to the library's modal 2 and is flagged."""
    cells = fixture_majority()
    crew_row = next(
        addr for addr, value in cells.items() if value == 'How many Men on the job'
    )
    row_num = int(''.join(ch for ch in crew_row if ch.isdigit()))
    cells[f'D{row_num}'] = 224

    r = extract_assembly(build(tmp_dir, 'bad_crew.xlsx', cells))
    c.equal(r['crewSize'], 2, 'implausible crew falls back to the modal crew')
    c.check(
        any('implausible' in f for f in r['flags']),
        f"implausible crew should be flagged, got {r['flags']}",
    )

    # A crew of 3 is real and must survive untouched.
    cells[f'D{row_num}'] = 3
    r = extract_assembly(build(tmp_dir, 'ok_crew.xlsx', cells))
    c.equal(r['crewSize'], 3, 'a plausible crew is left alone')
    c.check(
        not any('implausible' in f for f in r['flags']),
        'a plausible crew must not be flagged',
    )


def check_rejects_non_components(c: Checker, tmp_dir: str) -> None:
    """A production-rate row divides a quantity too — `ROUNDUP(IF(D30,B13/D30,),)`
    — but is not a component. It has no top-level division, so it must not
    parse as one."""
    from assembly_extract import parse_quantity_formula

    c.equal(
        parse_quantity_formula("ROUNDUP(IF(D30,B13/D30,),)"),
        None,
        "production-rate formula must not parse as a component quantity",
    )
    c.equal(
        parse_quantity_formula("ROUNDUP(D15/G19,)"),
        ("D15", "G19"),
        "bare quantity formula",
    )
    c.equal(
        parse_quantity_formula("ROUNDUP((D23+D17)/G27,)"),
        ("(D23+D17)", "G27"),
        "compound numerator",
    )
    c.equal(
        parse_quantity_formula("ROUNDUP(((I11*D11)/G27),)"),
        ("(I11*D11)", "G27"),
        "fully parenthesised body",
    )
    c.equal(
        parse_quantity_formula("IF(E15+D15<G19,0,ROUNDUP(D15/G20,))"),
        ("D15", "G20"),
        "gated quantity formula",
    )
    c.equal(parse_quantity_formula("SUM(J19:J20)"), None, "unrelated formula")


def run_selftest() -> bool:
    tmp_dir = tempfile.mkdtemp(prefix="assembly_extract_selftest_")
    c = Checker()
    try:
        check_majority(c, tmp_dir)
        check_shifted(c, tmp_dir)
        check_multi_block(c, tmp_dir)
        check_implausible_crew(c, tmp_dir)
        check_rejects_non_components(c, tmp_dir)
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
