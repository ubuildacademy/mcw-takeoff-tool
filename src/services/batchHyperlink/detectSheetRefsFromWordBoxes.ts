import { normalizeSheetNumberForMatch } from './buildSheetIndex';

/** Word box compatible with persisted OCR (pdf.js / tesseract / pymupdf / bubble / callout pass). */
export interface BatchOcrWordBox {
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence?: number;
  source?: 'pdfjs' | 'tesseract' | 'pymupdf' | 'bubble_ocr' | 'callout_pass';
}

const Y_CLUSTER_TOL = 0.018;
const X_CLUSTER_TOL = 0.016;
/** Run patterns on every contiguous slice of up to this many tokens (reading-ordered). */
const MAX_SLICE_WORDS_STRICT = 8;
/** Looser sliding windows create fake "sheet" strings from unrelated tokens; keep tight. */
const MAX_SLICE_WORDS_LOOSE = 4;
const MAX_SLICE_CHARS = 96;

const STRICT_CUE_RE =
  /\b(SEE|DET|REF|REFS|TYP|TYPICAL|SIM|SIMILAR|SHEETS?|DWG|DRWG|DRAWING|DETAILS?|NOTES?|REFER|PER)\b/i;

// Sheet number shapes used by US architectural docs:
//   - Letter + 1 digit + dot + 2 digits  (`A4.02`, `S2.13`)
//   - Letter + 2 digits + dot + 2 digits (`AD2.34`)
//   - Letter + 3 digits hyphenated       (`A-101`)
// Numbers after the dot are capped at 2 digits to reject over-merges like `A4.123410` (detail
// number eaten into the sheet) and title-block noise like `V786.879`, `KLW786.879`.
const REF_PATTERN_SPECS: Array<{ re: RegExp; pick: (m: RegExpExecArray) => string }> = [
  {
    // `15 / A4.02` and tight `15/A4.02` — detail number followed by sheet id.
    re: /\b(\d{1,3})\s*\/\s*([A-Z]{1,3}\d{1,2}(?:\.\d{1,2})?)\b/g,
    pick: (m) => m[2] ?? '',
  },
  {
    // Split-pill OCR: `15 A4.02` / `23 A9.81` (space or newline, no slash).
    re: /\b(\d{1,3})\s+([A-Z]{1,3}\d{1,2}(?:\.\d{1,2})?)\b/g,
    pick: (m) => m[2] ?? '',
  },
  {
    // Dotted form: `A4.02`, `S2.13`.
    re: /\b([A-Z]{1,3}\d{1,2}\.\d{1,2})\b/g,
    pick: (m) => m[1] ?? '',
  },
  {
    // Hyphenated form: `A-101`. Page count typically 2–3 digits.
    re: /\b([A-Z]{1,3})-(\d{2,3})\b/g,
    pick: (m) => `${m[1] ?? ''}-${m[2] ?? ''}`,
  },
  {
    // No-dot form: `A101`. 3 digits minimum to avoid `A19`, `E26`, `T014` style noise.
    re: /\b([A-Z]{1,3}\d{3})\b/g,
    pick: (m) => m[1] ?? '',
  },
];

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function lineCenterY(w: BatchOcrWordBox): number {
  return w.bbox.y + w.bbox.height / 2;
}

function lineCenterX(w: BatchOcrWordBox): number {
  return w.bbox.x + w.bbox.width / 2;
}

/** Group words into reading-order lines using center-y clustering. */
export function groupWordsIntoLines(words: BatchOcrWordBox[]): BatchOcrWordBox[][] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => {
    const dy = lineCenterY(a) - lineCenterY(b);
    if (Math.abs(dy) > Y_CLUSTER_TOL) return dy;
    return a.bbox.x - b.bbox.x;
  });

  const lines: BatchOcrWordBox[][] = [];
  let current: BatchOcrWordBox[] = [];
  let refCy = lineCenterY(sorted[0]!);

  for (const w of sorted) {
    const cy = lineCenterY(w);
    if (current.length === 0) {
      current.push(w);
      refCy = cy;
      continue;
    }
    if (Math.abs(cy - refCy) <= Y_CLUSTER_TOL) {
      current.push(w);
      refCy = (refCy * (current.length - 1) + cy) / current.length;
    } else {
      lines.push(current);
      current = [w];
      refCy = cy;
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

/**
 * Group words into vertical strips (match lines, vertical sheet IDs). Uses center-x clustering;
 * each column is sorted top-to-bottom for tight text join.
 */
export function groupWordsIntoColumns(words: BatchOcrWordBox[]): BatchOcrWordBox[][] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => {
    const dx = lineCenterX(a) - lineCenterX(b);
    if (Math.abs(dx) > X_CLUSTER_TOL) return dx;
    return lineCenterY(a) - lineCenterY(b);
  });

  const cols: BatchOcrWordBox[][] = [];
  let current: BatchOcrWordBox[] = [];
  let refCx = lineCenterX(sorted[0]!);

  for (const w of sorted) {
    const cx = lineCenterX(w);
    if (current.length === 0) {
      current.push(w);
      refCx = cx;
      continue;
    }
    if (Math.abs(cx - refCx) <= X_CLUSTER_TOL) {
      current.push(w);
      refCx = (refCx * (current.length - 1) + cx) / current.length;
    } else {
      cols.push(current);
      current = [w];
      refCx = cx;
    }
  }
  if (current.length) cols.push(current);
  return cols;
}

/** Space-separated reading line (horizontal). */
function buildSpacedLineString(line: BatchOcrWordBox[]): { text: string; charToWord: number[] } {
  const parts: string[] = [];
  const charToWord: number[] = [];
  line.forEach((w, wi) => {
    if (parts.length > 0) {
      parts.push(' ');
      charToWord.push(-1);
    }
    const t = w.text ?? '';
    for (let i = 0; i < t.length; i++) {
      charToWord.push(wi);
    }
    parts.push(t);
  });
  return { text: parts.join(''), charToWord };
}

/** Tight-joined tokens (helps OCR splits like A4 + .07, vertical stacks). */
function buildTightString(seq: BatchOcrWordBox[]): { text: string; charToWord: number[] } {
  const charToWord: number[] = [];
  const parts: string[] = [];
  seq.forEach((w, wi) => {
    const t = (w.text ?? '').trim();
    if (!t) return;
    for (let i = 0; i < t.length; i++) {
      charToWord.push(wi);
    }
    parts.push(t);
  });
  return { text: parts.join(''), charToWord };
}

function wordIndicesForRange(charToWord: number[], start: number, end: number): number[] {
  const set = new Set<number>();
  for (let i = start; i < end && i < charToWord.length; i++) {
    const wi = charToWord[i];
    if (wi >= 0) set.add(wi);
  }
  return [...set].sort((a, b) => a - b);
}

function unionSourceRect(words: BatchOcrWordBox[], indices: number[]): { x: number; y: number; width: number; height: number } | null {
  if (indices.length === 0) return null;
  let xmin = 1;
  let ymin = 1;
  let xmax = 0;
  let ymax = 0;
  for (const wi of indices) {
    const b = words[wi]?.bbox;
    if (!b) continue;
    xmin = Math.min(xmin, b.x);
    ymin = Math.min(ymin, b.y);
    xmax = Math.max(xmax, b.x + b.width);
    ymax = Math.max(ymax, b.y + b.height);
  }
  if (xmax <= xmin || ymax <= ymin) return null;
  const pad = Math.max(0.0008, 0.003 * Math.min(xmax - xmin, ymax - ymin));
  return {
    x: clamp01(xmin - pad),
    y: clamp01(ymin - pad),
    width: clamp01(xmax - xmin + 2 * pad),
    height: clamp01(ymax - ymin + 2 * pad),
  };
}

/**
 * Loose mode runs without SEE/MATCH cues; drawing numbers and title-block OCR
 * often produce tokens like V786 / KLW786 that match `[A-Z]{1,3}\\d{3}` but
 * are not sheet references.
 */
function passesLooseNoiseGate(normalizedRef: string): boolean {
  // Drawing / volume numbers: V###, W### (US title blocks).
  if (/^[VW]\d{3}$/.test(normalizedRef)) return false;
  // Legalese / vendor IDs: KLW786, KEY341, DWG123, COM292 (AAA + 3 digits).
  if (/^[A-Z]{3}\d{3}$/.test(normalizedRef)) return false;
  return true;
}

/** Reject rectangles that cover implausibly much of the page (sliding-window junk). */
function sourceRectLooksLikeCalloutBox(
  r: { width: number; height: number },
  options?: { relaxed?: boolean }
): boolean {
  const area = r.width * r.height;
  if (area < 1e-7) return false;
  if (area > (options?.relaxed ? 0.12 : 0.085)) return false;
  const ar = r.width / Math.max(r.height, 1e-9);
  if (ar > 38 || ar < 1 / 38) return false;
  // Wide/tall unions from unrelated words still pass area+AR; cap longest edge (~1/4 page).
  const maxSide = Math.max(r.width, r.height);
  if (maxSide > (options?.relaxed ? 0.28 : 0.22)) return false;
  const minSide = Math.min(r.width, r.height);
  if (minSide < 0.002) return false;
  return true;
}

/** Max center-to-center span (page fraction) for words contributing to one match. */
const MAX_WORD_CENTER_SPAN_LOOSE = 0.11;
const MAX_WORD_CENTER_SPAN_STRICT = 0.15;

function wordsSpatiallyCoherent(words: BatchOcrWordBox[], indices: number[], strict: boolean): boolean {
  if (indices.length <= 1) return true;
  const centers = indices
    .map((wi) => words[wi])
    .filter((w): w is BatchOcrWordBox => Boolean(w?.bbox))
    .map((w) => ({ x: lineCenterX(w), y: lineCenterY(w) }));
  if (centers.length <= 1) return true;
  const minX = Math.min(...centers.map((c) => c.x));
  const maxX = Math.max(...centers.map((c) => c.x));
  const minY = Math.min(...centers.map((c) => c.y));
  const maxY = Math.max(...centers.map((c) => c.y));
  const span = Math.max(maxX - minX, maxY - minY);
  return span <= (strict ? MAX_WORD_CENTER_SPAN_STRICT : MAX_WORD_CENTER_SPAN_LOOSE);
}

/** At least one contributing word (or their tight join) must substantiate the sheet ref. */
function occurrenceSubstantiatedByWords(
  words: BatchOcrWordBox[],
  indices: number[],
  normalizedRef: string
): boolean {
  for (const wi of indices) {
    const t = words[wi]?.text ?? '';
    const norm = normalizeSheetNumberForMatch(t);
    if (!norm) continue;
    if (norm === normalizedRef) return true;
    if (normalizedRef.includes('.') && norm.includes('.')) {
      if (norm === normalizedRef || norm.endsWith(normalizedRef) || normalizedRef.endsWith(norm)) {
        return true;
      }
    }
  }
  if (indices.length <= 4) {
    const slice = indices.map((wi) => words[wi]).filter((w): w is BatchOcrWordBox => Boolean(w));
    const tight = buildTightString(slice);
    const tightUpper = tight.text.toUpperCase();
    if (tightUpper.includes(normalizedRef)) return true;
    const tightNorm = normalizeSheetNumberForMatch(tight.text);
    if (tightNorm === normalizedRef) return true;
  }
  return false;
}

/**
 * Section callouts often stack detail # then sheet (e.g. 29 + A9.31 → tight "29A9.31"), which
 * breaks \\b-based regexes. Sliding windows recover "A9.31" and split OCR (A9 + .31).
 */
function applyPatternsToContiguousSlices(
  seq: BatchOcrWordBox[],
  strict: boolean,
  maxSliceWords: number,
  cueLineText: string | undefined,
  seen: Set<string>,
  out: SheetRefOccurrence[]
): void {
  const n = seq.length;
  for (let i = 0; i < n; i++) {
    const maxLen = Math.min(maxSliceWords, n - i);
    for (let len = 1; len <= maxLen; len++) {
      const slice = seq.slice(i, i + len);
      const tight = buildTightString(slice);
      if (tight.text.length === 0 || tight.text.length > MAX_SLICE_CHARS) continue;
      applyPatterns(tight.text.toUpperCase(), tight.charToWord, slice, strict, cueLineText, seen, out);
    }
  }
}

interface ApplyPatternsOptions {
  /** Bubble / callout OCR crops — skip callout-box size gate, allow taller ROIs. */
  trustIsolatedBox?: boolean;
}

function applyPatterns(
  upperText: string,
  charToWord: number[],
  words: BatchOcrWordBox[],
  strict: boolean,
  cueLineText: string | undefined,
  seen: Set<string>,
  out: SheetRefOccurrence[],
  options?: ApplyPatternsOptions
): void {
  if (strict && cueLineText != null && !STRICT_CUE_RE.test(cueLineText)) return;
  if (!upperText.trim()) return;

  const trustIsolatedBox = options?.trustIsolatedBox === true;

  for (const spec of REF_PATTERN_SPECS) {
    const re = new RegExp(spec.re.source, spec.re.flags.includes('g') ? spec.re.flags : `${spec.re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(upperText)) != null) {
      const rawPick = spec.pick(m);
      if (!rawPick) continue;
      const normalizedRef = normalizeSheetNumberForMatch(rawPick);
      if (!normalizedRef || normalizedRef.length < 2) continue;
      if (!strict && !passesLooseNoiseGate(normalizedRef)) continue;

      const start = m.index;
      const end = start + m[0].length;
      const wordIndices = wordIndicesForRange(charToWord, start, end);
      const sourceRect = unionSourceRect(words, wordIndices);
      if (!sourceRect) continue;
      if (!trustIsolatedBox && !sourceRectLooksLikeCalloutBox(sourceRect)) continue;
      if (trustIsolatedBox && !sourceRectLooksLikeCalloutBox(sourceRect, { relaxed: true })) continue;
      if (!trustIsolatedBox && !wordsSpatiallyCoherent(words, wordIndices, strict)) continue;
      if (!trustIsolatedBox && !occurrenceSubstantiatedByWords(words, wordIndices, normalizedRef)) continue;

      const dedupeKey = `${normalizedRef}|${sourceRect.x.toFixed(4)}|${sourceRect.y.toFixed(4)}|${sourceRect.width.toFixed(4)}|${sourceRect.height.toFixed(4)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      out.push({ normalizedRef, sourceRect });
    }
  }
}

export interface SheetRefOccurrence {
  normalizedRef: string;
  sourceRect: { x: number; y: number; width: number; height: number };
}

/**
 * Extract sheet reference occurrences from one page's word boxes.
 * Handles horizontal lines (space- and tight-joined) and vertical stacks (match lines, split OCR).
 */
export function detectSheetRefsFromWordBoxes(
  wordBoxes: BatchOcrWordBox[],
  options: { mode: 'strict' | 'loose' }
): SheetRefOccurrence[] {
  const out: SheetRefOccurrence[] = [];
  const seen = new Set<string>();
  const strict = options.mode === 'strict';
  const maxSliceWords = strict ? MAX_SLICE_WORDS_STRICT : MAX_SLICE_WORDS_LOOSE;

  const words = wordBoxes.filter((w) => typeof w.text === 'string' && w.text.trim().length > 0);
  if (words.length === 0) return out;

  const lines = groupWordsIntoLines(words);
  for (const line of lines) {
    const lineX = [...line].sort((a, b) => a.bbox.x - b.bbox.x);
    const spaced = buildSpacedLineString(lineX);
    applyPatterns(spaced.text.toUpperCase(), spaced.charToWord, lineX, strict, spaced.text, seen, out);

    const tight = buildTightString(lineX);
    // Always run tight join: patterns need contiguous tokens (e.g. A4 + .07 → A4.07); spaced
    // "A4 .07" does not match sheet regexes. tight/squeeze equality is common, so a gated
    // "only if different from spaced.replace" would skip this pass entirely for most lines.
    if (tight.text.length > 0) {
      applyPatterns(tight.text.toUpperCase(), tight.charToWord, lineX, strict, spaced.text, seen, out);
    }
    if (lineX.length > 1) {
      applyPatternsToContiguousSlices(lineX, strict, maxSliceWords, spaced.text, seen, out);
    }
  }

  const columns = groupWordsIntoColumns(words);
  for (const col of columns) {
    if (col.length === 0) continue;
    const colY = [...col].sort((a, b) => lineCenterY(a) - lineCenterY(b));
    if (colY.length > 16) continue;
    const columnCue = colY
      .map((w) => (w.text ?? '').trim())
      .filter((t) => t.length > 0)
      .join(' ');
    applyPatternsToContiguousSlices(colY, strict, maxSliceWords, columnCue || undefined, seen, out);
  }

  return out;
}

/**
 * Per-box detection for bubble / callout OCR crops. Skips line/column grouping so
 * supplemental ROIs link at the crop hotspot instead of drifting to unrelated page text.
 */
export function detectSheetRefsFromIsolatedBoxes(
  wordBoxes: BatchOcrWordBox[],
  options: { mode: 'strict' | 'loose' }
): SheetRefOccurrence[] {
  const out: SheetRefOccurrence[] = [];
  const seen = new Set<string>();
  const strict = options.mode === 'strict';

  for (const box of wordBoxes) {
    const text = (box.text ?? '').trim();
    if (!text || !box.bbox || typeof box.bbox.x !== 'number') continue;
    const words = [box];
    const spaced = buildSpacedLineString(words);
    applyPatterns(
      spaced.text.toUpperCase(),
      spaced.charToWord,
      words,
      strict,
      text,
      seen,
      out,
      { trustIsolatedBox: true }
    );
  }

  return out;
}
