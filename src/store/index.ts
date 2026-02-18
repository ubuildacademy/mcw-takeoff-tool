// Store slices (all components use these)
export {
  useProjectStore,
  useConditionStore,
  useMeasurementStore,
  useCalibrationStore,
  useAnnotationStore,
  useDocumentViewStore,
  useUserPreferencesStore,
  useUndoStore,
} from './useTakeoffStore';

export type {
  TakeoffCondition,
  TakeoffMeasurement,
  Calibration,
  Project,
  Annotation
} from './useTakeoffStore';
