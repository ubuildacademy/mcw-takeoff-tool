import { describe, expect, it, vi } from 'vitest';
import { isAutoHyperlinkUiEnabled } from './batchHyperlinkFeature';

describe('isAutoHyperlinkUiEnabled', () => {
  it('is true when VITE_BATCH_HYPERLINK is not false', () => {
    vi.stubEnv('VITE_BATCH_HYPERLINK', '');
    expect(isAutoHyperlinkUiEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('is false when VITE_BATCH_HYPERLINK is false', () => {
    vi.stubEnv('VITE_BATCH_HYPERLINK', 'false');
    expect(isAutoHyperlinkUiEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });
});
