/**
 * Vector Callout Extractor
 *
 * Thin wrapper around server/src/scripts/vector_callout_pass.py. Reads
 * detail/section callout geometry (circles, hexagons) straight from a vector
 * PDF's drawing commands via PyMuPDF and pairs each shape with the exact text
 * words inside it — no rasterization, no OCR, exact coordinates.
 *
 * This is the precision path for Auto-hyperlink on CAD-exported sets; the
 * raster passes (bubble_ocr_pass.py, callout_hyperlink_pass.py) remain the
 * fallback for flattened/scanned pages.
 *
 * Same spawn/stream pattern as bubbleOcrExtractor: stderr progress lines are
 * piped into the server log live.
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import { devLog } from '../lib/devLog';
import { runPythonScript } from '../lib/runPythonScript';

interface VectorCalloutWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VectorCallout {
  /** Normalized 0..1 bbox of the callout shape on the unrotated page. */
  bbox: { x: number; y: number; width: number; height: number };
  shape: 'circle' | 'hexagon';
  /** Top-half label ("5", "A", "D1") — null when the bubble only holds a sheet ref. */
  detailLabel: string | null;
  /** Bottom-half sheet number ("A-501", "S3.1") — null for detail-title bubbles. */
  sheetRef: string | null;
  /**
   * reference    — points at another sheet (has sheetRef)
   * detail_title — labels a detail on this sheet (detailLabel + adjacent title text)
   * unlabeled    — shape with a label but no title/ref context
   */
  kind: 'reference' | 'detail_title' | 'unlabeled';
  titleText: string | null;
  words: VectorCalloutWord[];
}

interface VectorCalloutPage {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  callouts: VectorCallout[];
  error?: string;
}

interface VectorCalloutExtractionResult {
  totalPages: number;
  calloutsFound: number;
  pages: VectorCalloutPage[];
}

interface VectorCalloutScriptOutput {
  success: boolean;
  totalPages?: number;
  calloutsFound?: number;
  pages?: VectorCalloutPage[];
  error?: string;
}

// Pure geometry + text extraction: seconds per document even for large sets.
// Cap generous anyway; the route's HTTP window is 15 min.
const VECTOR_CALLOUT_TIMEOUT_MS = 10 * 60 * 1000;
const VECTOR_CALLOUT_MAX_STDOUT_BYTES = 100 * 1024 * 1024;

class VectorCalloutExtractor {
  private readonly pythonScriptPath: string;

  constructor() {
    const isCompiled = __dirname.includes('dist');
    const baseDir = isCompiled
      ? path.join(__dirname, '..', '..')
      : path.join(__dirname, '..');

    this.pythonScriptPath = isCompiled
      ? path.join(baseDir, 'src', 'scripts', 'vector_callout_pass.py')
      : path.join(baseDir, 'scripts', 'vector_callout_pass.py');
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
   * Extract callout geometry + inside text from every page of `pdfPath`.
   * Throws on script failure (e.g. PyMuPDF missing); callers treat that as a
   * soft fail and fall back to the raster passes.
   */
  async extractAllPages(
    pdfPath: string,
    onPage?: (page: number, totalPages: number) => void
  ): Promise<VectorCalloutExtractionResult> {
    if (!(await fs.pathExists(pdfPath))) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }
    if (!(await fs.pathExists(this.pythonScriptPath))) {
      throw new Error(`Vector callout script not found: ${this.pythonScriptPath}`);
    }

    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const enhancedPath = this.getEnhancedPath();

    devLog(
      `📐 Running vector callout pass: ${pythonCommand} ${this.pythonScriptPath} ${pdfPath}`
    );
    const start = Date.now();

    const { stdout, stderrTail } = await runPythonScript({
      command: pythonCommand,
      args: [this.pythonScriptPath, pdfPath],
      enhancedPath,
      timeoutMs: VECTOR_CALLOUT_TIMEOUT_MS,
      maxStdoutBytes: VECTOR_CALLOUT_MAX_STDOUT_BYTES,
      logPrefix: '📐',
      label: 'vector callout',
      onPage,
    });

    let parsed: VectorCalloutScriptOutput;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch (parseErr) {
      console.error(
        '❌ Failed to parse vector callout output (first 500 chars):',
        stdout.slice(0, 500)
      );
      if (stderrTail) {
        console.error('  stderr tail:', stderrTail);
      }
      throw new Error(
        `Failed to parse vector callout output: ${
          parseErr instanceof Error ? parseErr.message : 'Invalid JSON'
        }`
      );
    }

    if (!parsed.success) {
      throw new Error(parsed.error || 'Vector callout script reported failure');
    }

    const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
    const totalPages = parsed.totalPages ?? pages.length;
    const calloutsFound =
      parsed.calloutsFound ??
      pages.reduce((sum, p) => sum + (p.callouts?.length || 0), 0);
    const elapsed = Date.now() - start;
    devLog(
      `✅ Vector callout pass found ${calloutsFound} callouts across ${totalPages} pages in ${elapsed}ms`
    );

    return { totalPages, calloutsFound, pages };
  }
}

export const vectorCalloutExtractor = new VectorCalloutExtractor();
