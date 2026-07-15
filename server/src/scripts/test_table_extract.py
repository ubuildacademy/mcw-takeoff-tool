#!/usr/bin/env python3
"""Self-test for the deterministic (non-OCR) parts of table_extract.py —
character-confusion normalization and per-column charset validation.
No PDF/Tesseract needed; run directly: python3 test_table_extract.py
"""
from __future__ import annotations

import unittest

from table_extract import _normalize_cell_text, _validate_dimension_columns


class NormalizeCellTextTests(unittest.TestCase):
    def test_quote_glyphs_in_dimension_cell(self) -> None:
        self.assertEqual(_normalize_cell_text("3’-0”"), '3\'-0"')
        self.assertEqual(_normalize_cell_text("2’—10”"), "2'—10\"")

    def test_quote_glyphs_untouched_outside_dimension_cell(self) -> None:
        # No leading digit+quote/dash pattern -> not a dimension cell, leave alone.
        self.assertEqual(_normalize_cell_text("SEE “NOTE”"), "SEE “NOTE”")

    def test_digit_confusions_in_door_number(self) -> None:
        self.assertEqual(_normalize_cell_text("2O1A"), "201A")
        self.assertEqual(_normalize_cell_text("2l0B"), "210B")

    def test_digit_confusions_skip_real_words(self) -> None:
        # "STAIRS# 1" has real letters beyond the confusable set -> untouched.
        self.assertEqual(_normalize_cell_text("STAIRS# 1"), "STAIRS# 1")
        self.assertEqual(_normalize_cell_text("HOUSEKEEPING"), "HOUSEKEEPING")

    def test_strip_lone_trailing_dot_after_integer(self) -> None:
        self.assertEqual(_normalize_cell_text("12."), "12")
        self.assertEqual(_normalize_cell_text("#16.0"), "#16.0")

    def test_empty_and_none_safe(self) -> None:
        self.assertEqual(_normalize_cell_text(""), "")


class ValidateDimensionColumnsTests(unittest.TestCase):
    def test_mismatch_lowers_confidence_never_rewrites(self) -> None:
        # First 3 rows are always treated as header (grouped-header schedules
        # span up to 3 rows), so a 4th data row is needed to exercise this.
        rows = [
            ["DOOR", "WIDTH", "REMARKS"],
            ["", "", ""],
            ["", "", ""],
            ["101", "3'-0\"", "OK"],
            ["102", "ROOM NAME LEAKED HERE", "OK"],
        ]
        conf = [[90, 90, 90], [0, 0, 0], [0, 0, 0], [95, 95, 95], [95, 95, 95]]
        _validate_dimension_columns(rows, conf)
        self.assertEqual(rows[4][1], "ROOM NAME LEAKED HERE")  # text untouched
        self.assertLess(conf[4][1], 70)  # confidence lowered -> amber flag
        self.assertEqual(conf[3][1], 95)  # valid cell untouched

    def test_no_header_match_is_a_noop(self) -> None:
        rows = [["A", "B"], ["1", "2"]]
        conf = [[90, 90], [90, 90]]
        _validate_dimension_columns(rows, conf)
        self.assertEqual(conf, [[90, 90], [90, 90]])


if __name__ == "__main__":
    unittest.main()
