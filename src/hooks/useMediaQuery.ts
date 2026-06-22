import { useEffect, useState } from 'react';

/**
 * Returns true while the document matches the given CSS media query string.
 * Subscribes via MediaQueryList and re-renders on changes (e.g. rotation, resize).
 *
 * Usage:
 *   const isTablet = useMediaQuery('(max-width: 1023px)');
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
