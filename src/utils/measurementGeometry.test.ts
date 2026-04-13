import { describe, it, expect } from 'vitest';
import {
  cssToBaseNormalized,
  baseNormToViewportPixels,
  baseNormDeltaToViewportPixels,
  normalizeRotationDeg,
  cssDragRectToBasePdfAabb,
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

  describe('baseNormDeltaToViewportPixels (move-drag preview)', () => {
    const vp = { width: 400, height: 300 };

    it('at 0° matches scale by width/height', () => {
      expect(baseNormDeltaToViewportPixels(0.1, 0.05, vp, 0)).toEqual({ x: 40, y: 15 });
    });

    it('at 90° is not (dNx*width, dNy*height); matches T(d)-T(0)', () => {
      expect(baseNormDeltaToViewportPixels(0.1, 0, vp, 90)).toEqual({ x: 0, y: 30 });
      expect(baseNormDeltaToViewportPixels(0, 0.1, vp, 90)).toEqual({ x: -40, y: 0 });
    });
  });

  describe('cssDragRectToBasePdfAabb', () => {
    const dp = { w: 400, h: 300 };

    it('at 0° matches axis-aligned CSS rect in base 0–1 space (same as css/dp for x,y,w,h)', () => {
      const a = cssDragRectToBasePdfAabb(dp, basePage, 0, 40, 60, 100, 80);
      expect(a.x).toBeCloseTo(40 / 400);
      expect(a.y).toBeCloseTo(60 / 300);
      expect(a.width).toBeCloseTo(100 / 400);
      expect(a.height).toBeCloseTo(80 / 300);
    });

    it('at 90° is not simple division by dp.w/dp.h', () => {
      const a = cssDragRectToBasePdfAabb(dp, basePage, 90, 0, 0, 100, 80);
      const tl = cssToBaseNormalized(0, 0, dp, basePage, 90);
      const br = cssToBaseNormalized(100, 80, dp, basePage, 90);
      expect(a.x).toBeCloseTo(Math.min(tl.x, br.x));
      expect(a.y).toBeCloseTo(Math.min(tl.y, br.y));
      expect(a.width).toBeCloseTo(Math.abs(br.x - tl.x));
      expect(a.height).toBeCloseTo(Math.abs(br.y - tl.y));
    });
  });
});
