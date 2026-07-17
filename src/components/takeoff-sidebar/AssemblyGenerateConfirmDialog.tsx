import { BaseDialog } from '../ui/base-dialog';
import { Button } from '../ui/button';
import type { AssemblyMapping, AssemblyWorkbook } from '../../services/apiService';

export interface AssemblyGenerateItem {
  workbook: AssemblyWorkbook;
  mapping: AssemblyMapping;
  breakdown: Array<{ conditionId: string; name: string; quantity: number }>;
  total: number;
}

export interface AssemblyGenerateConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: AssemblyGenerateItem[];
  onConfirm: () => void;
  confirming: boolean;
}

const JOB_INFO_LABELS: Record<string, string> = {
  projectName: 'Project name',
  client: 'Client',
  address: 'Address',
};

export function AssemblyGenerateConfirmDialog({
  open,
  onOpenChange,
  items,
  onConfirm,
  confirming,
}: AssemblyGenerateConfirmDialogProps) {
  const isMultiple = items.length > 1;

  return (
    <BaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isMultiple ? `Generate ${items.length} Assemblies` : 'Generate Assembly'}
      description={
        isMultiple
          ? 'Each mapped workbook below will be priced and downloaded.'
          : 'Review the quantity being written before downloading the priced workbook.'
      }
      maxWidth="fit"
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={confirming || items.length === 0}>
            {confirming ? 'Generating…' : isMultiple ? 'Generate All' : 'Generate'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        {items.map((item) => {
          const jobInfoEntries = Object.entries(item.mapping.jobInfoCells ?? {});
          return (
            <div key={item.mapping.id} className="border rounded-lg p-3 bg-muted/30">
              <div className="font-medium text-sm text-foreground mb-2">{item.workbook.filename}</div>
              <div className="space-y-1">
                {item.breakdown.map((b) => (
                  <div key={b.conditionId} className="flex justify-between text-sm text-muted-foreground">
                    <span>{b.name}</span>
                    <span>{b.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm font-semibold text-foreground border-t border-border mt-2 pt-2">
                <span>
                  Total → {item.mapping.inputs.map((i) => i.cell).join(', ')}
                </span>
                <span>{item.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              {jobInfoEntries.length > 0 && (
                <div className="text-xs text-muted-foreground mt-2">
                  Also writes: {jobInfoEntries.map(([field, cell]) => `${JOB_INFO_LABELS[field] ?? field} (${cell})`).join(', ')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </BaseDialog>
  );
}
