import { describe, it, expect } from 'vitest';
import {
  cssToBaseNormalized,
  baseNormToViewportPixels,
  normalizeRotationDeg,
} from './measurementGeometry';

const basePage = { width: 800, height: 600 };

describe('measurementGeometry PDF coordinates', () => {
  describe('normalizeRotationDeg', () => {
    it('normalizes negative angles', () => {
      expect(normalizeRotationDeg(-90)).toBe(270);
    });
    it('wraps values >= 360', () => {
      expect(normalizeRotationDeg(450)).toBe(90);
    });
  });

  describe('cssToBaseNormalized + baseNormToViewportPixels round-trip', () => {
    const dp = { w: 400, h: 300 };

    it('at 0° maps CSS center to base center and back to viewport pixels', () => {
      const cssX = 200;
      const cssY = 150;
      const base = cssToBaseNormalized(cssX, cssY, dp, basePage, 0);
      expect(base.x).toBeCloseTo(0.5);
      expect(base.y).toBeCloseTo(0.5);
      const px = baseNormToViewportPixels(base.x, base.y, { width: dp.w, height: dp.h }, 0);
      expect(px.x).toBeCloseTo(cssX);
      expect(px.y).toBeCloseTo(cssY);
    });

    it('at 90° round-trips corner CSS through base norm to viewport pixels', () => {
      const rotation = 90;
      const cssX = 0;
      const cssY = 0;
      const base = cssToBaseNormalized(cssX, cssY, dp, basePage, rotation);
      const px = baseNormToViewportPixels(base.x, base.y, { width: dp.w, height: dp.h }, rotation);
      expect(px.x).toBeCloseTo(cssX);
      expect(px.y).toBeCloseTo(cssY);
    });

    it('at 90° maps moving down in CSS to increasing viewport Y (no perpendicular drift)', () => {
      const rotation = 90;
      const top = cssToBaseNormalized(200, 50, dp, basePage, rotation);
      const bottom = cssToBaseNormalized(200, 250, dp, basePage, rotation);
      const pxTop = baseNormToViewportPixels(top.x, top.y, { width: dp.w, height: dp.h }, rotation);
      const pxBottom = baseNormToViewportPixels(bottom.x, bottom.y, { width: dp.w, height: dp.h }, rotation);
      expect(pxBottom.y).toBeGreaterThan(pxTop.y);
    });
  });
});
