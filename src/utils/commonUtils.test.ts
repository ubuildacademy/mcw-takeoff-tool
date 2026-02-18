import { describe, it, expect } from 'vitest';
import {
  calculateDistance,
  safeJsonParse,
  safeJsonStringify,
  isEmpty,
  getDefaultUnit,
  extractErrorMessage,
} from './commonUtils';

describe('commonUtils', () => {
  describe('calculateDistance', () => {
    it('returns 0 when points are the same', () => {
      const p = { x: 1, y: 2 };
      expect(calculateDistance(p, p)).toBe(0);
    });

    it('returns correct distance for horizontal line', () => {
      expect(calculateDistance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
    });

    it('returns correct distance for vertical line', () => {
      expect(calculateDistance({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(4);
    });

    it('returns correct distance for diagonal (3-4-5 triangle)', () => {
      expect(calculateDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });
  });

  describe('safeJsonParse', () => {
    it('parses valid JSON and returns parsed value', () => {
      expect(safeJsonParse('{"a":1}', { a: 0 })).toEqual({ a: 1 });
      expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3]);
    });

    it('returns fallback when JSON is invalid', () => {
      const fallback = { default: true };
      expect(safeJsonParse('not json', fallback)).toBe(fallback);
      expect(safeJsonParse('', fallback)).toBe(fallback);
    });
  });

  describe('safeJsonStringify', () => {
    it('stringifies valid objects', () => {
      expect(safeJsonStringify({ a: 1 })).toBe('{"a":1}');
    });

    it('returns fallback when stringify throws (e.g. circular ref)', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(safeJsonStringify(circular, '{}')).toBe('{}');
    });
  });

  describe('isEmpty', () => {
    it('returns true for null, undefined, empty string', () => {
      expect(isEmpty(null)).toBe(true);
      expect(isEmpty(undefined)).toBe(true);
      expect(isEmpty('')).toBe(true);
    });

    it('returns false for non-empty values', () => {
      expect(isEmpty('hello')).toBe(false);
      expect(isEmpty(0)).toBe(false);
      expect(isEmpty([])).toBe(true);
      expect(isEmpty({})).toBe(true);
    });
  });

  describe('getDefaultUnit', () => {
    it('returns expected units for each type', () => {
      expect(getDefaultUnit('linear')).toBe('LF');
      expect(getDefaultUnit('area')).toBe('SF');
      expect(getDefaultUnit('volume')).toBe('CY');
      expect(getDefaultUnit('count')).toBe('EA');
    });
  });

  describe('extractErrorMessage', () => {
    it('extracts message from Error instance', () => {
      expect(extractErrorMessage(new Error('foo'))).toBe('foo');
    });

    it('extracts message from object with .message', () => {
      expect(extractErrorMessage({ message: 'bar' })).toBe('bar');
    });

    it('extracts .error string from object', () => {
      expect(extractErrorMessage({ error: 'baz' })).toBe('baz');
    });

    it('returns fallback for null/undefined', () => {
      expect(extractErrorMessage(null)).toBe('Unknown error');
      expect(extractErrorMessage(null, 'custom')).toBe('custom');
    });

    it('converts primitives to string', () => {
      expect(extractErrorMessage(42)).toBe('42');
    });
  });
});
