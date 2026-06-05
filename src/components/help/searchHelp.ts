import type { HelpItem } from '../../content/helpFaqTypes';
import type { HelpSearchEntry } from './buildHelpSearchIndex';
import { faqAnchorId } from './helpConstants';

export type HelpSearchHit = HelpSearchEntry & { score: number };

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

function scoreText(haystack: string, query: string, words: string[]): number {
  let score = 0;
  if (haystack.includes(query)) score += 80;
  for (const word of words) {
    if (word.length < 2) continue;
    if (haystack.includes(word)) score += 12;
  }
  return score;
}

export function faqToSearchEntries(
  items: HelpItem[],
  surface: 'dashboard' | 'workspace'
): HelpSearchEntry[] {
  return items.map((item) => ({
    id: `faq-${surface}-${item.id}`,
    title: item.question,
    snippet: item.answer,
    href: `/help#${faqAnchorId(surface, item.id)}`,
    type: 'faq' as const,
    surface,
  }));
}

export function searchHelp(
  query: string,
  entries: HelpSearchEntry[],
  options?: { surface?: 'dashboard' | 'workspace'; limit?: number }
): HelpSearchHit[] {
  const q = normalizeQuery(query);
  if (q.length < 2) return [];

  const words = q.split(/\s+/).filter(Boolean);
  const limit = options?.limit ?? 12;

  const hits: HelpSearchHit[] = [];

  for (const entry of entries) {
    if (options?.surface && entry.surface && entry.surface !== options.surface) {
      continue;
    }

    const title = entry.title.toLowerCase();
    const snippet = entry.snippet.toLowerCase();
    let score = scoreText(title, q, words) * 1.4 + scoreText(snippet, q, words);

    if (entry.type === 'guide') score *= 0.85;
    if (entry.type === 'faq') score *= 1.1;

    if (score > 0) {
      hits.push({ ...entry, score });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
