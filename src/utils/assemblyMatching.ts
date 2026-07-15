export interface MatchableCondition {
  id: string;
  name: string;
}

/**
 * Matches conditions against a mapping's conditionRef: exact case-insensitive
 * match, or a trailing-`*` prefix wildcard (e.g. "Aquafin*" matches any
 * condition name starting with "aquafin", case-insensitive).
 */
export function matchConditionsToMapping<T extends MatchableCondition>(
  conditions: T[],
  conditionRef: string
): T[] {
  const ref = conditionRef.trim().toLowerCase();
  if (!ref) return [];

  if (ref.endsWith('*')) {
    const prefix = ref.slice(0, -1);
    return conditions.filter((c) => c.name.trim().toLowerCase().startsWith(prefix));
  }

  return conditions.filter((c) => c.name.trim().toLowerCase() === ref);
}
