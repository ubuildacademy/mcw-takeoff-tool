/**
 * Opening an assembly as a condition template (task I8): turn a library
 * assembly into ready-to-draw conditions that price the moment they are
 * measured, with no manual wiring in the condition dialog.
 *
 * One condition per named quantity input, because that is what the assembly
 * actually needs measured — an assembly with SF-Floor, SF-Wall and LF-Cove
 * prices $0 on the two nobody drew.
 */
import type { TakeoffCondition } from '../types';
import type { AssemblyDetail, AssemblyQuantityInput } from '../services/apiService';

export type ConditionDraft = Omit<TakeoffCondition, 'id' | 'projectId'>;

interface UnitMapping {
  type: TakeoffCondition['type'];
  unit: string;
}

/**
 * The workbook unit strings seen across MCW's library. Anything else keeps its
 * own unit and is measured as an area, which is the commonest shape — the
 * caller surfaces it as unrecognised so the estimator checks it rather than
 * finding out from a wrong total.
 */
const UNIT_MAP: Record<string, UnitMapping> = {
  SF: { type: 'area', unit: 'SF' },
  SQFT: { type: 'area', unit: 'SF' },
  'SQ FT': { type: 'area', unit: 'SF' },
  SY: { type: 'area', unit: 'SY' },
  LF: { type: 'linear', unit: 'LF' },
  FT: { type: 'linear', unit: 'LF' },
  LNFT: { type: 'linear', unit: 'LF' },
  CY: { type: 'volume', unit: 'CY' },
  CF: { type: 'volume', unit: 'CF' },
  EA: { type: 'count', unit: 'EA' },
  EACH: { type: 'count', unit: 'EA' },
  PC: { type: 'count', unit: 'EA' },
  EACHES: { type: 'count', unit: 'EA' },
};

export interface ResolvedUnit extends UnitMapping {
  /** False when the assembly's unit isn't one we know how to measure. */
  recognized: boolean;
}

export function resolveConditionUnit(assemblyUnit: string | null): ResolvedUnit {
  const key = (assemblyUnit ?? '').trim().toUpperCase();
  const mapped = UNIT_MAP[key];
  if (mapped) return { ...mapped, recognized: true };
  return { type: 'area', unit: key || 'SF', recognized: false };
}

/**
 * Workbook "Unit of Measurement" cells frequently carry the component name
 * instead of a bare unit ("SF-Floor", "LF - Cove bead & Term Bar"), which is
 * why resolveConditionUnit's exact match misses them. This scans for a known
 * unit token or phrase anywhere in the text — used as a fallback, never a
 * replacement for an exact match, so it can't turn a real unit into the wrong
 * one on its own.
 */
const PHRASE_UNIT_MAP: Array<{ re: RegExp; mapping: UnitMapping }> = [
  { re: /\bSQ\.?\s*FT\.?\b|\bSQUARE\s+FEET\b|\bSQUARE\s+FOOT\b/, mapping: { type: 'area', unit: 'SF' } },
  { re: /\bCUBIC\s+YARDS?\b/, mapping: { type: 'volume', unit: 'CY' } },
  { re: /\bCUBIC\s+FEET\b|\bCUBIC\s+FOOT\b/, mapping: { type: 'volume', unit: 'CF' } },
  {
    re: /\bLINEAR\s+FEET\b|\bLINEAR\s+FOOT\b|\bLINEAL\s+FEET\b|\bLINEAL\s+FOOT\b/,
    mapping: { type: 'linear', unit: 'LF' },
  },
];

/**
 * Bare "FT" is deliberately excluded — inside a longer phrase it's as likely
 * to be the tail of "SQ FT" as a real linear-feet token, and the exact match
 * in resolveConditionUnit already catches a standalone "FT".
 */
const TOKEN_UNIT_MAP: Record<string, UnitMapping> = {
  SF: { type: 'area', unit: 'SF' },
  SQFT: { type: 'area', unit: 'SF' },
  AREA: { type: 'area', unit: 'SF' },
  SY: { type: 'area', unit: 'SY' },
  LF: { type: 'linear', unit: 'LF' },
  LNFT: { type: 'linear', unit: 'LF' },
  LINEAR: { type: 'linear', unit: 'LF' },
  CY: { type: 'volume', unit: 'CY' },
  CF: { type: 'volume', unit: 'CF' },
  EA: { type: 'count', unit: 'EA' },
  EACH: { type: 'count', unit: 'EA' },
  EACHES: { type: 'count', unit: 'EA' },
  PC: { type: 'count', unit: 'EA' },
  COUNT: { type: 'count', unit: 'EA' },
};

export function inferUnitFromText(text: string | null | undefined): UnitMapping | null {
  const upper = (text ?? '').toUpperCase();
  if (!upper.trim()) return null;
  for (const { re, mapping } of PHRASE_UNIT_MAP) {
    if (re.test(upper)) return mapping;
  }
  for (const token of upper.split(/[^A-Z0-9]+/).filter(Boolean)) {
    const mapped = TOKEN_UNIT_MAP[token];
    if (mapped) return mapped;
  }
  return null;
}

/**
 * Appends " (2)", " (3)"… until the name is free. Applying the same assembly
 * twice should add a second condition, not silently reuse the first.
 */
export function uniqueConditionName(desired: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()));
  const base = desired.trim();
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

function draftName(assemblyName: string, input: AssemblyQuantityInput, inputCount: number): string {
  return inputCount === 1 ? assemblyName.trim() : `${assemblyName.trim()} — ${input.name.trim()}`;
}

export interface BuildConditionsOptions {
  /** Names already used in the project, for de-duplication. */
  existingNames: string[];
  /** Colors already used in the project, so a new condition is visually distinct. */
  existingColors: string[];
  /** Injected so this stays pure and testable; production passes generateDistinctColor. */
  pickColor: (existingColors: string[]) => string;
  folderId?: string | null;
}

export interface BuiltConditions {
  drafts: ConditionDraft[];
  /** Quantity inputs whose unit we could not map — shown to the estimator. */
  unrecognizedUnits: string[];
}

/**
 * Waste is deliberately 0. Every assembly quantity input carries its own waste %
 * read from the source workbook, and I6 sends the engine a quantity without the
 * condition's waste; setting a second allowance here would compound the two into
 * a silent over-order (open item 10).
 */
export function buildConditionsFromAssembly(
  assembly: AssemblyDetail,
  options: BuildConditionsOptions
): BuiltConditions {
  const taken = new Set(options.existingNames.map((n) => n.trim().toLowerCase()));
  const colors = [...options.existingColors];
  const drafts: ConditionDraft[] = [];
  const unrecognizedUnits: string[] = [];

  for (const input of assembly.quantityInputs) {
    const direct = resolveConditionUnit(input.unit);
    let resolved: ResolvedUnit = direct;
    if (!direct.recognized) {
      const inferred = inferUnitFromText(input.unit) ?? inferUnitFromText(input.name);
      if (inferred) resolved = { ...inferred, recognized: true };
    }
    if (!resolved.recognized) unrecognizedUnits.push(input.name);

    const name = uniqueConditionName(
      draftName(assembly.name, input, assembly.quantityInputs.length),
      taken
    );
    taken.add(name.toLowerCase());

    const color = options.pickColor(colors);
    colors.push(color);

    drafts.push({
      name,
      type: resolved.type,
      unit: resolved.unit,
      wasteFactor: 0,
      color,
      description: `Priced by assembly "${assembly.name}" (${input.name}).`,
      folderId: options.folderId ?? null,
      assemblyId: assembly.id,
      assemblyQuantityInputId: input.id,
    });
  }

  return { drafts, unrecognizedUnits };
}
