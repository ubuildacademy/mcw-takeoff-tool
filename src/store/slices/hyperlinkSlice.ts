import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SheetHyperlink } from '../../types';

interface HyperlinkState {
  hyperlinks: SheetHyperlink[];

  addHyperlink: (hyperlink: Omit<SheetHyperlink, 'id' | 'timestamp'>) => SheetHyperlink;
  addHyperlinksBulk: (hyperlinks: SheetHyperlink[]) => void;
  updateHyperlink: (id: string, updates: Partial<Pick<SheetHyperlink, 'targetSheetId' | 'targetPageNumber' | 'targetUrl' | 'sourceRect'>>) => void;
  deleteHyperlink: (id: string) => void;
  clearAllHyperlinks: () => void;
  /** Removes links with origin === 'batch' for this project; returns count removed. */
  clearBatchHyperlinksForProject: (projectId: string) => number;
  getPageHyperlinks: (projectId: string, sheetId: string, pageNumber: number) => SheetHyperlink[];
  getHyperlinkById: (id: string) => SheetHyperlink | undefined;
}

export const useHyperlinkStore = create<HyperlinkState>()(
  persist(
    (set, get) => ({
      hyperlinks: [],

      addHyperlink: (data) => {
        const hyperlink: SheetHyperlink = {
          ...data,
          origin: data.origin ?? 'manual',
          id: `hyperlink-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          timestamp: new Date().toISOString(),
        };
        set((state) => ({ hyperlinks: [...state.hyperlinks, hyperlink] }));
        return hyperlink;
      },

      addHyperlinksBulk: (hyperlinksToAdd) => {
        if (hyperlinksToAdd.length === 0) return;
        set((state) => ({
          hyperlinks: [...state.hyperlinks, ...hyperlinksToAdd],
        }));
      },

      updateHyperlink: (id, updates) => {
        set((state) => ({
          hyperlinks: state.hyperlinks.map((h) =>
            h.id === id ? { ...h, ...updates } : h
          ),
        }));
      },

      deleteHyperlink: (id) => {
        set((state) => ({
          hyperlinks: state.hyperlinks.filter((h) => h.id !== id),
        }));
      },

      clearAllHyperlinks: () => {
        set({ hyperlinks: [] });
      },

      clearBatchHyperlinksForProject: (projectId) => {
        let removed = 0;
        set((state) => ({
          hyperlinks: state.hyperlinks.filter((h) => {
            if (h.projectId !== projectId || h.origin !== 'batch') return true;
            removed += 1;
            return false;
          }),
        }));
        return removed;
      },

      getPageHyperlinks: (projectId, sheetId, pageNumber) => {
        return get().hyperlinks.filter(
          (h) =>
            h.projectId === projectId &&
            h.sourceSheetId === sheetId &&
            h.sourcePageNumber === pageNumber
        );
      },

      getHyperlinkById: (id) => {
        return get().hyperlinks.find((h) => h.id === id);
      },
    }),
    { name: 'hyperlink-store', partialize: (s) => ({ hyperlinks: s.hyperlinks }) }
  )
);
