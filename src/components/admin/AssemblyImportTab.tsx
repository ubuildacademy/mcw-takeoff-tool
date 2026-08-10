import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { AlertTriangle, CheckCircle2, Hammer, Loader2, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  assemblyLibraryService,
  type AssemblyImportPreview,
  type AssemblyListItem,
  type AssemblyProposal,
} from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';
import { filterAssemblies, groupAssembliesByBrand } from '../../utils/assemblyListFilter';
import { AssemblyBuilderForm } from './AssemblyBuilderForm';

/**
 * Assemblies tab — import a priced workbook into the native library.
 *
 * Two steps on purpose: a workbook is parsed into a PROPOSAL that writes
 * nothing, the reviewer fixes what the importer could not resolve, and only
 * then is it saved. Saving straight from a parse would bake in every gap.
 *
 * The importer flags rather than guesses, so this screen's job is to make those
 * flags impossible to miss — an assembly that prices confidently and wrongly is
 * the failure this whole workstream exists to avoid.
 */

function formatNumber(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}${suffix}`;
}

function Flags({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {flags.map((flag, index) => (
        <li key={index} className="text-xs text-amber-600 dark:text-amber-500 flex gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{flag}</span>
        </li>
      ))}
    </ul>
  );
}

function ProposalReview({
  proposal,
  preview,
  onNameChange,
  onBrandChange,
}: {
  proposal: AssemblyProposal;
  preview: AssemblyImportPreview;
  onNameChange: (name: string) => void;
  onBrandChange: (brand: string) => void;
}) {
  const inputName = (seq: number | null) =>
    proposal.quantityInputs.find((i) => i.seq === seq)?.name ?? '—';

  const ruleBySeq = new Map(preview.components.map((c) => [c.seq, c.quantityRule]));
  const overridden = Object.keys(preview.assembly.overrides ?? {});

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-sm">Assembly name</Label>
          <Input
            value={proposal.name}
            onChange={(event) => onNameChange(event.target.value)}
            className="w-[22rem]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Brand</Label>
          <Input
            value={proposal.brand ?? ''}
            onChange={(event) => onBrandChange(event.target.value)}
            placeholder="e.g. Tremco"
            className="w-48"
          />
        </div>
        <div className="text-sm text-muted-foreground pb-2">from {proposal.sourceFile}</div>
      </div>

      {preview.blockers.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
          <div className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {preview.blockers.length} thing{preview.blockers.length === 1 ? '' : 's'} to fix before
            this can be priced
          </div>
          <ul className="text-xs space-y-0.5 list-disc pl-5">
            {preview.blockers.map((blocker, index) => (
              <li key={index}>{blocker}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground pt-1">
            You can still import it — it will be saved and flagged, not silently priced.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Everything resolved — this assembly can price as soon as it is imported.
        </div>
      )}

      <Flags flags={proposal.flags} />

      <div>
        <h4 className="text-sm font-semibold mb-2">
          Quantity inputs ({proposal.quantityInputs.length})
        </h4>
        <div className="border border-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium text-right">Waste</th>
              </tr>
            </thead>
            <tbody>
              {proposal.quantityInputs.map((input) => (
                <tr key={input.seq} className="border-t border-border">
                  <td className="px-3 py-1.5 text-muted-foreground">{input.seq}</td>
                  <td className="px-3 py-1.5">
                    {input.name}
                    {input.derived && (
                      <span className="ml-2 text-xs text-muted-foreground">(computed)</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatNumber(input.wastePct * 100, '%')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-2">Components ({proposal.components.length})</h4>
        <div className="border border-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Code / price</th>
                <th className="px-3 py-2 font-medium">Drives off</th>
                <th className="px-3 py-2 font-medium text-right">Yield</th>
              </tr>
            </thead>
            <tbody>
              {proposal.components.map((component) => {
                const rule = ruleBySeq.get(component.seq);
                return (
                  <tr key={component.seq} className="border-t border-border align-top">
                    <td className="px-3 py-1.5 text-muted-foreground">{component.seq}</td>
                    <td className="px-3 py-1.5">
                      {component.description ?? <span className="text-muted-foreground">—</span>}
                      {component.isOptional && (
                        <span className="ml-2 text-xs text-muted-foreground">(optional)</span>
                      )}
                      <Flags flags={component.flags} />
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {component.productCode ??
                        (component.unitPrice !== null
                          ? `$${component.unitPrice} fixed`
                          : '—')}
                    </td>
                    <td className="px-3 py-1.5">
                      {inputName(component.quantityInputSeq)}
                      {component.additionalQuantityInputSeqs?.length
                        ? ` + ${component.additionalQuantityInputSeqs.map(inputName).join(' + ')}`
                        : ''}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {rule === 'manual' ? (
                        <span className="text-amber-600 dark:text-amber-500">needs a rule</span>
                      ) : (
                        formatNumber(component.coverageYield)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold mb-2">
            Production rates ({proposal.productionRates.filter((r) => r.ratePerDay > 0).length})
          </h4>
          <div className="border border-border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {proposal.productionRates
                  .filter((rate) => rate.ratePerDay > 0)
                  .map((rate, index) => (
                    <tr key={index} className="border-t border-border first:border-t-0">
                      <td className="px-3 py-1.5">{rate.description ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatNumber(rate.ratePerDay)} {rate.unit ?? ''}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground text-xs">
                        {inputName(rate.quantityInputSeq)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold mb-2">Rates</h4>
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Crew size</span>
              <span>{formatNumber(proposal.crewSize)}</span>
            </div>
            {overridden.length > 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-500 pt-1">
                Differs from your company defaults and will be stored on this assembly:{' '}
                {overridden.join(', ')}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground pt-1">
                Every rate matches your company defaults, so this assembly inherits them — change
                them in Cost Defaults and this assembly follows.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AssemblyImportTab() {
  const [assemblies, setAssemblies] = useState<AssemblyListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [proposal, setProposal] = useState<AssemblyProposal | null>(null);
  const [preview, setPreview] = useState<AssemblyImportPreview | null>(null);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const libraryGroups = useMemo(
    () => groupAssembliesByBrand(filterAssemblies(assemblies, libraryQuery)),
    [assemblies, libraryQuery]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAssemblies(await assemblyLibraryService.list());
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to load assemblies'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFile = async (file: File) => {
    setExtracting(true);
    setProposal(null);
    setPreview(null);
    try {
      const result = await assemblyLibraryService.extract(file);
      setProposal(result.proposal);
      setPreview(result.preview);
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to read workbook'));
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const save = async () => {
    if (!proposal) return;
    setSaving(true);
    try {
      const summary = await assemblyLibraryService.import(proposal);
      toast.success(
        `Imported “${summary.name}” — ${summary.componentCount} component(s)` +
          (summary.blockers.length ? `, ${summary.blockers.length} flagged` : '')
      );
      setProposal(null);
      setPreview(null);
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to import assembly'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (assembly: AssemblyListItem) => {
    if (!window.confirm(`Delete the assembly “${assembly.name}”?`)) return;
    try {
      await assemblyLibraryService.remove(assembly.id);
      toast.success('Assembly deleted');
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to delete assembly'));
    }
  };

  const beginEdit = (assembly: AssemblyListItem) => {
    setEditingId(assembly.id);
    setEditName(assembly.name);
    setEditBrand(assembly.brand ?? '');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) {
      toast.error('The assembly needs a name');
      return;
    }
    try {
      await assemblyLibraryService.rename(editingId, {
        name,
        brand: editBrand.trim() || null,
      });
      toast.success('Assembly updated');
      setEditingId(null);
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to update assembly'));
    }
  };

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Assemblies</h3>
        <p className="text-sm text-muted-foreground">
          Import a priced workbook into the native library. The workbook is read first and shown
          for review — nothing is saved until you confirm, and anything the reader couldn’t work
          out is flagged rather than guessed.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <Button onClick={() => fileInputRef.current?.click()} disabled={extracting || saving}>
          {extracting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Upload className="w-4 h-4 mr-2" />
          )}
          {extracting ? 'Reading…' : 'Read a workbook'}
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowBuilder(true)}
          disabled={extracting || saving || showBuilder || !!proposal}
        >
          <Hammer className="w-4 h-4 mr-2" />
          Build from scratch
        </Button>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <span className="text-sm text-muted-foreground">
          {assemblies.length} assembl{assemblies.length === 1 ? 'y' : 'ies'} in the library
        </span>
      </div>

      {showBuilder && !proposal && (
        <div className="rounded-md border border-border p-4">
          <AssemblyBuilderForm
            onReviewed={(result) => {
              setProposal(result.proposal);
              setPreview(result.preview);
              setShowBuilder(false);
            }}
            onCancel={() => setShowBuilder(false)}
          />
        </div>
      )}

      {proposal && preview && (
        <div className="rounded-md border border-border p-4 space-y-5">
          <ProposalReview
            proposal={proposal}
            preview={preview}
            onNameChange={(name) => setProposal({ ...proposal, name })}
            onBrandChange={(brand) => setProposal({ ...proposal, brand })}
          />
          <div className="flex items-center gap-3 border-t border-border pt-4">
            <Button onClick={() => void save()} disabled={saving || !proposal.name.trim()}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {saving ? 'Importing…' : 'Import assembly'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setProposal(null);
                setPreview(null);
              }}
              disabled={saving}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h4 className="text-sm font-semibold">Library</h4>
          <Input
            value={libraryQuery}
            onChange={(event) => setLibraryQuery(event.target.value)}
            placeholder="Search by name or brand…"
            className="h-8 w-64"
          />
        </div>
        <div className="border border-border rounded-md overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left sticky top-0">
              <tr>
                <th className="px-3 py-2 font-medium">Brand</th>
                <th className="px-3 py-2 font-medium">Assembly</th>
                <th className="px-3 py-2 font-medium text-right">Crew</th>
                <th className="px-3 py-2 font-medium">Imported</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {assemblies.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-muted-foreground" colSpan={5}>
                    {loading ? 'Loading…' : 'No assemblies yet — read a workbook to get started.'}
                  </td>
                </tr>
              )}
              {assemblies.length > 0 && libraryGroups.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-muted-foreground" colSpan={5}>
                    No assembly matches “{libraryQuery.trim()}”.
                  </td>
                </tr>
              )}
              {libraryGroups.map((group) => (
                <Fragment key={`brand-${group.label}`}>
                  <tr className="border-t border-border bg-muted/40">
                    <td className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" colSpan={5}>
                      {group.label}
                      <span className="ml-2 font-normal normal-case tracking-normal">
                        ({group.assemblies.length})
                      </span>
                    </td>
                  </tr>
                  {group.assemblies.map((assembly) => (
                    <tr key={assembly.id} className="border-t border-border">
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {editingId === assembly.id ? (
                          <Input
                            value={editBrand}
                            onChange={(event) => setEditBrand(event.target.value)}
                            className="h-8 w-36"
                            placeholder="Brand"
                          />
                        ) : (
                          assembly.brand ?? '—'
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {editingId === assembly.id ? (
                          <Input
                            value={editName}
                            onChange={(event) => setEditName(event.target.value)}
                            className="h-8"
                          />
                        ) : (
                          assembly.name
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatNumber(assembly.crewSize)}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {assembly.createdAt ? new Date(assembly.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex justify-end gap-1">
                          {editingId === assembly.id ? (
                            <>
                              <Button size="sm" onClick={() => void saveEdit()}>
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingId(null)}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => beginEdit(assembly)}
                                aria-label="Rename assembly"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => void remove(assembly)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
