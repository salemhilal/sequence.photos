/**
 * Tooltips: `data-tip` on an element shows its text after a second's hover (then at once
 * for the next for a second after, as you move along a toolbar), or at once on keyboard
 * focus. One tip element, fixed to the window, so it's never clipped by a scrolling panel
 * and always fits on screen.
 */

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How long a hover waits before its tip shows, and how long after a tip goes the next shows at once. */
export const TIP_DELAY_MS = 1000;

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
  // A hover waiting out the delay, and when a tip last went (the next within the delay shows at once).
  let waiting: { el: Element; timer: number } | null = null;
  let lastHidden = -Infinity;

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
  const cancelWait = () => {
    if (waiting) clearTimeout(waiting.timer);
    waiting = null;
  };
  const hide = () => {
    cancelWait();
    if (!shown) return;
    shown = null;
    tip.hidden = true;
    watch.disconnect();
    lastHidden = performance.now();
  };
  /** A hover's tip: at once while tips are showing (or just were), else after the delay. */
  const hover = (el: Element) => {
    if (shown || performance.now() - lastHidden < TIP_DELAY_MS) {
      cancelWait();
      return show(el);
    }
    if (waiting?.el === el) return;
    cancelWait();
    waiting = {
      el,
      timer: window.setTimeout(() => {
        waiting = null;
        if (el.isConnected) show(el);
      }, TIP_DELAY_MS),
    };
  };
  const tipped = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-tip]') : null);

  document.addEventListener('pointerover', (e) => {
    const el = tipped(e.target);
    if (el === shown) return;
    if (el) hover(el);
    else hide();
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
