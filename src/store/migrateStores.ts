/**
 * One-time migration: hydrate slice stores from the legacy "takeoff-store" localStorage key.
 * Run once on app load so existing users keep their persisted data after we split the store.
 * After migrating, we remove the legacy key so we don't overwrite slice state on future loads.
 */

import type { Project, TakeoffCondition, Annotation } from '../types';
import { useProjectStore } from './slices/projectSlice';
import { useConditionStore } from './slices/conditionSlice';
import { useAnnotationStore } from './slices/annotationSlice';
import { useDocumentViewStore } from './slices/documentViewSlice';

const LEGACY_STORAGE_KEY = 'takeoff-store';

export function runStoreMigration(): void {
  if (typeof window === 'undefined') return;

  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> } | Record<string, unknown>;
    const rawState = parsed && typeof parsed === 'object' && 'state' in parsed ? parsed.state : parsed;
    if (!rawState || typeof rawState !== 'object') return;

    type LegacyState = {
      projects?: unknown[];
      conditions?: unknown[];
      annotations?: unknown[];
      documentRotations?: unknown;
      documentPages?: unknown;
      documentScales?: unknown;
      documentLocations?: unknown;
      lastViewedDocumentId?: string | null;
    };
    const state = rawState as LegacyState;

    if (Array.isArray(state.projects) && state.projects.length > 0) {
      useProjectStore.setState({ projects: state.projects as Project[] });
    }
    if (Array.isArray(state.conditions) && state.conditions.length > 0) {
      useConditionStore.setState({ conditions: state.conditions as TakeoffCondition[] });
    }
    if (Array.isArray(state.annotations) && state.annotations.length > 0) {
      useAnnotationStore.setState({ annotations: state.annotations as Annotation[] });
    }
    const docViewUpdates: Record<string, unknown> = {};
    if (state.documentRotations && typeof state.documentRotations === 'object') docViewUpdates.documentRotations = state.documentRotations;
    if (state.documentPages && typeof state.documentPages === 'object') docViewUpdates.documentPages = state.documentPages;
    if (state.documentScales && typeof state.documentScales === 'object') docViewUpdates.documentScales = state.documentScales;
    if (state.documentLocations && typeof state.documentLocations === 'object') docViewUpdates.documentLocations = state.documentLocations;
    if (state.lastViewedDocumentId != null) docViewUpdates.lastViewedDocumentId = state.lastViewedDocumentId;
    if (Object.keys(docViewUpdates).length > 0) {
      useDocumentViewStore.setState(docViewUpdates);
    }

    localStorage.removeItem(LEGACY_STORAGE_KEY);
    console.log('[store] Migrated persisted data from takeoff-store to slice stores.');
  } catch (e) {
    console.warn('[store] Migration from takeoff-store failed:', e);
  }
}
