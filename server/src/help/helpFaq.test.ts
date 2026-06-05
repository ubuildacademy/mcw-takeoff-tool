import { describe, expect, it } from 'vitest';
import { buildHelpFaqPayload, parseHelpFaqConfig } from './helpFaq';

describe('helpFaq', () => {
  it('parses valid FAQ payload', () => {
    const config = parseHelpFaqConfig({
      version: 1,
      dashboard: [{ id: 'a', question: 'Q?', answer: 'A.' }],
      workspace: [],
    });
    expect(config?.dashboard).toHaveLength(1);
  });

  it('rejects empty FAQ payload', () => {
    expect(parseHelpFaqConfig({ version: 1, dashboard: [], workspace: [] })).toBeNull();
  });

  it('adds updated metadata on build', () => {
    const built = buildHelpFaqPayload(
      {
        version: 1,
        dashboard: [{ question: 'Hi', answer: 'There' }],
        workspace: [],
      },
      'admin@test.com'
    );
    expect(built?.updatedAt).toBeTruthy();
    expect(built?.updatedBy).toBe('admin@test.com');
  });
});
