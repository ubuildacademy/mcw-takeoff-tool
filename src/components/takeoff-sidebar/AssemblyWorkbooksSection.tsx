import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { FileSpreadsheet, Upload, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/base-dialog';
import { authHelpers } from '../../lib/supabase';
import { useConditionStore } from '../../store/slices/conditionSlice';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import type { TakeoffCondition } from '../../types';
import { assemblyService, type AssemblyWorkbook, type AssemblyMapping } from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';
import { matchConditionsToMapping } from '../../utils/assemblyMatching';
import { AssemblyMappingForm } from './AssemblyMappingForm';
import { AssemblyGenerateConfirmDialog, type AssemblyGenerateItem } from './AssemblyGenerateConfirmDialog';

export interface AssemblyWorkbooksSectionProps {
  projectId: string;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AssemblyWorkbooksSection({ projectId }: AssemblyWorkbooksSectionProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [workbooks, setWorkbooks] = useState<AssemblyWorkbook[]>([]);
  const [workbooksLoading, setWorkbooksLoading] = useState(true);
  const [workbooksError, setWorkbooksError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Record<string, AssemblyMapping[]>>({});
  const [mappingsLoading, setMappingsLoading] = useState<Record<string, boolean>>({});

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deleteWorkbookId, setDeleteWorkbookId] = useState<string | null>(null);
  const [deletingWorkbookId, setDeletingWorkbookId] = useState<string | null>(null);

  const [addMappingWorkbookId, setAddMappingWorkbookId] = useState<string | null>(null);
  const [deleteMappingTarget, setDeleteMappingTarget] = useState<{ workbookId: string; mappingId: string } | null>(null);
  const [deletingMappingId, setDeletingMappingId] = useState<string | null>(null);

  const [generateConfirmItems, setGenerateConfirmItems] = useState<AssemblyGenerateItem[] | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    authHelpers.isAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWorkbooksLoading(true);
    assemblyService
      .listWorkbooks()
      .then((wbs) => {
        if (!cancelled) {
          setWorkbooks(wbs);
          setWorkbooksError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setWorkbooksError(extractErrorMessage(err, 'Failed to load assembly workbooks'));
      })
      .finally(() => {
        if (!cancelled) setWorkbooksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const missing = workbooks.filter((wb) => !(wb.id in mappings) && !mappingsLoading[wb.id]);
    if (missing.length === 0) return;
    missing.forEach((wb) => {
      setMappingsLoading((prev) => ({ ...prev, [wb.id]: true }));
      assemblyService
        .listMappings(wb.id)
        .then((ms) => setMappings((prev) => ({ ...prev, [wb.id]: ms })))
        .catch((err) => toast.error(extractErrorMessage(err, `Failed to load mappings for ${wb.filename}`)))
        .finally(() => setMappingsLoading((prev) => ({ ...prev, [wb.id]: false })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbooks]);

  const conditions = useConditionStore(useShallow((s) => s.getProjectConditions(projectId)));
  const getConditionTakeoffMeasurements = useMeasurementStore((s) => s.getConditionTakeoffMeasurements);

  const computeQuantity = (condition: TakeoffCondition): number => {
    const measurements = getConditionTakeoffMeasurements(projectId, condition.id);
    const net = measurements.reduce((sum, m) => sum + (m.netCalculatedValue ?? m.calculatedValue ?? 0), 0);
    return net * (condition.multiplier ?? 1);
  };

  const allMatchedItems = useMemo<AssemblyGenerateItem[]>(() => {
    const items: AssemblyGenerateItem[] = [];
    for (const wb of workbooks) {
      for (const mapping of mappings[wb.id] ?? []) {
        const matched = matchConditionsToMapping(conditions, mapping.conditionRef);
        if (matched.length === 0) continue;
        const breakdown = matched.map((c) => ({ conditionId: c.id, name: c.name, quantity: computeQuantity(c) }));
        const total = breakdown.reduce((sum, b) => sum + b.quantity, 0);
        items.push({ workbook: wb, mapping, breakdown, total });
      }
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbooks, mappings, conditions, getConditionTakeoffMeasurements]);

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const workbook = await assemblyService.uploadWorkbook(file);
      setWorkbooks((prev) => [workbook, ...prev]);
      toast.success('Workbook uploaded');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to upload workbook'));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteWorkbook = async (id: string) => {
    setDeletingWorkbookId(id);
    try {
      await assemblyService.deleteWorkbook(id);
      setWorkbooks((prev) => prev.filter((w) => w.id !== id));
      setMappings((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      toast.success('Workbook deleted');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to delete workbook'));
    } finally {
      setDeletingWorkbookId(null);
    }
  };

  const handleDeleteMapping = async (workbookId: string, mappingId: string) => {
    setDeletingMappingId(mappingId);
    try {
      await assemblyService.deleteMapping(mappingId);
      setMappings((prev) => ({
        ...prev,
        [workbookId]: (prev[workbookId] ?? []).filter((m) => m.id !== mappingId),
      }));
      toast.success('Mapping deleted');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to delete mapping'));
    } finally {
      setDeletingMappingId(null);
    }
  };

  const handleConfirmGenerate = async () => {
    if (!generateConfirmItems || generateConfirmItems.length === 0) return;
    setGenerating(true);
    let successCount = 0;
    for (const item of generateConfirmItems) {
      try {
        const blob = await assemblyService.generate({
          projectId,
          mappingId: item.mapping.id,
          conditionIds: item.breakdown.map((b) => b.conditionId),
        });
        downloadBlob(blob, item.workbook.filename);
        successCount++;
      } catch (err) {
        toast.error(extractErrorMessage(err, `Failed to generate ${item.workbook.filename}`));
      }
    }
    setGenerating(false);
    setGenerateConfirmItems(null);
    if (successCount > 0) {
      toast.success(successCount === 1 ? 'Workbook downloaded' : `${successCount} workbooks downloaded`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-foreground flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" />
          Assembly Workbooks
        </h4>
        {isAdmin && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={handleFileSelected}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 text-xs"
            >
              <Upload className="w-3 h-3" />
              {uploading ? 'Uploading…' : 'Upload workbook'}
            </Button>
          </>
        )}
      </div>

      {allMatchedItems.length >= 2 && (
        <Button
          size="sm"
          onClick={() => setGenerateConfirmItems(allMatchedItems)}
          className="w-full"
        >
          Generate All ({allMatchedItems.length})
        </Button>
      )}

      {workbooksLoading && <p className="text-sm text-muted-foreground">Loading workbooks…</p>}
      {workbooksError && <p className="text-sm text-destructive">{workbooksError}</p>}
      {!workbooksLoading && !workbooksError && workbooks.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No assembly workbooks yet.{isAdmin ? ' Upload one to get started.' : ''}
        </p>
      )}

      <div className="space-y-3">
        {workbooks.map((wb) => {
          const wbMappings = mappings[wb.id] ?? [];
          const wbMappingsLoading = mappingsLoading[wb.id] ?? false;

          return (
            <div key={wb.id} className="border rounded-lg p-3 bg-card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm text-foreground">{wb.filename}</div>
                  <div className="text-xs text-muted-foreground">
                    Uploaded {new Date(wb.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteWorkbookId(wb.id)}
                    disabled={deletingWorkbookId === wb.id}
                    aria-label="Delete workbook"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>

              <div className="mt-2 space-y-2">
                {wbMappingsLoading && <p className="text-xs text-muted-foreground">Loading mappings…</p>}
                {!wbMappingsLoading && wbMappings.length === 0 && addMappingWorkbookId !== wb.id && (
                  <p className="text-xs text-muted-foreground">No mappings yet.</p>
                )}

                {wbMappings.map((m) => {
                  const item = allMatchedItems.find((it) => it.mapping.id === m.id);
                  return (
                    <div key={m.id} className="flex items-center justify-between text-sm border-t border-border pt-2">
                      <div>
                        <span className="text-foreground">{m.conditionRef}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          → {m.inputs.map((i) => i.cell).join(', ')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {item && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setGenerateConfirmItems([item])}
                            className="text-xs"
                          >
                            Generate assembly
                          </Button>
                        )}
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteMappingTarget({ workbookId: wb.id, mappingId: m.id })}
                            disabled={deletingMappingId === m.id}
                            aria-label="Delete mapping"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {isAdmin &&
                  (addMappingWorkbookId === wb.id ? (
                    <AssemblyMappingForm
                      workbookId={wb.id}
                      onCreated={(mapping) => {
                        setMappings((prev) => ({ ...prev, [wb.id]: [...(prev[wb.id] ?? []), mapping] }));
                        setAddMappingWorkbookId(null);
                      }}
                      onCancel={() => setAddMappingWorkbookId(null)}
                    />
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAddMappingWorkbookId(wb.id)}
                      className="flex items-center gap-1 text-xs mt-1"
                    >
                      <Plus className="w-3 h-3" />
                      Add mapping
                    </Button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={deleteWorkbookId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteWorkbookId(null);
        }}
        title="Delete Workbook"
        description="This removes the workbook and all of its condition mappings. This cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteWorkbookId) handleDeleteWorkbook(deleteWorkbookId);
        }}
      />

      <ConfirmDialog
        open={deleteMappingTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteMappingTarget(null);
        }}
        title="Delete Mapping"
        description="This removes the condition mapping. This cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteMappingTarget) handleDeleteMapping(deleteMappingTarget.workbookId, deleteMappingTarget.mappingId);
        }}
      />

      <AssemblyGenerateConfirmDialog
        open={generateConfirmItems !== null}
        onOpenChange={(open) => {
          if (!open) setGenerateConfirmItems(null);
        }}
        items={generateConfirmItems ?? []}
        onConfirm={handleConfirmGenerate}
        confirming={generating}
      />
    </div>
  );
}
