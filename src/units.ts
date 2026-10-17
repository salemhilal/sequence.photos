import type { Arrangement, Edges, PageSetup, Unit } from './types';

/**
 * What changes with the page's unit, inches or pixels. Sizes, guides, and placements are
 * stored in it; this is what the UI and geometry need to know about it.
 */
export interface Units {
  /** Shown after numbers. */
  suffix: Unit;
  /** The unit, in words. */
  name: 'inches' | 'pixels';
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

export const UNITS: Record<Unit, Units> = {
  in: {
    suffix: 'in',
    name: 'inches',
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
  px: {
    suffix: 'px',
    name: 'pixels',
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
 * What the UI calls things in each arrangement: a book has spreads of pages; a sequence
 * has frames.
 */
export interface Terms {
  /** One of the run the sidebar lists and the editor goes through. */
  spread: 'spread' | 'frame';
  spreads: 'spreads' | 'frames';
  Spreads: 'Spreads' | 'Frames';
  /** What photos are placed on. */
  page: 'page' | 'frame';
  pages: 'pages' | 'frames';
  /** The sidebar's count: a book's pages, or a sequence's frames. */
  count: (spreads: number) => string;
  /** The sidebar's button that adds one at the end. */
  addAtEnd: string;
  /** What the arrow keys do in the preview. */
  turn: string;
  /** The toolbar's preview button. */
  preview: string;
  /** Saved PDFs' title and file name. */
  pdfTitle: string;
  fileStem: string;
  /** Each edge's name: a frame has a left and right where a book page has an outside and inside. */
  edges: Record<keyof Edges, string>;
  /** The Layout panel's note on how guides apply and are measured. */
  guidesNote: string;
}

export const TERMS: Record<Arrangement, Terms> = {
  spreads: {
    spread: 'spread',
    spreads: 'spreads',
    Spreads: 'Spreads',
    page: 'page',
    pages: 'pages',
    count: (n) => `${n * 2 - 2} pages`,
    addAtEnd: 'Add a spread before the back page',
    turn: 'turn pages',
    preview: 'Preview book',
    pdfTitle: 'Photo book',
    fileStem: 'photo-book',
    edges: { top: 'Top', bottom: 'Bottom', inside: 'Inside', outside: 'Outside' },
    guidesNote:
      'Guides apply to every spread, mirrored on facing pages. Inside is the edge at the gutter; vertical guides are measured from the outside edge.',
  },
  frames: {
    spread: 'frame',
    spreads: 'frames',
    Spreads: 'Frames',
    page: 'frame',
    pages: 'frames',
    count: (n) => `${n} ${n === 1 ? 'frame' : 'frames'}`,
    addAtEnd: 'Add a frame at the end',
    turn: 'go through frames',
    preview: 'Preview',
    pdfTitle: 'Sequence',
    fileStem: 'sequence',
    edges: { top: 'Top', bottom: 'Bottom', inside: 'Right', outside: 'Left' },
    guidesNote: 'Guides apply to every frame. Vertical guides are measured from the left edge.',
  },
};

/** The resolution inches are exported at unless the document says otherwise. */
export const DEFAULT_DPI = 300;

/** A new project's book: 10 × 8 in pages, at 300 dpi. */
export const DEFAULT_PAGE: PageSetup = { w: 10, h: 8, unit: 'in', pxPerUnit: DEFAULT_DPI };

/** A page setting people often want, set all at once. */
export interface Preset {
  label: string;
  arrangement: Arrangement;
  /** The resolution comes from the draft for inches (else 300 dpi), and is 1× for pixels. */
  page: Omit<PageSetup, 'pxPerUnit'>;
}

/**
 * Books, zines, slides, and Instagram's feed and story sizes. None is pixel spreads, but any
 * combination can be set by hand.
 */
export const PRESETS: Preset[] = [
  { label: 'Book', arrangement: 'spreads', page: { w: 10, h: 8, unit: 'in' } },
  { label: 'Zine', arrangement: 'spreads', page: { w: 5.5, h: 8.5, unit: 'in' } },
  { label: 'Square book', arrangement: 'spreads', page: { w: 8, h: 8, unit: 'in' } },
  { label: 'Slides', arrangement: 'frames', page: { w: 13.33, h: 7.5, unit: 'in' } },
  { label: 'Instagram 4:5', arrangement: 'frames', page: { w: 1080, h: 1350, unit: 'px' } },
  // The Instagram app takes 3:4; its upload API doesn't (posting crops or expands it).
  { label: 'Instagram 3:4 (app uploads)', arrangement: 'frames', page: { w: 1080, h: 1440, unit: 'px' } },
  { label: 'Instagram square', arrangement: 'frames', page: { w: 1080, h: 1080, unit: 'px' } },
  { label: 'Instagram landscape', arrangement: 'frames', page: { w: 1080, h: 566, unit: 'px' } },
  { label: 'Instagram story', arrangement: 'frames', page: { w: 1080, h: 1920, unit: 'px' } },
];
