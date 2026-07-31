import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  costDefaultsService,
  type CostDefaultOverrides,
  type CostDefaults,
} from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';

/**
 * Company cost defaults — the rates that repeat across every assembly.
 *
 * Measured across MCW's 232 workbooks: labor burden, tax and insurance margin
 * are identical in all of them; the day rate, insurance rate, margin chain and
 * escalation hold in 86–99%. Keeping them here means raising a rate is one edit
 * rather than 232, and an assembly stores a value only where it truly differs.
 *
 * Crew size and production rates are deliberately absent: they vary per
 * assembly and per line item, and are edited with the assembly itself.
 */

/** Rates are stored as fractions but read and typed as percentages. */
function toPercentInput(value: number | null): string {
  if (value === null || value === undefined) return '';
  return String(Number((value * 100).toFixed(4)));
}

function fromPercentInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed / 100 : null;
}

function toMoneyInput(value: number | null): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function fromMoneyInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

interface FieldProps {
  label: string;
  hint?: string;
  suffix?: string;
  value: string;
  overrideCount?: number;
  onChange: (next: string) => void;
}

function Field({ label, hint, suffix, value, overrideCount, onChange }: FieldProps) {
  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="max-w-[10rem]"
          inputMode="decimal"
        />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {overrideCount ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          {overrideCount} assembl{overrideCount === 1 ? 'y sets' : 'ies set'} their own value and
          will not change.
        </p>
      ) : null}
    </div>
  );
}

export function CostDefaultsTab() {
  const [defaults, setDefaults] = useState<CostDefaults | null>(null);
  const [overrides, setOverrides] = useState<CostDefaultOverrides>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [dayRate, setDayRate] = useState('');
  const [burden, setBurden] = useState('');
  const [escalation, setEscalation] = useState('');
  const [surcharge, setSurcharge] = useState('');
  const [tax, setTax] = useState('');
  const [insuranceRate, setInsuranceRate] = useState('');
  const [insuranceMargin, setInsuranceMargin] = useState('');
  const [payrollTax, setPayrollTax] = useState('');
  const [workersComp, setWorkersComp] = useState('');
  const [generalLiability, setGeneralLiability] = useState('');
  const [generalLiabilityRestoration, setGeneralLiabilityRestoration] = useState('');
  const [margins, setMargins] = useState<{ name: string; rate: string }[]>([]);

  const hydrate = useCallback((next: CostDefaults) => {
    setDefaults(next);
    setDayRate(toMoneyInput(next.dayRatePerMan));
    setBurden(toPercentInput(next.laborBurdenPct));
    setEscalation(toPercentInput(next.escalationPct));
    setSurcharge(toPercentInput(next.surchargePct));
    setTax(toPercentInput(next.taxPct));
    setInsuranceRate(toMoneyInput(next.insuranceRatePerThousand));
    setInsuranceMargin(toPercentInput(next.insuranceMarginPct));
    setPayrollTax(toPercentInput(next.payrollTaxPct));
    setWorkersComp(toPercentInput(next.workersCompPct));
    setGeneralLiability(toPercentInput(next.generalLiabilityPct));
    setGeneralLiabilityRestoration(toPercentInput(next.generalLiabilityRestorationPct));
    setMargins(next.marginChain.map((m) => ({ name: m.name, rate: toPercentInput(m.rate) })));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await costDefaultsService.get();
      hydrate(data.defaults);
      setOverrides(data.overrides);
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to load cost defaults'));
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const chain = margins
      .map((m) => ({ name: m.name.trim(), rate: fromPercentInput(m.rate) }))
      .filter((m) => m.name !== '' && m.rate !== null) as { name: string; rate: number }[];

    if (chain.some((m) => m.rate >= 1 || m.rate < 0)) {
      toast.error('Margin rates must be between 0% and 100%');
      return;
    }

    setSaving(true);
    try {
      const data = await costDefaultsService.update({
        dayRatePerMan: fromMoneyInput(dayRate),
        laborBurdenPct: fromPercentInput(burden),
        escalationPct: fromPercentInput(escalation),
        surchargePct: fromPercentInput(surcharge),
        taxPct: fromPercentInput(tax),
        insuranceRatePerThousand: fromMoneyInput(insuranceRate),
        insuranceMarginPct: fromPercentInput(insuranceMargin),
        payrollTaxPct: fromPercentInput(payrollTax),
        workersCompPct: fromPercentInput(workersComp),
        generalLiabilityPct: fromPercentInput(generalLiability),
        generalLiabilityRestorationPct: fromPercentInput(generalLiabilityRestoration),
        marginChain: chain,
      });
      hydrate(data.defaults);
      setOverrides(data.overrides);
      toast.success('Cost defaults saved');
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to save cost defaults'));
    } finally {
      setSaving(false);
    }
  };

  const updateMargin = (index: number, patch: Partial<{ name: string; rate: string }>) => {
    setMargins((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Cost Defaults</h3>
        <p className="text-sm text-muted-foreground">
          The rates every assembly shares. Change one here and every assembly that hasn’t set its
          own value reprices. Crew size and production rates aren’t here — those vary per assembly
          and are edited with the assembly.
        </p>
        {defaults?.updatedAt && (
          <p className="text-xs text-muted-foreground mt-1">
            Last changed {new Date(defaults.updatedAt).toLocaleString()}
          </p>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2 max-w-3xl">
        <Field
          label="Day rate per man"
          suffix="$ / day"
          hint="Standard labor rate before burden."
          value={dayRate}
          overrideCount={overrides.dayRatePerMan}
          onChange={setDayRate}
        />
        <Field
          label="Labor burden"
          suffix="%"
          hint="Added on top of the crew’s day cost."
          value={burden}
          overrideCount={overrides.laborBurdenPct}
          onChange={setBurden}
        />
        <Field
          label="Price escalation"
          suffix="%"
          hint="Applied to the material subtotal."
          value={escalation}
          overrideCount={overrides.escalationPct}
          onChange={setEscalation}
        />
        <Field
          label="Surcharge"
          suffix="%"
          value={surcharge}
          overrideCount={overrides.surchargePct}
          onChange={setSurcharge}
        />
        <Field
          label="Tax"
          suffix="%"
          hint="Charged on the escalated material subtotal."
          value={tax}
          overrideCount={overrides.taxPct}
          onChange={setTax}
        />
        <div />
        <Field
          label="Insurance"
          suffix="$ per $1,000 of cost"
          hint="Charged outside the margin chain."
          value={insuranceRate}
          overrideCount={overrides.insuranceRatePerThousand}
          onChange={setInsuranceRate}
        />
        <Field
          label="Insurance margin"
          suffix="%"
          hint="Applied to the insurance charge only."
          value={insuranceMargin}
          overrideCount={overrides.insuranceMarginPct}
          onChange={setInsuranceMargin}
        />
      </div>

      <div className="space-y-3 max-w-3xl">
        <div>
          <Label className="text-sm">Accounting rates</Label>
          <p className="text-xs text-muted-foreground">
            These don’t change what a job is priced at. They split an already-priced total into the
            buckets the assembly budget report posts against, with overhead and profit taking
            whatever is left.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Payroll tax"
            suffix="%"
            hint="Charged on regular pay."
            value={payrollTax}
            onChange={setPayrollTax}
          />
          <Field
            label="Workers’ comp"
            suffix="%"
            hint="Charged on regular pay."
            value={workersComp}
            onChange={setWorkersComp}
          />
          <Field
            label="General liability"
            suffix="%"
            hint="Charged on the job total, not on pay. Waterproofing work."
            value={generalLiability}
            onChange={setGeneralLiability}
          />
          <Field
            label="General liability — restoration"
            suffix="%"
            hint="Used when a report is pulled on the restoration basis."
            value={generalLiabilityRestoration}
            onChange={setGeneralLiabilityRestoration}
          />
        </div>
      </div>

      <div className="space-y-2 max-w-3xl">
        <Label className="text-sm">Margins</Label>
        <p className="text-xs text-muted-foreground">
          Applied in order, each dividing through the running total (cost ÷ (1 − rate)) — the same
          way the workbooks do it, not a straight mark-up. Order matters for the amount each margin
          reports.
        </p>
        {overrides.marginChain ? (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            {overrides.marginChain} assembl{overrides.marginChain === 1 ? 'y has' : 'ies have'} their
            own margin chain and will not change.
          </p>
        ) : null}
        <div className="space-y-2">
          {margins.map((margin, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={margin.name}
                onChange={(event) => updateMargin(index, { name: event.target.value })}
                className="max-w-[14rem]"
                placeholder="Margin name"
              />
              <Input
                value={margin.rate}
                onChange={(event) => updateMargin(index, { rate: event.target.value })}
                className="max-w-[7rem]"
                inputMode="decimal"
              />
              <span className="text-sm text-muted-foreground">%</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMargins((prev) => prev.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMargins((prev) => [...prev, { name: '', rate: '' }])}
        >
          Add margin
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={saving || loading}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          {saving ? 'Saving…' : 'Save defaults'}
        </Button>
        <Button variant="outline" onClick={() => void load()} disabled={saving || loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Reset
        </Button>
      </div>
    </div>
  );
}
