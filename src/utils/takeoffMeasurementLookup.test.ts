import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TakeoffCondition, TakeoffMeasurement } from '../types';
import {
  samePdfPageKey,
  measurementDrawModeForCondition,
  findTakeoffMeasurementOnPage,
  syncStoreConditionFromMeasurementId,
  clearCanvasConditionSelection,
  canvasMeasurementSelectionMatchesCondition,
} from './takeoffMeasurementLookup';

const setSelectedCondition = vi.fn();

vi.mock('../store/slices/conditionSlice', () => ({
  useConditionStore: {
    getState: () => ({ setSelectedCondition }),
  },
}));

function condition(overrides: Partial<TakeoffCondition> = {}): TakeoffCondition {
  return {
    id: 'cond-1',
    projectId: 'proj-1',
    name: 'Test',
    type: 'linear',
    unit: 'LF',
    wasteFactor: 0,
    color: '#000',
    ...overrides,
  } as TakeoffCondition;
}

function measurement(overrides: Partial<TakeoffMeasurement> = {}): TakeoffMeasurement {
  return {
    id: 'm-1',
    projectId: 'proj-1',
    sheetId: 'doc-1-1',
    conditionId: 'cond-1',
    type: 'linear',
    pdfPage: 1,
    calculatedValue: 1,
    unit: 'LF',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as TakeoffMeasurement;
}

describe('takeoffMeasurementLookup', () => {
  beforeEach(() => {
    setSelectedCondition.mockClear();
  });

  describe('samePdfPageKey', () => {
    it('treats string and number page keys as equal', () => {
      expect(samePdfPageKey('2', 2)).toBe(true);
      expect(samePdfPageKey(1, 2)).toBe(false);
    });
  });

  describe('measurementDrawModeForCondition', () => {
    it('maps condition types to draw modes', () => {
      expect(measurementDrawModeForCondition(condition({ type: 'count' }))).toBe('count');
      expect(measurementDrawModeForCondition(condition({ type: 'volume' }))).toBe('volume');
      expect(measurementDrawModeForCondition(condition({ type: 'area' }))).toBe('area');
      expect(measurementDrawModeForCondition(condition({ type: 'linear' }))).toBe('linear');
    });

    it('falls back to unit when type is ambiguous', () => {
      expect(measurementDrawModeForCondition(condition({ type: 'auto-count' as TakeoffCondition['type'], unit: 'EA' }))).toBe('count');
      expect(measurementDrawModeForCondition(condition({ type: 'auto-count' as TakeoffCondition['type'], unit: 'SF' }))).toBe('area');
    });
  });

  describe('findTakeoffMeasurementOnPage', () => {
    const getPage = vi.fn(() => [measurement({ id: 'store-hit' })]);

    it('finds a measurement in local cache first', () => {
      const local = [measurement({ id: 'local-hit' })];
      expect(findTakeoffMeasurementOnPage('local-hit', local, 'proj-1', 'doc-1', 1, getPage)?.id).toBe(
        'local-hit'
      );
    });

    it('falls back to store page slice', () => {
      expect(findTakeoffMeasurementOnPage('store-hit', [], 'proj-1', 'doc-1', 1, getPage)?.id).toBe(
        'store-hit'
      );
    });
  });

  describe('syncStoreConditionFromMeasurementId', () => {
    it('selects the measurement condition in the store', () => {
      syncStoreConditionFromMeasurementId(
        'm-1',
        [measurement({ id: 'm-1', conditionId: 'cond-99' })],
        'proj-1',
        'doc-1',
        1,
        vi.fn()
      );
      expect(setSelectedCondition).toHaveBeenCalledWith('cond-99');
    });
  });

  describe('clearCanvasConditionSelection', () => {
    it('clears selected condition', () => {
      clearCanvasConditionSelection();
      expect(setSelectedCondition).toHaveBeenCalledWith(null);
    });
  });

  describe('canvasMeasurementSelectionMatchesCondition', () => {
    const getPage = vi.fn(() => []);

    it('returns true when all selected measurements belong to the condition', () => {
      const local = [measurement({ id: 'm-1', conditionId: 'cond-1' })];
      expect(
        canvasMeasurementSelectionMatchesCondition(
          ['m-1'],
          [],
          ['m-1'],
          'cond-1',
          local,
          'proj-1',
          'doc-1',
          1,
          getPage
        )
      ).toBe(true);
    });

    it('returns false when annotations are selected', () => {
      expect(
        canvasMeasurementSelectionMatchesCondition(
          ['m-1'],
          ['ann-1'],
          ['m-1', 'ann-1'],
          'cond-1',
          [measurement()],
          'proj-1',
          'doc-1',
          1,
          getPage
        )
      ).toBe(false);
    });
  });
});
