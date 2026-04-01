/**
 * True when keyboard focus is in a control where Space and letter keys should not
 * trigger global workspace shortcuts.
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  return target.getAttribute?.('contenteditable') === 'true';
}
