/**
 * Lists CV-proposed room polygons for a plan sheet with their computed areas
 * so the estimator can uncheck anything that isn't in scope (hallways,
 * shafts, etc.) before the parent turns the selection into measurements.
 * Nothing is written until Apply is pressed.
 */
import { useState } from 'react';
import { BaseDialog } from './ui/base-dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';

export interface RoomProposalItem {
  id: string;
  /** Human-readable computed area, e.g. "1,250 SF". */
  areaDisplay: string;
  /** Vertex count of the simplified polygon (display only). */
  vertexCount: number;
}

export interface RoomProposalsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Proposals, biggest area first. Null → render nothing (return null). */
  proposals: RoomProposalItem[] | null;
  /** Name of the condition the rooms will be added to (shown in the header copy). */
  conditionName: string;
  /** Apply selected proposal ids; may be async — show "Adding…" disabled state until resolved, then close. */
  onApply: (selectedIds: string[]) => void | Promise<void>;
}

export function RoomProposalsDialog({
  open,
  onOpenChange,
  proposals,
  conditionName,
  onApply,
}: RoomProposalsDialogProps): JSX.Element | null {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  // Reset selection to "all checked" whenever a new proposals array arrives.
  const [seen, setSeen] = useState<RoomProposalItem[] | null>(null);
  if (open && proposals !== seen) {
    setSeen(proposals);
    setSelected(new Set((proposals ?? []).map((p) => p.id)));
  }

  if (proposals === null) {
    return null;
  }

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(proposals.map((p) => p.id)));
  const selectNone = () => setSelected(new Set());

  const selectedCount = selected.size;

  const handleApply = async () => {
    setApplying(true);
    try {
      await onApply(Array.from(selected));
      onOpenChange(false);
    } finally {
      setApplying(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
        Cancel
      </Button>
      <Button onClick={handleApply} disabled={selectedCount === 0 || applying}>
        {applying ? 'Adding…' : `Add ${selectedCount} rooms`}
      </Button>
    </div>
  );

  return (
    <BaseDialog open={open} onOpenChange={onOpenChange} title="Room proposals" maxWidth="lg" footer={footer}>
      <p className="text-sm text-muted-foreground">
        {proposals.length} enclosed regions found — rooms land in "{conditionName}". Uncheck hallways, shafts, or
        anything that isn't scope.
      </p>

      {proposals.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No enclosed rooms found on this sheet.</p>
      ) : (
        <>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={selectAll}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={selectNone}>
              Select none
            </Button>
          </div>

          <div className="max-h-[50vh] overflow-y-auto rounded-md border divide-y">
            {proposals.map((proposal, index) => (
              <label
                key={proposal.id}
                className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/50"
              >
                <Checkbox
                  checked={selected.has(proposal.id)}
                  onCheckedChange={(checked) => toggleOne(proposal.id, checked)}
                />
                <span className="flex-1 text-sm">Room {index + 1}</span>
                <span className="text-sm font-medium">{proposal.areaDisplay}</span>
                <span className="text-xs text-muted-foreground">{proposal.vertexCount} pts</span>
              </label>
            ))}
          </div>
        </>
      )}
    </BaseDialog>
  );
}
