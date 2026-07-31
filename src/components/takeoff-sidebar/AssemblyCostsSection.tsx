/**
 * Live assembly pricing on the Costs tab (task I6).
 *
 * Every condition linked to an assembly is priced from its current takeoff
 * quantity — materials by coverage yield and the company price list, labor by
 * production rate and crew, then the assembly's margin chain and insurance.
 * The numbers move as the takeoff does.
 *
 * WASTE: the quantity sent is the measured value times the condition's
 * multiplier, deliberately WITHOUT the condition's own waste factor. The
 * assembly already carries a waste percentage per quantity input, taken from
 * the source workbook, and applying both would compound two allowances into a
 * silent over-order. One source of waste, and it is the assembly's.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Package } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useConditionStore } from '../../store/slices/conditionSlice';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import {
  assemblyLibraryService,
  type AssemblyPriceRequestItem,
  type AssemblyPriceResponse,
  type ConditionPricing,
} from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';

const money = (value: number) =>
  value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

interface AssemblyCostsSectionProps {
  projectId: string;
}

export function AssemblyCostsSection({ projectId }: AssemblyCostsSectionProps) {
  const conditions = useConditionStore(useShallow((s) => s.getProjectConditions(projectId)));
  const takeoffMeasurements = useMeasurementStore(useShallow((s) => s.takeoffMeasurements));

  const [result, setResult] = useState<AssemblyPriceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // The request the server needs: one entry per linked condition, carrying that
  // condition's live quantity.
  const items = useMemo<AssemblyPriceRequestItem[]>(() => {
    return conditions
      .filter((condition) => condition.assemblyId && condition.assemblyQuantityInputId)
      .map((condition) => {
        const quantity = takeoffMeasurements
          .filter((m) => m.conditionId === condition.id)
          .reduce((sum, m) => sum + (m.netCalculatedValue ?? m.calculatedValue ?? 0), 0);
        return {
          conditionId: condition.id,
          assemblyId: condition.assemblyId as string,
          quantityInputId: condition.assemblyQuantityInputId as string,
          quantity: quantity * (condition.multiplier ?? 1),
        };
      });
  }, [conditions, takeoffMeasurements]);

  // Re-pricing on every vertex drag would be a request per mouse move. The
  // signature collapses "same conditions, same quantities" into one string so
  // the effect only fires when a number an estimator can see actually changed.
  const signature = useMemo(
    () =>
      items
        .map((item) => `${item.conditionId}:${item.quantityInputId}:${item.quantity.toFixed(4)}`)
        .join('|'),
    [items]
  );

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const runPricing = useCallback(async () => {
    const current = itemsRef.current;
    if (current.length === 0) {
      setResult(null);
      setError(null);
      return;
    }
    setPricing(true);
    try {
      setResult(await assemblyLibraryService.price(projectId, current));
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setPricing(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!signature) {
      setResult(null);
      return;
    }
    const timer = setTimeout(runPricing, 400);
    return () => clearTimeout(timer);
  }, [signature, runPricing]);

  if (items.length === 0) return null;

  const conditionName = (conditionId: string) =>
    conditions.find((c) => c.id === conditionId)?.name ?? 'Condition';

  const toggle = (conditionId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(conditionId)) next.delete(conditionId);
      else next.add(conditionId);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-foreground flex items-center gap-2">
          <Package className="w-4 h-4" />
          Assembly Pricing
        </h4>
        {pricing && <span className="text-xs text-muted-foreground">Pricing…</span>}
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Material</span>
              <span className="font-medium">{money(result.totals.materialTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Labor</span>
              <span className="font-medium">{money(result.totals.laborTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Margins</span>
              <span className="font-medium">{money(result.totals.marginsTotal)}</span>
            </div>
            {result.totals.insuranceTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Insurance</span>
                <span className="font-medium">{money(result.totals.insuranceTotal)}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-border">
              <span className="font-bold text-foreground">
                Assembly Total
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {result.totals.conditionCount} condition
                  {result.totals.conditionCount === 1 ? '' : 's'}
                </span>
              </span>
              <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                {money(result.totals.total)}
              </span>
            </div>
            {result.totals.conditionsWithWarnings > 0 && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200">
                {result.totals.conditionsWithWarnings} of {result.totals.conditionCount} priced
                conditions have something worth checking before this is quoted.
              </p>
            )}
          </div>

          {result.unknownAssemblyIds.length > 0 && (
            <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200">
              {result.unknownAssemblyIds.length} condition
              {result.unknownAssemblyIds.length === 1 ? ' is' : 's are'} linked to an assembly that
              is no longer in the library. Re-link them to price again.
            </div>
          )}

          {result.pricings.map((pricing) => (
            <PricedCondition
              key={pricing.conditionId}
              pricing={pricing}
              name={conditionName(pricing.conditionId)}
              open={expanded.has(pricing.conditionId)}
              onToggle={() => toggle(pricing.conditionId)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function PricedCondition({
  pricing,
  name,
  open,
  onToggle,
}: {
  pricing: ConditionPricing;
  name: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { breakdown } = pricing;
  return (
    <div className="border rounded-lg bg-card shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="w-4 h-4 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {pricing.assemblyName}
              {pricing.quantityInputName ? ` · ${pricing.quantityInputName}` : ''} ·{' '}
              {pricing.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0 ml-2">
          <div className="font-bold text-blue-600 dark:text-blue-400">{money(breakdown.total)}</div>
          {pricing.warnings.length > 0 && (
            <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 justify-end">
              <AlertTriangle className="w-3 h-3" />
              {pricing.warnings.length}
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
          {pricing.warnings.length > 0 && (
            <ul className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 space-y-1 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200">
              {pricing.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}

          <div className="space-y-1 text-sm">
            {breakdown.components
              .filter((component) => component.included || component.extendedCost > 0)
              .map((component) => (
                <div key={component.componentId} className="flex justify-between gap-2">
                  <span className="text-muted-foreground truncate">
                    {component.description || component.productCode || `Line ${component.seq}`}
                    {component.packages > 0 && (
                      <span className="ml-1 text-xs">×{component.packages}</span>
                    )}
                  </span>
                  <span className="font-medium shrink-0">{money(component.extendedCost)}</span>
                </div>
              ))}
          </div>

          <div className="space-y-1 text-sm border-t border-border pt-2">
            <Row label="Material" value={breakdown.materialTotal} />
            <Row
              label={`Labor (${breakdown.laborManDays} man-day${breakdown.laborManDays === 1 ? '' : 's'} · ${breakdown.jobDurationDays} on site)`}
              value={breakdown.laborTotal}
            />
            {breakdown.marginSteps.map((step) => (
              <Row
                key={step.name}
                label={`${step.name} (${(step.rate * 100).toFixed(0)}%)`}
                value={step.amount}
              />
            ))}
            {breakdown.insuranceTotal > 0 && (
              <Row label="Insurance" value={breakdown.insuranceTotal} />
            )}
            <div className="flex justify-between pt-1 border-t border-border font-semibold">
              <span>Total</span>
              <span>{money(breakdown.total)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="font-medium shrink-0">{money(value)}</span>
    </div>
  );
}
