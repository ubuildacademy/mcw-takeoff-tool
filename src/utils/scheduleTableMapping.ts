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

const NAME_HEADER_PRIMARY_RE = /room|name|desc/i;
const NAME_HEADER_SECONDARY_RE = /mark|type|item|fixture|door|window/i;
const QTY_HEADER_RE = /qty|quan|count|no\.?$|ea\b/i;

export function guessNameColumn(labels: string[], instanceColumns: number[]): number {
  const instanceSet = new Set(instanceColumns);
  const primary = labels.findIndex((l, i) => !instanceSet.has(i) && NAME_HEADER_PRIMARY_RE.test(l));
  if (primary >= 0) return primary;
  const secondary = labels.findIndex((l, i) => !instanceSet.has(i) && NAME_HEADER_SECONDARY_RE.test(l));
  if (secondary >= 0) return secondary;
  const firstNonInstance = labels.findIndex((_, i) => !instanceSet.has(i));
  return firstNonInstance >= 0 ? firstNonInstance : 0;
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
