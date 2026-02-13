/**
 * Store exports – all state is in domain slices.
 *
 * Use slice hooks directly; no monolithic store.
 *
 * Slices:
 * - useProjectStore: Projects
 * - useConditionStore: Takeoff conditions
 * - useMeasurementStore: Takeoff measurements and cost calculations
 * - useCalibrationStore: Calibrations
 * - useAnnotationStore: Annotations
 * - useDocumentViewStore: Document view (rotation, scale, page, location)
 * - useUserPreferencesStore: User preferences (crosshair, ortho, labels)
 */

export { useProjectStore } from './slices/projectSlice';
export { useConditionStore } from './slices/conditionSlice';
export { useUserPreferencesStore } from './slices/userPreferencesSlice';
export { useMeasurementStore } from './slices/measurementSlice';
export { useCalibrationStore } from './slices/calibrationSlice';
export { useAnnotationStore } from './slices/annotationSlice';
export { useDocumentViewStore } from './slices/documentViewSlice';
export { useUndoStore } from './slices/undoSlice';

export type { TakeoffCondition, TakeoffMeasurement, Calibration, Project, Annotation } from '../types';
export type { UndoEntry } from './slices/undoSlice';
