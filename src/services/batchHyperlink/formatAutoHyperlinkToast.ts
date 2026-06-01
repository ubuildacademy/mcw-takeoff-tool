import type { RunBatchHyperlinksResult } from './runBatchHyperlinks';

export interface FormatAutoHyperlinkToastExtras {
  /** How many documents the pre-step PyMuPDF text re-extract actually ran on. */
  pymupdfDocsRan?: number;
  /** How many pages PyMuPDF re-read text from across all docs. */
  pymupdfPagesExtracted?: number;
  /** How many documents the pre-step bubble OCR pass ran on. */
  bubbleOcrDocsRan?: number;
  /** How many round callout bubbles bubble OCR recovered (sheet-ref filtered). */
  bubbleOcrCalloutsFound?: number;
  /** Pages where the template callout pass found at least one sheet ref. */
  calloutPassPagesMatched?: number;
  /** Word boxes from the template callout pass (split-circle / cloud shapes). */
  calloutPassWordBoxCount?: number;
}

/** Short title + optional detail for Sonner. */
export function formatAutoHyperlinkToast(
  run: RunBatchHyperlinksResult,
  extras: FormatAutoHyperlinkToastExtras = {}
): {
  title: string;
  description?: string;
} {
  const { createdCount: n } = run;

  const title =
    n === 0
      ? 'Auto-hyperlink finished — no new links'
      : `Added ${n} blue quick-link${n === 1 ? '' : 's'} on your drawings`;

  const parts: string[] = [];

  const pymupdfDocs = extras.pymupdfDocsRan ?? 0;
  const pymupdfPages = extras.pymupdfPagesExtracted ?? 0;
  if (pymupdfDocs > 0) {
    parts.push(
      `PyMuPDF re-read text from ${pymupdfDocs} PDF${pymupdfDocs === 1 ? '' : 's'} (${pymupdfPages} page${pymupdfPages === 1 ? '' : 's'}) to recover callout-bubble text PDF.js missed.`
    );
  }

  const bubbleDocs = extras.bubbleOcrDocsRan ?? 0;
  const bubbleCallouts = extras.bubbleOcrCalloutsFound ?? 0;
  if (bubbleDocs > 0) {
    parts.push(
      `Bubble OCR scanned ${bubbleDocs} PDF${bubbleDocs === 1 ? '' : 's'} and found ${bubbleCallouts} round callout${bubbleCallouts === 1 ? '' : 's'} drawn as vector paths.`
    );
  }

  const calloutPages = extras.calloutPassPagesMatched ?? 0;
  const calloutBoxes = extras.calloutPassWordBoxCount ?? 0;
  if (calloutPages > 0) {
    parts.push(
      `Template scan read ${calloutBoxes} split-circle or cloud callout${calloutBoxes === 1 ? '' : 's'} on ${calloutPages} page${calloutPages === 1 ? '' : 's'}.`
    );
  }

  if (run.skippedNoTarget > 0) {
    const refHint =
      run.topNoTargetRefs.length > 0
        ? ` Examples: ${run.topNoTargetRefs
            .slice(0, 5)
            .map(([ref, , , count]) => `${ref}${count > 1 ? ` (×${count})` : ''}`)
            .join(', ')}.`
        : '';
    parts.push(
      `${run.skippedNoTarget} sheet callout${run.skippedNoTarget === 1 ? '' : 's'} didn’t match any tab in your sidebar (check that the referenced sheets are uploaded and that the title block sheet numbers match the callouts).${refHint}`
    );
  }
  if (run.skippedSelfLink > 0) {
    parts.push(
      `${run.skippedSelfLink} callout${run.skippedSelfLink === 1 ? '' : 's'} already referred to the same page you’re on, so a link wasn’t added.`
    );
  }
  if (run.skippedAmbiguousTarget > 0) {
    // Sheet index keys both `A4.51` and its no-dot alias `A451` for the same sheet — dedupe
    // by preferring the dotted form when both are listed so toast doesn't read like 2 sheets.
    const dotted = new Set(run.ambiguousKeysInIndex.filter((k) => k.includes('.')));
    const dottedCompact = new Set([...dotted].map((k) => k.replace(/\./g, '')));
    const display: string[] = [];
    const seen = new Set<string>();
    for (const k of run.ambiguousKeysInIndex) {
      const canonical = dotted.has(k) || !dottedCompact.has(k) ? k : null;
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      display.push(canonical);
      if (display.length >= 5) break;
    }
    const keyHint = display.length > 0 ? ` Duplicates: ${display.join(', ')}.` : '';
    parts.push(
      `${run.skippedAmbiguousTarget} callout${run.skippedAmbiguousTarget === 1 ? '' : 's'} pointed to a sheet number that shows up in more than one uploaded file. Same-file copies link automatically; cross-file duplicates are skipped to avoid wrong targets.${keyHint}`
    );
  }
  if (run.documentsSkippedNoOcr > 0) {
    parts.push(
      `${run.documentsSkippedNoOcr} PDF${run.documentsSkippedNoOcr === 1 ? '' : 's'} had no saved searchable text — run OCR on those files first.`
    );
  }
  if (run.skippedNoWordBoxesPages > 0) {
    parts.push(
      `${run.skippedNoWordBoxesPages} page${run.skippedNoWordBoxesPages === 1 ? '' : 's'} had no saved word locations — try re-running OCR.`
    );
  }
  if (run.skippedDuplicate > 0) {
    parts.push(
      `${run.skippedDuplicate} redundant match${run.skippedDuplicate === 1 ? '' : 'es'} skipped — same label at the same spot counted once (different callouts to the same sheet each get their own link).`
    );
  }

  if (parts.length === 0 && n > 0) {
    return { title: `${title}.` };
  }

  return parts.length > 0 ? { title, description: parts.join(' ') } : { title };
}
