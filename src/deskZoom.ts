import { MAX_ZOOM, MIN_ZOOM } from './deskGeometry';
import { ui } from './ui';

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
export function zoomAround(zoom: number, sx: number, sy: number): void {
  const v = ui.get().view;
  const f = zoom / v.zoom;
  ui.set({ view: { zoom, panX: sx - (sx - v.panX) * f, panY: sy - (sy - v.panY) * f } });
}

/** `n`, held between `lo` and `hi`. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
