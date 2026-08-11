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
import { supabaseService } from '../../services/supabaseService';
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
  const pruneRemovedConditions = useAssemblyPricingStore((s) => s.pruneRemovedConditions);
  const entry = useAssemblyPricingStore((s) => s.byProject[projectId]);
  const getProjectCostBreakdown = useMeasurementStore((s) => s.getProjectCostBreakdown);

  const items = useMemo(
    () => buildAssemblyPriceItems(conditions, takeoffMeasurements),
    [conditions, takeoffMeasurements]
  );
  const signature = useMemo(() => assemblyPricingSignature(items), [items]);
  const liveConditionIds = useMemo(
    () => new Set(items.map((item) => item.conditionId)),
    [items]
  );

  // Deleting (or unlinking) an assembly condition must drop its row from the
  // Costs tab immediately, not after the next successful re-price — see
  // OPEN_ITEMS.md item 19. Runs synchronously, ahead of the debounced fetch
  // below, which then brings fresh numbers for whatever is left.
  useEffect(() => {
    pruneRemovedConditions(projectId, liveConditionIds);
  }, [projectId, liveConditionIds, pruneRemovedConditions]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void priceProject(projectId, items, signature);
    }, PRICING_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [projectId, items, signature, priceProject]);

  // Cache the settled total (flat + assembly) so the projects list can show
  // it without repricing every listed project — see OPEN_ITEMS.md item 15.
  // Only projects with assembly-linked conditions produce a result here; pure
  // flat-cost projects are already priced correctly by the list itself.
  useEffect(() => {
    if (!entry?.result || entry.pricing || entry.error) return;
    const total = getProjectCostBreakdown(projectId).summary.projectTotal;
    void supabaseService.updateProjectTotalCache(projectId, total);
  }, [projectId, entry?.result, entry?.pricing, entry?.error, getProjectCostBreakdown]);

  return {
    items,
    result: entry?.result ?? null,
    pricing: entry?.pricing ?? false,
    error: entry?.error ?? null,
  };
}
