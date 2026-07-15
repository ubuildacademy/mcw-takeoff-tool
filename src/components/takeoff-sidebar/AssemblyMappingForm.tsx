import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { assemblyService, type AssemblyMapping } from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';

const CELL_ADDRESS_RE = /^[A-Za-z]+[0-9]+$/;

interface InputRow {
  label: string;
  cell: string;
}

const JOB_INFO_FIELDS: Array<{ key: 'projectName' | 'client' | 'address'; label: string }> = [
  { key: 'projectName', label: 'Project name cell' },
  { key: 'client', label: 'Client cell' },
  { key: 'address', label: 'Address cell' },
];

export interface AssemblyMappingFormProps {
  workbookId: string;
  onCreated: (mapping: AssemblyMapping) => void;
  onCancel: () => void;
}

export function AssemblyMappingForm({ workbookId, onCreated, onCancel }: AssemblyMappingFormProps) {
  const [conditionRef, setConditionRef] = useState('');
  const [inputs, setInputs] = useState<InputRow[]>([{ label: 'Job Quantity', cell: '' }]);
  const [jobInfoCells, setJobInfoCells] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateInput = (index: number, patch: Partial<InputRow>) => {
    setInputs((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addInputRow = () => setInputs((prev) => [...prev, { label: '', cell: '' }]);
  const removeInputRow = (index: number) => setInputs((prev) => prev.filter((_, i) => i !== index));

  const validate = (): string | null => {
    if (!conditionRef.trim()) return 'Condition pattern is required.';
    if (inputs.length === 0) return 'At least one quantity input is required.';
    for (const row of inputs) {
      if (!row.label.trim()) return 'Every input row needs a label.';
      if (!CELL_ADDRESS_RE.test(row.cell.trim())) return `"${row.cell}" is not a valid cell address (e.g. C13).`;
    }
    for (const [field, cell] of Object.entries(jobInfoCells)) {
      if (cell.trim() && !CELL_ADDRESS_RE.test(cell.trim())) {
        return `${field} cell "${cell}" is not a valid cell address (e.g. A12).`;
      }
    }
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const cleanJobInfoCells = Object.fromEntries(
        Object.entries(jobInfoCells).filter(([, cell]) => cell.trim())
      );
      const mapping = await assemblyService.createMapping({
        workbookId,
        conditionRef: conditionRef.trim(),
        inputs: inputs.map((row) => ({ label: row.label.trim(), cell: row.cell.trim().toUpperCase() })),
        jobInfoCells: Object.keys(cleanJobInfoCells).length > 0 ? cleanJobInfoCells : undefined,
      });
      toast.success('Mapping created');
      onCreated(mapping);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create mapping'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border rounded-lg p-3 bg-muted/30 space-y-3">
      <div>
        <Label htmlFor="assembly-condition-ref">Condition pattern</Label>
        <Input
          id="assembly-condition-ref"
          placeholder='e.g. "Aquafin 2K deck" or "Aquafin*"'
          value={conditionRef}
          onChange={(e) => setConditionRef(e.target.value)}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Matches condition names exactly (case-insensitive), or use a trailing * for a prefix wildcard.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Quantity inputs</Label>
        {inputs.map((row, index) => (
          <div key={index} className="flex gap-2 items-center">
            <Input
              placeholder="Label"
              value={row.label}
              onChange={(e) => updateInput(index, { label: e.target.value })}
              className="flex-1"
            />
            <Input
              placeholder="Cell (e.g. C13)"
              value={row.cell}
              onChange={(e) => updateInput(index, { cell: e.target.value })}
              className="w-32"
            />
            {inputs.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => removeInputRow(index)} aria-label="Remove input">
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        ))}
        {inputs.length > 1 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            All inputs receive the same summed quantity.
          </p>
        )}
        <Button variant="outline" size="sm" onClick={addInputRow} className="flex items-center gap-1">
          <Plus className="w-3 h-3" />
          Add input
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Job info cells (optional)</Label>
        {JOB_INFO_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex gap-2 items-center">
            <span className="text-sm text-muted-foreground w-40">{label}</span>
            <Input
              placeholder="e.g. A12"
              value={jobInfoCells[key] ?? ''}
              onChange={(e) => setJobInfoCells((prev) => ({ ...prev, [key]: e.target.value }))}
              className="w-32"
            />
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving…' : 'Save mapping'}
        </Button>
      </div>
    </div>
  );
}
