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

  setCrosshairFullScreen: (value: boolean) => void;
  setCrosshairColor: (value: string) => void;
}

export const useUserPreferencesStore = create<UserPreferencesState>()(
  persist(
    (set) => ({
      crosshairFullScreen: false,
      crosshairColor: DEFAULT_CROSSHAIR_COLOR,

      setCrosshairFullScreen: (value) => set({ crosshairFullScreen: value }),
      setCrosshairColor: (value) => set({ crosshairColor: value }),
    }),
    {
      name: 'user-preferences-store',
      partialize: (state) => ({
        crosshairFullScreen: state.crosshairFullScreen,
        crosshairColor: state.crosshairColor,
      }),
    }
  )
);
