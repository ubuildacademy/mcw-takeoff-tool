/**
 * PyMuPDF Text Extractor
 *
 * Thin wrapper around server/src/scripts/pymupdf_text_extract.py. Used by the
 * Auto-hyperlink pre-step to re-read PDF text directly with MuPDF, which is
 * far more permissive than PDF.js' getTextContent (and therefore catches the
 * callout-bubble glyphs that the Auto-hyperlink feature otherwise misses).
 *
 * Mirrors the spawn/availability pattern in pythonPdfConverter.ts.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';

const execAsync = promisify(exec);

export interface PyMuPdfWord {
  text: string;
  /** Normalized 0..1 left edge relative to unrotated page width. */
  x: number;
  /** Normalized 0..1 top edge relative to unrotated page height. */
  y: number;
  /** Normalized 0..1 box width. */
  width: number;
  /** Normalized 0..1 box height. */
  height: number;
}

export interface PyMuPdfPage {
  pageNumber: number;
  /** Unrotated page width in PDF points. */
  width: number;
  /** Unrotated page height in PDF points. */
  height: number;
  /** Page rotation in degrees (0/90/180/270). */
  rotation: number;
  /** Concatenated page text, useful for general search indexing. */
  text: string;
  words: PyMuPdfWord[];
  error?: string;
}

export interface PyMuPdfExtractionResult {
  totalPages: number;
  pages: PyMuPdfPage[];
}

interface PyMuPdfScriptOutput {
  success: boolean;
  totalPages?: number;
  pages?: PyMuPdfPage[];
  error?: string;
}

class PyMuPdfTextExtractor {
  private readonly pythonScriptPath: string;

  constructor() {
    const isCompiled = __dirname.includes('dist');
    const baseDir = isCompiled
      ? path.join(__dirname, '..', '..')
      : path.join(__dirname, '..');

    this.pythonScriptPath = isCompiled
      ? path.join(baseDir, 'src', 'scripts', 'pymupdf_text_extract.py')
      : path.join(baseDir, 'scripts', 'pymupdf_text_extract.py');
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
   * Extract word boxes for every page of a PDF on disk.
   *
   * Throws on script failure / unreachable PyMuPDF; callers should treat that
   * as a hard fail and fall back to whatever PDF.js produced.
   */
  async extractAllPages(pdfPath: string): Promise<PyMuPdfExtractionResult> {
    if (!(await fs.pathExists(pdfPath))) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }
    if (!(await fs.pathExists(this.pythonScriptPath))) {
      throw new Error(`PyMuPDF script not found: ${this.pythonScriptPath}`);
    }

    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const enhancedPath = this.getEnhancedPath();
    const command = `${pythonCommand} "${this.pythonScriptPath}" "${pdfPath}"`;

    console.log(`📝 Running PyMuPDF text extraction: ${command}`);
    const start = Date.now();

    let stdout: string;
    let stderr: string;
    try {
      const result = await execAsync(command, {
        // Large multi-page PDFs can take a while; cap generously but well
        // below the 15-minute HTTP timeout the server enforces.
        timeout: 10 * 60 * 1000,
        // 500MB stdout cap - per-page word lists can be tens of thousands of words.
        maxBuffer: 500 * 1024 * 1024,
        env: { ...process.env, PATH: enhancedPath },
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (execError: any) {
      console.error('❌ PyMuPDF text extraction failed:', {
        message: execError instanceof Error ? execError.message : 'Unknown error',
        code: execError?.code,
        stderr: (execError?.stderr || '').toString().slice(0, 2000),
      });
      throw new Error(
        `PyMuPDF text extraction failed: ${
          execError instanceof Error ? execError.message : 'Unknown error'
        }`,
      );
    }

    if (stderr && !stderr.includes('DeprecationWarning')) {
      console.warn('⚠️ PyMuPDF script stderr:', stderr.slice(0, 1000));
    }

    let parsed: PyMuPdfScriptOutput;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch (parseErr) {
      console.error(
        '❌ Failed to parse PyMuPDF output (first 500 chars):',
        stdout.slice(0, 500),
      );
      throw new Error(
        `Failed to parse PyMuPDF script output: ${
          parseErr instanceof Error ? parseErr.message : 'Invalid JSON'
        }`,
      );
    }

    if (!parsed.success) {
      throw new Error(parsed.error || 'PyMuPDF script reported failure');
    }

    const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
    const totalPages = parsed.totalPages ?? pages.length;
    const elapsed = Date.now() - start;
    const wordCount = pages.reduce((sum, p) => sum + (p.words?.length || 0), 0);
    console.log(
      `✅ PyMuPDF extracted ${wordCount} words across ${totalPages} pages in ${elapsed}ms`,
    );

    return { totalPages, pages };
  }
}

export const pymupdfTextExtractor = new PyMuPdfTextExtractor();
