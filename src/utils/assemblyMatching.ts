export interface MatchableCondition {
  id: string;
  name: string;
}

/**
 * A mapping's `condition_ref` holds one entry per line. The multi-select in the
 * mapping form writes the chosen conditions' names, one per line; rows written
 * before that (single exact names and `Aquafin*` wildcards, typed by hand) parse
 * as a one-entry list and keep matching exactly as they did.
 *
 * A newline can't occur inside a condition name — every name comes from a
 * single-line input — so it is the one separator that can never split a name.
 */
const CONDITION_REF_SEPARATOR = '\n';

export function parseConditionRefs(conditionRef: string): string[] {
  return conditionRef
    .split(CONDITION_REF_SEPARATOR)
    .map((ref) => ref.trim())
    .filter(Boolean);
}

export function formatConditionRefs(refs: string[]): string {
  return refs.map((ref) => ref.trim()).filter(Boolean).join(CONDITION_REF_SEPARATOR);
}

function matchSingleRef<T extends MatchableCondition>(conditions: T[], ref: string): T[] {
  if (ref.endsWith('*')) {
    const prefix = ref.slice(0, -1);
    return conditions.filter((c) => c.name.trim().toLowerCase().startsWith(prefix));
  }
  return conditions.filter((c) => c.name.trim().toLowerCase() === ref);
}

/**
 * Matches conditions against a mapping's conditionRef. Each entry is an exact
 * case-insensitive name match or a trailing-`*` prefix wildcard (e.g. "Aquafin*"
 * matches any condition name starting with "aquafin"). A condition matched by
 * more than one entry is returned once, in the order the conditions were given.
 */
export function matchConditionsToMapping<T extends MatchableCondition>(
  conditions: T[],
  conditionRef: string
): T[] {
  const refs = parseConditionRefs(conditionRef.toLowerCase());
  if (refs.length === 0) return [];

  const matchedIds = new Set<string>();
  for (const ref of refs) {
    for (const condition of matchSingleRef(conditions, ref)) {
      matchedIds.add(condition.id);
    }
  }
  return conditions.filter((c) => matchedIds.has(c.id));
}

/**
 * Derives a starter condition-pattern from an uploaded workbook's filename, used
 * to pre-select matching conditions in the C5 auto-map confirm dialog. Strips the
 * extension, drops a trailing short revision token (e.g. "M"), and appends a
 * prefix wildcard — "Aquafin-2K M.xlsx" -> "Aquafin-2K*".
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
