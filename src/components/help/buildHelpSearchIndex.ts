import { preprocessGuideMarkdown } from './preprocessGuideMarkdown';
import { slugifyHeading } from './slugify';
import type { HelpGuideSlug } from '../../content/helpContent';
import { HELP_GUIDE_TITLES } from '../../content/helpContent';

export type HelpSearchResultType = 'faq' | 'guide-section' | 'guide';

export type HelpSearchEntry = {
  id: string;
  title: string;
  snippet: string;
  href: string;
  type: HelpSearchResultType;
  surface?: 'dashboard' | 'workspace';
};

const guideLoaders: Record<HelpGuideSlug, () => Promise<{ default: string }>> = {
  workspace: () => import('../../../docs/WORKSPACE_GUIDE.md?raw'),
  shortcuts: () => import('../../../docs/QUICKSTART_AND_HOTKEYS.md?raw'),
};

function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function extractSections(markdown: string, slug: HelpGuideSlug): HelpSearchEntry[] {
  const processed = preprocessGuideMarkdown(markdown);
  const lines = processed.split('\n');
  const entries: HelpSearchEntry[] = [];
  const guideTitle = HELP_GUIDE_TITLES[slug];

  entries.push({
    id: `guide-${slug}`,
    title: guideTitle,
    snippet: stripMarkdownInline(lines.find((l) => l.trim() && !l.startsWith('#')) ?? ''),
    href: `/help/${slug}`,
    type: 'guide',
  });

  let currentTitle: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!currentTitle) return;
    const body = buffer.join(' ').trim();
    const plain = stripMarkdownInline(body).slice(0, 280);
    entries.push({
      id: `guide-${slug}-${slugifyHeading(currentTitle)}`,
      title: `${guideTitle} — ${stripMarkdownInline(currentTitle)}`,
      snippet: plain,
      href: `/help/${slug}#${slugifyHeading(currentTitle)}`,
      type: 'guide-section',
    });
    buffer = [];
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flush();
      currentTitle = h2[1].trim();
      continue;
    }
    if (currentTitle && line.trim() && !line.startsWith('```')) {
      buffer.push(line.trim());
    }
  }
  flush();

  return entries;
}

let indexPromise: Promise<HelpSearchEntry[]> | null = null;

export function loadHelpSearchIndex(): Promise<HelpSearchEntry[]> {
  if (!indexPromise) {
    indexPromise = (async () => {
      const slugs: HelpGuideSlug[] = ['workspace', 'shortcuts'];
      const sections = await Promise.all(
        slugs.map(async (slug) => {
          const mod = await guideLoaders[slug]();
          return extractSections(mod.default, slug);
        })
      );
      return sections.flat();
    })();
  }
  return indexPromise;
}

export function clearHelpSearchIndexCache(): void {
  indexPromise = null;
}
