/**
 * Hints: `data-tip` on an element shows its text in the status bar at once, on hover or
 * keyboard focus, as desktop apps do. Nothing floats over the work; the status bar stays in
 * view under every page and dialog that has hints.
 */
import { ui } from './ui';

/** Show hints for every `data-tip` element in the page, now and later. Call once. */
export function installHints(): void {
  // The element whose hint shows, watched while it does: a change to its hint (a toggle)
  // shows the new one, and its removal (with a dialog closing, say) clears it.
  let hinted: Element | null = null;
  const watch = new MutationObserver(() => set(hinted?.isConnected ? hinted : null));
  const set = (el: Element | null) => {
    if (el !== hinted) {
      watch.disconnect();
      if (el) {
        watch.observe(el, { attributes: true, attributeFilter: ['data-tip'] });
        watch.observe(document.body, { childList: true, subtree: true });
      }
      hinted = el;
    }
    const hint = el?.getAttribute('data-tip') || null;
    if (ui.get().hint !== hint) ui.set({ hint });
  };
  const tipped = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-tip]') : null);

  document.addEventListener('pointerover', (e) => {
    const el = tipped(e.target);
    if (el !== hinted) set(el);
  });
  // Leaving the window: pointerout with nowhere it went to.
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) set(null);
  });
  // Keyboard focus shows its hint (as :focus-visible: a click leaves the pointer's).
  document.addEventListener('focusin', (e) => {
    const el = tipped(e.target);
    if (el && e.target instanceof HTMLElement && e.target.matches(':focus-visible')) set(el);
  });
  document.addEventListener('focusout', () => set(null));
  window.addEventListener('blur', () => set(null));
}
