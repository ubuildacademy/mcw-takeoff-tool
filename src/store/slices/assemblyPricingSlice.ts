/**
 * Live assembly pricing, held once per project.
 *
 * The engine's answer used to live in the Costs tab's own state, which is why
 * the project cost summary, the reports tab and the exports all disagreed with
 * it: they had no way to see it. It lives here instead, so a total that came
 * from the server can be read synchronously by code that cannot await —
 * `getProjectCostBreakdown` most of all.
 *
 * The cache is deliberately last-known-good. A stale total is what a summary
 * shows for the few hundred milliseconds after a measurement changes, and is
 * far better than the alternatives (a flash of zero, or every consumer firing
 * its own request).
 */
import { create } from 'zustand';
import {
  assemblyLibraryService,
  type AssemblyPriceRequestItem,
  type AssemblyPriceResponse,
} from '../../services/apiService';
import { extractErrorMessage } from '../../utils/commonUtils';

export interface AssemblyPricingEntry {
  /** The request this result answers; see assemblyPricingSignature. */
  signature: string;
  result: AssemblyPriceResponse | null;
  pricing: boolean;
  error: string | null;
}

const EMPTY_ENTRY: AssemblyPricingEntry = {
  signature: '',
  result: null,
  pricing: false,
  error: null,
};

interface AssemblyPricingState {
  byProject: Record<string, AssemblyPricingEntry>;

  /**
   * Price a project's assembly-linked conditions, unless the same request is
   * already in flight or already answered. Callers debounce; this de-dupes.
   */
  priceProject: (
    projectId: string,
    items: AssemblyPriceRequestItem[],
    signature: string
  ) => Promise<void>;
  clearProject: (projectId: string) => void;

  /**
   * Drop cached pricings for conditions that are no longer assembly-linked
   * (deleted, or unlinked from their assembly) and resum totals from what's
   * left. Pure subtraction, not a repricing — safe to do synchronously,
   * ahead of the debounced re-fetch that gets fresh numbers from the server.
   * Without this, the Costs tab kept showing a deleted condition's row (and
   * counting it in the total) until the next successful price came back —
   * see OPEN_ITEMS.md item 19.
   */
  pruneRemovedConditions: (projectId: string, liveConditionIds: ReadonlySet<string>) => void;

  getEntry: (projectId: string) => AssemblyPricingEntry;
  /** Last known assembly total for the project, or 0 if it has never priced. */
  getAssemblyTotal: (projectId: string) => number;
  /** Per-condition totals, so consumers that hide conditions can subtract them. */
  getConditionTotals: (projectId: string) => Record<string, number>;
}

export const useAssemblyPricingStore = create<AssemblyPricingState>()((set, get) => ({
  byProject: {},

  priceProject: async (projectId, items, signature) => {
    const existing = get().byProject[projectId];
    if (existing?.signature === signature && (existing.pricing || existing.result)) {
      return;
    }

    if (items.length === 0) {
      set((state) => ({
        byProject: { ...state.byProject, [projectId]: { ...EMPTY_ENTRY, signature } },
      }));
      return;
    }

    // Marked in flight before the await so a second caller in the same tick
    // sees it and does not fire the request again.
    set((state) => ({
      byProject: {
        ...state.byProject,
        [projectId]: {
          signature,
          result: existing?.result ?? null,
          pricing: true,
          error: null,
        },
      },
    }));

    try {
      const result = await assemblyLibraryService.price(projectId, items);
      set((state) => {
        // A newer request started while this one was out; its answer wins.
        if (state.byProject[projectId]?.signature !== signature) return state;
        return {
          byProject: {
            ...state.byProject,
            [projectId]: { signature, result, pricing: false, error: null },
          },
        };
      });
    } catch (err) {
      const message = extractErrorMessage(err);
      set((state) => {
        if (state.byProject[projectId]?.signature !== signature) return state;
        return {
          byProject: {
            ...state.byProject,
            [projectId]: {
              signature,
              // Keep the last good numbers on screen rather than blanking the
              // summary because one refresh failed.
              result: state.byProject[projectId]?.result ?? null,
              pricing: false,
              error: message,
            },
          },
        };
      });
    }
  },

  clearProject: (projectId) =>
    set((state) => {
      const { [projectId]: _removed, ...rest } = state.byProject;
      return { byProject: rest };
    }),

  pruneRemovedConditions: (projectId, liveConditionIds) =>
    set((state) => {
      const entry = state.byProject[projectId];
      if (!entry?.result) return state;

      const keptPricings = entry.result.pricings.filter((p) => liveConditionIds.has(p.conditionId));
      if (keptPricings.length === entry.result.pricings.length) return state;

      // Mirrors sumConditionPricing (server/src/services/conditionAssemblyPricing.ts) —
      // plain addition, no rounding or business logic to drift out of sync with.
      const totals = {
        total: 0,
        materialTotal: 0,
        laborTotal: 0,
        marginsTotal: 0,
        insuranceTotal: 0,
        conditionCount: keptPricings.length,
        conditionsWithWarnings: 0,
      };
      for (const pricing of keptPricings) {
        totals.total += pricing.breakdown.total;
        totals.materialTotal += pricing.breakdown.materialTotal;
        totals.laborTotal += pricing.breakdown.laborTotal;
        totals.marginsTotal += pricing.breakdown.marginsTotal;
        totals.insuranceTotal += pricing.breakdown.insuranceTotal;
        if (pricing.warnings.length > 0) totals.conditionsWithWarnings += 1;
      }

      return {
        byProject: {
          ...state.byProject,
          [projectId]: {
            ...entry,
            result: { ...entry.result, pricings: keptPricings, totals },
          },
        },
      };
    }),

  getEntry: (projectId) => get().byProject[projectId] ?? EMPTY_ENTRY,

  getAssemblyTotal: (projectId) => get().byProject[projectId]?.result?.totals.total ?? 0,

  getConditionTotals: (projectId) => {
    const pricings = get().byProject[projectId]?.result?.pricings ?? [];
    const totals: Record<string, number> = {};
    for (const pricing of pricings) {
      totals[pricing.conditionId] = pricing.breakdown.total;
    }
    return totals;
  },
}));
