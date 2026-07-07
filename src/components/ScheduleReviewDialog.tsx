/**
 * ScheduleReviewDialog
 *
 * Lets an estimator review a door/window schedule table parsed from a PDF
 * region (via the server's schedule-table endpoint), map which column holds
 * the item name and which holds the quantity, pick which rows to bring into
 * the takeoff, and apply them. Each applied row becomes a count condition
 * with the resolved name and the number of markers to place.
 */
import React, { useState } from 'react';
import { BaseDialog } from './ui/base-dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

export interface ScheduleTableData {
  mode: 'ruled' | 'clustered';
  rows: string[][];
  rowBoxes: Array<{ y0: number; y1: number }>;
}

export interface ScheduleApplyRow {
  rowIndex: number; // index into table.rows
  name: string; // condition name for this row
  qty: number; // count markers to create (>= 1)
}

export interface ScheduleReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: ScheduleTableData | null;
  /** Apply the selected rows; parent creates conditions + markers. May be async; show "Applying…" disabled state until it resolves. */
  onApply: (rows: ScheduleApplyRow[]) => void | Promise<void>;
}

const NAME_HEADER_RE = /mark|type|desc|item|fixture|door|window/i;
const QTY_HEADER_RE = /qty|quan|count|no\.?$|ea\b/i;

const NONE_QTY_VALUE = '__none__';

function guessNameColumn(table: ScheduleTableData, firstRowIsHeader: boolean): number {
  if (firstRowIsHeader && table.rows.length > 0) {
    const header = table.rows[0];
    const idx = header.findIndex((cell) => NAME_HEADER_RE.test(cell));
    if (idx >= 0) return idx;
  }
  return 0;
}

function guessQtyColumn(table: ScheduleTableData, firstRowIsHeader: boolean): number | null {
  if (firstRowIsHeader && table.rows.length > 0) {
    const header = table.rows[0];
    const idx = header.findIndex((cell) => QTY_HEADER_RE.test(cell));
    if (idx >= 0) return idx;
  }
  return null;
}

function parseQty(cell: string | undefined): number {
  if (cell === undefined) return 1;
  const parsed = parseInt(cell, 10);
  if (isNaN(parsed) || parsed < 1) return 1;
  return parsed;
}

function resolveName(row: string[], nameCol: number): string {
  const direct = (row[nameCol] ?? '').trim();
  if (direct) return direct;
  const fallback = row
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0)
    .join(' ');
  return fallback;
}

export function ScheduleReviewDialog({
  open,
  onOpenChange,
  table,
  onApply,
}: ScheduleReviewDialogProps): JSX.Element | null {
  const [seenTable, setSeenTable] = useState<ScheduleTableData | null>(null);
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true);
  const [nameCol, setNameCol] = useState(0);
  const [qtyCol, setQtyCol] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);

  // Render-phase reset: re-derive all local state whenever the dialog opens
  // with a new table, instead of doing this in a useEffect (banned in this repo).
  if (open && table !== seenTable) {
    setSeenTable(table);
    const nextFirstRowIsHeader = true;
    setFirstRowIsHeader(nextFirstRowIsHeader);
    if (table) {
      const guessedName = guessNameColumn(table, nextFirstRowIsHeader);
      const guessedQty = guessQtyColumn(table, nextFirstRowIsHeader);
      setNameCol(guessedName);
      setQtyCol(guessedQty);
      const dataStart = nextFirstRowIsHeader ? 1 : 0;
      const initialSelected = new Set<number>();
      for (let i = dataStart; i < table.rows.length; i++) {
        initialSelected.add(i);
      }
      setSelected(initialSelected);
    } else {
      setNameCol(0);
      setQtyCol(null);
      setSelected(new Set());
    }
    setApplying(false);
  }

  if (!table) {
    return null;
  }

  const handleFirstRowIsHeaderChange = (checked: boolean) => {
    setFirstRowIsHeader(checked);
    const guessedName = guessNameColumn(table, checked);
    const guessedQty = guessQtyColumn(table, checked);
    setNameCol(guessedName);
    setQtyCol(guessedQty);
    const dataStart = checked ? 1 : 0;
    const nextSelected = new Set<number>();
    for (let i = dataStart; i < table.rows.length; i++) {
      nextSelected.add(i);
    }
    setSelected(nextSelected);
  };

  const columnCount = table.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const dataStartIndex = firstRowIsHeader ? 1 : 0;
  const headerRow = firstRowIsHeader ? table.rows[0] : undefined;

  const toggleRow = (rowIndex: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(rowIndex);
      } else {
        next.delete(rowIndex);
      }
      return next;
    });
  };

  const applyRows: ScheduleApplyRow[] = [];
  for (let i = dataStartIndex; i < table.rows.length; i++) {
    if (!selected.has(i)) continue;
    const row = table.rows[i];
    const name = resolveName(row, nameCol);
    if (!name) continue;
    const qty = qtyCol === null ? 1 : parseQty(row[qtyCol]);
    applyRows.push({ rowIndex: i, name, qty });
  }

  const handleApply = async () => {
    if (applyRows.length === 0 || applying) return;
    setApplying(true);
    try {
      await onApply(applyRows);
      onOpenChange(false);
    } finally {
      setApplying(false);
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const columnLabel = (col: number): string => {
    if (headerRow && headerRow[col]) return `${col}: ${headerRow[col]}`;
    return `Column ${col}`;
  };

  return (
    <BaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Schedule → takeoff"
      maxWidth="2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={applying}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={applyRows.length === 0 || applying}>
            {applying ? 'Applying…' : `Apply ${applyRows.length} conditions`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Parsed {table.rows.length} rows ({table.mode === 'ruled' ? 'ruled grid' : 'text alignment'})
        </p>

        <div className="flex items-center gap-2">
          <Checkbox
            id="schedule-first-row-header"
            checked={firstRowIsHeader}
            onCheckedChange={handleFirstRowIsHeaderChange}
          />
          <Label htmlFor="schedule-first-row-header" className="cursor-pointer font-normal">
            First row is a header
          </Label>
        </div>

        <div className="grid grid-cols-2 gap-4">
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
            <Label htmlFor="schedule-qty-col">Qty column</Label>
            <select
              id="schedule-qty-col"
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={qtyCol === null ? NONE_QTY_VALUE : qtyCol}
              onChange={(e) =>
                setQtyCol(e.target.value === NONE_QTY_VALUE ? null : Number(e.target.value))
              }
            >
              <option value={NONE_QTY_VALUE}>None (1 per row)</option>
              {Array.from({ length: columnCount }, (_, col) => (
                <option key={col} value={col}>
                  {columnLabel(col)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="max-h-[45vh] overflow-y-auto rounded-md border border-input">
          <table className="w-full text-sm">
            <thead>
              {headerRow && (
                <tr className="bg-popover">
                  <th className="w-8 px-2 py-1" />
                  {headerRow.map((cell, col) => (
                    <th
                      key={col}
                      className={`px-2 py-1 text-left font-medium ${
                        col === nameCol || col === qtyCol ? 'bg-primary/10' : ''
                      }`}
                    >
                      {cell}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-left font-medium text-muted-foreground">Result</th>
                </tr>
              )}
            </thead>
            <tbody>
              {table.rows.slice(dataStartIndex).map((row, offset) => {
                const rowIndex = dataStartIndex + offset;
                const name = resolveName(row, nameCol);
                const qty = qtyCol === null ? 1 : parseQty(row[qtyCol]);
                const disabled = !name;
                return (
                  <tr key={rowIndex} className="border-t border-input">
                    <td className="px-2 py-1 align-top">
                      <Checkbox
                        checked={!disabled && selected.has(rowIndex)}
                        onCheckedChange={(checked) => toggleRow(rowIndex, checked)}
                        disabled={disabled}
                        title={disabled ? 'No usable name' : undefined}
                      />
                    </td>
                    {Array.from({ length: columnCount }, (_, col) => (
                      <td
                        key={col}
                        className={`px-2 py-1 align-top ${
                          col === nameCol || col === qtyCol ? 'bg-primary/10' : ''
                        }`}
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
