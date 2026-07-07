/**
 * Condition templates ("trade packs"): save a project's condition set once,
 * apply it to any new project in one click. Cuts new-project setup from
 * re-creating dozens of conditions by hand to seconds.
 *
 * Templates store only condition *definitions* (costs, waste, units, colors,
 * sub-quantities…) — never project-specific ids, folders, or auto-count
 * search images (those reference uploaded files in a specific project).
 *
 * DB-backed (2026-07 migration from localStorage) so templates follow the
 * user across devices and can be shared with the team. Writes are optimistic:
 * local state updates synchronously, persistence runs in the background with
 * an error toast on failure. Ids are client-generated so optimistic entries
 * never need reconciliation and legacy localStorage templates keep their ids
 * on import.
 *
 * `loadConditionTemplates()` fetches the user's + shared templates and
 * performs a ONE-TIME import of any legacy localStorage templates (pre-
 * migration data under the 'condition-templates' persist key).
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import type { TakeoffCondition } from '../../types';
import { conditionTemplateService } from '../../services/apiService';

const LEGACY_STORAGE_KEY = 'condition-templates';

/** Condition definition with project-specific fields stripped. */
export type TemplateCondition = Omit<
  TakeoffCondition,
  'id' | 'projectId' | 'folderId' | 'searchImage' | 'searchImageId' | 'aiGenerated'
>;

export interface ConditionTemplate {
  id: string;
  userId: string;
  name: string;
  shared: boolean;
  createdAt: string;
  conditions: TemplateCondition[];
}

interface ConditionTemplatesState {
  templates: ConditionTemplate[];
  loaded: boolean;

  loadConditionTemplates: () => Promise<void>;
  saveTemplate: (name: string, conditions: TakeoffCondition[], userId: string) => ConditionTemplate;
  deleteTemplate: (id: string) => void;
  renameTemplate: (id: string, name: string) => void;
  setTemplateShared: (id: string, shared: boolean) => void;
}

export function toTemplateCondition(c: TakeoffCondition): TemplateCondition {
  const {
    id: _id,
    projectId: _projectId,
    folderId: _folderId,
    searchImage: _searchImage,
    searchImageId: _searchImageId,
    aiGenerated: _aiGenerated,
    ...template
  } = c;
  return template;
}

function newTemplateId(): string {
  return `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function persistError(action: string, error: unknown): void {
  console.error(`Condition template ${action} failed to save:`, error);
  toast.error(`Template ${action} didn't save to the server — check your connection.`);
}

interface LegacyTemplate {
  id: string;
  name: string;
  createdAt: string;
  conditions: TemplateCondition[];
}

/** Legacy localStorage templates (pre-DB data), or []. */
function readLegacyTemplates(): LegacyTemplate[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { state?: { templates?: LegacyTemplate[] } };
    const all = parsed.state?.templates;
    if (!Array.isArray(all)) return [];
    return all.filter((t) => t && t.id && t.name);
  } catch {
    return [];
  }
}

/** Drop the legacy blob entirely after a successful import (whole key is per-user, not per-project). */
function pruneLegacyTemplates(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // best effort — worst case the import re-runs and upserts are idempotent
  }
}

export const useConditionTemplatesStore = create<ConditionTemplatesState>()((set, get) => ({
  templates: [],
  loaded: false,

  loadConditionTemplates: async () => {
    if (get().loaded) return;
    try {
      const { templates: serverTemplates } = await conditionTemplateService.list();

      // One-time legacy import: pre-migration localStorage templates the
      // server doesn't know about yet keep their ids (upsert is idempotent).
      const serverIds = new Set(serverTemplates.map((t) => t.id));
      const legacy = readLegacyTemplates().filter((t) => !serverIds.has(t.id));
      let merged = serverTemplates;
      if (legacy.length > 0) {
        try {
          const currentUserId = serverTemplates[0]?.userId;
          const imported: ConditionTemplate[] = [];
          for (const t of legacy) {
            const toSave: ConditionTemplate = {
              id: t.id,
              userId: currentUserId ?? '',
              name: t.name,
              shared: false,
              createdAt: t.createdAt,
              conditions: t.conditions,
            };
            const { template: saved } = await conditionTemplateService.save(toSave);
            imported.push(saved);
          }
          merged = [...serverTemplates, ...imported];
          pruneLegacyTemplates();
          toast.success(
            `Moved ${imported.length} template${imported.length === 1 ? '' : 's'} from this browser to your account`
          );
        } catch (error) {
          console.error('Legacy condition template import failed:', error);
          merged = serverTemplates; // legacy data stays in localStorage for a retry
        }
      }

      set({ templates: merged, loaded: true });
    } catch (error) {
      console.error('Failed to load condition templates:', error);
    }
  },

  saveTemplate: (name, conditions, userId) => {
    const template: ConditionTemplate = {
      id: newTemplateId(),
      userId,
      name: name.trim(),
      shared: false,
      createdAt: new Date().toISOString(),
      conditions: conditions.map(toTemplateCondition),
    };
    set((state) => ({ templates: [...state.templates, template] }));
    conditionTemplateService.save(template).catch((e) => persistError('save', e));
    return template;
  },

  deleteTemplate: (id) => {
    set((state) => ({ templates: state.templates.filter((t) => t.id !== id) }));
    conditionTemplateService.remove(id).catch((e) => persistError('delete', e));
  },

  renameTemplate: (id, name) => {
    const trimmed = name.trim();
    set((state) => ({
      templates: state.templates.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
    }));
    conditionTemplateService.update(id, { name: trimmed }).catch((e) => persistError('rename', e));
  },

  setTemplateShared: (id, shared) => {
    set((state) => ({
      templates: state.templates.map((t) => (t.id === id ? { ...t, shared } : t)),
    }));
    conditionTemplateService.update(id, { shared }).catch((e) => persistError('share', e));
  },
}));
