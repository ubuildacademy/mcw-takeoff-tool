/**
 * Picks which of the project's conditions feed a workbook mapping (task I8,
 * absorbing C6). This replaced a free-text pattern box: a typo there produced a
 * mapping that silently matched nothing, and nothing on screen said so.
 *
 * The mapping still stores names rather than condition ids, because the
 * workbook registry is org-wide while conditions belong to one project — a
 * mapping made here has to keep working on the next job that uses the same
 * condition names.
 */
import { Checkbox } from '../ui/checkbox';
import type { TakeoffCondition } from '../../types';

export interface ConditionMultiSelectProps {
  conditions: TakeoffCondition[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
}

export function ConditionMultiSelect({
  conditions,
  selectedIds,
  onChange,
}: ConditionMultiSelectProps) {
  const selected = new Set(selectedIds);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(conditions.filter((c) => next.has(c.id)).map((c) => c.id));
  };

  if (conditions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground border rounded-md px-3 py-3">
        This project has no conditions yet. Create the conditions this workbook prices, then add
        the mapping.
      </p>
    );
  }

  return (
    <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
      {conditions.map((condition) => (
        <label
          key={condition.id}
          className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/50"
        >
          <Checkbox
            checked={selected.has(condition.id)}
            onCheckedChange={() => toggle(condition.id)}
          />
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: condition.color }}
          />
          <span className="truncate">{condition.name}</span>
        </label>
      ))}
    </div>
  );
}
