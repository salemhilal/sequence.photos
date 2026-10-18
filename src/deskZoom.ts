import { MAX_ZOOM, MIN_ZOOM } from './deskGeometry';
import { ui, type DeskView } from './ui';

/** Zoom the desk by a factor, about its center (the status bar's − and +). */
export function zoomBy(f: number): void {
  zoomTo(ui.get().view.zoom * f);
}

/** Zoom the desk to a level (1 is 100%), about its center. */
export function zoomTo(zoom: number): void {
  const r = document.querySelector('.desk')?.getBoundingClientRect();
  zoomAround(clamp(zoom, MIN_ZOOM, MAX_ZOOM), (r?.width ?? 0) / 2, (r?.height ?? 0) / 2);
}

/** Set zoom keeping the desk point under (sx, sy) — desk-relative pixels — fixed. */
function zoomAround(zoom: number, sx: number, sy: number): void {
  ui.set({ view: zoomedAround(ui.get().view, zoom, sx, sy) });
}

/** A view zoomed to `zoom`, keeping the point at (sx, sy) (from its origin, in pixels) still. */
export function zoomedAround(v: DeskView, zoom: number, sx: number, sy: number): DeskView {
  const f = zoom / v.zoom;
  return { zoom, panX: sx - (sx - v.panX) * f, panY: sy - (sy - v.panY) * f };
}

/**
 * A view after a wheel event, as on the desk and in the spread editor: a pinch (which comes
 * as Ctrl + wheel) or ⌘/Ctrl + scroll zooms around the pointer at (sx, sy), between `min`
 * and `max`; plain scrolling pans.
 */
export function wheeled(
  v: DeskView,
  e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'ctrlKey' | 'metaKey'>,
  sx: number,
  sy: number,
  min = MIN_ZOOM,
  max = MAX_ZOOM,
): DeskView {
  if (!e.ctrlKey && !e.metaKey) return { ...v, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY };
  return zoomedAround(v, clamp(v.zoom * Math.exp(-e.deltaY * 0.01), min, max), sx, sy);
}

/** `n`, held between `lo` and `hi`. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
