import { ui } from '../ui';

interface Badge {
  key: number;
  label: string;
  x: number;
  y: number;
  disabled: boolean;
}

/** Room between a button and its badge. */
const GAP = 4;

/**
 * While the shortcut modifier is held (see useCommandShortcuts), each button with a
 * `data-shortcut` shows it in a badge just below, in a layer over everything so nothing
 * covers it, and the button stays in view.
 */
export function ShortcutBadges() {
  const show = ui.use((s) => s.hints);
  if (!show) return null;
  return (
    <div className="shortcut-badges" aria-hidden="true">
      {measure().map((b) => (
        <kbd key={b.key} className={`shortcut-hint${b.disabled ? ' disabled' : ''}`} style={{ left: b.x, top: b.y }}>
          {b.label}
        </kbd>
      ))}
    </div>
  );
}

/**
 * Where each badge goes. Read when they appear: holding the key changes nothing on the page,
 * so what's there is what was there.
 */
function measure(): Badge[] {
  const found: Badge[] = [];
  document.querySelectorAll<HTMLElement>('[data-shortcut]').forEach((el, key) => {
    const r = el.getBoundingClientRect();
    // Not for buttons out of sight (a hidden page's, a collapsed panel's).
    if (!r.width || !r.height || !el.checkVisibility()) return;
    const label = el.dataset.shortcut ?? '';
    const disabled = el instanceof HTMLButtonElement && el.disabled;
    found.push({ key, label, x: r.left + r.width / 2, y: r.bottom + GAP, disabled });
  });
  return found;
}
