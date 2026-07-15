#!/usr/bin/env python3
"""
assembly_write.py — surgical OOXML cell writer for assembly workbooks
(Stage 1 workbook bridge, see docs/ASSEMBLIES_DESIGN.md).

Pure stdlib (zipfile + regex-scoped XML surgery). NEVER openpyxl for
writing — it mangles formatting/charts on the real MCW workbooks, and is
broken in the current venv anyway. This mirrors the technique the MCW
Pricing Manager already proves out for its own "Pricing DB" sheet rewrite.

CLI:
    assembly_write.py <src.xlsx> <dest.xlsx> <cells_json>

    cells_json: JSON object of sheetName -> {cellAddress: value}. `value`
    is written as an inline number (JSON number) or an inlineStr (JSON
    string) — the workbook's own type at that address is not consulted;
    the caller decides.

Only the targeted <row>/<c> elements inside each touched worksheet's
<sheetData> are located and replaced via regex-scoped string surgery — not
a full ElementTree parse/reserialize of the sheet — so every other byte of
the worksheet (styles, drawings, mc:AlternateContent, extLst, ...) and
every untouched zip entry passes through unmodified. xl/calcChain.xml is
dropped (with its Content_Types/rels references) since Excel rebuilds it;
<calcPr> gets fullCalcOnLoad="1" so formulas depending on the written
cells recompute on open.

Output on stdout: {"success": true, "cellsWritten": N} or
{"success": false, "error": "..."} (exit 1).
"""
import json
import re
import sys
import zipfile
from xml.sax.saxutils import escape as xml_escape

CELL_REF_RE = re.compile(r'^([A-Z]+)(\d+)$')
ROW_RE = re.compile(r'<row\b[^>]*?(?:/>|>.*?</row>)', re.DOTALL)
CELL_RE = re.compile(r'<c\b[^>]*?(?:/>|>.*?</c>)', re.DOTALL)
SHEET_TAG_RE = re.compile(r'<sheet\b[^>]*/>')
RELATIONSHIP_RE = re.compile(r'<Relationship\b[^>]*/>')


def col_to_index(letters: str) -> int:
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - ord('A') + 1)
    return idx


def parse_cell_ref(ref: str):
    m = CELL_REF_RE.match(ref.strip().upper())
    if not m:
        raise ValueError(f'Invalid cell address: {ref!r}')
    letters = m.group(1)
    return letters, col_to_index(letters), int(m.group(2))


def _opening_tag(elem_text: str) -> str:
    # elem_text is a full '<tag ...>...</tag>' or '<tag .../>' match;
    # attributes never contain '>' so the first one ends the opening tag.
    return elem_text[:elem_text.index('>') + 1]


def _attr(tag_text: str, name: str):
    m = re.search(rf'\b{re.escape(name)}="([^"]*)"', tag_text)
    return m.group(1) if m else None


def build_cell_xml(addr: str, value, existing_style) -> str:
    style_attr = f' s="{existing_style}"' if existing_style is not None else ''
    if value is None or isinstance(value, bool):
        text = '' if value is None else ('1' if value else '0')
        inner = f'<v>{text}</v>' if text else ''
        return f'<c r="{addr}"{style_attr}>{inner}</c>'
    if isinstance(value, (int, float)):
        num = str(int(value)) if isinstance(value, float) and value.is_integer() else str(value)
        return f'<c r="{addr}"{style_attr}><v>{num}</v></c>'
    text = str(value)
    space_attr = ' xml:space="preserve"' if text != text.strip() else ''
    return f'<c r="{addr}"{style_attr} t="inlineStr"><is><t{space_attr}>{xml_escape(text)}</t></is></c>'


def set_cell(sheet_xml: str, addr: str, value) -> str:
    """Replace (or insert) one cell inside <sheetData>, touching nothing else."""
    _, col_idx, row_num = parse_cell_ref(addr)

    sd_start = sheet_xml.index('<sheetData')
    sd_open_end = sheet_xml.index('>', sd_start) + 1
    sd_close = sheet_xml.index('</sheetData>', sd_open_end)
    body = sheet_xml[sd_open_end:sd_close]

    target_row = None
    insert_before_row = None
    for m in ROW_RE.finditer(body):
        r_attr = _attr(_opening_tag(m.group(0)), 'r')
        r_num = int(r_attr) if r_attr is not None else None
        if r_num == row_num:
            target_row = m
            break
        if r_num is not None and r_num > row_num and insert_before_row is None:
            insert_before_row = m

    if target_row is not None:
        row_text = target_row.group(0)
        row_open = _opening_tag(row_text)
        if row_open.endswith('/>'):
            row_inner = ''
            row_open = row_open[:-2] + '>'
        else:
            row_inner = row_text[len(row_open):-len('</row>')]

        existing_style = None
        cell_match = None
        insert_before_cell = None
        for cm in CELL_RE.finditer(row_inner):
            c_open = _opening_tag(cm.group(0))
            c_addr = _attr(c_open, 'r')
            if c_addr == addr:
                cell_match = cm
                existing_style = _attr(c_open, 's')
                break
            if c_addr:
                _, c_col, _ = parse_cell_ref(c_addr)
                if c_col > col_idx and insert_before_cell is None:
                    insert_before_cell = cm

        new_cell = build_cell_xml(addr, value, existing_style)
        if cell_match is not None:
            new_row_inner = row_inner[:cell_match.start()] + new_cell + row_inner[cell_match.end():]
        elif insert_before_cell is not None:
            pos = insert_before_cell.start()
            new_row_inner = row_inner[:pos] + new_cell + row_inner[pos:]
        else:
            new_row_inner = row_inner + new_cell

        new_row_text = row_open + new_row_inner + '</row>'
        new_body = body[:target_row.start()] + new_row_text + body[target_row.end():]
    else:
        new_row_text = f'<row r="{row_num}">{build_cell_xml(addr, value, None)}</row>'
        if insert_before_row is not None:
            pos = insert_before_row.start()
            new_body = body[:pos] + new_row_text + body[pos:]
        else:
            new_body = body + new_row_text

    return sheet_xml[:sd_open_end] + new_body + sheet_xml[sd_close:]


def sheet_name_to_path(workbook_xml: str, rels_xml: str, sheet_name: str) -> str:
    rid = None
    for m in SHEET_TAG_RE.finditer(workbook_xml):
        tag = m.group(0)
        if _attr(tag, 'name') == sheet_name:
            rid_m = re.search(r'(?:\w+:)?id="(rId\d+)"', tag)
            rid = rid_m.group(1) if rid_m else None
            break
    if rid is None:
        raise ValueError(f'Sheet not found in workbook: {sheet_name!r}')

    target = None
    for m in RELATIONSHIP_RE.finditer(rels_xml):
        tag = m.group(0)
        if _attr(tag, 'Id') == rid:
            target = _attr(tag, 'Target')
            break
    if target is None:
        raise ValueError(f'Relationship not found for sheet {sheet_name!r} ({rid})')

    target = target.lstrip('/')
    return target if target.startswith('xl/') else f'xl/{target}'


def ensure_full_calc_on_load(workbook_xml: str) -> str:
    def repl(m):
        tag = m.group(0)
        if 'fullCalcOnLoad' in tag:
            return re.sub(r'fullCalcOnLoad="[^"]*"', 'fullCalcOnLoad="1"', tag)
        return tag[:-2] + ' fullCalcOnLoad="1"/>'
    return re.sub(r'<calcPr\b[^>]*/>', repl, workbook_xml)


def write_assembly(src_path: str, dest_path: str, cells_by_sheet: dict) -> int:
    with zipfile.ZipFile(src_path, 'r') as zin:
        names = zin.namelist()
        infos = {i.filename: i for i in zin.infolist()}
        workbook_xml = zin.read('xl/workbook.xml').decode('utf-8')
        rels_xml = zin.read('xl/_rels/workbook.xml.rels').decode('utf-8')

        sheet_paths = {
            sheet_name: sheet_name_to_path(workbook_xml, rels_xml, sheet_name)
            for sheet_name in cells_by_sheet
        }

        modified = {}
        cells_written = 0
        for sheet_name, cells in cells_by_sheet.items():
            path = sheet_paths[sheet_name]
            xml_text = zin.read(path).decode('utf-8')
            for addr, value in cells.items():
                xml_text = set_cell(xml_text, addr.strip().upper(), value)
                cells_written += 1
            modified[path] = xml_text.encode('utf-8')

        if 'xl/calcChain.xml' in names:
            modified['xl/workbook.xml'] = ensure_full_calc_on_load(workbook_xml).encode('utf-8')

            ct_xml = zin.read('[Content_Types].xml').decode('utf-8')
            ct_xml = re.sub(r'<Override\b[^>]*PartName="/xl/calcChain\.xml"[^>]*/>', '', ct_xml)
            modified['[Content_Types].xml'] = ct_xml.encode('utf-8')

            rels_xml_out = re.sub(r'<Relationship\b[^>]*Target="calcChain\.xml"[^>]*/>', '', rels_xml)
            modified['xl/_rels/workbook.xml.rels'] = rels_xml_out.encode('utf-8')

        with zipfile.ZipFile(dest_path, 'w') as zout:
            for name in names:
                if name == 'xl/calcChain.xml':
                    continue
                info = infos[name]
                data = modified.get(name)
                if data is None:
                    data = zin.read(name)
                new_info = zipfile.ZipInfo(name, date_time=info.date_time)
                new_info.compress_type = info.compress_type
                new_info.external_attr = info.external_attr
                new_info.internal_attr = info.internal_attr
                new_info.create_system = info.create_system
                zout.writestr(new_info, data)

    return cells_written


def run_selftest() -> bool:
    import os
    import shutil
    import tempfile

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="ASSEMBLY" sheetId="1" r:id="rId1"/></sheets>'
        '<calcPr calcId="191029"/>'
        '</workbook>'
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/>'
        '</Relationships>'
    )
    sheet1_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetData>'
        '<row r="12"><c r="A12" t="inlineStr"><is><t>Job Name</t></is></c></row>'
        '<row r="13"><c r="B13" s="4"><v>0</v></c><c r="C13" s="4"><v>0</v></c></row>'
        '</sheetData>'
        '</worksheet>'
    )
    calc_chain_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<c r="C13" i="1"/></calcChain>'
    )
    shared_strings_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"/>'
    )

    entries = {
        '[Content_Types].xml': content_types,
        '_rels/.rels': root_rels,
        'xl/workbook.xml': workbook_xml,
        'xl/_rels/workbook.xml.rels': workbook_rels,
        'xl/worksheets/sheet1.xml': sheet1_xml,
        'xl/calcChain.xml': calc_chain_xml,
        'xl/sharedStrings.xml': shared_strings_xml,
    }

    tmp_dir = tempfile.mkdtemp(prefix='assembly_write_selftest_')
    src_path = os.path.join(tmp_dir, 'src.xlsx')
    dest_path = os.path.join(tmp_dir, 'dest.xlsx')
    ok = True
    try:
        with zipfile.ZipFile(src_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for name, text in entries.items():
                zf.writestr(name, text)

        cells_written = write_assembly(src_path, dest_path, {
            'ASSEMBLY': {'C13': 6200, 'A13': 'Riverside Tower'},
        })

        if cells_written != 2:
            print(f'FAIL: expected 2 cells written, got {cells_written}', file=sys.stderr)
            ok = False

        with zipfile.ZipFile(dest_path, 'r') as zf:
            names = zf.namelist()
            if 'xl/calcChain.xml' in names:
                print('FAIL: calcChain.xml not dropped', file=sys.stderr)
                ok = False

            out_sheet = zf.read('xl/worksheets/sheet1.xml').decode('utf-8')
            if '<c r="C13" s="4"><v>6200</v></c>' not in out_sheet:
                print(f'FAIL: C13 not written correctly: {out_sheet}', file=sys.stderr)
                ok = False
            if '<c r="A13" t="inlineStr"><is><t>Riverside Tower</t></is></c>' not in out_sheet:
                print(f'FAIL: A13 not inserted correctly: {out_sheet}', file=sys.stderr)
                ok = False
            if '<c r="B13" s="4"><v>0</v></c>' not in out_sheet:
                print(f'FAIL: untouched cell B13 mutated: {out_sheet}', file=sys.stderr)
                ok = False

            ct_out = zf.read('[Content_Types].xml').decode('utf-8')
            if 'calcChain' in ct_out:
                print('FAIL: calcChain Override not removed from Content_Types', file=sys.stderr)
                ok = False

            rels_out = zf.read('xl/_rels/workbook.xml.rels').decode('utf-8')
            if 'calcChain' in rels_out:
                print('FAIL: calcChain relationship not removed', file=sys.stderr)
                ok = False

            wb_out = zf.read('xl/workbook.xml').decode('utf-8')
            if 'fullCalcOnLoad="1"' not in wb_out:
                print('FAIL: fullCalcOnLoad not set on calcPr', file=sys.stderr)
                ok = False

            with zipfile.ZipFile(src_path, 'r') as zsrc:
                for name in ('_rels/.rels', 'xl/sharedStrings.xml'):
                    if zf.read(name) != zsrc.read(name):
                        print(f'FAIL: untouched entry {name} changed', file=sys.stderr)
                        ok = False
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    if ok:
        print('OK: assembly_write.py self-test passed', file=sys.stderr)
    return ok


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == '--selftest':
        ok = run_selftest()
        print(json.dumps({'success': ok}))
        sys.exit(0 if ok else 1)

    if len(sys.argv) != 4:
        print(json.dumps({
            'success': False,
            'error': 'Usage: assembly_write.py <src.xlsx> <dest.xlsx> <cells_json>',
        }))
        sys.exit(1)

    src_path, dest_path, cells_json = sys.argv[1], sys.argv[2], sys.argv[3]
    try:
        cells_by_sheet = json.loads(cells_json)
        if not isinstance(cells_by_sheet, dict):
            raise ValueError('cells_json must be a JSON object of sheetName -> {cellAddress: value}')
        cells_written = write_assembly(src_path, dest_path, cells_by_sheet)
        print(json.dumps({'success': True, 'cellsWritten': cells_written}))
    except Exception as exc:  # noqa: BLE001 - CLI boundary, report all failures as JSON
        print(json.dumps({'success': False, 'error': str(exc)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
