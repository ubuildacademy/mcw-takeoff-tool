import type { PDFDocument } from '../../types';

/** Treat "Unknown" like HyperlinkSheetPickerDialog — not a usable sheet index key. */
export function isMeaningfulSheetNumber(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  return value.trim().toLowerCase() !== 'unknown';
}

/**
 * Normalize a sheet number string for index lookup (A-101 / A 101 / A101 → same key; keeps dots e.g. A4.21).
 */
export function normalizeSheetNumberForMatch(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/\u2013|\u2014/g, '-');
  if (!s) return '';
  s = s.replace(/\s+/g, '');
  s = s.replace(/([A-Z]+)-(?=[0-9])/g, '$1');
  return s;
}

/**
 * Aliases for a normalized sheet number so callsites can index/lookup with dot/no-dot equivalents.
 * Examples:
 *   A4.51  → ["A4.51", "A451"]
 *   A451   → ["A451"]            (no dot ambiguity — don't guess)
 *   A1     → ["A1"]
 *
 * Symmetric handling: title-block keys with dots are indexed under both forms, and OCR-detected refs
 * with dots also probe the no-dot form. That lets `A4.51` callouts find an `A451` sheet (and vice
 * versa via the dotted alias on the index side).
 */
export function sheetNumberKeyAliases(normalized: string): string[] {
  if (!normalized) return [];
  const out = new Set<string>([normalized]);
  if (normalized.includes('.')) {
    out.add(normalized.replace(/\./g, ''));
  }
  return [...out];
}

export interface SheetIndexTarget {
  documentId: string;
  pageNumber: number;
}

export interface SheetIndex {
  /** All distinct targets across alias forms of the input key. */
  getTargets(normalizedRef: string): SheetIndexTarget[];
  /** Keys with >1 distinct target globally — surfaced for diagnostics; resolver may still pick a same-doc match. */
  ambiguousKeys: string[];
  pagesWithSheetNumber: number;
  totalPagesCounted: number;
  /** Every lookup key in the index (dotted + no-dot aliases). Used for OCR near-miss repair. */
  allKeys: ReadonlySet<string>;
}

function targetSlot(t: SheetIndexTarget): string {
  return `${t.documentId}\0${t.pageNumber}`;
}

/**
 * Build lookup from sidebar / PDFDocument page metadata (sheetNumber per page).
 * Stores all targets per key — resolution / disambiguation happens at link time in `runBatchHyperlinks`.
 */
export function buildSheetIndexFromDocuments(documents: PDFDocument[]): SheetIndex {
  const keyToTargets = new Map<string, Map<string, SheetIndexTarget>>();
  let pagesWithSheetNumber = 0;
  let totalPagesCounted = 0;

  for (const doc of documents) {
    const totalPages = Math.max(doc.totalPages ?? 0, doc.pages?.length ?? 0) || 1;
    for (let p = 1; p <= totalPages; p++) {
      totalPagesCounted += 1;
      const page = doc.pages?.find((pg) => pg.pageNumber === p);
      const num = page?.sheetNumber;
      if (!isMeaningfulSheetNumber(num)) continue;
      pagesWithSheetNumber += 1;
      const normalized = normalizeSheetNumberForMatch(num!);
      if (!normalized) continue;

      const target: SheetIndexTarget = { documentId: doc.id, pageNumber: p };
      const slot = targetSlot(target);
      for (const alias of sheetNumberKeyAliases(normalized)) {
        let m = keyToTargets.get(alias);
        if (!m) {
          m = new Map();
          keyToTargets.set(alias, m);
        }
        m.set(slot, target);
      }
    }
  }

  const ambiguousKeys: string[] = [];
  for (const [key, slots] of keyToTargets) {
    if (slots.size > 1) ambiguousKeys.push(key);
  }
  ambiguousKeys.sort();

  const allKeys = new Set<string>(keyToTargets.keys());

  return {
    getTargets(normalizedRef: string): SheetIndexTarget[] {
      const seen = new Map<string, SheetIndexTarget>();
      for (const alias of sheetNumberKeyAliases(normalizedRef)) {
        const slots = keyToTargets.get(alias);
        if (!slots) continue;
        for (const [slot, t] of slots) {
          if (!seen.has(slot)) seen.set(slot, t);
        }
      }
      return [...seen.values()];
    },
    ambiguousKeys,
    pagesWithSheetNumber,
    totalPagesCounted,
    allKeys,
  };
}

/** Typical arch drawing sheet key with a dot (title block / callout shape). */
const ARCH_DOTTED_SHEET_RE = /^[A-Z]{1,3}\d{1,2}\.\d{1,2}$/;

function stripRepeatedLeadingLetterVariants(ref: string): string[] {
  const acc: string[] = [ref];
  let r = ref;
  for (let i = 0; i < 4; i++) {
    if (r.length >= 3 && r[0] === r[1] && /[A-Z]/.test(r[0]!)) {
      r = r.slice(1);
      acc.push(r);
      continue;
    }
    break;
  }
  return acc;
}

/**
 * Generate normalized ref strings to try when OCR dropped a dot, duplicated a
 * leading letter, or truncated `A9.22` to `A9` while the index holds a unique
 * dotted sheet for that prefix. Only conservative transforms — ambiguity
 * yields no candidates (caller requires a single resolved target slot).
 */
export function expandNearMissSheetRefCandidates(ref: string, allKeys: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const bases = stripRepeatedLeadingLetterVariants(ref);
  for (const v of bases) {
    if (v) out.add(v);
    // Missing dot: A653 → A6.53, A922 → A9.22 (letters + 1 digit + 2 digits, no dot).
    const ins = v.match(/^([A-Z]{1,3})(\d)(\d{2})$/);
    if (ins) out.add(`${ins[1] ?? ''}${ins[2] ?? ''}.${ins[3] ?? ''}`);
  }
  // Short form A9 → unique A9.xx in this project
  for (const v of [...out]) {
    if (!ARCH_DOTTED_SHEET_RE.test(v) && /^[A-Z]{1,3}\d{1,2}$/.test(v)) {
      const prefix = v;
      const dotted = [...allKeys].filter((k) => ARCH_DOTTED_SHEET_RE.test(k) && k.startsWith(`${prefix}.`));
      if (dotted.length === 1) out.add(dotted[0]!);
    }
  }
  return [...out];
}

/**
 * When direct `getTargets(ref)` is empty, try conservative OCR near-miss
 * variants. Resolves only if every matching variant maps to the same physical
 * sheet slot (document + page).
 */
export function getTargetsWithNearMiss(index: SheetIndex, normalizedRef: string): SheetIndexTarget[] {
  const candidates = expandNearMissSheetRefCandidates(normalizedRef, index.allKeys);
  const slotToTarget = new Map<string, SheetIndexTarget>();
  for (const c of candidates) {
    for (const t of index.getTargets(c)) {
      slotToTarget.set(targetSlot(t), t);
    }
  }
  if (slotToTarget.size !== 1) return [];
  return [...slotToTarget.values()];
}

export interface ResolvedTarget {
  target: SheetIndexTarget | null;
  /** True only when multiple equally-likely targets remain after same-document preference. */
  ambiguous: boolean;
}

/**
 * Pick a single target for a detected occurrence, preferring within-source-doc.
 * - 0 targets → not found
 * - 1 target → use it
 * - many targets:
 *     - exactly one same-doc target → use it (covers duplicate sheet numbers across files)
 *     - many same-doc targets → ambiguous
 *     - zero same-doc targets, 1 unique cross-doc target → use it
 *     - else → ambiguous
 */
export function resolveTargetForSource(
  targets: SheetIndexTarget[],
  sourceDocumentId: string,
): ResolvedTarget {
  if (targets.length === 0) return { target: null, ambiguous: false };
  if (targets.length === 1) return { target: targets[0]!, ambiguous: false };
  const sameDoc = targets.filter((t) => t.documentId === sourceDocumentId);
  if (sameDoc.length === 1) return { target: sameDoc[0]!, ambiguous: false };
  if (sameDoc.length > 1) return { target: null, ambiguous: true };
  const uniqueDocs = new Set(targets.map((t) => t.documentId));
  if (uniqueDocs.size === 1) return { target: targets[0]!, ambiguous: false };
  return { target: null, ambiguous: true };
}
