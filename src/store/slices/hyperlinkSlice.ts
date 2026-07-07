/**
 * Sheet hyperlinks — DB-backed (2026-07 migration from localStorage) so links
 * follow the project across devices, browsers, and shared-project members.
 *
 * Writes are optimistic: local state updates synchronously (callers keep the
 * old sync API), persistence runs in the background with an error toast on
 * failure. Ids are client-generated so optimistic entries never need
 * reconciliation and legacy localStorage links keep their ids on import.
 *
 * `loadProjectHyperlinks(projectId)` fetches the project's links on workspace
 * open and performs a ONE-TIME import of any legacy localStorage links
 * (pre-migration data under the 'hyperlink-store' persist key).
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import type { SheetHyperlink } from '../../types';
import { hyperlinkService } from '../../services/apiService';

const LEGACY_STORAGE_KEY = 'hyperlink-store';

interface HyperlinkState {
  hyperlinks: SheetHyperlink[];
  /** Projects whose links have been fetched this session. */
  loadedProjects: Record<string, boolean>;

  loadProjectHyperlinks: (projectId: string) => Promise<void>;
  addHyperlink: (hyperlink: Omit<SheetHyperlink, 'id' | 'timestamp'>) => SheetHyperlink;
  addHyperlinksBulk: (hyperlinks: SheetHyperlink[]) => void;
  updateHyperlink: (id: string, updates: Partial<Pick<SheetHyperlink, 'targetSheetId' | 'targetPageNumber' | 'targetUrl' | 'sourceRect' | 'targetViewport'>>) => void;
  deleteHyperlink: (id: string) => void;
  clearAllHyperlinks: (projectId: string) => void;
  /** Removes links with origin === 'batch' for this project; returns count removed. */
  clearBatchHyperlinksForProject: (projectId: string) => number;
  getPageHyperlinks: (projectId: string, sheetId: string, pageNumber: number) => SheetHyperlink[];
  getHyperlinkById: (id: string) => SheetHyperlink | undefined;
}

function newHyperlinkId(): string {
  return `hyperlink-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function persistError(action: string, error: unknown): void {
  console.error(`Hyperlink ${action} failed to save:`, error);
  toast.error(`Hyperlink ${action} didn't save to the server — check your connection.`);
}

/** Legacy localStorage links for a project (pre-DB data), or []. */
function readLegacyLinks(projectId: string): SheetHyperlink[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { state?: { hyperlinks?: SheetHyperlink[] } };
    const all = parsed.state?.hyperlinks;
    if (!Array.isArray(all)) return [];
    return all.filter((h) => h && h.projectId === projectId && h.id && h.sourceSheetId);
  } catch {
    return [];
  }
}

/** Drop a project's links from the legacy blob after successful import. */
function pruneLegacyLinks(projectId: string): void {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { state?: { hyperlinks?: SheetHyperlink[] } };
    if (!parsed.state?.hyperlinks) return;
    parsed.state.hyperlinks = parsed.state.hyperlinks.filter((h) => h?.projectId !== projectId);
    if (parsed.state.hyperlinks.length === 0) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } else {
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch {
    // best effort — worst case the import re-runs and upserts are idempotent
  }
}

export const useHyperlinkStore = create<HyperlinkState>()((set, get) => ({
  hyperlinks: [],
  loadedProjects: {},

  loadProjectHyperlinks: async (projectId) => {
    if (get().loadedProjects[projectId]) return;
    try {
      const { hyperlinks: serverLinks } = await hyperlinkService.getProjectHyperlinks(projectId);

      // One-time legacy import: pre-migration localStorage links the server
      // doesn't know about yet keep their ids (bulk upsert is idempotent).
      const serverIds = new Set(serverLinks.map((h) => h.id));
      const legacy = readLegacyLinks(projectId).filter((h) => !serverIds.has(h.id));
      let merged = serverLinks;
      if (legacy.length > 0) {
        try {
          await hyperlinkService.bulkUpsert(projectId, legacy);
          merged = [...serverLinks, ...legacy];
          pruneLegacyLinks(projectId);
          toast.success(
            `Moved ${legacy.length} hyperlink${legacy.length === 1 ? '' : 's'} from this browser to the project`
          );
        } catch (error) {
          console.error('Legacy hyperlink import failed:', error);
          merged = [...serverLinks, ...legacy]; // still usable locally this session
        }
      }

      set((state) => ({
        hyperlinks: [...state.hyperlinks.filter((h) => h.projectId !== projectId), ...merged],
        loadedProjects: { ...state.loadedProjects, [projectId]: true },
      }));
    } catch (error) {
      console.error('Failed to load hyperlinks:', error);
      // Fall back to legacy local links so the session isn't linkless offline.
      const legacy = readLegacyLinks(projectId);
      if (legacy.length > 0) {
        set((state) => ({
          hyperlinks: [...state.hyperlinks.filter((h) => h.projectId !== projectId), ...legacy],
        }));
      }
    }
  },

  addHyperlink: (data) => {
    const hyperlink: SheetHyperlink = {
      ...data,
      origin: data.origin ?? 'manual',
      id: newHyperlinkId(),
      timestamp: new Date().toISOString(),
    };
    set((state) => ({ hyperlinks: [...state.hyperlinks, hyperlink] }));
    hyperlinkService
      .bulkUpsert(hyperlink.projectId, [hyperlink])
      .catch((e) => persistError('create', e));
    return hyperlink;
  },

  addHyperlinksBulk: (hyperlinksToAdd) => {
    if (hyperlinksToAdd.length === 0) return;
    set((state) => ({ hyperlinks: [...state.hyperlinks, ...hyperlinksToAdd] }));
    const projectId = hyperlinksToAdd[0].projectId;
    hyperlinkService
      .bulkUpsert(projectId, hyperlinksToAdd)
      .catch((e) => persistError('bulk save', e));
  },

  updateHyperlink: (id, updates) => {
    const existing = get().hyperlinks.find((h) => h.id === id);
    set((state) => ({
      hyperlinks: state.hyperlinks.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    }));
    if (existing) {
      hyperlinkService
        .update(existing.projectId, id, updates)
        .catch((e) => persistError('update', e));
    }
  },

  deleteHyperlink: (id) => {
    const existing = get().hyperlinks.find((h) => h.id === id);
    set((state) => ({ hyperlinks: state.hyperlinks.filter((h) => h.id !== id) }));
    if (existing) {
      hyperlinkService
        .remove(existing.projectId, id)
        .catch((e) => persistError('delete', e));
    }
  },

  clearAllHyperlinks: (projectId) => {
    set((state) => ({
      hyperlinks: state.hyperlinks.filter((h) => h.projectId !== projectId),
    }));
    hyperlinkService.clearAll(projectId).catch((e) => persistError('clear', e));
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
    hyperlinkService.clearBatch(projectId).catch((e) => persistError('batch clear', e));
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
}));
