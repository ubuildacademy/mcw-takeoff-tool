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
    const resolved = resolveConditionUnit(input.unit);
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
