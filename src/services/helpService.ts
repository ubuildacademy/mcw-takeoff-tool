import { getApiBaseUrl } from '../lib/apiConfig';
import { apiClient } from './apiService';
import type { HelpFaqConfig } from '../content/helpFaqTypes';

export type HelpFaqResponse = {
  customized: boolean;
  faq: HelpFaqConfig | null;
};

let cachedFaqResponse: HelpFaqResponse | null = null;
let fetchPromise: Promise<HelpFaqResponse> | null = null;

export function clearHelpFaqCache(): void {
  cachedFaqResponse = null;
  fetchPromise = null;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('meridian-help-faq-updated'));
  }
}

export async function fetchHelpFaq(): Promise<HelpFaqResponse> {
  if (cachedFaqResponse) return cachedFaqResponse;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const base = getApiBaseUrl().replace(/\/$/, '');
      const url = base.startsWith('http') ? `${base}/help/faq` : `${window.location.origin}${base}/help/faq`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as HelpFaqResponse;
      cachedFaqResponse = data;
      return data;
    } catch {
      const fallback: HelpFaqResponse = { customized: false, faq: null };
      cachedFaqResponse = fallback;
      return fallback;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

export const helpService = {
  fetchHelpFaq,

  async saveHelpFaq(config: HelpFaqConfig): Promise<HelpFaqConfig> {
    const response = await apiClient.put('/help/faq', config);
    clearHelpFaqCache();
    return response.data.faq as HelpFaqConfig;
  },

  async resetHelpFaq(): Promise<void> {
    await apiClient.delete('/help/faq');
    clearHelpFaqCache();
  },
};
