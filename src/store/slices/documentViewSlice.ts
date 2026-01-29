import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DocumentViewState {
  // State
  documentRotations: Record<string, number>;
  documentPages: Record<string, number>;
  documentScales: Record<string, number>;
  documentLocations: Record<string, { x: number; y: number }>;
  lastViewedDocumentId: string | null;
  
  // Rotation actions
  setDocumentRotation: (documentId: string, rotation: number) => void;
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
  
  // Last viewed
  setLastViewedDocumentId: (documentId: string) => void;
  getLastViewedDocumentId: () => string | null;
}

export const useDocumentViewStore = create<DocumentViewState>()(
  persist(
    (set, get) => ({
      // Initial state
      documentRotations: {},
      documentPages: {},
      documentScales: {},
      documentLocations: {},
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
      
      // Last viewed
      setLastViewedDocumentId: (documentId: string) => {
        set({ lastViewedDocumentId: documentId });
      },
      
      getLastViewedDocumentId: () => {
        return get().lastViewedDocumentId;
      }
    }),
    {
      name: 'document-view-store',
      partialize: (state) => ({
        documentRotations: state.documentRotations,
        documentPages: state.documentPages,
        documentScales: state.documentScales,
        documentLocations: state.documentLocations,
        lastViewedDocumentId: state.lastViewedDocumentId
      })
    }
  )
);
