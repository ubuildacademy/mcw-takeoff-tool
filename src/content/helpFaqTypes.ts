import type { HelpSurface } from './helpContent';

export type HelpItem = {
  id: string;
  question: string;
  answer: string;
};

export type HelpFaqConfig = {
  version: 1;
  dashboard: HelpItem[];
  workspace: HelpItem[];
  updatedAt?: string;
  updatedBy?: string;
};

export function getFaqItemsForSurface(config: HelpFaqConfig, surface: HelpSurface): HelpItem[] {
  return surface === 'dashboard' ? config.dashboard : config.workspace;
}
