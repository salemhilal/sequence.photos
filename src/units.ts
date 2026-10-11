import type { LayoutKind, Size } from './types';

/**
 * What changes with the layout's units: print works in inches, digital in pixels. Sizes,
 * guides, and placements are stored in these units; this is what the UI and geometry need
 * to know about them.
 */
export interface Units {
  /** Shown after numbers. */
  suffix: 'in' | 'px';
  /** An arrow-key nudge, and with Shift. */
  nudge: number;
  nudgeBig: number;
  /** What Shift snaps a dragged guide to. */
  snap: number;
  /** The smallest a border guide's box gets, so it stays on the page. */
  minBox: number;
  /** How much each new border guide steps in from the last. */
  guideStep: number;
  /** The smallest page or frame. */
  minSize: number;
  /** Steps in a number field. */
  fieldStep: number;
  /** Values as they're kept and shown: eighths of an inch exactly, else hundredths; whole pixels. */
  round: (n: number) => number;
  /** Values as shown. */
  format: (n: number) => string;
}

const roundInches = (n: number) => {
  const eighths = Math.abs(n * 8 - Math.round(n * 8)) < 1e-9;
  return eighths ? Math.round(n * 1000) / 1000 : Math.round(n * 100) / 100;
};

export const UNITS: Record<LayoutKind, Units> = {
  print: {
    suffix: 'in',
    nudge: 1 / 16,
    nudgeBig: 1 / 2,
    snap: 1 / 8,
    minBox: 0.25,
    guideStep: 0.25,
    minSize: 1,
    fieldStep: 0.125,
    round: roundInches,
    format: (n) => roundInches(n).toString(),
  },
  digital: {
    suffix: 'px',
    nudge: 1,
    nudgeBig: 10,
    snap: 10,
    minBox: 24,
    guideStep: 25,
    minSize: 100,
    fieldStep: 1,
    round: Math.round,
    format: (n) => Math.round(n).toString(),
  },
};

/** A new project's book: 10 × 8 in pages. */
export const DEFAULT_PAGE: Size = { w: 10, h: 8 };

/**
 * A new digital sequence's frames: Instagram's tallest feed format, 3:4, at the 1080 px
 * width it shows posts at (larger uploads are scaled down to it).
 */
export const DEFAULT_FRAME: Size = { w: 1080, h: 1440 };

/** Instagram's feed and story sizes, offered as presets for digital frames. */
export const FRAME_PRESETS: { label: string; size: Size }[] = [
  { label: 'Instagram 3:4', size: { w: 1080, h: 1440 } },
  { label: 'Instagram 4:5', size: { w: 1080, h: 1350 } },
  { label: 'Instagram square', size: { w: 1080, h: 1080 } },
  { label: 'Instagram landscape', size: { w: 1080, h: 566 } },
  { label: 'Instagram story', size: { w: 1080, h: 1920 } },
];
