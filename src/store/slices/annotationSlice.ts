import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Annotation } from '../../types';

interface AnnotationState {
  // State
  annotations: Annotation[];
  
  // Actions
  addAnnotation: (annotation: Omit<Annotation, 'id' | 'timestamp'>) => Annotation;
  /** Add multiple annotations in a single update (e.g. from backup/import). */
  addAnnotationsBulk: (annotations: Annotation[]) => void;
  updateAnnotation: (id: string, updates: Partial<Pick<Annotation, 'points' | 'color' | 'text'>>) => void;
  deleteAnnotation: (id: string) => void;
  clearPageAnnotations: (projectId: string, sheetId: string, pageNumber: number) => void;
  
  // Getters
  getPageAnnotations: (projectId: string, sheetId: string, pageNumber: number) => Annotation[];
  getAnnotationById: (id: string) => Annotation | undefined;
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
        return annotation;
      },

      addAnnotationsBulk: (annotationsToAdd) => {
        if (annotationsToAdd.length === 0) return;
        set(state => ({
          annotations: [...state.annotations, ...annotationsToAdd]
        }));
      },

      updateAnnotation: (id, updates) => {
        set(state => ({
          annotations: state.annotations.map(a =>
            a.id === id ? { ...a, ...updates } : a
          )
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
      },
      
      getAnnotationById: (id) => {
        return get().annotations.find(a => a.id === id);
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
