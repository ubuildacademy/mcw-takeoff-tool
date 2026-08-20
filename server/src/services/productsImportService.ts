/**
 * Product price-list import (Stage 2, task I2).
 *
 * Parses a price list with server/src/scripts/products_import.py (execFile
 * wrapper in the `assemblyExtractor.ts` pattern), diffs
 * it against what the org already has, and applies the result as an upsert.
 *
 * The MCW Pricing Manager stays the system of record for pricing — this is a
 * read cache the costing engine resolves component codes against. Its
 * supplier-diff workflow is deliberately NOT ported (recorded non-goal).
 */
import { execFile } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { supabase } from '../supabase';
import { wrapDatabaseError } from '../errors';
import { devLog } from '../lib/devLog';
import { ExistingProduct, ImportedProduct, diffProducts } from './productsImport';

interface ParsedPriceListStats {
  sourceFile: string;
  headerRow: number;
  /** field name -> spreadsheet column the alias matcher chose. */
  mappedColumns: Record<string, string>;
  /** Headers that matched no alias. Surfaced, never silently dropped. */
  unmappedColumns: string[];
  productRows: number;
  duplicateCodesInFile: number;
  skippedNoCode: number;
  /** Rows after the blank separator — the export's category-header rows. */
  skippedAfterSeparator: number;
  missingPrice: number;
}

interface ParsedPriceList {
  rows: ImportedProduct[];
  stats: ParsedPriceListStats;
}

export interface ProductImportResult {
  inserted: number;
  updated: number;
  unchanged: number;
  stats: ParsedPriceListStats;
}

interface ParseScriptOutput {
  success: boolean;
  rows?: ImportedProduct[];
  stats?: ParsedPriceListStats;
  error?: string;
}

const PARSE_TIMEOUT_MS = 60 * 1000;
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
/** PostgREST rejects unbounded payloads; the real export is ~1,150 rows. */
const UPSERT_CHUNK_SIZE = 500;

function scriptPath(): string {
  const isCompiled = __dirname.includes('dist');
  const baseDir = isCompiled ? path.join(__dirname, '..', '..') : path.join(__dirname, '..');
  return isCompiled
    ? path.join(baseDir, 'src', 'scripts', 'products_import.py')
    : path.join(baseDir, 'scripts', 'products_import.py');
}

function enhancedPath(): string {
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

/** Parses a price list file into rows + parse statistics. Does not touch the database. */
export async function parsePriceList(filePath: string): Promise<ParsedPriceList> {
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`Price list not found: ${filePath}`);
  }
  const pythonScriptPath = scriptPath();
  if (!(await fs.pathExists(pythonScriptPath))) {
    throw new Error(`Products import script not found: ${pythonScriptPath}`);
  }

  const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      pythonCommand,
      [pythonScriptPath, filePath],
      {
        env: { ...process.env, PATH: enhancedPath(), PYTHONUNBUFFERED: '1' },
        timeout: PARSE_TIMEOUT_MS,
        maxBuffer: MAX_STDOUT_BYTES,
      },
      (error, out, stderr) => {
        // Known failures come back as a JSON payload with a non-zero exit;
        // prefer that message over the exec error.
        if (error && !out) {
          reject(
            new Error(
              `Price list parse failed: ${error.message}${stderr ? `\n  ${stderr.slice(-300)}` : ''}`
            )
          );
          return;
        }
        resolve(out);
      }
    );
  });

  let parsed: ParseScriptOutput;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Failed to parse price list output: ${stdout.slice(0, 300)}`);
  }
  if (!parsed.success || !parsed.rows || !parsed.stats) {
    throw new Error(parsed.error || 'Price list parse reported failure');
  }
  return { rows: parsed.rows, stats: parsed.stats };
}

async function fetchExistingProducts(orgId: string): Promise<ExistingProduct[]> {
  const { data, error } = await supabase
    .from('products')
    .select('code, item, description, net_price, price_date')
    .eq('org_id', orgId);
  if (error) throw wrapDatabaseError('List products for import', error, { orgId });
  return (data || []).map((row) => ({
    code: row.code,
    item: row.item,
    description: row.description,
    // NUMERIC arrives as a string from PostgREST; comparing it to a parsed
    // price as-is would report every row as changed on every import.
    netPrice: row.net_price === null ? null : Number(row.net_price),
    priceDate: row.price_date,
  }));
}

async function upsertChunk(orgId: string, rows: ImportedProduct[]): Promise<void> {
  const { error } = await supabase.from('products').upsert(
    rows.map((row) => ({
      org_id: orgId,
      code: row.code,
      item: row.item,
      description: row.description,
      net_price: row.netPrice,
      price_date: row.priceDate,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'org_id,code' }
  );
  if (error) throw wrapDatabaseError('Upsert products', error, { orgId, count: rows.length });
}

/**
 * Import a price list into an org's product list.
 *
 * Only rows that actually differ are written, so re-importing the same export
 * is a genuine no-op rather than a silent full rewrite that churns
 * `updated_at` and makes "last imported" meaningless.
 */
export async function importPriceList(
  orgId: string,
  filePath: string
): Promise<ProductImportResult> {
  const { rows, stats } = await parsePriceList(filePath);
  const existing = await fetchExistingProducts(orgId);
  const { toInsert, toUpdate, unchangedCount } = diffProducts(existing, rows);

  const writes = [...toInsert, ...toUpdate];
  for (let index = 0; index < writes.length; index += UPSERT_CHUNK_SIZE) {
    await upsertChunk(orgId, writes.slice(index, index + UPSERT_CHUNK_SIZE));
  }

  devLog(
    `📦 Products import: ${toInsert.length} new, ${toUpdate.length} updated, ` +
      `${unchangedCount} unchanged (from ${stats.sourceFile})`
  );

  return {
    inserted: toInsert.length,
    updated: toUpdate.length,
    unchanged: unchangedCount,
    stats,
  };
}

export interface ProductListSummary {
  count: number;
  /** Most recent write to any product row — what the admin panel shows. */
  lastImportedAt: string | null;
  /** Newest price date in the list, which is the Pricing Manager's own "as of". */
  latestPriceDate: string | null;
}

export async function getProductListSummary(orgId: string): Promise<ProductListSummary> {
  const { count, error: countError } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);
  if (countError) throw wrapDatabaseError('Count products', countError, { orgId });

  const [{ data: newest, error: newestError }, { data: newestPrice, error: priceError }] =
    await Promise.all([
      supabase
        .from('products')
        .select('updated_at')
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('products')
        .select('price_date')
        .eq('org_id', orgId)
        .not('price_date', 'is', null)
        .order('price_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  if (newestError) throw wrapDatabaseError('Get last product import', newestError, { orgId });
  if (priceError) throw wrapDatabaseError('Get latest price date', priceError, { orgId });

  return {
    count: count ?? 0,
    lastImportedAt: newest?.updated_at ?? null,
    latestPriceDate: newestPrice?.price_date ?? null,
  };
}
