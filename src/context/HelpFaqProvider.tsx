import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_HELP_FAQ_CONFIG,
  type HelpSurface,
} from '../content/helpContent';
import type { HelpFaqConfig, HelpItem } from '../content/helpFaqTypes';
import { getFaqItemsForSurface } from '../content/helpFaqTypes';
import { fetchHelpFaq } from '../services/helpService';

type HelpFaqContextValue = {
  config: HelpFaqConfig;
  customized: boolean;
  loading: boolean;
  reload: () => Promise<void>;
  getFaq: (surface: HelpSurface) => HelpItem[];
};

const HelpFaqContext = createContext<HelpFaqContextValue | null>(null);

function resolveConfig(remote: HelpFaqConfig | null, customized: boolean): HelpFaqConfig {
  if (customized && remote) return remote;
  return DEFAULT_HELP_FAQ_CONFIG;
}

function useHelpFaqState(): HelpFaqContextValue {
  const [config, setConfig] = useState<HelpFaqConfig>(DEFAULT_HELP_FAQ_CONFIG);
  const [customized, setCustomized] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { customized: isCustom, faq } = await fetchHelpFaq();
      setCustomized(isCustom);
      setConfig(resolveConfig(faq, isCustom));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onUpdate = () => {
      void reload();
    };
    window.addEventListener('meridian-help-faq-updated', onUpdate);
    return () => window.removeEventListener('meridian-help-faq-updated', onUpdate);
  }, [reload]);

  const getFaq = useCallback(
    (surface: HelpSurface): HelpItem[] => getFaqItemsForSurface(config, surface),
    [config]
  );

  return useMemo(
    () => ({ config, customized, loading, reload, getFaq }),
    [config, customized, loading, reload, getFaq]
  );
}

export function HelpFaqProvider({ children }: { children: ReactNode }) {
  const value = useHelpFaqState();
  return <HelpFaqContext.Provider value={value}>{children}</HelpFaqContext.Provider>;
}

export function useHelpFaq(): HelpFaqContextValue {
  const ctx = useContext(HelpFaqContext);
  if (!ctx) {
    throw new Error('useHelpFaq must be used within HelpFaqProvider');
  }
  return ctx;
}
