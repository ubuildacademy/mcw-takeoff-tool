/**
 * User preferences (global, not project-specific).
 * Persisted to localStorage so preferences persist across sessions.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const DEFAULT_CROSSHAIR_COLOR = '#000000';

export interface UserPreferencesState {
  crosshairFullScreen: boolean;
  crosshairColor: string;
  /** Stroke thickness of crosshair lines in CSS pixels (1–5) */
  crosshairStrokeWidth: number;
  /** When true, ortho snapping is enabled by default when starting measurements or calibration */
  defaultOrthoSnapping: boolean;
  /** Show value labels on completed measurements (LF, SF, CY, etc.) */
  showMeasurementLabels: boolean;
  /** Show running length tooltip while drawing continuous linear measurements */
  showRunningLength: boolean;

  setCrosshairFullScreen: (value: boolean) => void;
  setCrosshairColor: (value: string) => void;
  setCrosshairStrokeWidth: (value: number) => void;
  setDefaultOrthoSnapping: (value: boolean) => void;
  setShowMeasurementLabels: (value: boolean) => void;
  setShowRunningLength: (value: boolean) => void;
}

export const useUserPreferencesStore = create<UserPreferencesState>()(
  persist(
    (set) => ({
      crosshairFullScreen: false,
      crosshairColor: DEFAULT_CROSSHAIR_COLOR,
      crosshairStrokeWidth: 1.5,
      defaultOrthoSnapping: false,
      showMeasurementLabels: true,
      showRunningLength: true,

      setCrosshairFullScreen: (value) => set({ crosshairFullScreen: value }),
      setCrosshairColor: (value) => set({ crosshairColor: value }),
      setCrosshairStrokeWidth: (value) => set({ crosshairStrokeWidth: value }),
      setDefaultOrthoSnapping: (value) => set({ defaultOrthoSnapping: value }),
      setShowMeasurementLabels: (value) => set({ showMeasurementLabels: value }),
      setShowRunningLength: (value) => set({ showRunningLength: value }),
    }),
    {
      name: 'user-preferences-store',
      partialize: (state) => ({
        crosshairFullScreen: state.crosshairFullScreen,
        crosshairColor: state.crosshairColor,
        crosshairStrokeWidth: state.crosshairStrokeWidth,
        defaultOrthoSnapping: state.defaultOrthoSnapping,
        showMeasurementLabels: state.showMeasurementLabels,
        showRunningLength: state.showRunningLength,
      }),
    }
  )
);
