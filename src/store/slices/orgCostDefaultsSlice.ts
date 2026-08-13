/**
 * The org's bond % default, held so `getProjectCostBreakdown`
 * (measurementSlice.ts) can read it synchronously — same reason
 * assemblyPricingSlice.ts caches the engine's assembly totals instead of
 * awaiting them inline. Fetched once per session; a project's own
 * `bondPctOverride` always wins when it's set, so a stale cache here only
 * ever affects projects that inherit the company default.
 */
import { create } from 'zustand';
import { costDefaultsService } from '../../services/apiService';

interface OrgCostDefaultsState {
  bondPct: number | null;
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
}

export const useOrgCostDefaultsStore = create<OrgCostDefaultsState>()((set, get) => ({
  bondPct: null,
  loaded: false,
  loading: false,

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      const { defaults } = await costDefaultsService.get();
      set({ bondPct: defaults.bondPct, loaded: true, loading: false });
    } catch {
      // No org, no permission, or the request failed — bond simply falls
      // back to "no default", same as a company that never set one.
      set({ loaded: true, loading: false });
    }
  },
}));
