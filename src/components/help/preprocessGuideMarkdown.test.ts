import { describe, expect, it } from 'vitest';
import { preprocessGuideMarkdown } from './preprocessGuideMarkdown';

describe('preprocessGuideMarkdown', () => {
  it('rewrites relative guide links to in-app routes', () => {
    const raw = 'See [shortcuts](./QUICKSTART_AND_HOTKEYS.md) and [workspace](./WORKSPACE_GUIDE.md).';
    expect(preprocessGuideMarkdown(raw)).toBe(
      'See [shortcuts](/help/shortcuts) and [workspace](/help/workspace).'
    );
  });
});
