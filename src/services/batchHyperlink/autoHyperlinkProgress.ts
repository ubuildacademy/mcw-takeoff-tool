/**
 * Client-side Auto-hyperlink run progress.
 *
 * The run is orchestrated in `handleExecuteAutoHyperlink`: it fires one request
 * per document per pre-pass, and the slow bubble-OCR pass can sit on a single
 * document for minutes. The server tracks a cumulative per-page counter keyed by
 * a `runId` (see server `autoHyperlinkProgress.ts`); the orchestrator polls it
 * and emits this shape so the run dialog can render a bar that moves page-by-page
 * across the whole run rather than freezing between document responses.
 */

export type AutoHyperlinkPhase =
  | 'scanning-callouts'
  | 'reextracting-text'
  | 'scanning-bubbles'
  | 'matching';

export interface AutoHyperlinkRunProgress {
  phase: AutoHyperlinkPhase;
  /** Cumulative pages finished across every pre-pass (from the server counter). */
  pagesDone: number;
  /** Total pages the run queued across all pre-passes (the orchestrator's denominator). */
  totalPages: number;
  /** Clamped 0..1 fill fraction for the bar. */
  fraction: number;
  /** Filename of the document whose page most recently completed ('' if none yet). */
  currentDoc: string;
  /** Page number within `currentDoc` (0 when not streaming, e.g. text re-extract). */
  currentDocPage: number;
  /** Total pages in `currentDoc` (0 when unknown). */
  currentDocTotal: number;
  /** Callouts found so far (accumulated from completed pre-pass responses — honest, not links). */
  calloutsFound: number;
}

/** Short human label for the current phase, shown above the bar. */
export function phaseLabel(phase: AutoHyperlinkPhase): string {
  switch (phase) {
    case 'scanning-callouts':
      return 'Scanning callouts';
    case 'reextracting-text':
      return 'Re-extracting text';
    case 'scanning-bubbles':
      return 'Scanning bubbles';
    case 'matching':
      return 'Matching sheet references';
  }
}
