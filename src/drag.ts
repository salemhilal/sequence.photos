import { toSpreadId, type PhotoId, type SpreadId } from './ids';
import type { PageSide } from './types';
import { ui } from './ui';

/** What the pointer is over during a drag, as resolved by `hitTest`. */
export type DropTarget =
  | { kind: 'page'; spreadId: SpreadId; side: PageSide }
  | { kind: 'desk' }
  /** The desk strip at the bottom of the spread editor. */
  | { kind: 'strip' }
  /** The gap before spread `index` in the sidebar: dropping there adds a spread. */
  | { kind: 'insert'; index: number }
  | null;

/** Whether two drop targets are the same place (for highlighting the one under the pointer). */
export function sameTarget(a: DropTarget, b: DropTarget): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'page' && b.kind === 'page') return a.spreadId === b.spreadId && a.side === b.side;
  if (a.kind === 'insert' && b.kind === 'insert') return a.index === b.index;
  return true;
}

/** Resolve the drop target under a client point via `data-drop` attributes. */
export function hitTest(clientX: number, clientY: number): DropTarget {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (!(el instanceof HTMLElement)) continue;
    const kind = el.dataset.drop;
    if (kind === 'page') {
      const spreadId = el.dataset.spread;
      const side = el.dataset.side;
      // A book's left or right page, or a frame (all one page).
      if (spreadId && (side === 'left' || side === 'right' || side === 'whole'))
        return { kind: 'page', spreadId: toSpreadId(spreadId), side };
    }
    if (kind === 'desk') return { kind: 'desk' };
    if (kind === 'strip') return { kind: 'strip' };
    if (kind === 'insert') {
      const index = Number(el.dataset.index);
      if (Number.isInteger(index)) return { kind: 'insert', index };
    }
    // A modal blocks targets beneath it.
    if (el.dataset.modal !== undefined) return null;
  }
  return null;
}

const THRESHOLD = 4;

export interface DragMove {
  e: PointerEvent;
  /** Client-pixel offset from the pointerdown point. */
  dx: number;
  dy: number;
}

interface DragHandlers {
  onStart?: (m: DragMove) => void;
  onMove?: (m: DragMove) => void;
  /** Called on release. `moved` is false for a click. */
  onEnd?: (m: DragMove, moved: boolean) => void;
  onCancel?: () => void;
}

/**
 * Track a pointer drag from a React pointerdown. Movement under a few pixels counts as a click.
 * Escape, or the window losing focus, cancels the gesture.
 */
export function startDrag(down: React.PointerEvent, h: DragHandlers): void {
  const x0 = down.clientX;
  const y0 = down.clientY;
  let moved = false;
  // Capture the pointer so the release is delivered even outside the window;
  // otherwise a drag could be left hanging until the next click.
  const el = down.currentTarget as Element;
  const pointerId = down.pointerId;
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Not capturable (e.g. a synthetic event); window listeners still work.
  }

  const move = (e: PointerEvent) => {
    const m = { e, dx: e.clientX - x0, dy: e.clientY - y0 };
    if (!moved) {
      if (Math.hypot(m.dx, m.dy) < THRESHOLD) return;
      moved = true;
      h.onStart?.(m);
    }
    h.onMove?.(m);
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', cancel);
    try {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    } catch {
      // Already released, or the element is gone.
    }
  };
  const up = (e: PointerEvent) => {
    cleanup();
    h.onEnd?.({ e, dx: e.clientX - x0, dy: e.clientY - y0 }, moved);
  };
  const cancel = () => {
    cleanup();
    h.onCancel?.();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
  window.addEventListener('blur', cancel);
}

/** Show the floating thumbnail and highlight the drop target under the pointer. */
export function trackGhost(
  e: PointerEvent,
  ghost: { photoId: PhotoId; count: number; w: number; h: number } | null,
): DropTarget {
  const target = hitTest(e.clientX, e.clientY);
  ui.set({
    ghost: ghost ? { ...ghost, clientX: e.clientX, clientY: e.clientY } : null,
    hover: target,
  });
  return target;
}

export function clearGhost(): void {
  ui.set({ ghost: null, hover: null });
}
