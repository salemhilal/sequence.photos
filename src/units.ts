import type { Edges, LayoutKind, Size } from './types';

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
  /** What Shift snaps a dragged guide to, and its name. */
  snap: number;
  snapLabel: string;
  /** The smallest a border guide's box gets, so it stays on the page. */
  minBox: number;
  /** How much each new border guide steps in from the last. */
  guideStep: number;
  /** The smallest page or frame. */
  minSize: number;
  /** The smallest side a placed photo gets. */
  minPhoto: number;
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
    snapLabel: '⅛ in',
    minBox: 0.25,
    guideStep: 0.25,
    minSize: 1,
    minPhoto: 0.1,
    fieldStep: 0.125,
    round: roundInches,
    format: (n) => roundInches(n).toString(),
  },
  digital: {
    suffix: 'px',
    nudge: 1,
    nudgeBig: 10,
    snap: 10,
    snapLabel: '10 px',
    minBox: 24,
    guideStep: 25,
    minSize: 100,
    minPhoto: 10,
    fieldStep: 1,
    round: Math.round,
    format: (n) => Math.round(n).toString(),
  },
};

/**
 * What the UI calls things in each layout: a book has spreads of pages, measured in
 * inches; a digital sequence has frames, measured in pixels.
 */
export interface Terms {
  /** One of the run the sidebar lists and the editor goes through. */
  spread: 'spread' | 'frame';
  spreads: 'spreads' | 'frames';
  Spreads: 'Spreads' | 'Frames';
  /** What photos are placed on. */
  page: 'page' | 'frame';
  pages: 'pages' | 'frames';
  /** The units, in words. */
  unitName: 'inches' | 'pixels';
  /** The sidebar's count: a book's pages, or a sequence's frames. */
  count: (spreads: number) => string;
  /** The sidebar's button that adds one at the end. */
  addAtEnd: string;
  /** What the arrow keys do in the preview. */
  turn: string;
  /** The toolbar's preview button. */
  preview: string;
  /** The preview's save button. */
  save: string;
  /** Saved PDFs' title and file name. */
  pdfTitle: string;
  fileStem: string;
  /** Each edge's name: a frame has a left and right where a book page has an outside and inside. */
  edges: Record<keyof Edges, string>;
  /** The Layout panel's note on how guides apply and are measured. */
  guidesNote: string;
}

export const TERMS: Record<LayoutKind, Terms> = {
  print: {
    spread: 'spread',
    spreads: 'spreads',
    Spreads: 'Spreads',
    page: 'page',
    pages: 'pages',
    unitName: 'inches',
    count: (n) => `${n * 2 - 2} pages`,
    addAtEnd: 'Add a spread before the back page',
    turn: 'turn pages',
    preview: 'Preview book',
    save: 'Download PDF',
    pdfTitle: 'Photo book',
    fileStem: 'photo-book',
    edges: { top: 'Top', bottom: 'Bottom', inside: 'Inside', outside: 'Outside' },
    guidesNote:
      'Every spread, mirrored on facing pages. Inside is the edge at the gutter; vertical guides are measured from the outside edge.',
  },
  digital: {
    spread: 'frame',
    spreads: 'frames',
    Spreads: 'Frames',
    page: 'frame',
    pages: 'frames',
    unitName: 'pixels',
    count: (n) => `${n} ${n === 1 ? 'frame' : 'frames'}`,
    addAtEnd: 'Add a frame at the end',
    turn: 'go through frames',
    preview: 'Preview',
    save: 'Save images',
    pdfTitle: 'Sequence',
    fileStem: 'sequence',
    edges: { top: 'Top', bottom: 'Bottom', inside: 'Right', outside: 'Left' },
    guidesNote: 'Every frame. Vertical guides are measured from the left edge.',
  },
};

/** A new project's book: 10 × 8 in pages. */
export const DEFAULT_PAGE: Size = { w: 10, h: 8 };

/**
 * A new digital sequence's frames: 4:5, the tallest shape Instagram's API posts as is, at
 * the 1080 px width Instagram shows posts at (larger uploads are scaled down to it).
 */
export const DEFAULT_FRAME: Size = { w: 1080, h: 1350 };

/** Instagram's feed and story sizes, offered as presets for digital frames. */
export const FRAME_PRESETS: { label: string; size: Size }[] = [
  { label: 'Instagram 4:5', size: { w: 1080, h: 1350 } },
  // The Instagram app takes 3:4; its upload API doesn't (posting crops or expands it).
  { label: 'Instagram 3:4 (app uploads)', size: { w: 1080, h: 1440 } },
  { label: 'Instagram square', size: { w: 1080, h: 1080 } },
  { label: 'Instagram landscape', size: { w: 1080, h: 566 } },
  { label: 'Instagram story', size: { w: 1080, h: 1920 } },
];
