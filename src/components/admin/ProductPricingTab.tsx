import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Loader2, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  productService,
  type Product,
  type ProductImportResult,
  type ProductListSummary,
} from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';

/**
 * Product Pricing tab — the company's price list, imported from the MCW
 * Pricing Manager's "Export DB" file.
 *
 * Deliberately read-only apart from the import: the Pricing Manager is the
 * system of record for prices, so the way to change one is to change it there
 * and re-import. Editing here would create a second source of truth.
 */

function formatDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatPrice(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function ImportSummary({ result }: { result: ProductImportResult }) {
  const { stats } = result;
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1">
      <div className="font-medium">
        {result.inserted} new · {result.updated} updated · {result.unchanged} unchanged
      </div>
      <div className="text-muted-foreground">
        Read {stats.productRows} product rows from {stats.sourceFile}.
        {stats.skippedAfterSeparator > 0 && (
          <> Skipped {stats.skippedAfterSeparator} category-header rows below the price list.</>
        )}
        {stats.skippedNoCode > 0 && <> Skipped {stats.skippedNoCode} rows with no product code.</>}
        {stats.duplicateCodesInFile > 0 && (
          <> {stats.duplicateCodesInFile} duplicate code(s) in the file; the last one won.</>
        )}
        {stats.missingPrice > 0 && <> {stats.missingPrice} product(s) have no price.</>}
      </div>
      {stats.unmappedColumns.length > 0 && (
        <div className="text-amber-600 dark:text-amber-500">
          Columns not recognised and ignored: {stats.unmappedColumns.join(', ')}
        </div>
      )}
    </div>
  );
}

export function ProductPricingTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [summary, setSummary] = useState<ProductListSummary | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastImport, setLastImport] = useState<ProductImportResult | null>(null);
  const [filter, setFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await productService.list();
      setProducts(data.products);
      setSummary(data.summary);
      setOrganizationName(data.organization?.name ?? null);
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to load product pricing'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFile = async (file: File) => {
    setImporting(true);
    setLastImport(null);
    try {
      const result = await productService.importPriceList(file);
      setLastImport(result);
      setSummary(result.summary);
      toast.success(
        `Imported: ${result.inserted} new, ${result.updated} updated, ${result.unchanged} unchanged`
      );
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to import price list'));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? products.filter(
        (product) =>
          product.code.toLowerCase().includes(needle) ||
          (product.description ?? '').toLowerCase().includes(needle) ||
          (product.item ?? '').toLowerCase().includes(needle)
      )
    : products;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Product Pricing</h3>
        <p className="text-sm text-muted-foreground">
          The price list assemblies are costed against{organizationName ? ` for ${organizationName}` : ''}.
          Import the “Export DB” file from the MCW Pricing Manager — that stays the system of record,
          so prices are changed there and re-imported here.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm,.csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <Button onClick={() => fileInputRef.current?.click()} disabled={importing}>
          {importing ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Upload className="w-4 h-4 mr-2" />
          )}
          {importing ? 'Importing…' : 'Import price list'}
        </Button>
        <Button variant="outline" onClick={() => void load()} disabled={loading || importing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        {summary && (
          <div className="text-sm text-muted-foreground">
            {summary.count.toLocaleString()} products · prices as of {formatDate(summary.latestPriceDate)} ·
            last imported {formatDate(summary.lastImportedAt)}
          </div>
        )}
      </div>

      {lastImport && <ImportSummary result={lastImport} />}

      <Input
        placeholder="Filter by code, item or description…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        className="max-w-sm"
      />

      <div className="border border-border rounded-md overflow-auto max-h-[45vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium text-right">Net price</th>
              <th className="px-3 py-2 font-medium">Price date</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-muted-foreground" colSpan={5}>
                  {loading
                    ? 'Loading…'
                    : products.length === 0
                      ? 'No products yet — import a price list to get started.'
                      : 'No products match that filter.'}
                </td>
              </tr>
            )}
            {visible.map((product) => (
              <tr key={product.id} className="border-t border-border">
                <td className="px-3 py-1.5 font-mono text-xs">{product.code}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{product.item ?? '—'}</td>
                <td className="px-3 py-1.5">{product.description ?? '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatPrice(product.netPrice)}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{formatDate(product.priceDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length > 0 && visible.length !== products.length && (
        <div className="text-xs text-muted-foreground">
          Showing {visible.length.toLocaleString()} of {products.length.toLocaleString()} products.
        </div>
      )}
    </div>
  );
}
