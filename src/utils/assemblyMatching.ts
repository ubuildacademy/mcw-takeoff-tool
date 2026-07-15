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

/**
 * Derives a starter condition-pattern from an uploaded workbook's filename, for
 * pre-filling the C5 auto-map confirm dialog. Strips the extension, drops a
 * trailing short revision token (e.g. "M"), and appends a prefix wildcard —
 * "Aquafin-2K M.xlsx" -> "Aquafin-2K*".
 */
export function deriveConditionPattern(filename: string): string {
  const withoutExt = filename.replace(/\.[A-Za-z0-9]+$/, '').trim();
  const tokens = withoutExt.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && /^[A-Za-z0-9]{1,2}$/.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  const base = tokens.join(' ').trim();
  return base ? `${base}*` : '*';
}
