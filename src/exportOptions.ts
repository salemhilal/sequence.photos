import type { Project, Sheet } from './types';

/**
 * What the Export view exports to, and the choices each takes. Measurements convert only
 * where the destination's differ from the project's: an inches project exported as images
 * (or to Instagram) is turned into pixels at a dpi; a pixel project saved as a PDF is given
 * a printed size at a dpi. InDesign opens pixels as pixels (a point each), so it needs none.
 */

export type Destination = 'pdf' | 'images' | 'indesign' | 'instagram';

/** One output per spread (its pages side by side) or per page. Frames are always per page. */
export type Per = 'spread' | 'page';

export interface ExportOptions {
  per: Per;
  /** Images only. */
  format: 'jpeg' | 'png';
  /**
   * Inches projects: output pixels per inch, for a PDF's photos or for images. At most the
   * project's dpi: more would only enlarge the photos.
   */
  dpi: number;
  /** Pixel projects as a PDF: how many pixels make an inch of the page. */
  printAt: number;
}

export const DEFAULT_PRINT_AT = 300;

export function defaultOptions(sheet: Pick<Sheet, 'arrangement' | 'unit' | 'pxPerUnit'>): ExportOptions {
  return {
    per: sheet.arrangement === 'spreads' ? 'spread' : 'page',
    format: 'jpeg',
    dpi: sheet.unit === 'in' ? sheet.pxPerUnit : 1,
    printAt: DEFAULT_PRINT_AT,
  };
}

/** Where a project can go: InDesign takes spreads; Instagram is web only. */
export function destinations(project: Project, web: boolean): Destination[] {
  return [
    'pdf',
    'images',
    ...(project.layout.kind === 'spreads' ? (['indesign'] as const) : []),
    ...(web ? (['instagram'] as const) : []),
  ];
}

/** Whether a destination measures in pixels (so an inches project converts to it). */
export function measuresInPixels(d: Destination): boolean {
  return d === 'images' || d === 'instagram';
}

/** Whether exporting to `d` converts the project's measurements (see the module comment). */
export function converts(d: Destination, sheet: Pick<Sheet, 'unit'>): boolean {
  if (d === 'indesign') return false;
  return sheet.unit === 'in' ? measuresInPixels(d) : !measuresInPixels(d);
}

/**
 * Output pixels per unit an export makes: for inches, the chosen dpi (no more than the
 * project's); for pixels, one each. Photos are checked for detail against this.
 */
export function exportPxPerUnit(
  d: Destination,
  sheet: Pick<Sheet, 'unit' | 'pxPerUnit'>,
  o: Pick<ExportOptions, 'dpi'>,
): number {
  if (sheet.unit === 'px' || d === 'indesign' || d === 'instagram') return sheet.pxPerUnit;
  return Math.min(sheet.pxPerUnit, Math.max(1, o.dpi));
}

/** One output per spread or per page, as asked; frames are pages either way. */
export function perOf(project: Project, o: Pick<ExportOptions, 'per'>): Per {
  return project.layout.kind === 'spreads' ? o.per : 'page';
}
