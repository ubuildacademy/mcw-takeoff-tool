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
import { spawn } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { devLog } from '../lib/devLog';

export interface BubbleOcrCallout {
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

export interface BubbleOcrPage {
  pageNumber: number;
  /** Unrotated page width in PDF points (may be 0 if the page errored). */
  width: number;
  /** Unrotated page height in PDF points (may be 0 if the page errored). */
  height: number;
  bubbles: BubbleOcrCallout[];
  error?: string;
}

export interface BubbleOcrExtractionResult {
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

    const { stdout, stderrTail } = await this.runScript(
      pythonCommand,
      [this.pythonScriptPath, pdfPath],
      enhancedPath,
      onPage
    );

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

  /**
   * Run the python script and stream its stderr to the server log line by
   * line. Returns the accumulated stdout (a single JSON blob) plus the last
   * few stderr lines so callers can surface them on parse failure.
   *
   * We use `spawn` (not `exec`) for two reasons:
   *   1) The script emits per-page progress to stderr (`[bubble-ocr] page
   *      N/M: ...`). Buffering it for the whole run defeats the purpose --
   *      we want it streamed live.
   *   2) `exec` swallows the SIGTERM cause with `code: null` + empty stderr,
   *      making timeouts indistinguishable from missing-binary errors. With
   *      `spawn` we can react to `close` with `signal` set.
   */
  private runScript(
    command: string,
    args: string[],
    enhancedPath: string,
    onPage?: (page: number, totalPages: number) => void
  ): Promise<{ stdout: string; stderrTail: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env, PATH: enhancedPath, PYTHONUNBUFFERED: '1' },
      });

      const stdoutChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stdoutOverflow = false;
      // Recent stderr lines, kept as a small ring so we can include them in
      // error messages without blowing memory on chatty failure modes.
      const STDERR_TAIL_LINES = 40;
      const stderrTail: string[] = [];
      let stderrLineBuf = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // best effort -- the promise still rejects below via 'close'
        }
      }, BUBBLE_OCR_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutOverflow) return;
        if (stdoutBytes + chunk.length > BUBBLE_OCR_MAX_STDOUT_BYTES) {
          stdoutOverflow = true;
          return;
        }
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrLineBuf += chunk.toString('utf8');
        let nlIdx: number;
        while ((nlIdx = stderrLineBuf.indexOf('\n')) !== -1) {
          const line = stderrLineBuf.slice(0, nlIdx).trimEnd();
          stderrLineBuf = stderrLineBuf.slice(nlIdx + 1);
          if (!line) continue;
          // Forward script progress straight to the server log; the user can
          // tail this terminal during an Auto-hyperlink run and see live N/M.
          devLog(`🫧 ${line}`);
          // Surface per-page progress to the caller (e.g. the run-status map
          // the client polls). Format: `[bubble-ocr] page N/M: ...`.
          if (onPage) {
            const m = line.match(/\bpage (\d+)\/(\d+)\b/);
            if (m) onPage(parseInt(m[1], 10), parseInt(m[2], 10));
          }
          stderrTail.push(line);
          if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(
          new Error(
            `Failed to start bubble OCR script: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        );
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        // Flush any trailing stderr line that didn't end in newline.
        const trailing = stderrLineBuf.trim();
        if (trailing) {
          devLog(`🫧 ${trailing}`);
          stderrTail.push(trailing);
          if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
        }

        if (stdoutOverflow) {
          return reject(
            new Error(
              `Bubble OCR stdout exceeded ${BUBBLE_OCR_MAX_STDOUT_BYTES} bytes`
            )
          );
        }

        if (timedOut) {
          return reject(
            new Error(
              `Bubble OCR pass timed out after ${BUBBLE_OCR_TIMEOUT_MS / 1000}s`
            )
          );
        }

        if (code !== 0) {
          const sigSuffix = signal ? ` (signal: ${signal})` : '';
          const tail = stderrTail.slice(-5).join('\n  ');
          return reject(
            new Error(
              `Bubble OCR script exited with code ${code}${sigSuffix}` +
                (tail ? `\n  ${tail}` : '')
            )
          );
        }

        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderrTail: stderrTail.slice(-10).join('\n  '),
        });
      });
    });
  }
}

export const bubbleOcrExtractor = new BubbleOcrExtractor();
