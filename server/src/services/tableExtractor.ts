/**
 * Table Extractor — thin wrapper around server/src/scripts/table_extract.py.
 *
 * Schedule→takeoff for vector PDFs: reconstructs a table (door/window/fixture
 * schedule) from a user-boxed region using line-grid geometry + exact text.
 * Deterministic, single page, sub-second — no OCR, no LLM.
 */
import { execFile } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { devLog } from '../lib/devLog';

export interface ExtractedTable {
  mode: 'ruled' | 'clustered';
  rows: string[][];
  /** Normalized page-space y-range per row (marker placement + traceability). */
  rowBoxes: Array<{ y0: number; y1: number }>;
  region: { x0: number; y0: number; x1: number; y1: number };
}

interface TableScriptOutput extends Partial<ExtractedTable> {
  success: boolean;
  error?: string;
}

const TABLE_EXTRACT_TIMEOUT_MS = 60 * 1000;
const MAX_STDOUT_BYTES = 20 * 1024 * 1024;

class TableExtractor {
  private readonly pythonScriptPath: string;

  constructor() {
    const isCompiled = __dirname.includes('dist');
    const baseDir = isCompiled
      ? path.join(__dirname, '..', '..')
      : path.join(__dirname, '..');
    this.pythonScriptPath = isCompiled
      ? path.join(baseDir, 'src', 'scripts', 'table_extract.py')
      : path.join(baseDir, 'scripts', 'table_extract.py');
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

  /** Extract the table inside `region` (normalized 0..1) on `pageNumber` (1-based). */
  async extract(
    pdfPath: string,
    pageNumber: number,
    region: { x: number; y: number; width: number; height: number }
  ): Promise<ExtractedTable> {
    if (!(await fs.pathExists(pdfPath))) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }
    if (!(await fs.pathExists(this.pythonScriptPath))) {
      throw new Error(`Table extract script not found: ${this.pythonScriptPath}`);
    }

    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const args = [
      this.pythonScriptPath,
      pdfPath,
      String(pageNumber),
      String(region.x),
      String(region.y),
      String(region.x + region.width),
      String(region.y + region.height),
    ];

    devLog(`📋 Running table extract: page ${pageNumber}`);
    const start = Date.now();

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        pythonCommand,
        args,
        {
          env: { ...process.env, PATH: this.getEnhancedPath(), PYTHONUNBUFFERED: '1' },
          timeout: TABLE_EXTRACT_TIMEOUT_MS,
          maxBuffer: MAX_STDOUT_BYTES,
        },
        (error, out, stderr) => {
          // The script prints a JSON error payload and exits non-zero on known
          // failures; prefer that payload over the exec error.
          if (error && !out) {
            reject(
              new Error(
                `Table extract failed: ${error.message}${stderr ? `\n  ${stderr.slice(-300)}` : ''}`
              )
            );
            return;
          }
          resolve(out);
        }
      );
    });

    let parsed: TableScriptOutput;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`Failed to parse table extract output: ${stdout.slice(0, 300)}`);
    }
    if (!parsed.success) {
      throw new Error(parsed.error || 'Table extract script reported failure');
    }

    devLog(
      `✅ Table extract: ${parsed.rows?.length ?? 0} rows (${parsed.mode}) in ${Date.now() - start}ms`
    );
    return {
      mode: parsed.mode ?? 'clustered',
      rows: parsed.rows ?? [],
      rowBoxes: parsed.rowBoxes ?? [],
      region: parsed.region ?? { x0: region.x, y0: region.y, x1: region.x + region.width, y1: region.y + region.height },
    };
  }
}

export const tableExtractor = new TableExtractor();
