import { getImage } from './db';
import { spreadLeft, spreadWidth } from './geometry';
import { platform } from '#platform';
import { projectStore } from './store';
import { ui } from './ui';
import { allSpreads, sheetOf } from './spreads';
import type { LayoutKind } from './types';

/** PDF points per unit: 72 to the inch, and a pixel to a point (as image editors do). */
const PT: Record<LayoutKind, number> = { print: 72, digital: 1 };

/**
 * Render the book as a PDF: one PDF page per spread, at true size, with the first
 * and last pages as single pages (or one page per frame, a point to the pixel).
 * Photos are cropped at the page edges; guides are omitted.
 */
export async function renderPdf(onProgress: (done: number, total: number) => void): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const project = projectStore.project;
  const sheet = sheetOf(project);
  const { pageH, layout } = sheet;
  const pt = PT[layout];
  const pdf = await PDFDocument.create();
  pdf.setTitle(layout === 'print' ? 'Photo book' : 'Sequence');
  pdf.setCreator('Sequence');

  const book = allSpreads(project);
  for (const [i, spread] of book.entries()) {
    const left = spreadLeft(spread.kind, sheet);
    const page = pdf.addPage([spreadWidth(spread.kind, sheet) * pt, pageH * pt]);

    for (const p of [...spread.items].sort((a, b) => a.z - b.z)) {
      const img = await getImage(p.photoId);
      if (!img) continue;
      // Display copies are always JPEG and already have EXIF orientation applied.
      // An unreadable one is left out rather than failing the whole book.
      const embedded = await img.thumb
        .arrayBuffer()
        .then((bytes) => pdf.embedJpg(bytes))
        .catch(() => null);
      if (!embedded) continue;
      page.drawImage(embedded, {
        x: (p.x - left) * pt,
        // PDF's origin is the bottom-left corner.
        y: (pageH - p.y - p.h) * pt,
        width: p.w * pt,
        height: p.h * pt,
      });
    }
    onProgress(i + 1, book.length);
  }

  const bytes = await pdf.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

/** Render and save the PDF, reporting progress and errors in the UI. */
export async function savePdf(): Promise<void> {
  if (ui.get().busy || ui.get().importing) return;
  try {
    const name = projectStore.project.layout.kind === 'print' ? 'photo-book' : 'sequence';
    await platform.saveFile(`${name}-${new Date().toISOString().slice(0, 10)}.pdf`, () => {
      ui.set({ busy: 'Rendering PDF…' });
      return renderPdf((done, total) => ui.set({ busy: `Rendering PDF ${done} of ${total}…` }));
    });
  } catch {
    ui.set({ notice: "Couldn't make the PDF." });
  } finally {
    ui.set({ busy: null });
  }
}
