#!/usr/bin/env python3
"""
test_assembly_e2e.py — E2E proof of assembly_write.py against a REAL MCW
workbook (Stage 1 assembly bridge, see docs/ASSEMBLIES_DESIGN.md task C4).

Pure stdlib, mirrors the --selftest style already in assembly_write.py, but
runs against a real file instead of a synthetic fixture.

Cell choice for Aquafin-2K M.xlsx, sheet "ASSEMBLY" (verified by reading the
sheet XML directly before writing this test):
  - D13 : numeric input. Label at C13 is shared-string "Job Quantity ";
    D13 itself holds a plain literal <v>500.0</v> with style s="39" and no
    <f> formula — a genuine user-input cell, not a formula result.
  - C8  : text input. Label at B8 is shared-string "Notes:"; C8 is an empty
    cell (style s="28", no <v>, no <f>) directly below/beside it — a
    genuine free-text input cell.
  (C13/A13 from the task's illustrative example do not hold user-editable
  values in this workbook — C13 is the label itself, and there is no A13 —
  so this test uses D13/C8, the real input cells, instead.)

This workbook has no xl/calcChain.xml, so the calcChain-drop path in
assembly_write.py is NOT exercised here (it's covered by --selftest
instead); this test's job is byte-identity across every other entry and
correct writes to the one touched worksheet.

Usage:
    ASSEMBLY_E2E_WORKBOOK=/path/to/Aquafin-2K\\ M.xlsx python3 test_assembly_e2e.py

Skips (exit 0) with a clear message if the env var is unset or the file
doesn't exist, so this is safe to leave in the repo without the real
(commercially sensitive) workbook present.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ASSEMBLY_WRITE = os.path.join(SCRIPT_DIR, 'assembly_write.py')

SHEET_NAME = 'ASSEMBLY'
NUMERIC_CELL = 'D13'
NUMERIC_VALUE = 6200
TEXT_CELL = 'C8'
TEXT_VALUE = 'E2E Test Job'
EXPECTED_NUMERIC_STYLE = '39'
EXPECTED_TEXT_STYLE = '28'


def fail(msg: str, failures: list) -> None:
    failures.append(msg)
    print(f'FAIL: {msg}', file=sys.stderr)


def resolve_sheet_path(zf: zipfile.ZipFile, sheet_name: str) -> str:
    import re
    workbook_xml = zf.read('xl/workbook.xml').decode('utf-8')
    rels_xml = zf.read('xl/_rels/workbook.xml.rels').decode('utf-8')
    sheet_m = re.search(rf'<sheet\b[^>]*name="{re.escape(sheet_name)}"[^>]*/>', workbook_xml)
    if not sheet_m:
        raise ValueError(f'Sheet {sheet_name!r} not found in workbook.xml')
    rid_m = re.search(r'(?:\w+:)?id="(rId\d+)"', sheet_m.group(0))
    rid = rid_m.group(1)
    rel_m = re.search(rf'<Relationship\b[^>]*Id="{rid}"[^>]*Target="([^"]*)"', rels_xml)
    target = rel_m.group(1).lstrip('/')
    return target if target.startswith('xl/') else f'xl/{target}'


def main() -> int:
    src_env = os.environ.get('ASSEMBLY_E2E_WORKBOOK')
    if not src_env:
        print('SKIP: ASSEMBLY_E2E_WORKBOOK not set — point it at a copy of '
              'Aquafin-2K M.xlsx to run this test. Example:\n'
              '  ASSEMBLY_E2E_WORKBOOK="/path/to/Aquafin-2K M.xlsx" '
              'python3 server/src/scripts/test_assembly_e2e.py')
        return 0
    if not os.path.isfile(src_env):
        print(f'SKIP: ASSEMBLY_E2E_WORKBOOK={src_env!r} does not exist', file=sys.stderr)
        return 0

    failures: list = []
    tmp_dir = tempfile.mkdtemp(prefix='assembly_e2e_')
    try:
        src_copy = os.path.join(tmp_dir, 'source.xlsx')
        dest_path = os.path.join(tmp_dir, 'generated.xlsx')
        shutil.copyfile(src_env, src_copy)

        cells_json = json.dumps({SHEET_NAME: {NUMERIC_CELL: NUMERIC_VALUE, TEXT_CELL: TEXT_VALUE}})
        proc = subprocess.run(
            [sys.executable, ASSEMBLY_WRITE, src_copy, dest_path, cells_json],
            capture_output=True, text=True,
        )
        try:
            result = json.loads(proc.stdout.strip())
        except json.JSONDecodeError:
            fail(f'assembly_write.py did not print valid JSON: stdout={proc.stdout!r} stderr={proc.stderr!r}', failures)
            result = {}

        if proc.returncode != 0 or not result.get('success'):
            fail(f'assembly_write.py exited {proc.returncode}: {result}', failures)
        elif result.get('cellsWritten') != 2:
            fail(f'expected cellsWritten=2, got {result.get("cellsWritten")}', failures)

        if not os.path.isfile(dest_path):
            fail('generated workbook was not created', failures)
            print_summary(failures)
            return 1

        # --- valid zip + parses as XML ---
        with zipfile.ZipFile(dest_path, 'r') as zf:
            bad_entry = zf.testzip()
            if bad_entry is not None:
                fail(f'zip CRC check failed on entry {bad_entry!r}', failures)
            dest_names = set(zf.namelist())
            try:
                ET.fromstring(zf.read('xl/workbook.xml'))
            except ET.ParseError as exc:
                fail(f'xl/workbook.xml does not parse as XML: {exc}', failures)

            touched_path = resolve_sheet_path(zf, SHEET_NAME)
            try:
                ET.fromstring(zf.read(touched_path))
            except ET.ParseError as exc:
                fail(f'{touched_path} does not parse as XML: {exc}', failures)

            # --- entry-by-entry byte comparison against the untouched copy ---
            with zipfile.ZipFile(src_copy, 'r') as zsrc:
                src_names = set(zsrc.namelist())
                calc_chain_present = 'xl/calcChain.xml' in src_names
                expected_changed = {touched_path}
                if calc_chain_present:
                    expected_changed |= {
                        'xl/workbook.xml', '[Content_Types].xml', 'xl/_rels/workbook.xml.rels',
                    }
                    expected_dropped = {'xl/calcChain.xml'}
                else:
                    expected_dropped = set()

                if dest_names != (src_names - expected_dropped):
                    added = dest_names - src_names
                    missing = src_names - dest_names - expected_dropped
                    fail(f'entry set changed unexpectedly: added={added} missing={missing}', failures)

                for name in src_names & dest_names:
                    src_bytes = zsrc.read(name)
                    dest_bytes = zf.read(name)
                    if name in expected_changed:
                        if src_bytes == dest_bytes:
                            fail(f'expected {name} to change but it is byte-identical', failures)
                        continue
                    if src_bytes != dest_bytes:
                        fail(f'entry {name} changed but was expected to stay byte-identical', failures)

            # --- correct values + preserved styles in the touched sheet ---
            sheet_xml = zf.read(touched_path).decode('utf-8')
            expected_numeric = f'<c r="{NUMERIC_CELL}" s="{EXPECTED_NUMERIC_STYLE}"><v>{NUMERIC_VALUE}</v></c>'
            if expected_numeric not in sheet_xml:
                fail(f'{NUMERIC_CELL} not written as expected ({expected_numeric!r} not found)', failures)
            expected_text = (
                f'<c r="{TEXT_CELL}" s="{EXPECTED_TEXT_STYLE}" t="inlineStr">'
                f'<is><t>{TEXT_VALUE}</t></is></c>'
            )
            if expected_text not in sheet_xml:
                fail(f'{TEXT_CELL} not written as expected ({expected_text!r} not found)', failures)

        print_summary(failures)
        if not failures:
            print(f'Generated workbook left at: {dest_path}')
            print('(temp dir will be cleaned up on process exit; copy it out '
                  'first if you want to open it manually)')
            manual_open_note()
        return 0 if not failures else 1
    finally:
        if failures:
            # keep the temp dir around for manual inspection on failure
            print(f'(inputs/output preserved for inspection at {tmp_dir})', file=sys.stderr)
        else:
            shutil.rmtree(tmp_dir, ignore_errors=True)


def manual_open_note() -> None:
    print(
        'MANUAL VISUAL CHECK: not performed by this automated run — this '
        'script has no way to observe whether Excel/Numbers shows a repair '
        'dialog. Open the generated file by hand (`open <path>`) to confirm '
        'visually; do not treat this PASS as proof it opens without repair.'
    )


def print_summary(failures: list) -> None:
    if failures:
        print(f'\nFAIL: {len(failures)} check(s) failed', file=sys.stderr)
        for f in failures:
            print(f'  - {f}', file=sys.stderr)
    else:
        print('\nPASS: all checks green '
              f'(sheet={SHEET_NAME}, {NUMERIC_CELL}={NUMERIC_VALUE}, {TEXT_CELL}={TEXT_VALUE!r})')


if __name__ == '__main__':
    sys.exit(main())
