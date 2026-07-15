/**
 * Assembly Writer — thin wrapper around server/src/scripts/assembly_write.py.
 *
 * Stage 1 assembly bridge: surgically writes job-quantity + job-info cells
 * into a copy of an org's priced assembly workbook. Deterministic, stdlib
 * OOXML surgery — never openpyxl. See docs/ASSEMBLIES_DESIGN.md.
 */
import { execFile } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { devLog } from '../lib/devLog';

export type AssemblyCellValue = string | number;
export type AssemblyCellsBySheet = Record<string, Record<string, AssemblyCellValue>>;

interface WriterScriptOutput {
  success: boolean;
  cellsWritten?: number;
  error?: string;
}

export interface AssemblyScanProposal {
  quantityLabelCell: string;
  quantityCell: string;
  quantityLabel: string;
  jobInfoCells: Record<string, string> | null;
}

interface ScanScriptOutput {
  success: boolean;
  proposal?: AssemblyScanProposal | null;
  reason?: string;
  error?: string;
}

const ASSEMBLY_WRITE_TIMEOUT_MS = 30 * 1000;
const MAX_STDOUT_BYTES = 5 * 1024 * 1024;

class AssemblyWriter {
  private readonly pythonScriptPath: string;

  constructor() {
    const isCompiled = __dirname.includes('dist');
    const baseDir = isCompiled ? path.join(__dirname, '..', '..') : path.join(__dirname, '..');
    this.pythonScriptPath = isCompiled
      ? path.join(baseDir, 'src', 'scripts', 'assembly_write.py')
      : path.join(baseDir, 'scripts', 'assembly_write.py');
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

  /** Writes `cellsBySheet` into a copy of `srcPath`, saved at `destPath`. Returns cells-written count. */
  async write(srcPath: string, destPath: string, cellsBySheet: AssemblyCellsBySheet): Promise<number> {
    if (!(await fs.pathExists(srcPath))) {
      throw new Error(`Workbook not found: ${srcPath}`);
    }
    if (!(await fs.pathExists(this.pythonScriptPath))) {
      throw new Error(`Assembly write script not found: ${this.pythonScriptPath}`);
    }

    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const args = [this.pythonScriptPath, srcPath, destPath, JSON.stringify(cellsBySheet)];

    devLog(`📊 Running assembly write: ${Object.keys(cellsBySheet).length} sheet(s)`);
    const start = Date.now();

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        pythonCommand,
        args,
        {
          env: { ...process.env, PATH: this.getEnhancedPath(), PYTHONUNBUFFERED: '1' },
          timeout: ASSEMBLY_WRITE_TIMEOUT_MS,
          maxBuffer: MAX_STDOUT_BYTES,
        },
        (error, out, stderr) => {
          // The script prints a JSON error payload and exits non-zero on known
          // failures; prefer that payload over the exec error.
          if (error && !out) {
            reject(
              new Error(
                `Assembly write failed: ${error.message}${stderr ? `\n  ${stderr.slice(-300)}` : ''}`
              )
            );
            return;
          }
          resolve(out);
        }
      );
    });

    let parsed: WriterScriptOutput;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`Failed to parse assembly write output: ${stdout.slice(0, 300)}`);
    }
    if (!parsed.success) {
      throw new Error(parsed.error || 'Assembly write script reported failure');
    }

    devLog(`✅ Assembly write: ${parsed.cellsWritten ?? 0} cells in ${Date.now() - start}ms`);
    return parsed.cellsWritten ?? 0;
  }

  /** Scans `srcPath`'s ASSEMBLY sheet for a Job Quantity label and proposes a mapping. */
  async scan(srcPath: string): Promise<AssemblyScanProposal | null> {
    if (!(await fs.pathExists(srcPath))) {
      throw new Error(`Workbook not found: ${srcPath}`);
    }
    if (!(await fs.pathExists(this.pythonScriptPath))) {
      throw new Error(`Assembly write script not found: ${this.pythonScriptPath}`);
    }

    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const args = [this.pythonScriptPath, '--scan', srcPath];

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        pythonCommand,
        args,
        {
          env: { ...process.env, PATH: this.getEnhancedPath(), PYTHONUNBUFFERED: '1' },
          timeout: ASSEMBLY_WRITE_TIMEOUT_MS,
          maxBuffer: MAX_STDOUT_BYTES,
        },
        (error, out, stderr) => {
          if (error && !out) {
            reject(
              new Error(`Assembly scan failed: ${error.message}${stderr ? `\n  ${stderr.slice(-300)}` : ''}`)
            );
            return;
          }
          resolve(out);
        }
      );
    });

    let parsed: ScanScriptOutput;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`Failed to parse assembly scan output: ${stdout.slice(0, 300)}`);
    }
    if (!parsed.success) {
      throw new Error(parsed.error || 'Assembly scan script reported failure');
    }
    return parsed.proposal ?? null;
  }
}

export const assemblyWriter = new AssemblyWriter();
