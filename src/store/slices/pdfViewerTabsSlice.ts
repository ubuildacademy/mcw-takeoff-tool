/**
 * PDF viewer tab state - multiple open sheets (document+page) per project.
 * Persisted so users can jump back in with the same tabs open.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getSheetId } from '../../lib/sheetUtils';

export const PDF_VIEWER_MAX_TABS = 15;

export interface PDFViewerTab {
  id: string;
  documentId: string;
  pageNumber: number;
  label: string;
}

interface PdfViewerTabsState {
  /** Per-project open tabs */
  openTabsByProject: Record<string, PDFViewerTab[]>;
  /** Per-project active tab id */
  activeTabIdByProject: Record<string, string | null>;

  getOpenTabs: (projectId: string) => PDFViewerTab[];
  getActiveTabId: (projectId: string) => string | null;
  getActiveTab: (projectId: string) => PDFViewerTab | null;

  addTab: (
    projectId: string,
    tab: Omit<PDFViewerTab, 'id'> & { id?: string }
  ) => void;
  closeTab: (projectId: string, tabId: string) => void;
  closeAllOtherTabs: (projectId: string, keepTabId: string) => void;
  setActiveTab: (projectId: string, tabId: string | null) => void;
  replaceActiveTab: (
    projectId: string,
    documentId: string,
    pageNumber: number,
    label: string
  ) => void;
}

export const usePdfViewerTabsStore = create<PdfViewerTabsState>()(
  persist(
    (set, get) => ({
      openTabsByProject: {},
      activeTabIdByProject: {},

      getOpenTabs: (projectId) => {
        const state = get();
        return state.openTabsByProject[projectId] ?? [];
      },

      getActiveTabId: (projectId) => {
        const state = get();
        return state.activeTabIdByProject[projectId] ?? null;
      },

      getActiveTab: (projectId) => {
        const state = get();
        const tabs = state.openTabsByProject[projectId] ?? [];
        const activeId = state.activeTabIdByProject[projectId] ?? null;
        if (!activeId) return null;
        return tabs.find((t) => t.id === activeId) ?? null;
      },

      addTab: (projectId, tabInput) => {
        const sheetId = getSheetId(tabInput.documentId, tabInput.pageNumber);
        const id = tabInput.id ?? sheetId;

        set((state) => {
          const tabs = state.openTabsByProject[projectId] ?? [];
          const existing = tabs.find(
            (t) =>
              t.documentId === tabInput.documentId &&
              t.pageNumber === tabInput.pageNumber
          );
          if (existing) {
            return {
              ...state,
              activeTabIdByProject: {
                ...state.activeTabIdByProject,
                [projectId]: existing.id,
              },
            };
          }
          if (tabs.length >= PDF_VIEWER_MAX_TABS) return state;

          const newTab: PDFViewerTab = {
            id,
            documentId: tabInput.documentId,
            pageNumber: tabInput.pageNumber,
            label: tabInput.label,
          };

          return {
            ...state,
            openTabsByProject: {
              ...state.openTabsByProject,
              [projectId]: [...tabs, newTab],
            },
            activeTabIdByProject: {
              ...state.activeTabIdByProject,
              [projectId]: newTab.id,
            },
          };
        });
      },

      closeTab: (projectId, tabId) => {
        set((state) => {
          const tabs = state.openTabsByProject[projectId] ?? [];
          const next = tabs.filter((t) => t.id !== tabId);
          const activeId = state.activeTabIdByProject[projectId];

          let newActiveId: string | null = activeId;
          if (activeId === tabId) {
            const closedIndex = tabs.findIndex((t) => t.id === tabId);
            if (next.length > 0) {
              const idx = Math.min(closedIndex, next.length - 1);
              newActiveId = next[idx]!.id;
            } else {
              newActiveId = null;
            }
          }

          return {
            ...state,
            openTabsByProject: {
              ...state.openTabsByProject,
              [projectId]: next,
            },
            activeTabIdByProject: {
              ...state.activeTabIdByProject,
              [projectId]: newActiveId,
            },
          };
        });
      },

      closeAllOtherTabs: (projectId, keepTabId) => {
        set((state) => {
          const tabs = state.openTabsByProject[projectId] ?? [];
          const kept = tabs.find((t) => t.id === keepTabId);
          if (!kept) return state;

          return {
            ...state,
            openTabsByProject: {
              ...state.openTabsByProject,
              [projectId]: [kept],
            },
            activeTabIdByProject: {
              ...state.activeTabIdByProject,
              [projectId]: keepTabId,
            },
          };
        });
      },

      setActiveTab: (projectId, tabId) => {
        set((state) => ({
          ...state,
          activeTabIdByProject: {
            ...state.activeTabIdByProject,
            [projectId]: tabId,
          },
        }));
      },

      replaceActiveTab: (projectId, documentId, pageNumber, label) => {
        const sheetId = getSheetId(documentId, pageNumber);

        set((state) => {
          const tabs = state.openTabsByProject[projectId] ?? [];
          const activeId = state.activeTabIdByProject[projectId] ?? null;

          const existing = tabs.find(
            (t) => t.documentId === documentId && t.pageNumber === pageNumber
          );
          if (existing) {
            return {
              ...state,
              activeTabIdByProject: {
                ...state.activeTabIdByProject,
                [projectId]: existing.id,
              },
            };
          }

          if (tabs.length === 0) {
            const newTab: PDFViewerTab = {
              id: sheetId,
              documentId,
              pageNumber,
              label,
            };
            return {
              ...state,
              openTabsByProject: {
                ...state.openTabsByProject,
                [projectId]: [newTab],
              },
              activeTabIdByProject: {
                ...state.activeTabIdByProject,
                [projectId]: newTab.id,
              },
            };
          }

          const newTab: PDFViewerTab = {
            id: sheetId,
            documentId,
            pageNumber,
            label,
          };
          const nextTabs = activeId
            ? tabs.map((t) => (t.id === activeId ? newTab : t))
            : [...tabs, newTab];

          return {
            ...state,
            openTabsByProject: {
              ...state.openTabsByProject,
              [projectId]: nextTabs,
            },
            activeTabIdByProject: {
              ...state.activeTabIdByProject,
              [projectId]: newTab.id,
            },
          };
        });
      },
    }),
    {
      name: 'pdf-viewer-tabs-store',
      partialize: (state) => ({
        openTabsByProject: state.openTabsByProject,
        activeTabIdByProject: state.activeTabIdByProject,
      }),
    }
  )
);
