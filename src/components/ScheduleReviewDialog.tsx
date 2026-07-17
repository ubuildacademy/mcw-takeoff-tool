/**
 * ScheduleReviewDialog
 *
 * Review a door/window schedule parsed from a PDF region and turn it into
 * takeoff conditions. Handles real schedule shapes:
 *  - multi-row headers (group header over sub-columns) via a header-row count
 *  - implied quantities: "count filled cells across the level columns" mode
 *    for schedules with a door number per level and no QTY column
 *  - door-type grouping: rows with the same name merge into ONE condition
 *    with the summed count (markers still land beside every source row)
 */
import React, { useState } from 'react';
import { BaseDialog } from './ui/base-dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import {
  buildColumnLabels,
  computeRowQty,
  detectHeaderRowCount,
  detectInstanceColumns,
  groupScheduleRows,
  guessNameColumn,
  guessQtyMapping,
  type QtyMapping,
  type ScheduleApplyGroup,
  type ScheduleRowMapping,
} from '../utils/scheduleTableMapping';

export type { ScheduleApplyGroup } from '../utils/scheduleTableMapping';

export interface ScheduleTableData {
  mode: 'ruled' | 'clustered';
  rows: string[][];
  rowBoxes: Array<{ y0: number; y1: number }>;
}

export interface ScheduleReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: ScheduleTableData | null;
  /** Apply the grouped conditions; parent creates conditions + markers. */
  onApply: (groups: ScheduleApplyGroup[]) => void | Promise<void>;
}

type QtyModeChoice = 'onePerRow' | 'column' | 'countColumns';

function resolveName(row: string[], nameCol: number): string {
  const direct = (row[nameCol] ?? '').trim();
  if (direct) return direct;
  return row
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0)
    .join(' ');
}

export function ScheduleReviewDialog({
  open,
  onOpenChange,
  table,
  onApply,
}: ScheduleReviewDialogProps): JSX.Element | null {
  const [seenTable, setSeenTable] = useState<ScheduleTableData | null>(null);
  const [headerRows, setHeaderRows] = useState(1);
  const [nameCol, setNameCol] = useState(0);
  const [qtyMode, setQtyMode] = useState<QtyModeChoice>('onePerRow');
  const [qtyColumn, setQtyColumn] = useState(0);
  const [countColumns, setCountColumns] = useState<Set<number>>(new Set());
  const [groupByName, setGroupByName] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);

  const columnCount = table ? table.rows.reduce((max, row) => Math.max(max, row.length), 0) : 0;

  const reseedFromHeaderRows = (t: ScheduleTableData, nextHeaderRows: number, colCount: number) => {
    const labels = buildColumnLabels(t.rows, nextHeaderRows, colCount);
    const instanceCols = detectInstanceColumns(t.rows, nextHeaderRows, colCount);
    setNameCol(guessNameColumn(labels, instanceCols));
    const mapping = guessQtyMapping(labels, instanceCols);
    setQtyMode(mapping.mode);
    setQtyColumn(mapping.mode === 'column' ? mapping.column : 0);
    setCountColumns(new Set(mapping.mode === 'countColumns' ? mapping.columns : instanceCols));
    const nextSelected = new Set<number>();
    for (let i = nextHeaderRows; i < t.rows.length; i++) nextSelected.add(i);
    setSelected(nextSelected);
  };

  // Render-phase reset: re-derive local state when the dialog opens with a new
  // table, instead of a useEffect (banned in this repo).
  if (open && table !== seenTable) {
    setSeenTable(table);
    setGroupByName(true);
    setApplying(false);
    if (table) {
      const colCount = table.rows.reduce((max, row) => Math.max(max, row.length), 0);
      const detected = detectHeaderRowCount(table.rows);
      setHeaderRows(detected);
      reseedFromHeaderRows(table, detected, colCount);
    } else {
      setHeaderRows(1);
      setNameCol(0);
      setQtyMode('onePerRow');
      setQtyColumn(0);
      setCountColumns(new Set());
      setSelected(new Set());
    }
  }

  if (!table) {
    return null;
  }

  const labels = buildColumnLabels(table.rows, headerRows, columnCount);

  const handleHeaderRowsChange = (next: number) => {
    setHeaderRows(next);
    reseedFromHeaderRows(table, next, columnCount);
  };

  const activeMapping: QtyMapping =
    qtyMode === 'onePerRow'
      ? { mode: 'onePerRow' }
      : qtyMode === 'column'
        ? { mode: 'column', column: qtyColumn }
        : { mode: 'countColumns', columns: [...countColumns].sort((a, b) => a - b) };

  const toggleRow = (rowIndex: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(rowIndex);
      else next.delete(rowIndex);
      return next;
    });
  };

  const toggleCountColumn = (col: number, checked: boolean) => {
    setCountColumns((prev) => {
      const next = new Set(prev);
      if (checked) next.add(col);
      else next.delete(col);
      return next;
    });
  };

  const isMappedColumn = (col: number): boolean =>
    col === nameCol ||
    (qtyMode === 'column' && col === qtyColumn) ||
    (qtyMode === 'countColumns' && countColumns.has(col));

  const mappedRows: ScheduleRowMapping[] = [];
  for (let i = headerRows; i < table.rows.length; i++) {
    if (!selected.has(i)) continue;
    const row = table.rows[i];
    const name = resolveName(row, nameCol);
    if (!name) continue;
    const qty = computeRowQty(row, activeMapping);
    if (qty < 1) continue; // all-dash row under count mode — nothing to count
    mappedRows.push({ rowIndex: i, name, qty });
  }
  const groups = groupScheduleRows(mappedRows, groupByName);
  const totalMarkers = groups.reduce((sum, g) => sum + g.totalQty, 0);

  const handleApply = async () => {
    if (groups.length === 0 || applying) return;
    setApplying(true);
    try {
      await onApply(groups);
      onOpenChange(false);
    } finally {
      setApplying(false);
    }
  };

  const columnLabel = (col: number): string => {
    const label = labels[col];
    return label ? `${col}: ${label}` : `Column ${col}`;
  };

  const maxHeaderChoices = Math.min(3, Math.max(0, table.rows.length - 1));

  return (
    <BaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Schedule → takeoff"
      maxWidth="fit"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {groups.length > 0
              ? `→ ${groups.length} condition${groups.length === 1 ? '' : 's'}, ${totalMarkers} markers`
              : 'Nothing to apply yet'}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={groups.length === 0 || applying}>
              {applying
                ? 'Applying…'
                : `Apply ${groups.length} condition${groups.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Parsed {table.rows.length} rows ({table.mode === 'ruled' ? 'ruled grid' : 'text alignment'})
        </p>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label htmlFor="schedule-header-rows">Header rows</Label>
            <select
              id="schedule-header-rows"
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={headerRows}
              onChange={(e) => handleHeaderRowsChange(Number(e.target.value))}
            >
              {Array.from({ length: maxHeaderChoices + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'None (data starts at row 1)' : n}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="schedule-name-col">Name column</Label>
            <select
              id="schedule-name-col"
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={nameCol}
              onChange={(e) => setNameCol(Number(e.target.value))}
            >
              {Array.from({ length: columnCount }, (_, col) => (
                <option key={col} value={col}>
                  {columnLabel(col)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="schedule-qty-mode">Quantity</Label>
            <select
              id="schedule-qty-mode"
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={qtyMode}
              onChange={(e) => setQtyMode(e.target.value as QtyModeChoice)}
            >
              <option value="onePerRow">1 per row</option>
              <option value="column">From a column</option>
              <option value="countColumns">Count filled cells across columns</option>
            </select>
          </div>
        </div>

        {qtyMode === 'column' && (
          <div className="space-y-1">
            <Label htmlFor="schedule-qty-col">Qty column</Label>
            <select
              id="schedule-qty-col"
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={qtyColumn}
              onChange={(e) => setQtyColumn(Number(e.target.value))}
            >
              {Array.from({ length: columnCount }, (_, col) => (
                <option key={col} value={col}>
                  {columnLabel(col)}
                </option>
              ))}
            </select>
          </div>
        )}

        {qtyMode === 'countColumns' && (
          <div className="space-y-1">
            <Label>Count these columns (e.g. one door number per level)</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-input p-2">
              {Array.from({ length: columnCount }, (_, col) => (
                <label key={col} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <Checkbox
                    checked={countColumns.has(col)}
                    onCheckedChange={(checked) => toggleCountColumn(col, checked === true)}
                  />
                  {columnLabel(col)}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Checkbox
            id="schedule-group-by-name"
            checked={groupByName}
            onCheckedChange={(checked) => setGroupByName(checked === true)}
          />
          <Label htmlFor="schedule-group-by-name" className="cursor-pointer font-normal">
            Group rows with the same name into one condition (door types)
          </Label>
        </div>

        <div className="max-h-[45vh] overflow-auto rounded-md border border-input">
          <table className="w-full text-sm min-w-max">
            <thead>
              {headerRows > 0 && (
                <tr className="bg-popover">
                  <th className="w-8 px-2 py-1" />
                  {Array.from({ length: columnCount }, (_, col) => (
                    <th
                      key={col}
                      className={`px-2 py-1 text-left font-medium ${isMappedColumn(col) ? 'bg-primary/10' : ''}`}
                    >
                      {labels[col]}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-left font-medium text-muted-foreground">Result</th>
                </tr>
              )}
            </thead>
            <tbody>
              {table.rows.slice(headerRows).map((row, offset) => {
                const rowIndex = headerRows + offset;
                const name = resolveName(row, nameCol);
                const qty = computeRowQty(row, activeMapping);
                const disabled = !name || qty < 1;
                return (
                  <tr key={rowIndex} className="border-t border-input">
                    <td className="px-2 py-1 align-top">
                      <Checkbox
                        checked={!disabled && selected.has(rowIndex)}
                        onCheckedChange={(checked) => toggleRow(rowIndex, checked === true)}
                        disabled={disabled}
                        title={disabled ? (name ? 'No filled quantity cells' : 'No usable name') : undefined}
                      />
                    </td>
                    {Array.from({ length: columnCount }, (_, col) => (
                      <td
                        key={col}
                        className={`px-2 py-1 align-top ${isMappedColumn(col) ? 'bg-primary/10' : ''}`}
                      >
                        {row[col] ?? ''}
                      </td>
                    ))}
                    <td className="px-2 py-1 align-top text-muted-foreground whitespace-nowrap">
                      {disabled ? '—' : `→ ${name} ×${qty}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </BaseDialog>
  );
}
