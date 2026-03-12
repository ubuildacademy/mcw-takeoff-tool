/**
 * Document view state (page, scale, rotation, scroll) per document.
 * Persisted to localStorage so viewport restores on reload.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { parseDocumentIdFromSheetId } from '../../lib/sheetUtils';

interface DocumentViewState {
  // State
  documentRotations: Record<string, number>;
  documentPages: Record<string, number>;
  documentScales: Record<string, number>;
  documentLocations: Record<string, { x: number; y: number }>;
  /** Per-sheet view state for multi-tab (sheetId = documentId-pageNumber) */
  documentRotationsBySheet: Record<string, number>;
  documentScalesBySheet: Record<string, number>;
  documentLocationsBySheet: Record<string, { x: number; y: number }>;
  /** Per-project last viewed document (projectId -> documentId) so reload restores the right doc per project */
  lastViewedDocumentIds: Record<string, string>;
  /** @deprecated Legacy single last viewed; used as fallback when no per-project entry */
  lastViewedDocumentId: string | null;

  // Rotation actions
  setDocumentRotation: (documentId: string, rotation: number) => void;
  /** Set multiple document rotations in a single update (e.g. from backup/import). */
  setDocumentRotations: (rotations: Record<string, number>) => void;
  /** Set rotation for all sheets in a document (document-level rotation). */
  setDocumentRotationsForDocument: (documentId: string, rotation: number, totalPages: number) => void;
  getDocumentRotation: (documentId: string) => number;

  // Page actions
  setDocumentPage: (documentId: string, page: number) => void;
  getDocumentPage: (documentId: string) => number;

  // Scale actions
  setDocumentScale: (documentId: string, scale: number) => void;
  getDocumentScale: (documentId: string) => number;

  // Location actions
  setDocumentLocation: (documentId: string, location: { x: number; y: number }) => void;
  getDocumentLocation: (documentId: string) => { x: number; y: number };

  // Last viewed (per project)
  setLastViewedDocumentId: (projectId: string, documentId: string) => void;
  getLastViewedDocumentId: (projectId: string) => string | null;

  // Per-sheet actions (for multi-tab; sheetId = documentId-pageNumber)
  setDocumentRotationBySheet: (sheetId: string, rotation: number) => void;
  getDocumentRotationBySheet: (sheetId: string) => number;
  setDocumentScaleBySheet: (sheetId: string, scale: number) => void;
  getDocumentScaleBySheet: (sheetId: string) => number;
  setDocumentLocationBySheet: (sheetId: string, location: { x: number; y: number }) => void;
  getDocumentLocationBySheet: (sheetId: string) => { x: number; y: number };
}

export const useDocumentViewStore = create<DocumentViewState>()(
  persist(
    (set, get) => ({
      // Initial state
      documentRotations: {},
      documentPages: {},
      documentScales: {},
      documentLocations: {},
      documentRotationsBySheet: {},
      documentScalesBySheet: {},
      documentLocationsBySheet: {},
      lastViewedDocumentIds: {},
      lastViewedDocumentId: null,

      // Rotation actions
      setDocumentRotation: (documentId, rotation) => {
        set(state => ({
          documentRotations: {
            ...state.documentRotations,
            [documentId]: rotation
          }
        }));
      },

      setDocumentRotations: (rotations) => {
        if (Object.keys(rotations).length === 0) return;
        set(state => ({
          documentRotations: {
            ...state.documentRotations,
            ...rotations
          }
        }));
      },

      setDocumentRotationsForDocument: (documentId, rotation, totalPages) => {
        set(state => {
          const nextBySheet = { ...state.documentRotationsBySheet };
          for (let p = 1; p <= totalPages; p++) {
            nextBySheet[`${documentId}-${p}`] = rotation;
          }
          return {
            documentRotations: {
              ...state.documentRotations,
              [documentId]: rotation,
            },
            documentRotationsBySheet: nextBySheet,
          };
        });
      },

      getDocumentRotation: (documentId) => {
        const state = get();
        return state.documentRotations[documentId] || 0;
      },
      
      // Page actions
      setDocumentPage: (documentId, page) => {
        set(state => ({
          documentPages: {
            ...state.documentPages,
            [documentId]: page
          }
        }));
      },
      
      getDocumentPage: (documentId) => {
        const state = get();
        return state.documentPages[documentId] || 1;
      },
      
      // Scale actions
      setDocumentScale: (documentId, scale) => {
        set(state => ({
          documentScales: {
            ...state.documentScales,
            [documentId]: scale
          }
        }));
      },
      
      getDocumentScale: (documentId) => {
        const state = get();
        return state.documentScales[documentId] || 1;
      },
      
      // Location actions
      setDocumentLocation: (documentId, location) => {
        set(state => ({
          documentLocations: {
            ...state.documentLocations,
            [documentId]: location
          }
        }));
      },
      
      getDocumentLocation: (documentId) => {
        const state = get();
        return state.documentLocations[documentId] || { x: 0, y: 0 };
      },
      
      // Last viewed (per project)
      setLastViewedDocumentId: (projectId: string, documentId: string) => {
        set((state) => ({
          lastViewedDocumentIds: {
            ...state.lastViewedDocumentIds,
            [projectId]: documentId,
          },
        }));
      },

      getLastViewedDocumentId: (projectId: string) => {
        const state = get();
        return state.lastViewedDocumentIds[projectId] ?? state.lastViewedDocumentId ?? null;
      },

      setDocumentRotationBySheet: (sheetId, rotation) => {
        set(state => ({
          documentRotationsBySheet: {
            ...state.documentRotationsBySheet,
            [sheetId]: rotation,
          },
        }));
      },

      getDocumentRotationBySheet: (sheetId) => {
        const state = get();
        const bySheet = state.documentRotationsBySheet[sheetId];
        if (bySheet != null) return bySheet;
        // Only fall back to document-level if NO sheet in this document has explicit rotation.
        // Otherwise we'd incorrectly apply one sheet's rotation to others when switching tabs.
        const documentId = parseDocumentIdFromSheetId(sheetId);
        const hasAnyBySheetForDoc = Object.keys(state.documentRotationsBySheet).some(
          (sid) => parseDocumentIdFromSheetId(sid) === documentId
        );
        if (hasAnyBySheetForDoc) return 0;
        return state.documentRotations[documentId] ?? 0;
      },

      setDocumentScaleBySheet: (sheetId, scale) => {
        set(state => ({
          documentScalesBySheet: {
            ...state.documentScalesBySheet,
            [sheetId]: scale,
          },
        }));
      },

      getDocumentScaleBySheet: (sheetId) => {
        const state = get();
        const bySheet = state.documentScalesBySheet[sheetId];
        if (bySheet != null) return bySheet;
        return state.documentScales[parseDocumentIdFromSheetId(sheetId)] ?? 1;
      },

      setDocumentLocationBySheet: (sheetId, location) => {
        set(state => ({
          documentLocationsBySheet: {
            ...state.documentLocationsBySheet,
            [sheetId]: location,
          },
        }));
      },

      getDocumentLocationBySheet: (sheetId) => {
        const state = get();
        const bySheet = state.documentLocationsBySheet[sheetId];
        if (bySheet != null) return bySheet;
        return state.documentLocations[parseDocumentIdFromSheetId(sheetId)] ?? { x: 0, y: 0 };
      },
    }),
    {
      name: 'document-view-store',
      partialize: (state) => ({
        documentRotations: state.documentRotations,
        documentPages: state.documentPages,
        documentScales: state.documentScales,
        documentLocations: state.documentLocations,
        documentRotationsBySheet: state.documentRotationsBySheet,
        documentScalesBySheet: state.documentScalesBySheet,
        documentLocationsBySheet: state.documentLocationsBySheet,
        lastViewedDocumentIds: state.lastViewedDocumentIds,
        lastViewedDocumentId: state.lastViewedDocumentId,
      }),
    }
  )
);
