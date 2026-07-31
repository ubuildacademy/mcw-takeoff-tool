/**
 * Assembly Extractor — thin wrapper around server/src/scripts/assembly_extract.py.
 *
 * Stage 2 bootstrap importer (task I3): parses an uploaded assembly workbook's
 * ASSEMBLY sheet into a native assembly PROPOSAL. Same execFile plumbing, PATH
 * handling and JSON contract as `productsImportService.ts`.
 *
 * The output is a proposal, never a saved assembly. Anything the sheet left
 * ambiguous arrives as a flag rather than a guess, and the import review screen
 * (task I5) is what turns a reviewed proposal into rows. See
 * docs/ASSEMBLIES_DESIGN.md for the measurements behind the detector rules.
 */
import { execFile } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { devLog } from '../lib/devLog';

/** One named quantity input of the assembly (SF-Floor, Joint LF, ...). */
export interface ExtractedQuantityInput {
  seq: number;
  name: string;
  unit: string | null;
  /** Waste is per input, not per assembly. */
  wastePct: number;
  quantityCell: string;
  totalCell: string;
  column: string;
  /** Which quantity block of the sheet this came from (some have two). */
  block: number;
  /** True when the workbook computes this input from another one. */
  derived: boolean;
}

export interface ExtractedComponent {
  seq: number;
  sourceRow: number;
  /** The `seq` of the quantity input this component divides; null if unresolved. */
  quantityInputSeq: number | null;
  /** The raw numerator expression, for review when it is not a plain cell. */
  quantityBasis: string;
  description: string | null;
  /** Mutually exclusive with `unitPrice`. */
  productCode: string | null;
  unitPrice: number | null;
  coverageYield: number | null;
  yieldUnit: string | null;
  /** Informational; not used in the cost math. */
  packagingUnit: string | null;
  isOptional: boolean;
  flags: string[];
}

export interface ExtractedProductionRate {
  description: string | null;
  ratePerDay: number;
  unit: string | null;
  sourceRow: number;
}

/**
 * The assembly name to propose for an uploaded workbook: its filename without
 * the extension. Uploads reach the parser as a temp file named
 * `${uuid}-${originalname}`, so the name it derives from the path it was handed
 * carries that uuid — this is applied over the top from the original filename.
 */
export function assemblyNameFromFilename(filename: string): string {
  return filename
    .trim()
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '')
    .trim();
}

/**
 * Pull a brand label out of a source-folder name.
 *
 * "Tremco" stays "Tremco". "Laticrete - Need to request pricing by Project"
 * becomes "Laticrete", with the qualifier returned separately so the importer
 * can flag it rather than bake a sentence into every assembly's brand.
 */
export function brandFromFolderName(folderName: string): {
  brand: string;
  qualifier: string | null;
} {
  const trimmed = folderName.trim();
  const split = trimmed.match(/^(.+?)\s+-\s+(.+)$/);
  if (!split) return { brand: trimmed, qualifier: null };
  return { brand: split[1].trim(), qualifier: split[2].trim() };
}

export interface AssemblyProposal {
  sourceFile: string;
  name: string;
  /** Manufacturer / product line. Set by bulk import from the folder tree. */
  brand?: string | null;
  quantityInputs: ExtractedQuantityInput[];
  components: ExtractedComponent[];
  dayRatePerMan: number | null;
  crewSize: number | null;
  laborBurdenPct: number | null;
  productionRates: ExtractedProductionRate[];
  /** Ordered divide-through chain; rates normalised to fractions. */
  marginChain: { name: string; rate: number }[];
  /** Captured separately — its base is workbook-specific and it is not part of the chain. */
  insuranceMarginPct: number | null;
  escalationPct: number | null;
  surchargePct: number | null;
  taxPct: number | null;
  /** Assembly-level problems. Component-level ones live on each component. */
  flags: string[];
  componentFlagCount: number;
  /** True only when nothing anywhere needed flagging. */
  isClean: boolean;
}

interface ExtractScriptOutput {
  success: boolean;
  proposal?: AssemblyProposal;
  error?: string;
}

const EXTRACT_TIMEOUT_MS = 30 * 1000;
const MAX_STDOUT_BYTES = 5 * 1024 * 1024;

class AssemblyExtractor {
  private readonly pythonScriptPath: string;

  constructor() {
    const isCompiled = __dirname.includes('dist');
    const baseDir = isCompiled ? path.join(__dirname, '..', '..') : path.join(__dirname, '..');
    this.pythonScriptPath = isCompiled
      ? path.join(baseDir, 'src', 'scripts', 'assembly_extract.py')
      : path.join(baseDir, 'scripts', 'assembly_extract.py');
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
   * Parses `srcPath`'s ASSEMBLY sheet into a native assembly proposal.
   *
   * `originalName` is the filename the user uploaded. The script names the
   * assembly after the file it was handed, which for an upload is a temp file
   * prefixed with a uuid — so the name has to come from the caller, or every
   * imported assembly is called "0f249b88-…-Aquafin 2K".
   */
  async extract(srcPath: string, originalName?: string): Promise<AssemblyProposal> {
    if (!(await fs.pathExists(srcPath))) {
      throw new Error(`Workbook not found: ${srcPath}`);
    }
    if (!(await fs.pathExists(this.pythonScriptPath))) {
      throw new Error(`Assembly extract script not found: ${this.pythonScriptPath}`);
    }

    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const start = Date.now();

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        pythonCommand,
        [this.pythonScriptPath, srcPath],
        {
          env: { ...process.env, PATH: this.getEnhancedPath(), PYTHONUNBUFFERED: '1' },
          timeout: EXTRACT_TIMEOUT_MS,
          maxBuffer: MAX_STDOUT_BYTES,
        },
        (error, out, stderr) => {
          // The script reports known failures as a JSON payload and exits
          // non-zero; prefer that payload over the exec error.
          if (error && !out) {
            reject(
              new Error(
                `Assembly extract failed: ${error.message}${stderr ? `\n  ${stderr.slice(-300)}` : ''}`
              )
            );
            return;
          }
          resolve(out);
        }
      );
    });

    let parsed: ExtractScriptOutput;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error(`Failed to parse assembly extract output: ${stdout.slice(0, 300)}`);
    }
    if (!parsed.success || !parsed.proposal) {
      throw new Error(parsed.error || 'Assembly extract script reported failure');
    }

    const proposal = parsed.proposal;
    if (originalName) {
      proposal.sourceFile = originalName;
      proposal.name = assemblyNameFromFilename(originalName) || proposal.name;
    }
    devLog(
      `📥 Assembly extract: ${proposal.components.length} component(s), ` +
        `${proposal.quantityInputs.length} input(s), ` +
        `${proposal.flags.length + proposal.componentFlagCount} flag(s) in ${Date.now() - start}ms`
    );
    return proposal;
  }
}

export const assemblyExtractor = new AssemblyExtractor();
