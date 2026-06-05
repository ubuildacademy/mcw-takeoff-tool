/**
 * Rewrites repo-relative markdown links so in-app guides use React Router paths.
 */
export function preprocessGuideMarkdown(raw: string): string {
  return raw
    .replace(/\]\(\.\/QUICKSTART_AND_HOTKEYS\.md\)/gi, '](/help/shortcuts)')
    .replace(/\]\(\.\/WORKSPACE_GUIDE\.md\)/gi, '](/help/workspace)')
    .replace(/\]\(QUICKSTART_AND_HOTKEYS\.md\)/gi, '](/help/shortcuts)')
    .replace(/\]\(WORKSPACE_GUIDE\.md\)/gi, '](/help/workspace)');
}
