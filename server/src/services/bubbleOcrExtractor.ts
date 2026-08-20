/**
 * Bubble OCR Extractor
 *
 * Thin wrapper around server/src/scripts/bubble_ocr_pass.py. Used by the
 * Auto-hyperlink pre-step to recover sheet-ref text from architectural
 * callout bubbles that PDF.js and PyMuPDF both miss because the bubble
 * glyphs are drawn as vector paths (line segments) rather than text.
 *
 * Uses `spawn` (not `exec`) so we can pipe the script's per-page stderr
 * progress lines (`[bubble-ocr] page N/M: ...`) into the server log live.
 * That gives us visibility into long runs and confirms throughput
 * problems aren't silent hangs.
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import { devLog } from '../lib/devLog';
import { runPythonScript } from '../lib/runPythonScript';

interface BubbleOcrCallout {
  /** OCR text from the bubble crop (already filtered to match a sheet-ref shape). */
  text: string;
  /** Normalized 0..1 left edge relative to unrotated page width. */
  x: number;
  /** Normalized 0..1 top edge relative to unrotated page height. */
  y: number;
  /** Normalized 0..1 box width. */
  width: number;
  /** Normalized 0..1 box height. */
  height: number;
  /** Mean Tesseract confidence (0..100) across tokens inside the crop. */
  confidence: number;
}

interface BubbleOcrPage {
  pageNumber: number;
  /** Unrotated page width in PDF points (may be 0 if the page errored). */
  width: number;
  /** Unrotated page height in PDF points (may be 0 if the page errored). */
  height: number;
  bubbles: BubbleOcrCallout[];
  error?: string;
}

interface BubbleOcrExtractionResult {
  totalPages: number;
  /** Total number of bubble-OCR callouts found across all pages. */
  calloutsFound: number;
  pages: BubbleOcrPage[];
}

interface BubbleOcrScriptOutput {
  success: boolean;
  totalPages?: number;
  calloutsFound?: number;
  pages?: BubbleOcrPage[];
  error?: string;
}

// 15-min cap matches the outer Express timeout in `routes/ocr.ts` so the
// child can use the full HTTP window if a huge doc needs it. With the new
// multiprocessing pool an 80-page plan set is ~2-3 min; this is headroom.
const BUBBLE_OCR_TIMEOUT_MS = 15 * 60 * 1000;
// Stdout is one JSON blob at the very end of the run. Plan sets stay well
// under 10 MB, but we cap generously to absorb pathological cases.
const BUBBLE_OCR_MAX_STDOUT_BYTES = 100 * 1024 * 1024;

class BubbleOcrExtractor {
  private readonly pythonScriptPath: string;

  constructor() {
    const isCompiled = __dirname.includes('dist');
    const baseDir = isCompiled
      ? path.join(__dirname, '..', '..')
      : path.join(__dirname, '..');

    this.pythonScriptPath = isCompiled
      ? path.join(baseDir, 'src', 'scripts', 'bubble_ocr_pass.py')
      : path.join(baseDir, 'scripts', 'bubble_ocr_pass.py');
  }

  private getEnhancedPath(): string {
    return [
      '/opt/venv/bin',
      '/root/.nix-profile/bin',
      '/nix/var/nix/profiles/default/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      process.env.PATH || '',
    ]
      .filter(Boolean)
      .join(':');
  }

  /**
   * Detect circular callout bubbles on every page of `pdfPath` and OCR each
   * one. Throws on script failure / missing OpenCV / Tesseract; callers
   * should treat that as a soft fail and continue with whatever text-based
   * extraction already produced.
   */
  async extractAllPages(
    pdfPath: string,
    onPage?: (page: number, totalPages: number) => void
  ): Promise<BubbleOcrExtractionResult> {
    if (!(await fs.pathExists(pdfPath))) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }
    if (!(await fs.pathExists(this.pythonScriptPath))) {
      throw new Error(`Bubble OCR script not found: ${this.pythonScriptPath}`);
    }

    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const enhancedPath = this.getEnhancedPath();

    devLog(
      `🫧 Running bubble OCR pass: ${pythonCommand} ${this.pythonScriptPath} ${pdfPath}`
    );
    const start = Date.now();

    const { stdout, stderrTail } = await runPythonScript({
      command: pythonCommand,
      args: [this.pythonScriptPath, pdfPath],
      enhancedPath,
      timeoutMs: BUBBLE_OCR_TIMEOUT_MS,
      maxStdoutBytes: BUBBLE_OCR_MAX_STDOUT_BYTES,
      logPrefix: '🫧',
      label: 'bubble OCR',
      onPage,
    });

    let parsed: BubbleOcrScriptOutput;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch (parseErr) {
      console.error(
        '❌ Failed to parse bubble OCR output (first 500 chars):',
        stdout.slice(0, 500)
      );
      if (stderrTail) {
        console.error('  stderr tail:', stderrTail);
      }
      throw new Error(
        `Failed to parse bubble OCR output: ${
          parseErr instanceof Error ? parseErr.message : 'Invalid JSON'
        }`
      );
    }

    if (!parsed.success) {
      throw new Error(parsed.error || 'Bubble OCR script reported failure');
    }

    const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
    const totalPages = parsed.totalPages ?? pages.length;
    const calloutsFound =
      parsed.calloutsFound ??
      pages.reduce((sum, p) => sum + (p.bubbles?.length || 0), 0);
    const elapsed = Date.now() - start;
    devLog(
      `✅ Bubble OCR found ${calloutsFound} callouts across ${totalPages} pages in ${elapsed}ms`
    );

    return { totalPages, calloutsFound, pages };
  }
}

export const bubbleOcrExtractor = new BubbleOcrExtractor();
