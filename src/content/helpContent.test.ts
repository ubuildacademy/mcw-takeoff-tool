import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HELP_FAQ_CONFIG,
  getHelpFaq,
  getHelpTopic,
  getWorkspaceContextTip,
  HELP_POPULAR_FAQ_IDS,
  isHelpGuideSlug,
} from './helpContent';

describe('helpContent', () => {
  it('returns dashboard and workspace FAQ sets', () => {
    expect(getHelpFaq('dashboard').length).toBeGreaterThan(0);
    expect(getHelpFaq('workspace').length).toBeGreaterThan(getHelpFaq('dashboard').length);
  });

  it('validates guide slugs', () => {
    expect(isHelpGuideSlug('workspace')).toBe(true);
    expect(isHelpGuideSlug('shortcuts')).toBe(true);
    expect(isHelpGuideSlug('other')).toBe(false);
  });

  it('maps popular FAQ ids to workspace entries', () => {
    const ids = new Set(DEFAULT_HELP_FAQ_CONFIG.workspace.map((item) => item.id));
    for (const id of HELP_POPULAR_FAQ_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('exposes contextual topic copy for banners', () => {
    expect(getHelpTopic('auto-count').question).toMatch(/auto count/i);
  });

  it('prioritizes calibration tip over generic tips', () => {
    const tip = getWorkspaceContextTip({
      hasOpenPdf: true,
      isCalibrating: true,
      isMeasuring: false,
      hasSelectedCondition: true,
    });
    expect(tip).toMatch(/two points/i);
  });
});
