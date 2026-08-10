/**
 * Condition templates ("trade packs"): save this project's condition list as a
 * reusable template, or apply a saved template to seed the current project.
 * New-project setup drops from re-creating dozens of conditions to one click.
 *
 * Task I8 adds the library's priced assemblies as a second kind of template:
 * picking one creates the conditions it needs measured, already wired to the
 * assembly, so the Costs tab prices them the moment anything is drawn.
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BaseDialog } from '../ui/base-dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { Trash2 } from 'lucide-react';
import {
  useConditionTemplatesStore,
  type ConditionTemplate,
} from '../../store/slices/conditionTemplatesSlice';
import { useConditionStore } from '../../store/slices/conditionSlice';
import { useConditionFolderStore } from '../../store/slices/conditionFolderSlice';
import { authHelpers } from '../../lib/supabase';
import type { TakeoffCondition } from '../../types';
import { assemblyLibraryService, type AssemblyListItem } from '../../services/apiService';
import { buildConditionsFromAssembly } from '../../utils/assemblyConditionTemplate';
import { generateDistinctColor, extractErrorMessage } from '../../utils/commonUtils';
import { filterAssemblies, groupAssembliesByBrand } from '../../utils/assemblyListFilter';

interface ConditionTemplatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Current project's conditions (source for "Save as template"). */
  conditions: TakeoffCondition[];
  /** Whether the caller's company has the assemblies feature (upsell switch, 2026-08-10)
   *  — hides "Start from a priced assembly" and skips fetching the library entirely when
   *  off, rather than relying on the fetch itself failing closed. */
  assembliesEnabled?: boolean;
}

export function ConditionTemplatesDialog({
  open,
  onOpenChange,
  projectId,
  conditions,
  assembliesEnabled = false,
}: ConditionTemplatesDialogProps) {
  const templates = useConditionTemplatesStore((s) => s.templates);
  const loadConditionTemplates = useConditionTemplatesStore((s) => s.loadConditionTemplates);
  const saveTemplate = useConditionTemplatesStore((s) => s.saveTemplate);
  const deleteTemplate = useConditionTemplatesStore((s) => s.deleteTemplate);
  const setTemplateShared = useConditionTemplatesStore((s) => s.setTemplateShared);

  const [newName, setNewName] = useState('');
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [assemblies, setAssemblies] = useState<AssemblyListItem[]>([]);
  const [assemblyQuery, setAssemblyQuery] = useState('');

  const assemblyGroups = useMemo(
    () => groupAssembliesByBrand(filterAssemblies(assemblies, assemblyQuery)),
    [assemblies, assemblyQuery]
  );

  useEffect(() => {
    if (!open) return;
    loadConditionTemplates();
    authHelpers.getCurrentUser().then((user) => setCurrentUserId(user?.id ?? null));
    if (!assembliesEnabled) {
      setAssemblies([]);
      return;
    }
    // Having no library — or no org yet — is not an error worth a toast; the
    // section simply doesn't render.
    assemblyLibraryService
      .list()
      .then(setAssemblies)
      .catch(() => setAssemblies([]));
  }, [open, loadConditionTemplates, assembliesEnabled]);

  const handleSave = () => {
    const name = newName.trim();
    if (!name) return;
    if (conditions.length === 0) {
      toast.error('This project has no conditions to save.');
      return;
    }
    if (!currentUserId) {
      toast.error('Still confirming your account — try again in a moment.');
      return;
    }
    saveTemplate(name, conditions, currentUserId);
    setNewName('');
    toast.success(`Template "${name}" saved (${conditions.length} conditions)`);
  };

  const handleApply = async (template: ConditionTemplate) => {
    if (applyingId) return;
    setApplyingId(template.id);
    const addCondition = useConditionStore.getState().addCondition;
    // Skip conditions whose name already exists in the project (re-apply safe).
    const existingNames = new Set(
      conditions.map((c) => c.name.trim().toLowerCase())
    );
    let created = 0;
    let skipped = 0;
    try {
      for (const tc of template.conditions) {
        if (existingNames.has(tc.name.trim().toLowerCase())) {
          skipped += 1;
          continue;
        }
        await addCondition({ ...tc, projectId });
        created += 1;
      }
      toast.success(
        `Applied "${template.name}": ${created} condition${created === 1 ? '' : 's'} added` +
          (skipped > 0 ? `, ${skipped} skipped (name already exists)` : '')
      );
      onOpenChange(false);
    } catch (error) {
      console.error('Template apply failed:', error);
      toast.error(
        `Template partially applied (${created} added). Check your connection and re-apply — existing names are skipped.`
      );
    } finally {
      setApplyingId(null);
    }
  };

  const handleApplyAssembly = async (assembly: AssemblyListItem) => {
    if (applyingId) return;
    setApplyingId(assembly.id);
    try {
      const detail = await assemblyLibraryService.detail(assembly.id);
      if (detail.quantityInputs.length === 0) {
        toast.error(`"${assembly.name}" has no quantity to measure — re-import it before using it here.`);
        return;
      }

      // Group the conditions this assembly needs under a folder named after it, rather
      // than dropping them uncategorized into the list — otherwise a multi-input
      // assembly (Jeff, 2026-08-10: 7 conditions from one "Add condition" click) reads
      // as clutter instead of a set. Reuse the folder if applying this assembly again.
      const { getFolders, ensureFoldersLoaded, createFolder } = useConditionFolderStore.getState();
      await ensureFoldersLoaded(projectId);
      const existingFolder = getFolders(projectId).find(
        (f) => f.name.trim().toLowerCase() === assembly.name.trim().toLowerCase()
      );
      const folder = existingFolder ?? (await createFolder(projectId, assembly.name));

      const { drafts, unrecognizedUnits } = buildConditionsFromAssembly(detail, {
        existingNames: conditions.map((c) => c.name),
        existingColors: conditions.map((c) => c.color).filter(Boolean),
        pickColor: generateDistinctColor,
        folderId: folder.id,
      });

      const addCondition = useConditionStore.getState().addCondition;
      for (const draft of drafts) {
        await addCondition({ ...draft, projectId });
      }

      toast.success(
        `Added ${drafts.length} condition${drafts.length === 1 ? '' : 's'} from "${assembly.name}" — ` +
          'draw on a sheet and the Costs tab prices the assembly.'
      );
      if (unrecognizedUnits.length > 0) {
        toast.warning(
          `Check the measurement type on: ${unrecognizedUnits.join(', ')} — the assembly's unit isn't one Meridian measures.`
        );
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(extractErrorMessage(error, `Failed to add conditions from "${assembly.name}"`));
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <BaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Condition templates"
      maxWidth="lg"
      footer={
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {assemblies.length > 0 && (
          <div className="space-y-2">
            <Label>Start from a priced assembly</Label>
            <Input
              value={assemblyQuery}
              onChange={(e) => setAssemblyQuery(e.target.value)}
              placeholder="Search by name or brand…"
              className="h-8"
            />
            <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
              {assemblyGroups.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No assembly matches “{assemblyQuery.trim()}”.
                </p>
              )}
              {assemblyGroups.map((group) => (
                <div key={group.label}>
                  {assemblyGroups.length > 1 && (
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
                      {group.label}
                    </div>
                  )}
                  {group.assemblies.map((assembly) => (
                    <div key={assembly.id} className="flex items-center gap-3 px-3 py-2">
                      <p className="flex-1 min-w-0 truncate text-sm font-medium">{assembly.name}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleApplyAssembly(assembly)}
                        disabled={applyingId !== null}
                      >
                        {applyingId === assembly.id ? 'Adding…' : 'Add condition'}
                      </Button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Creates the conditions this assembly needs measured, already priced by it — no
              wiring, and no per-unit costs to enter. Waste comes from the assembly.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="template-name">Save current conditions as a template</Label>
          <div className="flex gap-2">
            <Input
              id="template-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder='e.g. "Waterproofing — Div 7" or "Residential drywall"'
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
            />
            <Button onClick={handleSave} disabled={!newName.trim() || conditions.length === 0}>
              Save ({conditions.length})
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Saves names, types, units, colors, costs, waste factors, and sub-quantities.
            Auto-count search images stay with their project.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Apply a template to this project</Label>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground border rounded-md px-3 py-4 text-center">
              No templates yet — save this project's conditions above to create one.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
              {templates.map((template) => {
                const isOwner = currentUserId != null && template.userId === currentUserId;
                return (
                  <div key={template.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{template.name}</p>
                        {!isOwner && (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Shared
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {template.conditions.length} condition
                        {template.conditions.length === 1 ? '' : 's'} ·{' '}
                        {new Date(template.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {isOwner && (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                        <Checkbox
                          checked={template.shared}
                          onCheckedChange={(checked) => setTemplateShared(template.id, checked)}
                        />
                        Share
                      </label>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleApply(template)}
                      disabled={applyingId !== null}
                    >
                      {applyingId === template.id ? 'Applying…' : 'Apply'}
                    </Button>
                    {isOwner && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        title="Delete template"
                        onClick={() => {
                          deleteTemplate(template.id);
                          toast.success(`Template "${template.name}" deleted`);
                        }}
                        disabled={applyingId !== null}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </BaseDialog>
  );
}
