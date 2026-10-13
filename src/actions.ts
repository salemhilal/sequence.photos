import type { Draft } from 'immer';
import { getImage, putImage, type StoredImage } from './db';
import { importFiles, setUrl } from './images';
import { newPhotoId, newSpreadId, type PhotoId, type SpreadId } from './ids';
import { allSpreads, findSpread, middleIndex, sheetOf } from './spreads';
import { projectStore } from './store';
import { dropBox, fitCentered, pageRect, pileSize, PILE_PHOTO_SIZE } from './geometry';
import type { DropTarget } from './drag';
import type { LayoutKind, Project, PageSide, PhotoMeta, Placement, Spread } from './types';
import { DESK_PPI, deskGeometry } from './deskGeometry';
import { ui } from './ui';

const CELL = 1.8;
const JITTER = 0.3;

/** Scatter new photos like prints on a desk: a loose grid with jitter, overlapping slightly. */
export function addPhotosToPile(photos: PhotoMeta[]): void {
  if (!photos.length) return;
  const vis = deskGeometry.visible();
  const cols = Math.max(3, Math.floor((vis.w - 0.5) / CELL));
  let top = vis.y + 0.4;
  const pile = projectStore.project.pile;
  if (pile.length) top = Math.max(...pile.map((p) => p.y + p.h)) + 0.6;
  const left = vis.x + 0.4;

  projectStore.apply((d) => {
    photos.forEach((photo, i) => {
      d.photos[photo.id] = photo;
      const { w, h } = pileSize(photo);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = left + col * CELL + CELL / 2 + (Math.random() * 2 - 1) * JITTER;
      const cy = top + row * CELL + CELL / 2 + (Math.random() * 2 - 1) * JITTER;
      d.pile.push({ photoId: photo.id, x: cx - w / 2, y: cy - h / 2, w, h, z: d.nextZ++ });
    });
  });

  // Bring the new batch into view if it landed below the fold.
  const view = ui.get().view;
  const rows = Math.ceil(photos.length / cols);
  if (top > vis.y + vis.h - 1 && rows > 0) {
    ui.set({ view: { ...view, panY: view.panY - (top - vis.y - 0.4) * DESK_PPI * view.zoom } });
  }
}

/** Placement for a photo freshly dropped on a page: fit inside the drop border guide, centered on the page. */
export function placementOnPage(d: Draft<Project> | Project, photoId: PhotoId, side: PageSide): Placement | null {
  const photo = d.photos[photoId];
  if (!photo) return null;
  const sheet = sheetOf(d);
  const page = pageRect(side, sheet);
  const r = fitCentered(photo, dropBox(side, sheet), page);
  return { photoId, ...r, z: 0 };
}

/** Where a photo is: on the desk, on a spread, or (if unplaced) nowhere. */
export type Location<S, P> = { where: 'desk'; placement: P } | { where: 'spread'; spread: S; placement: P } | null;

export function locate(d: Project, photoId: PhotoId): Location<Spread, Placement>;
export function locate(d: Draft<Project>, photoId: PhotoId): Location<Draft<Spread>, Draft<Placement>>;
export function locate(
  d: Project | Draft<Project>,
  photoId: PhotoId,
): Location<Spread | Draft<Spread>, Placement | Draft<Placement>> {
  const onDesk = d.pile.find((p) => p.photoId === photoId);
  if (onDesk) return { where: 'desk', placement: onDesk };
  for (const spread of allSpreads(d)) {
    const placement = spread.items.find((p) => p.photoId === photoId);
    if (placement) return { where: 'spread', spread, placement };
  }
  return null;
}

/**
 * Recipe: what dropping photos on a target does. Pages fit and center them;
 * gaps between spreads add a spread; the desk (at `at`, in desk inches) and the
 * editor's desk strip return them to the desk. Returns false for no target.
 */
export function dropPhotos(
  d: Draft<Project>,
  target: DropTarget,
  photoIds: PhotoId[],
  at?: { x: number; y: number },
): boolean {
  if (!target) return false;
  switch (target.kind) {
    case 'page':
      putOnPage(d, photoIds, target.spreadId, target.side);
      return true;
    case 'insert':
      putOnNewSpread(d, photoIds, target.index);
      return true;
    case 'desk':
    case 'strip':
      for (const id of photoIds) putInPile(d, id, target.kind === 'desk' ? at : undefined);
      return true;
  }
}

export function bump(d: Draft<Project>, p: Placement): void {
  p.z = d.nextZ++;
}

/**
 * Bring a clicked photo to the front of `among` (the desk, or its page), unless it's
 * already there: a click alone shouldn't count as a change to the project.
 */
export function raise(d: Draft<Project>, among: Placement[], p: Placement): void {
  if (among.some((o) => o !== p && o.z > p.z)) bump(d, p);
}

function removeFromSpreads(d: Draft<Project>, photoId: PhotoId): void {
  for (const s of allSpreads(d)) s.items = s.items.filter((i) => i.photoId !== photoId);
}

/** Recipe: put photos onto a page (from anywhere), each centered and fitted. */
export function putOnPage(d: Draft<Project>, photoIds: PhotoId[], spreadId: SpreadId, side: PageSide): void {
  const spread = findSpread(d, spreadId);
  if (!spread) return;
  for (const id of photoIds) {
    const p = placementOnPage(d, id, side);
    if (!p) continue;
    d.pile = d.pile.filter((i) => i.photoId !== id);
    removeFromSpreads(d, id);
    p.z = d.nextZ++;
    spread.items.push(p);
  }
}

/**
 * Recipe: add a spread (a book's middle spread, or a frame) before position `index` in
 * the book, and return its id. A book's first and last spreads stay first and last.
 */
function addSpread(d: Draft<Project>, index: number): SpreadId {
  const l = d.layout;
  const id = newSpreadId();
  if (l.kind === 'print') l.spreads.splice(middleIndex(l.spreads, index), 0, { kind: 'middle', id, items: [] });
  else l.frames.splice(Math.min(Math.max(0, index), l.frames.length), 0, { kind: 'frame', id, items: [] });
  return id;
}

/** Recipe: add a spread before position `index` and put photos on it (a new spread's left page). */
export function putOnNewSpread(d: Draft<Project>, photoIds: PhotoId[], index: number): void {
  const id = addSpread(d, index);
  putOnPage(d, photoIds, id, d.layout.kind === 'print' ? 'left' : 'whole');
}

/** Recipe: return a photo to the pile, centered on a desk point (defaults to the visible center). */
export function putInPile(d: Draft<Project>, photoId: PhotoId, at?: { x: number; y: number }): void {
  const photo = d.photos[photoId];
  if (!photo) return;
  removeFromSpreads(d, photoId);
  if (locate(d, photoId)?.where === 'desk') return;
  const { w, h } = pileSize(photo);
  let c = at;
  if (!c) {
    const v = deskGeometry.visible();
    c = {
      x: v.x + v.w / 2 + (Math.random() - 0.5) * PILE_PHOTO_SIZE,
      y: v.y + v.h / 2 + (Math.random() - 0.5) * PILE_PHOTO_SIZE,
    };
  }
  d.pile.push({ photoId, x: c.x - w / 2, y: c.y - h / 2, w, h, z: d.nextZ++ });
}

const TIDY_GAP = 0.3;

/**
 * Arrange desk photos in a tidy grid, keeping their rough reading order
 * (rows top to bottom, then left to right). Tidies `photoIds` if given,
 * otherwise the whole pile. The grid starts at the photos' top-left corner;
 * rows that are wider than the visible desk wrap.
 */
export function tidyPile(photoIds?: PhotoId[]): void {
  const ids = photoIds && photoIds.length > 1 ? new Set(photoIds) : null;
  const items = projectStore.project.pile.filter((p) => !ids || ids.has(p.photoId));
  if (items.length < 2) return;

  const cell = Math.max(...items.map((p) => Math.max(p.w, p.h))) + TIDY_GAP;
  const cy = (p: Placement) => p.y + p.h / 2;
  const cx = (p: Placement) => p.x + p.w / 2;

  // Group into rows: a photo joins the current row if its center is within
  // half a cell of the row's first photo.
  const rows: Placement[][] = [];
  for (const p of [...items].sort((a, b) => cy(a) - cy(b))) {
    const row = rows.at(-1);
    if (row && cy(p) - cy(row[0]!) < cell / 2) row.push(p);
    else rows.push([p]);
  }

  const left = Math.min(...items.map((p) => p.x));
  const top = Math.min(...items.map((p) => p.y));
  const vis = deskGeometry.visible();
  const cols = Math.max(1, Math.floor((vis.x + vis.w - left) / cell));

  // Each existing row stays a row, wrapping if it's wider than the view.
  const slot = new Map<PhotoId, { col: number; row: number }>();
  let gridRow = 0;
  for (const row of rows) {
    row
      .sort((a, b) => cx(a) - cx(b))
      .forEach((p, i) => {
        slot.set(p.photoId, { col: i % cols, row: gridRow + Math.floor(i / cols) });
      });
    gridRow += Math.ceil(row.length / cols);
  }

  projectStore.apply((d) => {
    for (const p of d.pile) {
      const at = slot.get(p.photoId);
      if (!at) continue;
      p.x = left + at.col * cell + (cell - TIDY_GAP - p.w) / 2;
      p.y = top + at.row * cell + (cell - TIDY_GAP - p.h) / 2;
    }
  });
}

/** "IMG_2103.jpg" → "IMG_2103 copy.jpg". */
export function copyName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} copy${name.slice(dot)}` : `${name} copy`;
}

const DUPLICATE_OFFSET = 0.25;

/**
 * Duplicate photos as new, independent photos (each with its own copy of the image
 * data), placed `offset` inches down and right of the originals: on the desk, or on
 * the same spread. In a frame, that's the same share of its width as on a 10 in page
 * (0.25 in → 27 px of 1,080). One undo step. Returns the new photos' ids.
 */
export async function duplicatePhotos(photoIds: PhotoId[], offset = DUPLICATE_OFFSET): Promise<PhotoId[]> {
  const sources: { from: PhotoId; id: PhotoId; img: StoredImage }[] = [];
  for (const from of photoIds) {
    const img = await getImage(from);
    if (img && projectStore.project.photos[from]) sources.push({ from, id: newPhotoId(), img });
  }
  if (!sources.length) return [];
  for (const { id, img } of sources) setUrl(id, img.thumb);

  // Reference the new photos before storing their images, so a background cleanup
  // of unreferenced images can't remove them in between.
  projectStore.apply((d) => {
    const sheet = sheetOf(d);
    const onSpread = sheet.layout === 'digital' ? (offset * sheet.pageW) / 10 : offset;
    for (const { from, id } of sources) {
      const meta = d.photos[from];
      if (!meta) continue;
      d.photos[id] = { ...meta, id, name: copyName(meta.name) };
      const at = locate(d, from);
      if (!at) {
        putInPile(d, id);
        continue;
      }
      const p = at.placement;
      const step = at.where === 'desk' ? offset : onSpread;
      const copy = { ...p, photoId: id, x: p.x + step, y: p.y + step, z: d.nextZ++ };
      (at.where === 'desk' ? d.pile : at.spread.items).push(copy);
    }
  });
  for (const { id, img } of sources) await putImage(id, img);
  return sources.map((s) => s.id);
}

export function deleteFromProject(photoIds: PhotoId[]): void {
  const ids = new Set(photoIds);
  projectStore.apply((d) => {
    d.pile = d.pile.filter((p) => !ids.has(p.photoId));
    for (const s of allSpreads(d)) s.items = s.items.filter((p) => !ids.has(p.photoId));
    for (const id of ids) delete d.photos[id];
  });
  ui.set((s) => ({ selection: s.selection.filter((id) => !ids.has(id)) }));
}

/** Insert a new spread (or frame) before position `index`. A book's first and last spreads stay put. */
export function insertSpread(index: number): void {
  projectStore.apply((d) => void addSpread(d, index));
}

/**
 * Delete a spread, returning its photos to the desk: a book's middle spread (the first and
 * last aren't in that list, so can't be), or any frame but a sequence's only one.
 */
export function deleteSpread(spreadId: SpreadId): void {
  projectStore.apply((d) => {
    const l = d.layout;
    let spread: Draft<Spread> | undefined;
    if (l.kind === 'print') {
      const idx = l.spreads.findIndex((s) => s.id === spreadId);
      if (idx >= 0) spread = l.spreads.splice(idx, 1)[0];
    } else {
      const idx = l.frames.findIndex((s) => s.id === spreadId);
      if (idx >= 0 && l.frames.length > 1) spread = l.frames.splice(idx, 1)[0];
    }
    if (!spread) return;
    const ids = spread.items.map((i) => i.photoId);
    const v = deskGeometry.visible();
    ids.forEach((id, n) => {
      putInPile(d, id, {
        x: v.x + v.w / 2 + ((n % 4) - 1.5) * CELL + (Math.random() - 0.5) * JITTER,
        y: v.y + v.h / 2 + (Math.floor(n / 4) - 0.5) * CELL + (Math.random() - 0.5) * JITTER,
      });
    });
  });
  if (ui.get().editingSpreadId === spreadId) ui.set({ editingSpreadId: null });
}

/** Move a book's middle spread, or a frame, to position `toIndex` (counted after its removal). */
export function moveSpread(spreadId: SpreadId, toIndex: number): void {
  projectStore.apply((d) => {
    const l = d.layout;
    if (l.kind === 'print') {
      const from = l.spreads.findIndex((s) => s.id === spreadId);
      const [spread] = from >= 0 ? l.spreads.splice(from, 1) : [];
      if (spread) l.spreads.splice(middleIndex(l.spreads, toIndex), 0, spread);
    } else {
      const from = l.frames.findIndex((s) => s.id === spreadId);
      const [frame] = from >= 0 ? l.frames.splice(from, 1) : [];
      if (frame) l.frames.splice(Math.min(Math.max(0, toIndex), l.frames.length), 0, frame);
    }
  });
}

/**
 * Folio-style labels, zero-padded like a book's page numbers: "01", "02–03", "08" for a
 * book's spreads, or "01", "02", … for a sequence's frames.
 */
export function folioLabel(index: number, total: number, layout: LayoutKind = 'print'): string {
  const width = Math.max(2, String(layout === 'print' ? total * 2 : total).length);
  return spreadLabel(index, total, layout)
    .split('–')
    .map((n) => n.padStart(width, '0'))
    .join('–');
}

/** Page labels, e.g. "1", "2–3", counting a book's single first and last pages; a frame's number. */
export function spreadLabel(index: number, total: number, layout: LayoutKind = 'print'): string {
  if (layout === 'digital' || index === 0) return String(index + 1);
  const left = index * 2;
  if (index === total - 1) return String(left);
  return `${left}–${left + 1}`;
}

export async function importPhotos(files: File[]): Promise<void> {
  if (ui.get().importing) return;
  try {
    const { photos, failed } = await importFiles(files, (done, total) => ui.set({ importing: { done, total } }));
    addPhotosToPile(photos);
    if (failed.length) {
      ui.set({
        notice: `Couldn't read ${failed.length} file${failed.length > 1 ? 's' : ''}: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`,
      });
    }
  } finally {
    ui.set({ importing: null });
  }
}
