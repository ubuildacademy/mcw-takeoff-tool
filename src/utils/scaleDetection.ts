/**
 * Detect drawing scale notation in PDF page text (vector sets: exact text from
 * PDF.js getTextContent, no OCR error).
 *
 * Supported notations:
 *   Architectural: 1/4" = 1'-0"   3/16"=1'   1 1/2" = 1'-0"   3" = 1'-0"
 *   Engineering:   1" = 20'   1" = 30'-0"
 *   Metric:        1:100   1 : 50   (only near the word SCALE — bare ratios
 *                  collide with sheet numbers and detail refs)
 *
 * A stated scale is only correct when the PDF is at its declared sheet size
 * (true for CAD exports; wrong if someone re-printed "fit to page"), so callers
 * should present results as a suggestion to verify, not silently calibrate.
 */

export interface DetectedScale {
  /** Human-readable notation as found, normalized (e.g. `1/4" = 1'-0"`). */
  label: string;
  /** Real-world : paper ratio (dimensionless), e.g. 48 for 1/4" = 1'-0". */
  ratio: number;
  /** Calibration scale factor in feet per PDF point (72 points = 1 paper inch). */
  scaleFactor: number;
  /** How many times this exact scale appears in the page text. */
  occurrences: number;
  /** True when the notation appears right after the word "scale". */
  nearScaleKeyword: boolean;
}

const POINTS_PER_INCH = 72;

/** ratio (real:paper) → calibration scaleFactor in feet per PDF point. */
export function scaleFactorFromRatio(ratio: number): number {
  return ratio / (POINTS_PER_INCH * 12);
}

/** Normalize unicode quotes/primes so one regex handles CAD text output. */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[’′ʹ]/g, "'")
    .replace(/[”″ʺ]/g, '"');
}

/** Parse `3`, `1/4`, `1 1/2`, `0.25` as inches. */
function parseInchesExpr(expr: string): number | null {
  const m = /^(\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?$/.exec(expr.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const whole = m[1] ? parseFloat(m[1]) : 0;
  const frac = m[2] && m[3] && parseFloat(m[3]) !== 0 ? parseFloat(m[2]) / parseFloat(m[3]) : 0;
  const value = whole + frac;
  return value > 0 ? value : null;
}

// paper-inches `"` = feet `'` [- inches `"`]
const IMPERIAL_RE =
  /(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?|\d+\s*\/\s*\d+)\s*"\s*=\s*(\d+(?:\.\d+)?)\s*'(?:\s*-?\s*(\d+(?:\.\d+)?)\s*")?/g;

// 1:100 style, only accepted near "scale"
const METRIC_RE = /\b1\s*:\s*(\d{1,4})\b/g;

const SCALE_KEYWORD_WINDOW = 24;

function isNearScaleKeyword(text: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - SCALE_KEYWORD_WINDOW);
  return /scale\s*[:=]?\s*$/i.test(text.slice(start, matchIndex).trimEnd() + ' ');
}

/**
 * Scan page text for scale notations. Returns distinct candidates, best first:
 * keyword-adjacent beats not, then more occurrences, then larger paper fraction
 * (main plan scale is usually the coarsest notation on the sheet).
 */
export function detectScalesInText(rawText: string): DetectedScale[] {
  const text = normalizeQuotes(rawText);
  const byLabel = new Map<string, DetectedScale>();

  const record = (label: string, ratio: number, nearKeyword: boolean) => {
    const existing = byLabel.get(label);
    if (existing) {
      existing.occurrences += 1;
      existing.nearScaleKeyword = existing.nearScaleKeyword || nearKeyword;
    } else {
      byLabel.set(label, {
        label,
        ratio,
        scaleFactor: scaleFactorFromRatio(ratio),
        occurrences: 1,
        nearScaleKeyword: nearKeyword,
      });
    }
  };

  for (const m of text.matchAll(IMPERIAL_RE)) {
    const paperInches = parseInchesExpr(m[1]);
    if (paperInches == null) continue;
    const feet = parseFloat(m[2]);
    const extraInches = m[3] ? parseFloat(m[3]) : 0;
    const realInches = feet * 12 + extraInches;
    if (!Number.isFinite(realInches) || realInches <= 0) continue;
    const ratio = realInches / paperInches;
    // Plausible drawing scales only: 1:1 mockups to 1"=200' civil sheets.
    if (ratio < 1 || ratio > 2400) continue;
    const inchLabel = m[1].replace(/\s+/g, ' ').trim();
    const feetLabel = extraInches > 0 ? `${m[2]}'-${m[3]}"` : `${m[2]}'-0"`;
    record(`${inchLabel}" = ${feetLabel}`, ratio, isNearScaleKeyword(text, m.index ?? 0));
  }

  for (const m of text.matchAll(METRIC_RE)) {
    if (!isNearScaleKeyword(text, m.index ?? 0)) continue;
    const denom = parseInt(m[1], 10);
    if (denom < 2 || denom > 2000) continue;
    record(`1:${denom}`, denom, true);
  }

  return [...byLabel.values()].sort((a, b) => {
    if (a.nearScaleKeyword !== b.nearScaleKeyword) return a.nearScaleKeyword ? -1 : 1;
    if (a.occurrences !== b.occurrences) return b.occurrences - a.occurrences;
    return b.ratio - a.ratio;
  });
}

/** Join PDF.js text items into scannable text. Items fragment mid-notation, so join with spaces. */
export function textItemsToScanText(items: Array<{ str?: string }>): string {
  return items
    .map((item) => item.str ?? '')
    .filter((s) => s.length > 0)
    .join(' ');
}

// ── Sheet-size sanity check ────────────────────────────────────────────────
// A stated scale is only accurate at the declared plot size. If the PDF was
// replotted onto a smaller/larger sheet (fit-to-page, half-size sets), the
// notation on the sheet no longer matches reality and calibrating from it
// would throw off every measurement on the job.

export interface SheetSizeAssessment {
  widthIn: number;
  heightIn: number;
  /** Matched standard sheet name (e.g. "ARCH D 24×36"), if any. */
  standardName: string | null;
  /** Set when the sheet is exactly half of a standard size → stated scale likely 2× off. */
  halfSizeOf: string | null;
  /**
   * 'standard'  — full-size standard sheet; stated scale plausible.
   * 'half-size' — matches a half-size print; stated scale probably 2× off.
   * 'unknown'   — non-standard dimensions; could be a custom plot or a fit-to-page reprint.
   */
  verdict: 'standard' | 'half-size' | 'unknown';
}

/** name → [shorter, longer] inches */
const STANDARD_SHEET_SIZES: Array<[string, number, number]> = [
  ['ARCH E1 30×42', 30, 42],
  ['ARCH E 36×48', 36, 48],
  ['ARCH D 24×36', 24, 36],
  ['ARCH C 18×24', 18, 24],
  ['ARCH B 12×18', 12, 18],
  ['ANSI E 34×44', 34, 44],
  ['ANSI D 22×34', 22, 34],
  ['ANSI C 17×22', 17, 22],
  ['ANSI B 11×17', 11, 17],
  ['ISO A0 33.1×46.8', 33.1, 46.8],
  ['ISO A1 23.4×33.1', 23.4, 33.1],
  ['ISO A2 16.5×23.4', 16.5, 23.4],
  ['Letter 8.5×11', 8.5, 11],
];

const SIZE_TOLERANCE_IN = 0.35;

function matchSheet(shortIn: number, longIn: number): string | null {
  for (const [name, s, l] of STANDARD_SHEET_SIZES) {
    if (Math.abs(shortIn - s) <= SIZE_TOLERANCE_IN && Math.abs(longIn - l) <= SIZE_TOLERANCE_IN) {
      return name;
    }
  }
  return null;
}

/**
 * Assess whether a page's physical size supports trusting an on-sheet scale
 * notation. Width/height in PDF points (1/72 inch), any orientation.
 */
export function assessSheetSize(widthPt: number, heightPt: number): SheetSizeAssessment {
  const widthIn = widthPt / POINTS_PER_INCH;
  const heightIn = heightPt / POINTS_PER_INCH;
  const shortIn = Math.min(widthIn, heightIn);
  const longIn = Math.max(widthIn, heightIn);

  const standardName = matchSheet(shortIn, longIn);

  // Half-size print of a (larger) standard sheet. Checked even when the page
  // itself matches a standard size: 11×17 is both ANSI B and half of ANSI D —
  // for construction sets the half-size reading is the important warning.
  let halfSizeOf: string | null = null;
  for (const [name, s, l] of STANDARD_SHEET_SIZES) {
    if (s <= 12) continue; // half of a small sheet isn't a plausible plan reprint
    // Halving flips the aspect: (s, l) → (l/2, s)
    if (Math.abs(shortIn - l / 2) <= SIZE_TOLERANCE_IN && Math.abs(longIn - s) <= SIZE_TOLERANCE_IN) {
      halfSizeOf = name;
      break;
    }
  }

  // Large sheets (short side ≥ 22") are practically always full-size plots even
  // when their dimensions also equal half of a bigger standard (24×36 is both
  // ARCH D and half of ARCH E). Below that, a half-size match is a real risk:
  // 11×17 sets are usually reduced prints of 22×34 originals.
  const verdict: SheetSizeAssessment['verdict'] =
    halfSizeOf && shortIn < 22
      ? 'half-size'
      : standardName
        ? 'standard'
        : 'unknown';

  return { widthIn, heightIn, standardName, halfSizeOf, verdict };
}
