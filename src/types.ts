import type { GuideId, PhotoId, SpreadId } from './ids';

/**
 * Positions and sizes on pages are in the page's unit (inches or pixels; see PageSetup and
 * units.ts). The desk is always in inches.
 */

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
 * A spread's items are in the page's unit, with y = 0 at the top edge. In spreads, x = 0
 * is the gutter (the left page spans -pageW..0, the right page 0..pageW): anchoring to the
 * gutter keeps layouts stable when the page size changes. A frame's x = 0 is its left edge.
 *
 * A book opens on a single right page (the first spread) and closes on a single left
 * page (the last); every spread between is a pair. A sequence is frames, one image each.
 * Each kind has its own type, and its own place in its layout, so one can't end up in
 * another's.
 */
interface SpreadOf<K extends string> {
  kind: K;
  id: SpreadId;
  items: Placement[];
}
export type FirstSpread = SpreadOf<'first'>;
export type MiddleSpread = SpreadOf<'middle'>;
export type LastSpread = SpreadOf<'last'>;
/** One image of a sequence of frames, like a carousel slide. */
export type Frame = SpreadOf<'frame'>;
export type Spread = FirstSpread | MiddleSpread | LastSpread | Frame;
export type SpreadKind = Spread['kind'];

/** A page of a spread: a book's left or right page, or the whole of a frame. */
export type PageSide = 'left' | 'right' | 'whole';

/** A width and height, in some unit. */
export interface Size {
  w: number;
  h: number;
}

/** Facing pages (a book) or single pages in order (a sequence of frames). */
export type Arrangement = 'spreads' | 'frames';
/** What sizes and positions on pages are stored in. The desk is always inches. */
export type Unit = 'in' | 'px';

/** The page: one page's size (a spread is two of them), its unit, and its resolution. */
export interface PageSetup {
  /** One page's size, in `unit`. */
  w: number;
  h: number;
  unit: Unit;
  /**
   * Output pixels per unit: the dpi for inches (300 by default), the pixel density for
   * pixels (1). Exports make this many pixels, and warnings check against it.
   */
  pxPerUnit: number;
}

/** A book: a single first page, spreads of two, and a single last page. */
export interface SpreadsLayout {
  kind: 'spreads';
  firstSpread: FirstSpread;
  spreads: MiddleSpread[];
  lastSpread: LastSpread;
}

/** A sequence, like an Instagram carousel: frames, all one size, in order. */
export interface FramesLayout {
  kind: 'frames';
  /** Never empty. */
  frames: [Frame, ...Frame[]];
}

export type Layout = SpreadsLayout | FramesLayout;

/**
 * Distances from a page's edges, in the page's unit. Inside is the edge at the gutter
 * and outside the one opposite, so they mirror on facing pages. A frame is laid
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
 * is its distance from the page's outside edge (a frame's left); a horizontal guide's,
 * from its top.
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
}

/**
 * What geometry lays photos out on: the project's page, with its arrangement, size, unit,
 * resolution, and guides. Worked out from the project (see `sheetOf`), never saved.
 */
export interface Sheet extends Settings {
  arrangement: Arrangement;
  unit: Unit;
  pxPerUnit: number;
  pageW: number;
  pageH: number;
}

/**
 * The version of the saved project's shape. Bump it (and add a migration and a
 * test sample in schema.ts / schema.test.ts) whenever what gets saved changes.
 */
export const CURRENT_SCHEMA = 4;

export interface Project {
  /** Always the current shape: older ones are upgraded on load (see schema.ts). */
  schemaVersion: typeof CURRENT_SCHEMA;
  photos: Record<PhotoId, PhotoMeta>;
  /** Photos on the desktop; x/y are desk coordinates, always in inches (the desk isn't a page). */
  pile: Placement[];
  /** The page size, unit, and resolution, shared by every spread or frame. */
  page: PageSetup;
  /** The book's spreads, or the sequence's frames (see `allSpreads`, `sheetOf`). */
  layout: Layout;
  settings: Settings;
  nextZ: number;
}
