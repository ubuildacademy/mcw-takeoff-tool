import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  assemblyLibraryService,
  type AssemblyProposal,
  type AssemblyImportPreview,
  type ProposalComponent,
  type ProposalQuantityInput,
} from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';

/**
 * Build an assembly from scratch — for a company with no workbook to import (task:
 * assembly builder, 2026-08-10). Produces the same `AssemblyProposal` shape a workbook
 * extraction does, then hands it to the same preview/review/save pipeline
 * `AssemblyImportTab` already has — this form's only job is to build that object.
 *
 * Rates (day rate, burden, margins, insurance, escalation/surcharge/tax) are
 * deliberately not exposed here: leaving them unset means the assembly inherits the
 * company's Cost Defaults, same as an imported assembly that didn't override anything.
 */

type Draft = {
  seq: number;
  name: string;
  unit: string;
  wastePctDisplay: string; // entered as a percent, e.g. "10" for 10%
};

type ComponentDraft = {
  seq: number;
  description: string;
  quantityInputSeq: number | null;
  pricingMode: 'code' | 'price';
  productCode: string;
  unitPrice: string;
  coverageYield: string;
  yieldUnit: string;
  packagingUnit: string;
  isOptional: boolean;
};

let nextSeq = 1;
const freshSeq = () => nextSeq++;

function buildProposal(
  name: string,
  brand: string,
  crewSize: string,
  inputs: Draft[],
  components: ComponentDraft[]
): AssemblyProposal {
  const quantityInputs: ProposalQuantityInput[] = inputs.map((i) => ({
    seq: i.seq,
    name: i.name.trim(),
    unit: i.unit.trim() || null,
    wastePct: (Number(i.wastePctDisplay) || 0) / 100,
  }));

  const proposalComponents: ProposalComponent[] = components.map((c) => ({
    seq: c.seq,
    quantityInputSeq: c.quantityInputSeq,
    description: c.description.trim() || null,
    productCode: c.pricingMode === 'code' ? c.productCode.trim() || null : null,
    unitPrice: c.pricingMode === 'price' ? (c.unitPrice.trim() ? Number(c.unitPrice) : null) : null,
    coverageYield: c.coverageYield.trim() ? Number(c.coverageYield) : null,
    yieldUnit: c.yieldUnit.trim() || null,
    packagingUnit: c.packagingUnit.trim() || null,
    isOptional: c.isOptional,
    flags: [],
  }));

  return {
    sourceFile: '(built in app)',
    name: name.trim(),
    brand: brand.trim() || null,
    quantityInputs,
    components: proposalComponents,
    productionRates: [],
    dayRatePerMan: null,
    crewSize: crewSize.trim() ? Number(crewSize) : null,
    laborBurdenPct: null,
    marginChain: [],
    insuranceRatePerThousand: null,
    insuranceMarginPct: null,
    escalationPct: null,
    surchargePct: null,
    taxPct: null,
    flags: [],
    componentFlagCount: 0,
    isClean: true,
  };
}

export function AssemblyBuilderForm({
  onReviewed,
  onCancel,
}: {
  onReviewed: (result: { proposal: AssemblyProposal; preview: AssemblyImportPreview }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [crewSize, setCrewSize] = useState('');
  const [inputs, setInputs] = useState<Draft[]>([]);
  const [components, setComponents] = useState<ComponentDraft[]>([]);
  const [reviewing, setReviewing] = useState(false);

  const addInput = () =>
    setInputs((prev) => [...prev, { seq: freshSeq(), name: '', unit: '', wastePctDisplay: '' }]);
  const removeInput = (seq: number) => {
    setInputs((prev) => prev.filter((i) => i.seq !== seq));
    // A component bound to the removed input goes back to "not bound" rather than
    // silently pointing at a seq that no longer exists.
    setComponents((prev) => prev.map((c) => (c.quantityInputSeq === seq ? { ...c, quantityInputSeq: null } : c)));
  };

  const addComponent = () =>
    setComponents((prev) => [
      ...prev,
      {
        seq: freshSeq(),
        description: '',
        quantityInputSeq: inputs[0]?.seq ?? null,
        pricingMode: 'code',
        productCode: '',
        unitPrice: '',
        coverageYield: '',
        yieldUnit: '',
        packagingUnit: '',
        isOptional: false,
      },
    ]);
  const removeComponent = (seq: number) => setComponents((prev) => prev.filter((c) => c.seq !== seq));

  const updateInput = (seq: number, patch: Partial<Draft>) =>
    setInputs((prev) => prev.map((i) => (i.seq === seq ? { ...i, ...patch } : i)));
  const updateComponent = (seq: number, patch: Partial<ComponentDraft>) =>
    setComponents((prev) => prev.map((c) => (c.seq === seq ? { ...c, ...patch } : c)));

  const handleReview = async () => {
    if (!name.trim()) {
      toast.error('The assembly needs a name');
      return;
    }
    setReviewing(true);
    try {
      const proposal = buildProposal(name, brand, crewSize, inputs, components);
      const result = await assemblyLibraryService.preview(proposal);
      onReviewed(result);
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to preview assembly'));
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-sm">Assembly name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-[22rem]" placeholder="e.g. Custom Deck Coating" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Brand</Label>
          <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Tremco" className="w-48" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Crew size</Label>
          <Input
            type="number"
            min="0"
            value={crewSize}
            onChange={(e) => setCrewSize(e.target.value)}
            className="w-28"
            placeholder="e.g. 2"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Day rate, burden, margins, insurance, escalation/surcharge/tax are not set here — this
        assembly inherits your company's Cost Defaults unless you override them later from the
        library.
      </p>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Quantity inputs ({inputs.length})</h4>
          <Button variant="outline" size="sm" onClick={addInput}>
            <Plus className="w-4 h-4 mr-1" /> Add input
          </Button>
        </div>
        {inputs.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            What the takeoff measures — e.g. "Area (SF)". Add at least one before adding components.
          </p>
        ) : (
          <div className="border border-border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Unit</th>
                  <th className="px-3 py-2 font-medium text-right">Waste %</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {inputs.map((input) => (
                  <tr key={input.seq} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <Input
                        value={input.name}
                        onChange={(e) => updateInput(input.seq, { name: e.target.value })}
                        placeholder="e.g. Area"
                        className="h-8"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        value={input.unit}
                        onChange={(e) => updateInput(input.seq, { unit: e.target.value })}
                        placeholder="SF"
                        className="h-8 w-24"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="number"
                        min="0"
                        value={input.wastePctDisplay}
                        onChange={(e) => updateInput(input.seq, { wastePctDisplay: e.target.value })}
                        placeholder="0"
                        className="h-8 w-20 text-right ml-auto"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Button variant="ghost" size="sm" onClick={() => removeInput(input.seq)} aria-label="Remove input">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Components ({components.length})</h4>
          <Button variant="outline" size="sm" onClick={addComponent}>
            <Plus className="w-4 h-4 mr-1" /> Add component
          </Button>
        </div>
        {components.length === 0 ? (
          <p className="text-xs text-muted-foreground">Materials this assembly buys — each priced by a product code or a fixed price.</p>
        ) : (
          <div className="space-y-3">
            {components.map((c) => (
              <div key={c.seq} className="border border-border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Input
                    value={c.description}
                    onChange={(e) => updateComponent(c.seq, { description: e.target.value })}
                    placeholder="Material description"
                    className="h-8"
                  />
                  <Button variant="ghost" size="sm" onClick={() => removeComponent(c.seq)} aria-label="Remove component">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <Label className="text-xs">Drives off</Label>
                    <select
                      value={c.quantityInputSeq ?? ''}
                      onChange={(e) => updateComponent(c.seq, { quantityInputSeq: e.target.value ? Number(e.target.value) : null })}
                      className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">Not bound</option>
                      {inputs.map((i) => (
                        <option key={i.seq} value={i.seq}>
                          {i.name || `Input ${i.seq}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Coverage yield</Label>
                    <Input
                      type="number"
                      value={c.coverageYield}
                      onChange={(e) => updateComponent(c.seq, { coverageYield: e.target.value })}
                      className="h-8"
                      placeholder="e.g. 100"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Yield unit</Label>
                    <Input
                      value={c.yieldUnit}
                      onChange={(e) => updateComponent(c.seq, { yieldUnit: e.target.value })}
                      className="h-8"
                      placeholder="SF/gal"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Packaging</Label>
                    <Input
                      value={c.packagingUnit}
                      onChange={(e) => updateComponent(c.seq, { packagingUnit: e.target.value })}
                      className="h-8"
                      placeholder="5 gal pail"
                    />
                  </div>
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex rounded-md border border-input overflow-hidden">
                    <button
                      type="button"
                      onClick={() => updateComponent(c.seq, { pricingMode: 'code' })}
                      className={`px-2 py-1 text-xs ${c.pricingMode === 'code' ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                    >
                      Product code
                    </button>
                    <button
                      type="button"
                      onClick={() => updateComponent(c.seq, { pricingMode: 'price' })}
                      className={`px-2 py-1 text-xs ${c.pricingMode === 'price' ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                    >
                      Fixed price
                    </button>
                  </div>
                  {c.pricingMode === 'code' ? (
                    <Input
                      value={c.productCode}
                      onChange={(e) => updateComponent(c.seq, { productCode: e.target.value })}
                      className="h-8 font-mono text-xs"
                      placeholder="Product code (from your price list)"
                    />
                  ) : (
                    <Input
                      type="number"
                      value={c.unitPrice}
                      onChange={(e) => updateComponent(c.seq, { unitPrice: e.target.value })}
                      className="h-8 w-32"
                      placeholder="$ per package"
                    />
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground pb-1.5">
                    <input
                      type="checkbox"
                      checked={c.isOptional}
                      onChange={(e) => updateComponent(c.seq, { isOptional: e.target.checked })}
                    />
                    Optional
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={() => void handleReview()} disabled={reviewing || !name.trim()}>
          {reviewing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {reviewing ? 'Checking…' : 'Review'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={reviewing}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
