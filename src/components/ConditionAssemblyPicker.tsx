/**
 * Pick the assembly a condition is priced by, and which of its named
 * quantities the takeoff feeds (task I6).
 *
 * Two decisions, but the second is only ever ASKED when it is real: most
 * assemblies price a single quantity, and for those the input is chosen
 * silently. Only a multi-quantity assembly — "SF-Floor / SF-Wall / LF-Cove" —
 * puts a second dropdown on screen, because there the choice changes which
 * components the measurement drives.
 *
 * The assembly chooser is a searchable combobox grouped by brand — a plain
 * Select was fine at three assemblies and unusable at two hundred.
 */
import { useEffect, useState } from 'react';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AssemblyCombobox } from './AssemblyCombobox';
import { assemblyLibraryService, type AssemblyDetail, type AssemblyListItem } from '../services/apiService';
import { extractErrorMessage } from '../utils/commonUtils';

/** The Select primitive cannot hold an empty string value, so "off" needs a token. */
const NONE = '__none__';

interface ConditionAssemblyPickerProps {
  assemblyId: string | null;
  quantityInputId: string | null;
  onChange: (next: { assemblyId: string | null; quantityInputId: string | null }) => void;
}

export function ConditionAssemblyPicker({
  assemblyId,
  quantityInputId,
  onChange,
}: ConditionAssemblyPickerProps) {
  const [assemblies, setAssemblies] = useState<AssemblyListItem[]>([]);
  const [detail, setDetail] = useState<AssemblyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    assemblyLibraryService
      .list()
      .then((items) => {
        if (!cancelled) setAssemblies(items);
      })
      .catch((err) => {
        // Not being in an org, or having imported nothing yet, is not an error
        // worth shouting about — the section just stays quiet.
        if (!cancelled) setError(extractErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!assemblyId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    assemblyLibraryService
      .detail(assemblyId)
      .then((loaded) => {
        if (cancelled) return;
        setDetail(loaded);
        if (loaded.quantityInputs.length === 1 && quantityInputId !== loaded.quantityInputs[0].id) {
          onChange({ assemblyId, quantityInputId: loaded.quantityInputs[0].id });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the assembly changes
  }, [assemblyId]);

  if (loading) return null;
  if (assemblies.length === 0) return null;

  const inputs = detail?.quantityInputs ?? [];
  const needsInputChoice = inputs.length > 1;

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div>
        <Label htmlFor="assembly">Price with assembly</Label>
        <AssemblyCombobox
          id="assembly"
          assemblies={assemblies}
          value={assemblyId}
          onChange={(nextId) =>
            onChange({
              assemblyId: nextId,
              quantityInputId: null,
            })
          }
          noneLabel="None — use the costs below"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {assemblyId
            ? "This condition’s quantity prices the whole assembly — materials, labor, margins — on the Costs tab."
            : 'Leave as None to price this condition with the per-unit costs below.'}
        </p>
      </div>

      {needsInputChoice && (
        <div>
          <Label htmlFor="assemblyInput">Which quantity does this measure?</Label>
          <Select
            value={quantityInputId ?? NONE}
            onValueChange={(value) =>
              onChange({ assemblyId, quantityInputId: value === NONE ? null : value })
            }
          >
            <SelectTrigger id="assemblyInput">
              <SelectValue placeholder="Choose one" />
            </SelectTrigger>
            <SelectContent>
              {inputs.map((input) => (
                <SelectItem key={input.id} value={input.id}>
                  {input.name}
                  {input.unit ? ` (${input.unit})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            This assembly prices {inputs.length} quantities. The others price at $0 until another
            condition measures them.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
