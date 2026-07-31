/**
 * Turning conditions + measurements into an assembly pricing request.
 *
 * Pulled out of the Costs tab when assembly totals had to reach the project
 * cost summary, the reports tab and the exports as well: every one of those
 * has to ask the engine the same question, and two definitions of "the
 * quantity for this condition" would quietly become two different job totals.
 *
 * WASTE: the quantity is the measured value times the condition's multiplier,
 * deliberately WITHOUT the condition's own waste factor. The assembly already
 * carries a waste percentage per quantity input, taken from the source
 * workbook, and applying both would compound two allowances into a silent
 * over-order. One source of waste, and it is the assembly's.
 */
import type { AssemblyPriceRequestItem } from '../services/apiService';

interface ConditionLike {
  id: string;
  assemblyId?: string | null;
  assemblyQuantityInputId?: string | null;
  multiplier?: number;
}

interface MeasurementLike {
  conditionId: string;
  calculatedValue?: number | null;
  netCalculatedValue?: number | null;
}

export function buildAssemblyPriceItems(
  conditions: ConditionLike[],
  measurements: MeasurementLike[]
): AssemblyPriceRequestItem[] {
  return conditions
    .filter((condition) => condition.assemblyId && condition.assemblyQuantityInputId)
    .map((condition) => {
      const quantity = measurements
        .filter((m) => m.conditionId === condition.id)
        .reduce((sum, m) => sum + (m.netCalculatedValue ?? m.calculatedValue ?? 0), 0);
      return {
        conditionId: condition.id,
        assemblyId: condition.assemblyId as string,
        quantityInputId: condition.assemblyQuantityInputId as string,
        quantity: quantity * (condition.multiplier ?? 1),
      };
    });
}

/**
 * Re-pricing on every vertex drag would be a request per mouse move. The
 * signature collapses "same conditions, same quantities" into one string so
 * callers only re-request when a number an estimator can see actually changed.
 */
export function assemblyPricingSignature(items: AssemblyPriceRequestItem[]): string {
  return items
    .map((item) => `${item.conditionId}:${item.quantityInputId}:${item.quantity.toFixed(4)}`)
    .join('|');
}
