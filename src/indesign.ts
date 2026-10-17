import { getImage } from './db';
import { platform } from '#platform';
import { buildIdml, type LinkedImage } from './idml';
import { readImageInfo } from './imageInfo';
import { uniqueName } from './project';
import { projectStore } from './store';
import { ui } from './ui';
import { createZip, type ZipInput } from './zip';
import { allSpreads } from './spreads';

/** Enough of a file to cover its metadata segments. */
const HEADER_BYTES = 512 * 1024;
const REENCODE_QUALITY = 0.95;

/**
 * Export the book for InDesign: a ZIP holding an .idml file and a Links folder with
 * the placed photos' originals. Originals InDesign can't use as they are (formats it
 * doesn't read, or JPEGs it would show sideways) are saved as upright, high-quality JPEGs.
 */
export async function exportIndesign(): Promise<boolean> {
  if (ui.get().busy || ui.get().importing) return false;
  const project = projectStore.project;
  const placed = [...new Set(allSpreads(project).flatMap((s) => s.items.map((i) => i.photoId)))];
  const setBusy = (busy: string | null) => ui.set({ busy });
  const date = new Date().toISOString().slice(0, 10);
  let missing = 0;
  try {
    const saved = await platform.saveFile(`photo-book-${date}-indesign.zip`, async () => {
      const links = new Map<string, LinkedImage>();
      const files: ZipInput[] = [];
      const used = new Set<string>();
      for (const [i, id] of placed.entries()) {
        setBusy(`Preparing photo ${i + 1} of ${placed.length}…`);
        const img = await getImage(id);
        const meta = project.photos[id];
        if (!img || !meta) continue;
        const { data, format, ppi, size } = await linkable(img.full, img.thumb);
        const base = meta.name.replace(/\.[^.]*$/, '') || id;
        const path = `Links/${uniqueName(`${base}.${format === 'png' ? 'png' : 'jpg'}`, id, used)}`;
        links.set(id, { path, format, ppi, pxW: size?.w ?? meta.pxW, pxH: size?.h ?? meta.pxH });
        files.push({ name: path, data });
      }
      missing = placed.length - links.size;
      setBusy('Writing InDesign file…');
      const idml = await createZip(buildIdml(project, links));
      return createZip([{ name: `photo-book-${date}.idml`, data: idml }, ...files]);
    });
    if (saved && missing) ui.set({ notice: "Some photos' images were missing, so their frames are empty." });
    return saved;
  } catch {
    ui.set({ notice: "Couldn't export for InDesign." });
    return false;
  } finally {
    setBusy(null);
  }
}

/** The file to link: the original when InDesign can place it as is, else an upright JPEG. */
async function linkable(
  full: Blob,
  thumb: Blob,
): Promise<{ data: Blob; format: 'jpeg' | 'png'; ppi: number; size?: { w: number; h: number } }> {
  const info = readImageInfo(new Uint8Array(await full.slice(0, HEADER_BYTES).arrayBuffer()));
  if (info.format === 'png' || (info.format === 'jpeg' && info.orientation === 1)) {
    return { data: full, format: info.format, ppi: info.ppi };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(full, { imageOrientation: 'from-image' });
  } catch {
    // Not decodable here (e.g. HEIC outside Safari): the display copy is the best available.
    bitmap = await createImageBitmap(thumb);
  }
  const size = { w: bitmap.width, h: bitmap.height };
  const canvas = new OffscreenCanvas(size.w, size.h);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = await canvas.convertToBlob({ type: 'image/jpeg', quality: REENCODE_QUALITY });
  // Browsers don't record a resolution in the JPEGs they write, and InDesign reads that as 72 ppi.
  return { data, format: 'jpeg', ppi: 72, size };
}
