import { HELP_STICKY_TOP_CLASS } from './helpConstants';

/** Scroll to a hash target below the sticky help header. */
export function scrollToHelpHash(hash: string, behavior: ScrollBehavior = 'smooth'): void {
  const id = hash.replace(/^#/, '').trim();
  if (!id) return;

  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior, block: 'start' });
  });
}

/** Class applied to FAQ anchor targets on the help index. */
export const HELP_FAQ_ANCHOR_CLASS = HELP_STICKY_TOP_CLASS;
