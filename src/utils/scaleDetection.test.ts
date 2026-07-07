import { describe, it, expect } from 'vitest';
import {
  assessSheetSize,
  detectScalesInText,
  scaleFactorFromRatio,
  textItemsToScanText,
} from './scaleDetection';

describe('scaleFactorFromRatio', () => {
  it('converts 1/4" = 1\'-0" (ratio 48) to ft per PDF point', () => {
    // 1 point = 1/72 paper inch = 48/72 real inch = 0.055556 ft
    expect(scaleFactorFromRatio(48)).toBeCloseTo(0.055556, 5);
  });

  it('converts 1:100 metric ratio', () => {
    expect(scaleFactorFromRatio(100)).toBeCloseTo(100 / 864, 6);
  });
});

describe('detectScalesInText', () => {
  it('detects quarter-inch architectural scale', () => {
    const found = detectScalesInText('SCALE: 1/4" = 1\'-0"');
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe('1/4" = 1\'-0"');
    expect(found[0].ratio).toBe(48);
    expect(found[0].nearScaleKeyword).toBe(true);
  });

  it('detects mixed-number scales like 1 1/2" = 1\'-0"', () => {
    const found = detectScalesInText('scale 1 1/2" = 1\'-0"');
    expect(found[0].ratio).toBe(8);
  });

  it('detects engineering scales like 1" = 20\'', () => {
    const found = detectScalesInText("SCALE: 1\" = 20'");
    expect(found[0].ratio).toBe(240);
    expect(found[0].label).toBe('1" = 20\'-0"');
  });

  it('detects notation without the scale keyword, flagged as not near keyword', () => {
    const found = detectScalesInText('FLOOR PLAN  1/8" = 1\'-0"');
    expect(found).toHaveLength(1);
    expect(found[0].ratio).toBe(96);
    expect(found[0].nearScaleKeyword).toBe(false);
  });

  it('detects metric scales only near the scale keyword', () => {
    expect(detectScalesInText('SCALE 1:100')).toHaveLength(1);
    expect(detectScalesInText('SCALE 1:100')[0].ratio).toBe(100);
    // Bare ratios look like detail refs / sheet numbers → ignored
    expect(detectScalesInText('SEE DETAIL 1:100 ON A-501')).toHaveLength(0);
  });

  it('handles unicode quotes and primes from CAD text', () => {
    const found = detectScalesInText('SCALE: 1/4″ = 1′-0″');
    expect(found).toHaveLength(1);
    expect(found[0].ratio).toBe(48);
  });

  it('counts occurrences and dedupes identical notations', () => {
    const found = detectScalesInText('1/4" = 1\'-0" ... 1/4" = 1\'-0" ... 1/2" = 1\'-0"');
    expect(found).toHaveLength(2);
    const quarter = found.find((f) => f.ratio === 48);
    expect(quarter?.occurrences).toBe(2);
  });

  it('ranks keyword-adjacent scale first when a sheet has multiple scales', () => {
    const found = detectScalesInText('DETAIL A 3" = 1\'-0"  SCALE: 1/4" = 1\'-0"');
    expect(found[0].ratio).toBe(48);
    expect(found[1].ratio).toBe(4);
  });

  it('rejects implausible ratios', () => {
    expect(detectScalesInText('99" = 1\'-0"')).toHaveLength(0); // ratio < 1
  });

  it('returns empty for text without scales', () => {
    expect(detectScalesInText('GENERAL NOTES: PROVIDE BLOCKING AT 16" O.C.')).toHaveLength(0);
  });
});

describe('assessSheetSize', () => {
  const pt = (inches: number) => inches * 72;

  it('recognizes ARCH D 24×36 as standard (not half of ARCH E)', () => {
    const a = assessSheetSize(pt(36), pt(24));
    expect(a.standardName).toBe('ARCH D 24×36');
    expect(a.verdict).toBe('standard');
  });

  it('flags 11×17 as a likely half-size print (half of ANSI C 17×22)', () => {
    const a = assessSheetSize(pt(17), pt(11));
    expect(a.halfSizeOf).toBe('ANSI C 17×22');
    expect(a.verdict).toBe('half-size');
  });

  it('flags 18×24 (ARCH C, but also half of ARCH D 24×36) as half-size risk', () => {
    const a = assessSheetSize(pt(24), pt(18));
    expect(a.standardName).toBe('ARCH C 18×24');
    expect(a.halfSizeOf).toBe('ARCH D 24×36');
    expect(a.verdict).toBe('half-size');
  });

  it('returns unknown for non-standard fit-to-page dimensions', () => {
    const a = assessSheetSize(pt(20.3), pt(13.7));
    expect(a.standardName).toBeNull();
    expect(a.verdict).toBe('unknown');
  });

  it('tolerates small plot rounding', () => {
    const a = assessSheetSize(pt(35.9), pt(24.1));
    expect(a.standardName).toBe('ARCH D 24×36');
  });
});

describe('textItemsToScanText', () => {
  it('joins fragmented PDF.js text items', () => {
    const items = [{ str: 'SCALE:' }, { str: '1/4"' }, { str: '=' }, { str: '1\'-0"' }];
    const found = detectScalesInText(textItemsToScanText(items));
    expect(found).toHaveLength(1);
    expect(found[0].ratio).toBe(48);
  });
});
