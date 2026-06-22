import { describe, expect, it } from 'vitest';
import { searchHelp } from './searchHelp';
import type { HelpSearchEntry } from './buildHelpSearchIndex';

const sample: HelpSearchEntry[] = [
  {
    id: '1',
    title: 'How do I calibrate scale?',
    snippet: 'Use Calibrate Scale in the top command bar',
    href: '/help',
    type: 'faq',
    surface: 'workspace',
  },
  {
    id: '2',
    title: 'Workspace — Documents tab',
    snippet: 'Upload PDFs in the right sidebar',
    href: '/help/workspace#documents',
    type: 'guide-section',
  },
];

describe('searchHelp', () => {
  it('returns matches for multi-word queries', () => {
    const hits = searchHelp('calibrate scale', sample);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title.toLowerCase()).toContain('calibrate');
  });

  it('returns empty for very short queries', () => {
    expect(searchHelp('a', sample)).toHaveLength(0);
  });
});
