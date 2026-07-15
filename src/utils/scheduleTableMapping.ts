/**
 * Pure mapping helpers for Schedule → takeoff review.
 *
 * Real schedules (door/window/finish) are messier than "one header row, one
 * QTY column":
 *  - Group headers span sub-columns ("DOOR NUMBER" over 2nd/3rd/4th/5th/6th
 *    LEVEL), so the true header is 2+ rows deep.
 *  - Quantity is often IMPLIED: one row lists a door number per level column
 *    (201A / 301A / 401A / 501A / 601A, "–" where absent) and the row's real
 *    quantity is the count of filled instance cells — there is no QTY column.
 *  - The same name repeats across many rows (every "UNIT K-A — ENTRANCE"
 *    door); an estimator wants ONE condition per door type with the summed
 *    count, not a condition per schedule row.
 */

export type QtyMapping =
  | { mode: 'onePerRow' }
  | { mode: 'column'; column: number }
  | { mode: 'countColumns'; columns: number[] };

/** Empty or dash-like placeholder cell ("–", "-", "—", "..."). */
export function isBlankOrDashCell(cell: string | undefined): boolean {
  if (cell === undefined) return true;
  return /^[\s\-–—.·]*$/.test(cell);
}

/** Door/window instance code: "201A", "729", "212D", "M12". */
const INSTANCE_CODE_RE = /^[A-Za-z]{0,2}\d{1,4}[A-Za-z]{0,2}$/;

export function isInstanceCode(cell: string | undefined): boolean {
  if (!cell) return false;
  const t = cell.trim();
  if (!t || !/\d/.test(t)) return false;
  // A bare number needs 3+ digits to be a door tag ("729"); 1–2 digit numbers
  // ("1", "24") are quantities/counts, not instance codes, and would otherwise
  // make a QTY column masquerade as a level column.
  if (/^\d+$/.test(t) && t.length < 3) return false;
  return INSTANCE_CODE_RE.test(t);
}

/** Cell content that only appears in data rows, never in header rows. */
function looksLikeDataCell(cell: string): boolean {
  const t = cell.trim();
  if (!t) return false;
  if (isBlankOrDashCell(t)) return true;
  if (isInstanceCode(t)) return true;
  if (/^\(\d+\)$/.test(t)) return true; // pair counts: (1)
  if (/^#\d/.test(t)) return true; // hardware sets: #16.0
  if (/^(YES|NO)$/i.test(t)) return true;
  if (/^\d+['′’]/.test(t)) return true; // dimensions: 3'-0"
  if (/^[\d]*\s*[¼½¾⅛⅜⅝⅞]/.test(t)) return true; // thickness: 1¾"
  if (/^\d+(\.\d+)?$/.test(t)) return true; // bare numbers
  if (/^\d+\/[A-Za-z]+\d/.test(t)) return true; // detail refs: 12/A9.03
  return false;
}

const MAX_HEADER_ROWS = 3;

/**
 * Number of leading header rows (0–3): the first row where at least half of
 * the non-empty cells look like data ends the header. Defaults to 1 when the
 * top rows are all header-ish (deep title blocks) so behavior matches the old
 * "first row is a header" assumption.
 */
export function detectHeaderRowCount(rows: string[][]): number {
  if (rows.length === 0) return 0;
  const limit = Math.min(MAX_HEADER_ROWS + 1, rows.length);
  for (let i = 0; i < limit; i++) {
    const nonEmpty = rows[i].map((c) => c.trim()).filter((c) => c.length > 0);
    if (nonEmpty.length < 2) continue; // sparse group-header band
    const dataish = nonEmpty.filter((c) => looksLikeDataCell(c)).length;
    if (dataish / nonEmpty.length >= 0.5) return i;
  }
  return Math.min(1, rows.length - 1);
}

/**
 * One label per column, joining every header row's cell top-down
 * ("DOOR NUMBER 2nd LEVEL"). Falls back to "Column N" when the header cells
 * are empty for that column.
 */
export function buildColumnLabels(rows: string[][], headerRows: number, columnCount: number): string[] {
  const labels: string[] = [];
  for (let col = 0; col < columnCount; col++) {
    const parts: string[] = [];
    for (let r = 0; r < headerRows && r < rows.length; r++) {
      const cell = (rows[r][col] ?? '').trim();
      if (cell) parts.push(cell);
    }
    labels.push(parts.join(' '));
  }
  return labels;
}

/**
 * Columns whose data cells are dominated by instance codes with dash gaps —
 * the "door number per level" pattern. Requires 2+ qualifying columns before
 * suggesting count mode (one code-like column alone is usually a MARK column).
 */
export function detectInstanceColumns(rows: string[][], headerRows: number, columnCount: number): number[] {
  const dataRows = rows.slice(headerRows);
  if (dataRows.length < 3) return [];
  const cols: number[] = [];
  for (let col = 0; col < columnCount; col++) {
    const cells = dataRows.map((r) => (r[col] ?? '').trim());
    const filled = cells.filter((c) => c.length > 0 && !isBlankOrDashCell(c));
    if (filled.length < 3) continue;
    const codes = filled.filter((c) => isInstanceCode(c)).length;
    if (codes / filled.length >= 0.7) cols.push(col);
  }
  return cols.length >= 2 ? cols : [];
}

const NAME_HEADER_RE = /room|name|mark|type|desc/i;
const QTY_HEADER_RE = /qty|quan|count|no\.?$|ea\b/i;

/** Share of non-empty data-row cells in `col` with 3+ alphabetic characters. */
function alphaDominantShare(rows: string[][], headerRows: number, col: number): number {
  const dataRows = rows.slice(headerRows);
  let nonEmpty = 0;
  let alphaDominant = 0;
  for (const row of dataRows) {
    const cell = (row[col] ?? '').trim();
    if (!cell) continue;
    nonEmpty++;
    if ((cell.match(/[A-Za-z]/g) ?? []).length >= 3) alphaDominant++;
  }
  return nonEmpty === 0 ? 0 : alphaDominant / nonEmpty;
}

/** Share of body rows (after headerRows) with non-empty (trimmed) content in `col`. */
function nonEmptyShare(rows: string[][], headerRows: number, col: number): number {
  const dataRows = rows.slice(headerRows);
  if (dataRows.length === 0) return 1; // no data to judge by — don't disqualify on label alone
  const filled = dataRows.filter((r) => (r[col] ?? '').trim().length > 0).length;
  return filled / dataRows.length;
}

const MIN_NAME_COLUMN_FILL_SHARE = 0.6;

/**
 * Name-column pick: prefer a header matching /room|name|mark|type|desc/i;
 * otherwise the non-instance column with the highest share of alpha-dominant
 * cells (rows/headerRows let this fallback see actual data — omit them to
 * skip straight to the first non-instance column).
 *
 * A column only qualifies (for either the header match or the fallback) if
 * at least 60% of its body rows are non-empty — otherwise a column that's
 * blank except for one OCR-noise cell can look "alpha-dominant" (100% of its
 * one non-empty cell is alpha) and out-rank the real name column, inverting
 * which rows end up checked (gate #2).
 */
export function guessNameColumn(
  labels: string[],
  instanceColumns: number[],
  rows: string[][] = [],
  headerRows = 0
): number {
  const instanceSet = new Set(instanceColumns);
  const candidates = labels.map((_, i) => i).filter((i) => !instanceSet.has(i));
  if (candidates.length === 0) return 0;

  const qualifying = candidates.filter(
    (col) => nonEmptyShare(rows, headerRows, col) >= MIN_NAME_COLUMN_FILL_SHARE
  );
  const pool = qualifying.length > 0 ? qualifying : candidates;

  const headerMatch = pool.find((i) => NAME_HEADER_RE.test(labels[i]));
  if (headerMatch !== undefined) return headerMatch;

  let best = pool[0];
  let bestShare = -1;
  for (const col of pool) {
    const share = alphaDominantShare(rows, headerRows, col);
    if (share > bestShare) {
      bestShare = share;
      best = col;
    }
  }
  return best;
}

/**
 * Qty mapping preference: explicit QTY column header → column mode; otherwise
 * a detected instance-column group → count mode; otherwise 1 per row.
 */
export function guessQtyMapping(labels: string[], instanceColumns: number[]): QtyMapping {
  const qtyCol = labels.findIndex((l) => QTY_HEADER_RE.test(l));
  if (qtyCol >= 0) return { mode: 'column', column: qtyCol };
  if (instanceColumns.length >= 2) return { mode: 'countColumns', columns: instanceColumns };
  return { mode: 'onePerRow' };
}

function parseQtyCell(cell: string | undefined): number {
  if (cell === undefined) return 1;
  const parsed = parseInt(cell, 10);
  if (isNaN(parsed) || parsed < 1) return 1;
  return parsed;
}

/** Row quantity under a mapping. Count mode can legitimately return 0 (all-dash row). */
export function computeRowQty(row: string[], mapping: QtyMapping): number {
  switch (mapping.mode) {
    case 'onePerRow':
      return 1;
    case 'column':
      return parseQtyCell(row[mapping.column]);
    case 'countColumns':
      return mapping.columns.reduce(
        (sum, col) => sum + (isBlankOrDashCell(row[col]) ? 0 : 1),
        0
      );
  }
}

export interface ScheduleRowMapping {
  rowIndex: number;
  name: string;
  qty: number;
}

/** One condition to create, with markers distributed across its source rows. */
export interface ScheduleApplyGroup {
  name: string;
  totalQty: number;
  /** Rows contributing markers: qty markers land beside each row. */
  markerRows: Array<{ rowIndex: number; qty: number }>;
}

/**
 * Group mapped rows into conditions. `groupByName` merges rows with the same
 * trimmed name (case-insensitive) — the door-type workflow: dozens of
 * "UNIT K-A — ENTRANCE" rows become one condition with the summed count.
 */
export function groupScheduleRows(rows: ScheduleRowMapping[], groupByName: boolean): ScheduleApplyGroup[] {
  if (!groupByName) {
    return rows.map((r) => ({
      name: r.name,
      totalQty: r.qty,
      markerRows: [{ rowIndex: r.rowIndex, qty: r.qty }],
    }));
  }
  const byKey = new Map<string, ScheduleApplyGroup>();
  const order: string[] = [];
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.totalQty += r.qty;
      existing.markerRows.push({ rowIndex: r.rowIndex, qty: r.qty });
    } else {
      byKey.set(key, {
        name: r.name,
        totalQty: r.qty,
        markerRows: [{ rowIndex: r.rowIndex, qty: r.qty }],
      });
      order.push(key);
    }
  }
  return order.map((k) => {
    const group = byKey.get(k);
    if (!group) throw new Error('unreachable: group key without group');
    return group;
  });
}

const MAX_NAME_LENGTH = 60;
/** Table-border OCR noise that can leak into a cell anywhere, not just the edges. */
const STRAY_BORDER_CHARS_RE = /[|[\]{}]/g;
/** Punctuation/quote noise worth trimming only when it wraps the name. */
const EDGE_PUNCT_RE = /^[\s"'`.,;:!?()<>*_~^]+|[\s"'`.,;:!?()<>*_~^]+$/g;

/**
 * Turn a raw schedule cell into a presentable condition name: collapse
 * whitespace, drop stray table-border characters, trim wrapping punctuation,
 * and cap length at a word boundary so long remarks/spec cells don't blow up
 * the sidebar.
 */
export function cleanConditionName(raw: string): string {
  let s = raw.replace(STRAY_BORDER_CHARS_RE, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(EDGE_PUNCT_RE, '').trim();
  if (s.length <= MAX_NAME_LENGTH) return s;
  const truncated = s.slice(0, MAX_NAME_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  const boundary = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
  return `${boundary.trimEnd()}…`;
}

/**
 * True when the name cell is too thin or too noisy to be a real condition
 * name, or the whole row is blank — extraction found nothing usable here.
 */
export function isJunkRow(row: string[], nameCol: number): boolean {
  const nameCell = (row[nameCol] ?? '').trim();
  const alphaCount = (nameCell.match(/[A-Za-z]/g) ?? []).length;
  if (alphaCount < 3) return true;
  const nonAlnumCount = (nameCell.match(/[^A-Za-z0-9]/g) ?? []).length;
  if (nonAlnumCount / nameCell.length > 0.5) return true;
  if (row.every((cell) => isBlankOrDashCell(cell))) return true;
  return false;
}
