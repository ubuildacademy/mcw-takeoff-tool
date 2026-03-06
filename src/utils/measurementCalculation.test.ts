import { describe, it, expect } from 'vitest';
import {
  MeasurementCalculator,
  type MeasurementPoint,
  type ScaleInfo,
} from './measurementCalculation';

const scaleInfo: ScaleInfo = {
  scaleFactor: 0.01,
  unit: 'ft',
  scaleText: '1" = 1\'',
  confidence: 0.95,
  viewportWidth: 1000,
  viewportHeight: 800,
};

describe('MeasurementCalculator', () => {
  describe('calculateLinear', () => {
    it('returns invalid for fewer than 2 points', () => {
      const result = MeasurementCalculator.calculateLinear([{ x: 0, y: 0 }], scaleInfo);
      expect(result.validation.isValid).toBe(false);
      expect(result.validation.errors).toContain('Linear measurement requires at least 2 points');
    });

    it('returns invalid when viewport dimensions missing', () => {
      const noViewport: ScaleInfo = { ...scaleInfo, viewportWidth: undefined, viewportHeight: undefined };
      const result = MeasurementCalculator.calculateLinear(
        [{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }],
        noViewport
      );
      expect(result.validation.isValid).toBe(false);
      expect(result.validation.errors).toContain('Viewport width and height are required for accurate measurement calculation');
    });

    it('calculates linear distance for two points', () => {
      const points: MeasurementPoint[] = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }];
      const result = MeasurementCalculator.calculateLinear(points, scaleInfo);
      expect(result.validation.isValid).toBe(true);
      expect(result.unit).toBe('LF');
      expect(result.calculatedValue).toBeGreaterThan(0);
    });
  });

  describe('calculateArea', () => {
    it('returns invalid for fewer than 3 points', () => {
      const result = MeasurementCalculator.calculateArea(
        [{ x: 0, y: 0 }, { x: 0.1, y: 0 }],
        scaleInfo
      );
      expect(result.validation.isValid).toBe(false);
      expect(result.validation.errors).toContain('Area measurement requires at least 3 points');
    });

    it('calculates area for a simple rectangle', () => {
      const points: MeasurementPoint[] = [
        { x: 0, y: 0 },
        { x: 0.1, y: 0 },
        { x: 0.1, y: 0.1 },
        { x: 0, y: 0.1 },
      ];
      const result = MeasurementCalculator.calculateArea(points, scaleInfo);
      expect(result.validation.isValid).toBe(true);
      expect(result.unit).toBe('SF');
      expect(result.calculatedValue).toBeGreaterThan(0);
      expect(result.perimeterValue).toBeDefined();
    });
  });

  describe('calculateVolume', () => {
    it('returns invalid for fewer than 3 points', () => {
      const result = MeasurementCalculator.calculateVolume(
        [{ x: 0, y: 0 }, { x: 0.1, y: 0 }],
        scaleInfo,
        1
      );
      expect(result.validation.isValid).toBe(false);
    });

    it('returns invalid for non-positive depth', () => {
      const points: MeasurementPoint[] = [
        { x: 0, y: 0 },
        { x: 0.1, y: 0 },
        { x: 0.1, y: 0.1 },
      ];
      const result = MeasurementCalculator.calculateVolume(points, scaleInfo, 0);
      expect(result.validation.isValid).toBe(false);
      expect(result.validation.errors).toContain('Volume measurement requires positive depth');
    });

    it('calculates volume from area and depth', () => {
      const points: MeasurementPoint[] = [
        { x: 0, y: 0 },
        { x: 0.1, y: 0 },
        { x: 0.1, y: 0.1 },
      ];
      const result = MeasurementCalculator.calculateVolume(points, scaleInfo, 2);
      expect(result.validation.isValid).toBe(true);
      expect(result.unit).toBe('CF');
      expect(result.calculatedValue).toBeGreaterThan(0);
    });
  });

  describe('calculateCount', () => {
    it('returns 1 with full confidence', () => {
      const result = MeasurementCalculator.calculateCount();
      expect(result.calculatedValue).toBe(1);
      expect(result.unit).toBe('EA');
      expect(result.confidence).toBe(1.0);
      expect(result.validation.isValid).toBe(true);
    });
  });

  describe('validateScale', () => {
    it('returns valid for reasonable scale factor', () => {
      const result = MeasurementCalculator.validateScale(scaleInfo);
      expect(result.isValid).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('returns warnings for extreme scale factors', () => {
      const tinyScale: ScaleInfo = { ...scaleInfo, scaleFactor: 0.001 };
      const result = MeasurementCalculator.validateScale(tinyScale);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
