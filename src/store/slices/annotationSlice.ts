import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Annotation } from '../../types';

interface AnnotationState {
  // State
  annotations: Annotation[];
  
  // Actions
  addAnnotation: (annotation: Omit<Annotation, 'id' | 'timestamp'>) => void;
  deleteAnnotation: (id: string) => void;
  clearPageAnnotations: (projectId: string, sheetId: string, pageNumber: number) => void;
  
  // Getters
  getPageAnnotations: (projectId: string, sheetId: string, pageNumber: number) => Annotation[];
}

export const useAnnotationStore = create<AnnotationState>()(
  persist(
    (set, get) => ({
      // Initial state
      annotations: [],
      
      // Actions
      addAnnotation: (annotationData) => {
        const annotation: Annotation = {
          ...annotationData,
          id: `annotation-${Date.now()}`,
          timestamp: new Date().toISOString()
        };
        
        set(state => ({
          annotations: [...state.annotations, annotation]
        }));
      },
      
      deleteAnnotation: (id) => {
        set(state => ({
          annotations: state.annotations.filter(a => a.id !== id)
        }));
      },
      
      clearPageAnnotations: (projectId, sheetId, pageNumber) => {
        set(state => ({
          annotations: state.annotations.filter(
            a => !(a.projectId === projectId && a.sheetId === sheetId && a.pageNumber === pageNumber)
          )
        }));
      },
      
      // Getters
      getPageAnnotations: (projectId, sheetId, pageNumber) => {
        const state = get();
        return state.annotations.filter(
          a => a.projectId === projectId && a.sheetId === sheetId && a.pageNumber === pageNumber
        );
      }
    }),
    {
      name: 'annotation-store',
      partialize: (state) => ({
        annotations: state.annotations
      })
    }
  )
);
