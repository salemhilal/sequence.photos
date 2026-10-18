/** Keyboard and input helpers. */

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The platform's shortcut modifier: Cmd on macOS, Ctrl elsewhere. */
export function hasMod(e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

export const MOD_LABEL = isMac ? '⌘' : 'Ctrl+';

/** Whether a key event is aimed at a text field (so app shortcuts should stay out of the way). */
export function isTyping(e: Event): boolean {
  return isTextField(e.target);
}

/** Input types you type into. Checkboxes, radios, and the like aren't text fields: shortcuts still work on them. */
const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'password', 'tel']);

export function isTextField(t: EventTarget | null): boolean {
  if (t instanceof HTMLInputElement) return TEXT_INPUTS.has(t.type);
  return (
    t instanceof HTMLTextAreaElement ||
    // A focused menu takes arrow keys and typing itself.
    t instanceof HTMLSelectElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

/**
 * Whether arrow keys belong to the control they're aimed at: a text field, or a choice
 * like a radio group, which moves its selection with them.
 */
export function ownsArrowKeys(t: EventTarget | null): boolean {
  return isTextField(t) || (t instanceof HTMLInputElement && t.type === 'radio');
}
