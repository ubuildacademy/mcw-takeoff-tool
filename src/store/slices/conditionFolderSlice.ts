import { create } from 'zustand';
import type { ConditionFolder } from '../../types';

interface ConditionFolderState {
  foldersByProject: Record<string, ConditionFolder[]>;
  loadedProjects: Set<string>;

  getFolders: (projectId: string) => ConditionFolder[];
  loadFolders: (projectId: string) => Promise<void>;
  ensureFoldersLoaded: (projectId: string) => Promise<void>;
  createFolder: (projectId: string, name: string) => Promise<ConditionFolder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string, projectId: string) => Promise<void>;
  moveFolderUp: (id: string, projectId: string) => Promise<void>;
}

export const useConditionFolderStore = create<ConditionFolderState>()((set, get) => ({
  foldersByProject: {},
  loadedProjects: new Set(),

  getFolders: (projectId) => get().foldersByProject[projectId] ?? [],

  loadFolders: async (projectId) => {
    const { conditionFolderService } = await import('../../services/apiService');
    const { folders } = await conditionFolderService.getProjectFolders(projectId);
    set((s) => ({
      foldersByProject: { ...s.foldersByProject, [projectId]: folders },
      loadedProjects: new Set([...s.loadedProjects, projectId]),
    }));
  },

  ensureFoldersLoaded: async (projectId) => {
    if (get().loadedProjects.has(projectId)) return;
    await get().loadFolders(projectId);
  },

  createFolder: async (projectId, name) => {
    const { conditionFolderService } = await import('../../services/apiService');
    const { folder } = await conditionFolderService.createFolder(projectId, name);
    set((s) => ({
      foldersByProject: {
        ...s.foldersByProject,
        [projectId]: [...(s.foldersByProject[projectId] ?? []), folder],
      },
    }));
    return folder;
  },

  renameFolder: async (id, name) => {
    const { conditionFolderService } = await import('../../services/apiService');
    const { folder } = await conditionFolderService.updateFolder(id, { name });
    set((s) => {
      const projectId = folder.projectId;
      return {
        foldersByProject: {
          ...s.foldersByProject,
          [projectId]: (s.foldersByProject[projectId] ?? []).map((f) =>
            f.id === id ? folder : f
          ),
        },
      };
    });
  },

  deleteFolder: async (id, projectId) => {
    const { conditionFolderService } = await import('../../services/apiService');
    await conditionFolderService.deleteFolder(id);
    set((s) => ({
      foldersByProject: {
        ...s.foldersByProject,
        [projectId]: (s.foldersByProject[projectId] ?? []).filter((f) => f.id !== id),
      },
    }));
  },

  moveFolderUp: async (id, projectId) => {
    const folders = get().foldersByProject[projectId] ?? [];
    const idx = folders.findIndex((f) => f.id === id);
    if (idx <= 0) return;
    const reordered = [...folders];
    [reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
    const updated = reordered.map((f, i) => ({ ...f, sortOrder: i }));
    set((s) => ({
      foldersByProject: { ...s.foldersByProject, [projectId]: updated },
    }));
    const { conditionFolderService } = await import('../../services/apiService');
    await Promise.all(
      updated.map((f) => conditionFolderService.updateFolder(f.id, { sortOrder: f.sortOrder }))
    );
  },
}));
