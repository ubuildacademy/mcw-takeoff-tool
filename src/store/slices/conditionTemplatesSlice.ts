/**
 * Condition templates ("trade packs"): save a project's condition set once,
 * apply it to any new project in one click. Cuts new-project setup from
 * re-creating dozens of conditions by hand to seconds.
 *
 * Templates store only condition *definitions* (costs, waste, units, colors,
 * sub-quantities…) — never project-specific ids, folders, or auto-count
 * search images (those reference uploaded files in a specific project).
 * Persisted to localStorage; templates are a per-user library.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TakeoffCondition } from '../../types';

/** Condition definition with project-specific fields stripped. */
export type TemplateCondition = Omit<
  TakeoffCondition,
  'id' | 'projectId' | 'folderId' | 'searchImage' | 'searchImageId' | 'aiGenerated'
>;

export interface ConditionTemplate {
  id: string;
  name: string;
  createdAt: string;
  conditions: TemplateCondition[];
}

interface ConditionTemplatesState {
  templates: ConditionTemplate[];

  saveTemplate: (name: string, conditions: TakeoffCondition[]) => ConditionTemplate;
  deleteTemplate: (id: string) => void;
  renameTemplate: (id: string, name: string) => void;
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

export const useConditionTemplatesStore = create<ConditionTemplatesState>()(
  persist(
    (set) => ({
      templates: [],

      saveTemplate: (name, conditions) => {
        const template: ConditionTemplate = {
          id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name: name.trim(),
          createdAt: new Date().toISOString(),
          conditions: conditions.map(toTemplateCondition),
        };
        set((state) => ({ templates: [...state.templates, template] }));
        return template;
      },

      deleteTemplate: (id) =>
        set((state) => ({ templates: state.templates.filter((t) => t.id !== id) })),

      renameTemplate: (id, name) =>
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id ? { ...t, name: name.trim() } : t
          ),
        })),
    }),
    { name: 'condition-templates' }
  )
);
