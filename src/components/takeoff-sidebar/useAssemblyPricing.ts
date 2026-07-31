/**
 * Keeps the shared assembly pricing cache in step with the takeoff.
 *
 * Called once, high in the sidebar, rather than by each thing that wants a
 * total — the Costs tab, the Reports tab and the exports all read the cache
 * this fills. That is also why it does not live inside AssemblyCostsSection
 * any more: a summary must not go blank because the tab that owned the fetch
 * was never opened.
 */
import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useConditionStore } from '../../store/slices/conditionSlice';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import { useAssemblyPricingStore } from '../../store/slices/assemblyPricingSlice';
import {
  assemblyPricingSignature,
  buildAssemblyPriceItems,
} from '../../utils/assemblyPricingItems';

/** Long enough to sit out a drag, short enough that the number feels live. */
const PRICING_DEBOUNCE_MS = 400;

export function useAssemblyPricing(projectId: string) {
  const conditions = useConditionStore(useShallow((s) => s.getProjectConditions(projectId)));
  const takeoffMeasurements = useMeasurementStore(useShallow((s) => s.takeoffMeasurements));
  const priceProject = useAssemblyPricingStore((s) => s.priceProject);
  const entry = useAssemblyPricingStore((s) => s.byProject[projectId]);

  const items = useMemo(
    () => buildAssemblyPriceItems(conditions, takeoffMeasurements),
    [conditions, takeoffMeasurements]
  );
  const signature = useMemo(() => assemblyPricingSignature(items), [items]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void priceProject(projectId, items, signature);
    }, PRICING_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [projectId, items, signature, priceProject]);

  return {
    items,
    result: entry?.result ?? null,
    pricing: entry?.pricing ?? false,
    error: entry?.error ?? null,
  };
}
