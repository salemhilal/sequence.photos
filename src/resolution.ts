import type { PhotoId, SpreadId } from './ids';
import { allSpreads, sheetOf } from './spreads';
import type { PhotoMeta, Placement, Project, Sheet } from './types';
import { ui } from './ui';

/**
 * Whether photos have enough detail for the page's resolution. One measure works for any
 * unit: how many of the photo's pixels there are per output pixel it covers (output
 * pixels being the page's units times its pxPerUnit). Below 1, it has less detail than the
 * page's dpi (or pixel size) asks for. Too much detail isn't flagged: exports downsample.
 */

/**
 * The photo's pixels per output pixel it covers, on its thinner axis (a photo stretched by
 * a free resize counts its thinner side). 1 or more: enough detail.
 */
export function coverage(
  photo: Pick<PhotoMeta, 'pxW' | 'pxH'>,
  item: Pick<Placement, 'w' | 'h'>,
  pxPerUnit: number,
): number {
  return Math.min(photo.pxW / (item.w * pxPerUnit), photo.pxH / (item.h * pxPerUnit));
}

/** Under this is a warning; a hair under 1 (from rounding in the fields) isn't. */
export const COVERAGE_MIN = 0.99;

export function isSoft(c: number): boolean {
  return c < COVERAGE_MIN;
}

/** Whether a placed photo has less detail than the page asks for. */
export function placedSoft(photo: PhotoMeta | undefined, item: Placement, sheet: Pick<Sheet, 'pxPerUnit'>): boolean {
  return !!photo && isSoft(coverage(photo, item, sheet.pxPerUnit));
}

/**
 * What the inspector says about a placed photo's detail, as a sentence: in inches, its
 * resolution on the page ("This image is 240 dpi, which is below the project's 300 dpi.");
 * in pixels, how much it's enlarged, only when it is.
 */
export function resolutionNote(
  photo: PhotoMeta,
  item: Placement,
  sheet: Pick<Sheet, 'unit' | 'pxPerUnit'>,
): { text: string; soft: boolean } | null {
  const c = coverage(photo, item, sheet.pxPerUnit);
  const soft = isSoft(c);
  if (sheet.unit === 'in') {
    const dpi = Math.round(Math.min(photo.pxW / item.w, photo.pxH / item.h));
    const text = soft
      ? `This image is ${dpi} dpi, which is below the project’s ${sheet.pxPerUnit} dpi.`
      : `This image is ${dpi} dpi.`;
    return { text, soft };
  }
  return soft ? { text: `This image is enlarged ${Math.round(100 / c)}%.`, soft } : null;
}

/**
 * Placed photos with less detail than the page asks for (or an export's `pxPerUnit`), in
 * book order.
 */
export function softPhotos(project: Project, pxPerUnit?: number): { photoId: PhotoId; spreadId: SpreadId }[] {
  const sheet = { ...sheetOf(project), ...(pxPerUnit === undefined ? {} : { pxPerUnit }) };
  return allSpreads(project).flatMap((spread) =>
    spread.items
      .filter((item) => placedSoft(project.photos[item.photoId], item, sheet))
      .map((item) => ({ photoId: item.photoId, spreadId: spread.id })),
  );
}

/**
 * The soft photo after `current` in book order (from the start, with none or after the
 * last), or null if there's no other.
 */
export function nextSoftPhoto(
  project: Project,
  current: PhotoId | null,
): { photoId: PhotoId; spreadId: SpreadId } | null {
  const soft = softPhotos(project);
  const at = soft.findIndex((s) => s.photoId === current);
  const others = soft.filter((s) => s.photoId !== current);
  if (!others.length) return null;
  return soft[(at + 1) % soft.length] ?? null;
}

/** "2 photos below 300 dpi", or "2 photos enlarged". */
export function softLabel(count: number, sheet: Pick<Sheet, 'unit' | 'pxPerUnit'>): string {
  const photos = `${count} ${count === 1 ? 'photo' : 'photos'}`;
  return sheet.unit === 'in' ? `${photos} below ${sheet.pxPerUnit} dpi` : `${photos} enlarged`;
}

/** "2 photos are below 300 dpi.", or "1 photo is enlarged." (`would`: "would be", for a draft). */
export function softSentence(count: number, sheet: Pick<Sheet, 'unit' | 'pxPerUnit'>, would = false): string {
  const photos = `${count} ${count === 1 ? 'photo' : 'photos'}`;
  const verb = would ? 'would be' : count === 1 ? 'is' : 'are';
  return sheet.unit === 'in' ? `${photos} ${verb} below ${sheet.pxPerUnit} dpi.` : `${photos} ${verb} enlarged.`;
}

/** Open a placed photo in the spread editor on the desk, selected (leaving the page or dialog it's shown from). */
export function showPhoto(at: { photoId: PhotoId; spreadId: SpreadId }): void {
  ui.set({ page: 'desk', modal: null, editingSpreadId: at.spreadId, editorSelect: at.photoId });
}
