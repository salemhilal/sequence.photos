/**
 * Tooltips: `data-tip` on an element shows its text right away on hover or keyboard focus
 * (the browser's own `title` tips wait about a second). One tip element, fixed to the
 * window, so it's never clipped by a scrolling panel and always fits on screen.
 */

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Room kept between a tip and the window's edges, and between a tip and its element. */
const MARGIN = 8;
const GAP = 6;

/**
 * Where a tip goes: centered below its element, or above it when there's no room below,
 * moved sideways to stay inside the window.
 */
export function placeTip(anchor: Box, tip: { width: number; height: number }, view: { width: number; height: number }) {
  const below = anchor.top + anchor.height + GAP;
  const top = below + tip.height <= view.height - MARGIN ? below : Math.max(MARGIN, anchor.top - GAP - tip.height);
  const centered = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.min(Math.max(MARGIN, centered), Math.max(MARGIN, view.width - MARGIN - tip.width));
  return { left, top };
}

/** Show tips for every `data-tip` element in the page, now and later. Call once. */
export function installTooltips(): void {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  let shown: Element | null = null;

  /**
   * While a tip shows, its element is watched: a change to its text (a toggle) shows the
   * new text, and its removal hides the tip, without measuring anything unless the text
   * changed. Nothing is watched while no tip shows.
   */
  const watch = new MutationObserver(() => {
    if (!shown) return;
    if (!shown.isConnected) hide();
    else if (shown.getAttribute('data-tip') !== tip.textContent) show(shown);
  });

  const show = (el: Element) => {
    const text = el.getAttribute('data-tip');
    if (!text) return hide();
    if (shown !== el) {
      watch.disconnect();
      watch.observe(el, { attributes: true, attributeFilter: ['data-tip'] });
      // It can go with any ancestor (a dialog closing): checking costs no layout.
      watch.observe(document.body, { childList: true, subtree: true });
    }
    shown = el;
    tip.textContent = text;
    tip.hidden = false;
    const { left, top } = placeTip(el.getBoundingClientRect(), tip.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = () => {
    if (!shown) return;
    shown = null;
    tip.hidden = true;
    watch.disconnect();
  };
  const tipped = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-tip]') : null);

  document.addEventListener('pointerover', (e) => {
    const el = tipped(e.target);
    if (el !== shown) {
      if (el) show(el);
      else hide();
    }
  });
  // Leaving the window: pointerout with nowhere it went to.
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = tipped(e.target);
    // Only for keyboard focus, as :focus-visible: a click shouldn't leave a tip behind.
    if (el && e.target instanceof HTMLElement && e.target.matches(':focus-visible')) show(el);
  });
  document.addEventListener('focusout', hide);
  // Pressing, scrolling, or typing moves things on; the tip would be in the way, or stale.
  for (const type of ['pointerdown', 'wheel', 'keydown'] as const) {
    document.addEventListener(type, hide, { capture: true, passive: true });
  }
  window.addEventListener('blur', hide);
}
