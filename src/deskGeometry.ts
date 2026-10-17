import type { DeskView } from './ui';

/** Screen pixels per inch on the desk at zoom 1. */
export const DESK_PPI = 48;

/** The desk's zoom range. Out far enough for rows of full-size photos. */
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 5;

/**
 * The view that shows `bounds` (desk inches) comfortably in a desk `size` (screen
 * pixels): centered, with a margin, zoomed no further in than 100%.
 */
export function viewToFit(
  bounds: { x: number; y: number; w: number; h: number },
  size: { w: number; h: number },
): DeskView {
  const margin = 0.08;
  const fit = Math.min(
    (size.w * (1 - 2 * margin)) / (bounds.w * DESK_PPI),
    (size.h * (1 - 2 * margin)) / (bounds.h * DESK_PPI),
  );
  const zoom = Math.min(1, MAX_ZOOM, Math.max(MIN_ZOOM, fit));
  const k = DESK_PPI * zoom;
  return {
    zoom,
    panX: (size.w - bounds.w * k) / 2 - bounds.x * k,
    panY: (size.h - bounds.h * k) / 2 - bounds.y * k,
  };
}

/**
 * Converts between screen and desk coordinates. The Desk component registers the
 * real implementations when it mounts; these defaults stand in before that (and in tests).
 */
export const deskGeometry = {
  toDesk: (clientX: number, clientY: number): { x: number; y: number } => ({ x: clientX, y: clientY }),
  /** Visible desk area in desk inches. */
  visible: (): { x: number; y: number; w: number; h: number } => ({ x: 0, y: 0, w: 20, h: 12 }),
  /** The desk's size on screen, in pixels. */
  size: (): { w: number; h: number } => ({ w: 960, h: 576 }),
};
