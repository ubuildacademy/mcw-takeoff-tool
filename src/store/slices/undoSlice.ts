import { create } from 'zustand';
import type { Annotation } from '../../types';
import type { TakeoffMeasurement } from '../../types';
import { useAnnotationStore } from './annotationSlice';
import { useMeasurementStore } from './measurementSlice';

/** One reversible action for undo/redo. */
export type UndoEntry =
  | { type: 'annotation_add'; id: string; annotation: Annotation }
  | { type: 'annotation_update'; id: string; previous: Partial<Pick<Annotation, 'points' | 'color' | 'text'>>; next: Partial<Pick<Annotation, 'points' | 'color' | 'text'>> }
  | { type: 'annotation_delete'; annotation: Annotation }
  | { type: 'measurement_add'; id: string; createPayload: Omit<TakeoffMeasurement, 'id' | 'timestamp'> }
  | { type: 'measurement_update'; id: string; previous: Partial<TakeoffMeasurement>; next: Partial<TakeoffMeasurement> }
  | { type: 'measurement_delete'; measurement: TakeoffMeasurement };

const MAX_HISTORY = 50;

interface UndoState {
  past: UndoEntry[];
  future: UndoEntry[];

  push: (entry: UndoEntry) => void;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  clear: () => void;

  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useUndoStore = create<UndoState>()((set, get) => ({
  past: [],
  future: [],

  push(entry) {
    set((state) => ({
      past: [...state.past.slice(-(MAX_HISTORY - 1)), entry],
      future: [],
    }));
  },

  async undo() {
    const { past } = get();
    const entry = past[past.length - 1];
    if (!entry) return false;

    set((state) => ({
      past: state.past.slice(0, -1),
      future: [entry, ...state.future],
    }));

    const annotation = useAnnotationStore.getState();
    const measurement = useMeasurementStore.getState();

    try {
      switch (entry.type) {
        case 'annotation_add':
          annotation.deleteAnnotation(entry.id);
          break;
        case 'annotation_update':
          annotation.updateAnnotation(entry.id, entry.previous);
          break;
        case 'annotation_delete': {
          const created = annotation.addAnnotation({
            projectId: entry.annotation.projectId,
            sheetId: entry.annotation.sheetId,
            pageNumber: entry.annotation.pageNumber,
            type: entry.annotation.type,
            points: entry.annotation.points,
            color: entry.annotation.color,
            ...(entry.annotation.text != null && { text: entry.annotation.text }),
          });
          set((state) => ({
            future: [{ type: 'annotation_delete', annotation: created }, ...state.future.slice(1)],
          }));
          break;
        }
        case 'measurement_add':
          await measurement.deleteTakeoffMeasurement(entry.id);
          break;
        case 'measurement_update':
          await measurement.updateTakeoffMeasurement(entry.id, entry.previous);
          break;
        case 'measurement_delete': {
          const newId = await measurement.addTakeoffMeasurement({
            projectId: entry.measurement.projectId,
            sheetId: entry.measurement.sheetId,
            conditionId: entry.measurement.conditionId,
            type: entry.measurement.type,
            points: entry.measurement.points,
            calculatedValue: entry.measurement.calculatedValue,
            unit: entry.measurement.unit,
            pdfPage: entry.measurement.pdfPage,
            pdfCoordinates: entry.measurement.pdfCoordinates,
            conditionColor: entry.measurement.conditionColor,
            conditionName: entry.measurement.conditionName,
            ...(entry.measurement.description != null && { description: entry.measurement.description }),
            ...(entry.measurement.perimeterValue != null && { perimeterValue: entry.measurement.perimeterValue }),
            ...(entry.measurement.areaValue != null && { areaValue: entry.measurement.areaValue }),
            ...(entry.measurement.cutouts != null && { cutouts: entry.measurement.cutouts }),
            ...(entry.measurement.netCalculatedValue != null && { netCalculatedValue: entry.measurement.netCalculatedValue }),
          });
          set((state) => ({
            future: [{ type: 'measurement_delete', measurement: { ...entry.measurement, id: newId } }, ...state.future.slice(1)],
          }));
          break;
        }
      }
      return true;
    } catch (err) {
      console.error('Undo failed:', err);
      set((state) => ({
        past: [...state.past, entry],
        future: state.future.slice(1),
      }));
      return false;
    }
  },

  async redo() {
    const { future } = get();
    const entry = future[0];
    if (!entry) return false;

    set((state) => ({
      past: [...state.past, entry],
      future: state.future.slice(1),
    }));

    const annotation = useAnnotationStore.getState();
    const measurement = useMeasurementStore.getState();

    try {
      switch (entry.type) {
        case 'annotation_add': {
          const created = annotation.addAnnotation({
            projectId: entry.annotation.projectId,
            sheetId: entry.annotation.sheetId,
            pageNumber: entry.annotation.pageNumber,
            type: entry.annotation.type,
            points: entry.annotation.points,
            color: entry.annotation.color,
            ...(entry.annotation.text != null && { text: entry.annotation.text }),
          });
          set((state) => ({
            past: [...state.past.slice(0, -1), { type: 'annotation_add', id: created.id, annotation: created }],
          }));
          break;
        }
        case 'annotation_update':
          annotation.updateAnnotation(entry.id, entry.next);
          break;
        case 'annotation_delete':
          annotation.deleteAnnotation(entry.annotation.id);
          break;
        case 'measurement_add': {
          const newId = await measurement.addTakeoffMeasurement(entry.createPayload);
          set((state) => ({
            past: [...state.past.slice(0, -1), { type: 'measurement_add', id: newId, createPayload: entry.createPayload }],
          }));
          break;
        }
        case 'measurement_update':
          await measurement.updateTakeoffMeasurement(entry.id, entry.next);
          break;
        case 'measurement_delete':
          await measurement.deleteTakeoffMeasurement(entry.measurement.id);
          break;
      }
      return true;
    } catch (err) {
      console.error('Redo failed:', err);
      set((state) => ({
        past: state.past.slice(0, -1),
        future: [entry, ...state.future],
      }));
      return false;
    }
  },

  clear() {
    set({ past: [], future: [] });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
