/**
 * Per-project PDF export preferences (legend visibility/position, markup label mode).
 * Persisted to localStorage — titleblock layout differs per plan set, so the legend
 * position choice should stick with the project.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_PDF_SHEET_EXPORT_OPTIONS,
  type PdfSheetExportOptions,
} from '../../utils/pdfExportUtils';

interface PdfExportPrefsState {
  optionsByProject: Record<string, PdfSheetExportOptions>;

  getOptions: (projectId: string) => PdfSheetExportOptions;
  setOptions: (projectId: string, options: PdfSheetExportOptions) => void;
}

export const usePdfExportPrefsStore = create<PdfExportPrefsState>()(
  persist(
    (set, get) => ({
      optionsByProject: {},

      getOptions: (projectId) =>
        get().optionsByProject[projectId] ?? DEFAULT_PDF_SHEET_EXPORT_OPTIONS,
      setOptions: (projectId, options) =>
        set((state) => ({
          optionsByProject: { ...state.optionsByProject, [projectId]: options },
        })),
    }),
    { name: 'pdf-export-prefs' }
  )
);
