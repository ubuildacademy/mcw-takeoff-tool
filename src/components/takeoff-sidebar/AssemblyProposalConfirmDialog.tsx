import { useState } from 'react';
import { toast } from 'sonner';
import { BaseDialog } from '../ui/base-dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { assemblyService, type AssemblyMapping, type AssemblyScanProposal } from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';
import {
  deriveConditionPattern,
  formatConditionRefs,
  matchConditionsToMapping,
} from '../../utils/assemblyMatching';
import { ConditionMultiSelect } from './ConditionMultiSelect';
import type { TakeoffCondition } from '../../types';

export interface AssemblyProposalConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workbookId: string;
  filename: string;
  proposal: AssemblyScanProposal;
  conditions: TakeoffCondition[];
  onSaved: (mapping: AssemblyMapping) => void;
}

export function AssemblyProposalConfirmDialog({
  open,
  onOpenChange,
  workbookId,
  filename,
  proposal,
  conditions,
  onSaved,
}: AssemblyProposalConfirmDialogProps) {
  // The filename still does the guessing it did before — it just pre-ticks real
  // conditions now instead of writing a pattern nobody verifies.
  const [selectedConditionIds, setSelectedConditionIds] = useState<string[]>(() =>
    matchConditionsToMapping(conditions, deriveConditionPattern(filename)).map((c) => c.id)
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (selectedConditionIds.length === 0) return;
    setSaving(true);
    try {
      const selectedNames = conditions
        .filter((c) => selectedConditionIds.includes(c.id))
        .map((c) => c.name);
      const mapping = await assemblyService.createMapping({
        workbookId,
        conditionRef: formatConditionRefs(selectedNames),
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
      description={`Found "${proposal.quantityLabel}" at ${proposal.quantityCell}. Pick the conditions that feed it.`}
      maxWidth="sm"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Skip
          </Button>
          <Button onClick={handleSave} disabled={saving || selectedConditionIds.length === 0}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        <Label>Conditions</Label>
        <ConditionMultiSelect
          conditions={conditions}
          selectedIds={selectedConditionIds}
          onChange={setSelectedConditionIds}
        />
        <p className="text-xs text-muted-foreground">
          Pre-ticked from the filename. Their quantities are summed into {proposal.quantityCell}.
        </p>
      </div>
    </BaseDialog>
  );
}
