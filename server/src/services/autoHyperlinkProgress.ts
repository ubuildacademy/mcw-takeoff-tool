/**
 * Auto-hyperlink run progress (in-memory).
 *
 * The Auto-hyperlink flow is orchestrated by the CLIENT: it fires one HTTP
 * request per document per pre-pass (vector callouts, then bubble OCR, then
 * PyMuPDF), and each request runs the whole document server-side before
 * responding. The slow pass (bubble OCR, ~1-2 s/page) can sit on a single
 * 80-page document for minutes, during which the client sees nothing move.
 *
 * The python passes already emit per-page progress to stderr; the extractors
 * forward each `page N/M` line here via `reportPage`. We keep a tiny in-memory
 * map keyed by a client-generated `runId` and expose it over a GET endpoint the
 * client polls. `pagesDone` is a monotonic counter incremented once per page
 * line across every instrumented pass, so concurrent workers (the vector pass
 * runs up to 3 at once) stay correct — the client owns the denominator (total
 * pages across the whole run) and divides.
 *
 * Deliberately in-memory: progress is ephemeral and worthless after the run,
 * and a single server process handles a given run's requests. Entries self-expire.
 */

export interface AutoHyperlinkProgress {
  runId: string;
  /** Cumulative pages finished across every instrumented pass (monotonic). */
  pagesDone: number;
  /** Human label of the document whose page most recently completed. */
  currentDoc: string;
  /** Page number within `currentDoc` that most recently completed (1-based). */
  currentDocPage: number;
  /** Total pages in `currentDoc`. */
  currentDocTotal: number;
  /** Wall-clock of the last update (ms epoch), used for TTL cleanup. */
  updatedAt: number;
}

// Runs older than this since their last update are swept. Comfortably longer
// than the 15-min HTTP window a single pass can occupy.
const RUN_TTL_MS = 20 * 60 * 1000;
const runs = new Map<string, AutoHyperlinkProgress>();

function sweep(now: number): void {
  for (const [id, state] of runs) {
    if (now - state.updatedAt > RUN_TTL_MS) runs.delete(id);
  }
}

/** Fetch a run's state, creating it (and sweeping stale runs) if absent. */
function ensureRun(runId: string): AutoHyperlinkProgress {
  let state = runs.get(runId);
  if (!state) {
    const now = Date.now();
    sweep(now);
    state = {
      runId,
      pagesDone: 0,
      currentDoc: '',
      currentDocPage: 0,
      currentDocTotal: 0,
      updatedAt: now,
    };
    runs.set(runId, state);
  }
  return state;
}

/** Begin (or reset) tracking for a run. Idempotent. */
export function startRun(runId: string): void {
  const now = Date.now();
  sweep(now);
  runs.set(runId, {
    runId,
    pagesDone: 0,
    currentDoc: '',
    currentDocPage: 0,
    currentDocTotal: 0,
    updatedAt: now,
  });
}

/**
 * Record that one page finished. Increments the monotonic page counter and
 * updates the "current document" label. Safe to call before `startRun`
 * (auto-initializes) so a late-arriving progress line is never dropped.
 */
export function reportPage(
  runId: string,
  docLabel: string,
  page: number,
  docTotal: number,
): void {
  const state = ensureRun(runId);
  state.pagesDone += 1;
  state.currentDoc = docLabel;
  state.currentDocPage = page;
  state.currentDocTotal = docTotal;
  state.updatedAt = Date.now();
}

/**
 * Coarsely advance the page counter by `count` for a pass that can't stream
 * per-page (PyMuPDF runs buffered and finishes in seconds). Called once when
 * the pass finishes a document.
 */
export function addPages(runId: string, count: number, docLabel: string): void {
  const state = ensureRun(runId);
  state.pagesDone += Math.max(0, count);
  if (docLabel) state.currentDoc = docLabel;
  state.updatedAt = Date.now();
}

export function getProgress(runId: string): AutoHyperlinkProgress | null {
  return runs.get(runId) ?? null;
}

/** Drop a finished run so the map doesn't grow unbounded. */
export function endRun(runId: string): void {
  runs.delete(runId);
}
