import type { PDFDocument, PDFImage, PDFPage } from 'pdf-lib';
import { getImage } from './db';
import { readImageInfo } from './imageInfo';
import { exportPxPerUnit, perOf, type ExportOptions } from './exportOptions';
import { orientationMatrix, passThrough, type Matrix } from './pdfImage';
import { platform } from '#platform';
import { decodePhoto } from './rasterExport';
import { outputPages, pageRegion, planPage, type Draw } from './renderPlan';
import { projectStore } from './store';
import { ui } from './ui';
import { sheetOf } from './spreads';
import type { PhotoMeta, Unit } from './types';
import { TERMS } from './units';

/** PDF points per unit: 72 to the inch, and for pixels, as many as print at `printAt` dpi. */
function ptPerUnit(unit: Unit, printAt: number): number {
  return unit === 'in' ? 72 : 72 / printAt;
}
/** Enough of a file to cover its metadata segments. */
const HEADER_BYTES = 512 * 1024;
const QUALITY = 0.92;

/**
 * Render the project as a PDF: one PDF page per spread (a book's first and last pages are
 * single) or per page, at true size (pixels printed at `printAt` dpi). Each photo goes in at
 * the chosen resolution (no more than the page's), or its own if that's less: its original as it is when
 * that's a JPEG near the size needed, else a copy resized to it, cropped to what shows.
 * Guides are left out. `previews` counts photos whose originals couldn't be read, so their
 * display copies went in; `missing`, photos with no image at all.
 */
export async function renderPdf(
  options: Pick<ExportOptions, 'per' | 'dpi' | 'printAt'>,
  onProgress: (done: number, total: number) => void,
): Promise<{ blob: Blob; previews: number; missing: number }> {
  const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } =
    await import('pdf-lib');
  const project = projectStore.project;
  const sheet = sheetOf(project);
  const pdf = await PDFDocument.create();
  pdf.setTitle(TERMS[sheet.arrangement].pdfTitle);
  pdf.setCreator('Sequence');
  let previews = 0;
  let missing = 0;

  /** Draw an image with a matrix (for an original's EXIF orientation). */
  const drawWith = (page: PDFPage, image: PDFImage, m: Matrix) => {
    const name = page.node.newXObject('Image', image.ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), drawObject(name), popGraphicsState());
  };

  const toPt = ptPerUnit(sheet.unit, options.printAt);
  const pages = outputPages(project, perOf(project, options));
  for (const [i, out] of pages.entries()) {
    const plan = planPage(out, sheet, project.photos, exportPxPerUnit('pdf', sheet, options));
    // Output pixels to points; PDF's origin is the bottom-left corner.
    const pt = toPt / plan.pxPerUnit;
    const pageH = sheet.pageH * toPt;
    const page = pdf.addPage([pageRegion(out, sheet).w * toPt, pageH]);
    const box = (r: { x: number; y: number; w: number; h: number }) => ({
      x: r.x * pt,
      y: pageH - (r.y + r.h) * pt,
      w: r.w * pt,
      h: r.h * pt,
    });

    for (const d of plan.draws) {
      const photo = project.photos[d.photoId];
      if (!photo) continue;
      // An unreadable photo is left out rather than failing the whole PDF.
      const placed = await embed(pdf, d, photo).catch(() => null);
      if (!placed) {
        missing++;
        continue;
      }
      if (placed.preview) previews++;
      if (placed.whole) drawWith(page, placed.image, orientationMatrix(placed.orientation, box(d.placed)));
      else {
        const b = box(d.dst);
        page.drawImage(placed.image, { x: b.x, y: b.y, width: b.w, height: b.h });
      }
    }
    onProgress(i + 1, pages.length);
  }

  const bytes = await pdf.save();
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), previews, missing };
}

/**
 * A photo embedded for one draw: its original JPEG as it is, drawn whole at its placed size
 * (the page crops it), or a copy of just the part that shows, at the pixels needed.
 */
async function embed(
  pdf: PDFDocument,
  d: Draw,
  photo: PhotoMeta,
): Promise<{ image: PDFImage; whole: boolean; orientation: number; preview: boolean } | null> {
  const img = await getImage(d.photoId);
  if (!img) return null;
  const info = readImageInfo(new Uint8Array(await img.full.slice(0, HEADER_BYTES).arrayBuffer()));
  if (passThrough(info, photo, d.placed.w)) {
    // Some JPEGs (unusual color spaces, say) won't embed: those are re-encoded below.
    const image = await pdf.embedJpg(await img.full.arrayBuffer()).catch(() => null);
    if (image) return { image, whole: true, orientation: info.orientation, preview: false };
  }
  const decoded = await decodePhoto(d.photoId, photo, d.placed.w, d.placed.h);
  if (!decoded) return null;
  const { bitmap, preview } = decoded;
  // The part that shows, at the decoded size (the placed size, or the photo's own if less).
  const kx = bitmap.width / photo.pxW;
  const ky = bitmap.height / photo.pxH;
  const w = Math.max(1, Math.round(d.src.w * kx));
  const h = Math.max(1, Math.round(d.src.h * ky));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  // On white, as the page is: a transparent PNG would otherwise turn black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, d.src.x * kx, d.src.y * ky, d.src.w * kx, d.src.h * ky, 0, 0, w, h);
  bitmap.close();
  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
  const image = await pdf.embedJpg(await jpeg.arrayBuffer());
  return { image, whole: false, orientation: 1, preview };
}

/** Render and save the PDF, reporting progress and problems in the UI. Resolves whether it was saved. */
export async function savePdf(options: Pick<ExportOptions, 'per' | 'dpi' | 'printAt'>): Promise<boolean> {
  if (ui.get().busy || ui.get().importing) return false;
  // What rendering ran into, for the notice after saving.
  const result = { previews: 0, missing: 0 };
  let saved = false;
  try {
    const name = TERMS[projectStore.project.layout.kind].fileStem;
    saved = await platform.saveFile(`${name}-${new Date().toISOString().slice(0, 10)}.pdf`, async () => {
      ui.set({ busy: 'Rendering PDF…' });
      const out = await renderPdf(options, (done, total) => ui.set({ busy: `Rendering PDF ${done} of ${total}…` }));
      Object.assign(result, { previews: out.previews, missing: out.missing });
      return out.blob;
    });
    if (saved && result.missing) ui.set({ notice: "Some photos' images were missing, so they're left out." });
    else if (saved && result.previews) {
      ui.set({ notice: "Some photos couldn't be read at full size, so their previews were used." });
    }
  } catch {
    ui.set({ notice: "Couldn't make the PDF." });
  } finally {
    ui.set({ busy: null });
  }
  return saved;
}
