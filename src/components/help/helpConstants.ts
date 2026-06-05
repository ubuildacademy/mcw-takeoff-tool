/** Tailwind classes for sticky help chrome and in-page anchor offset. */
export const HELP_STICKY_TOP_CLASS = 'scroll-mt-[7.5rem]';
export const HELP_SIDEBAR_STICKY_CLASS = 'lg:sticky lg:top-[7.5rem]';

export const HELP_SEARCH_SUGGESTIONS = [
  'calibrate scale',
  'upload PDF',
  'Space shortcut',
  'titleblock',
  'OCR search',
] as const;

export function faqAnchorId(surface: 'dashboard' | 'workspace', itemId: string): string {
  return `faq-${surface}-${itemId}`;
}
