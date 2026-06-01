import { describe, expect, it } from 'vitest';
import { detectSheetRefsFromWordBoxes, detectSheetRefsFromIsolatedBoxes } from './detectSheetRefsFromWordBoxes';

function w(text: string, x: number, y: number): { text: string; bbox: { x: number; y: number; width: number; height: number } } {
  return {
    text,
    bbox: { x, y, width: Math.max(0.02, text.length * 0.012), height: 0.02 },
  };
}

describe('detectSheetRefsFromWordBoxes', () => {
  it('strict mode requires cue on line', () => {
    const words = [w('SEE', 0.08, 0.5), w('A-101', 0.14, 0.5)];
    const strict = detectSheetRefsFromWordBoxes(words, { mode: 'strict' });
    expect(strict.some((r) => r.normalizedRef === 'A101')).toBe(true);

    const noCue = [w('A-101', 0.1, 0.5)];
    const strictNone = detectSheetRefsFromWordBoxes(noCue, { mode: 'strict' });
    expect(strictNone.length).toBe(0);

    const loose = detectSheetRefsFromWordBoxes(noCue, { mode: 'loose' });
    expect(loose.some((r) => r.normalizedRef === 'A101')).toBe(true);
  });

  it('detects detail style n / sheet', () => {
    const words = [w('SEE', 0.05, 0.4), w('3/A501', 0.1, 0.4)];
    const refs = detectSheetRefsFromWordBoxes(words, { mode: 'strict' });
    expect(refs.some((r) => r.normalizedRef === 'A501')).toBe(true);
  });

  it('detects vertical stack (match-line style) when OCR splits tokens', () => {
    const words = [
      w('A4', 0.5, 0.1),
      w('.07', 0.5, 0.13),
    ];
    const refs = detectSheetRefsFromWordBoxes(words, { mode: 'loose' });
    expect(refs.some((r) => r.normalizedRef === 'A4.07')).toBe(true);
  });

  it('detects tight horizontal join when OCR splits sheet id', () => {
    const words = [w('A4', 0.1, 0.5), w('.07', 0.15, 0.5)];
    const refs = detectSheetRefsFromWordBoxes(words, { mode: 'loose' });
    expect(refs.some((r) => r.normalizedRef === 'A4.07')).toBe(true);
  });

  it('detects dotted sheet index', () => {
    const words = [w('REF', 0.05, 0.3), w('G0.01', 0.11, 0.3)];
    const refs = detectSheetRefsFromWordBoxes(words, { mode: 'strict' });
    expect(refs.some((r) => r.normalizedRef === 'G0.01')).toBe(true);
  });

  it('detects section callout stack: detail number above sheet (vertical)', () => {
    const words = [
      { text: '29', bbox: { x: 0.48, y: 0.1, width: 0.04, height: 0.02 } },
      { text: 'A9.31', bbox: { x: 0.46, y: 0.135, width: 0.1, height: 0.02 } },
    ];
    const refs = detectSheetRefsFromWordBoxes(words, { mode: 'loose' });
    expect(refs.some((r) => r.normalizedRef === 'A9.31')).toBe(true);
  });

  it('detects sheet id when OCR splits after letter+digit (horizontal callout)', () => {
    const words = [
      { text: '05', bbox: { x: 0.2, y: 0.5, width: 0.03, height: 0.02 } },
      { text: 'A6.05', bbox: { x: 0.24, y: 0.5, width: 0.07, height: 0.02 } },
    ];
    const refs = detectSheetRefsFromWordBoxes(words, { mode: 'loose' });
    expect(refs.some((r) => r.normalizedRef === 'A6.05')).toBe(true);
  });

  it('detects bubble-OCR style two-line token in one box: detail then sheet (space)', () => {
    const words = [w('15 A9.22', 0.6, 0.5)];
    const refs = detectSheetRefsFromWordBoxes(words, { mode: 'loose' });
    expect(refs.some((r) => r.normalizedRef === 'A9.22')).toBe(true);
  });

  it('loose mode drops title-block style V### / AAA### junk but keeps real sheet ids', () => {
    const words = [w('V786', 0.5, 0.5), w('KLW786', 0.62, 0.5), w('A1.50', 0.74, 0.5), w('SF650', 0.86, 0.5)];
    const refs = detectSheetRefsFromWordBoxes(words, { mode: 'loose' });
    expect(refs.some((r) => r.normalizedRef === 'A1.50')).toBe(true);
    expect(refs.some((r) => r.normalizedRef === 'SF650')).toBe(true);
    expect(refs.some((r) => r.normalizedRef === 'V786')).toBe(false);
    expect(refs.some((r) => r.normalizedRef === 'KLW786')).toBe(false);
  });

  it('strict mode still allows V### when cued (schedules / notes)', () => {
    const words = [w('SEE', 0.05, 0.5), w('V786', 0.1, 0.5)];
    const refs = detectSheetRefsFromWordBoxes(words, { mode: 'strict' });
    expect(refs.some((r) => r.normalizedRef === 'V786')).toBe(true);
  });

  it('loose mode rejects sheet refs forged from horizontally scattered line words', () => {
    const words = [
      { text: 'A4', bbox: { x: 0.05, y: 0.5, width: 0.03, height: 0.02 } },
      { text: 'JUNK', bbox: { x: 0.35, y: 0.5, width: 0.05, height: 0.02 } },
      { text: '.02', bbox: { x: 0.75, y: 0.5, width: 0.04, height: 0.02 } },
    ];
    const refs = detectSheetRefsFromWordBoxes(words, { mode: 'loose' });
    expect(refs.some((r) => r.normalizedRef === 'A4.02')).toBe(false);
  });

  it('isolated boxes link at the crop bbox (bubble OCR style)', () => {
    const words = [{ text: '15 A9.22', bbox: { x: 0.6, y: 0.41, width: 0.04, height: 0.06 } }];
    const refs = detectSheetRefsFromIsolatedBoxes(words, { mode: 'loose' });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.normalizedRef).toBe('A9.22');
    expect(refs[0]!.sourceRect.x).toBeCloseTo(0.6, 2);
  });
});
