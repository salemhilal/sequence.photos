import type { GuideId, PhotoId, SpreadId } from './ids';

/** All positions and sizes are in inches. */

export interface PhotoMeta {
  id: PhotoId;
  name: string;
  /** Pixel dimensions of the original, after EXIF orientation. */
  pxW: number;
  pxH: number;
}

export interface Placement {
  photoId: PhotoId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order; the most recently touched photo has the highest z. */
  z: number;
}

/**
 * A spread's items are in its layout's units (inches in print, pixels in digital), with
 * y = 0 at the top edge. In print, x = 0 is the gutter (the left page spans -pageW..0,
 * the right page 0..pageW): anchoring to the gutter keeps layouts stable when the page
 * size changes. A digital frame's x = 0 is its left edge.
 *
 * A book opens on a single right page (the first spread) and closes on a single left
 * page (the last); every spread between is a pair. A digital sequence is frames, one
 * image each. Each kind has its own type, and its own place in its layout, so one can't
 * end up in another's.
 */
interface SpreadOf<K extends string> {
  kind: K;
  id: SpreadId;
  items: Placement[];
}
export type FirstSpread = SpreadOf<'first'>;
export type MiddleSpread = SpreadOf<'middle'>;
export type LastSpread = SpreadOf<'last'>;
/** One image of a digital sequence, like a carousel slide. */
export type Frame = SpreadOf<'frame'>;
export type Spread = FirstSpread | MiddleSpread | LastSpread | Frame;
export type SpreadKind = Spread['kind'];

/** A page of a spread: a book's left or right page, or the whole of a digital frame. */
export type PageSide = 'left' | 'right' | 'whole';

/** A page's or frame's size, in its layout's units: inches for print, pixels for digital. */
export interface Size {
  w: number;
  h: number;
}

/** A printed book: today's structure, with its page size. */
export interface PrintLayout {
  kind: 'print';
  /** In inches. */
  page: Size;
  firstSpread: FirstSpread;
  spreads: MiddleSpread[];
  lastSpread: LastSpread;
}

/** A digital sequence, like an Instagram carousel: frames, all one size, in order. */
export interface DigitalLayout {
  kind: 'digital';
  /** In pixels. */
  frame: Size;
  /** Never empty. */
  frames: [Frame, ...Frame[]];
}

export type Layout = PrintLayout | DigitalLayout;
export type LayoutKind = Layout['kind'];

/**
 * Distances from a page's edges, in its layout's units. Inside is the edge at the gutter
 * and outside the one opposite, so they mirror on facing pages. A digital frame is laid
 * out like a left page: outside is its left edge, inside its right (the UI says Left and
 * Right there).
 */
export interface Edges {
  top: number;
  bottom: number;
  inside: number;
  outside: number;
}

/**
 * A border guide: a box inset from every page's edges, either the same distance from
 * each (`even`, shown as linked) or its own distance per edge.
 */
export type BorderGuide = { id: GuideId } & ({ kind: 'even'; inset: number } | ({ kind: 'edges' } & Edges));

/**
 * A straight guide across every page, mirrored on facing pages. A vertical guide's `at`
 * is inches from the page's outside edge; a horizontal guide's, from its top.
 */
export interface LineGuide {
  id: GuideId;
  axis: 'vertical' | 'horizontal';
  at: number;
}

export interface Settings {
  centerV: boolean;
  centerH: boolean;
  /** When the page size changes, move photos with the guides instead of keeping absolute positions. */
  keepRelative: boolean;
  borders: BorderGuide[];
  lines: LineGuide[];
  /**
   * The border guide photos dropped on a page fit inside, by id. Null (or a guide that's
   * gone) means the one with the largest box; with no border guides, the page.
   */
  dropBorder: GuideId | null;
  /**
   * Each layout kind's last size (print in inches, digital in pixels), so switching back
   * restores it. The current kind's matches its layout's size.
   */
  sizes: Record<LayoutKind, Size>;
}

/**
 * What geometry lays photos out on: the project's page (print) or frame (digital), with
 * its size, its units, and its guides. Worked out from the project (see `sheetOf`), never
 * saved.
 */
export interface Sheet extends Omit<Settings, 'sizes'> {
  layout: LayoutKind;
  pageW: number;
  pageH: number;
}

/**
 * The version of the saved project's shape. Bump it (and add a migration and a
 * test sample in schema.ts / schema.test.ts) whenever what gets saved changes.
 */
export const CURRENT_SCHEMA = 3;

export interface Project {
  /** Always the current shape: older ones are upgraded on load (see schema.ts). */
  schemaVersion: typeof CURRENT_SCHEMA;
  photos: Record<PhotoId, PhotoMeta>;
  /** Photos on the desktop; x/y are desk coordinates, always in inches (the desk isn't a page). */
  pile: Placement[];
  /** The book's pages, or the sequence's frames, with their size (see `allSpreads`, `sheetOf`). */
  layout: Layout;
  settings: Settings;
  nextZ: number;
}
