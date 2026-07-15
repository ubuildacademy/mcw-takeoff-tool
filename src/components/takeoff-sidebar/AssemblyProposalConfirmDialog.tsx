import { useState } from 'react';
import { toast } from 'sonner';
import { BaseDialog } from '../ui/base-dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { assemblyService, type AssemblyMapping, type AssemblyScanProposal } from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';
import { deriveConditionPattern } from '../../utils/assemblyMatching';

export interface AssemblyProposalConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workbookId: string;
  filename: string;
  proposal: AssemblyScanProposal;
  onSaved: (mapping: AssemblyMapping) => void;
}

export function AssemblyProposalConfirmDialog({
  open,
  onOpenChange,
  workbookId,
  filename,
  proposal,
  onSaved,
}: AssemblyProposalConfirmDialogProps) {
  const [conditionRef, setConditionRef] = useState(() => deriveConditionPattern(filename));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!conditionRef.trim()) return;
    setSaving(true);
    try {
      const mapping = await assemblyService.createMapping({
        workbookId,
        conditionRef: conditionRef.trim(),
        inputs: [{ label: proposal.quantityLabel, cell: proposal.quantityCell }],
        jobInfoCells: proposal.jobInfoCells ?? undefined,
      });
      toast.success('Mapping created');
      onSaved(mapping);
      onOpenChange(false);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to create mapping'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Map this workbook?"
      description={`Found "${proposal.quantityLabel}" at ${proposal.quantityCell}. Confirm the condition pattern below.`}
      maxWidth="sm"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Skip
          </Button>
          <Button onClick={handleSave} disabled={saving || !conditionRef.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="assembly-proposal-condition-ref">Condition pattern</Label>
        <Input
          id="assembly-proposal-condition-ref"
          value={conditionRef}
          onChange={(e) => setConditionRef(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Matches condition names exactly (case-insensitive), or use a trailing * for a prefix wildcard.
        </p>
      </div>
    </BaseDialog>
  );
}
