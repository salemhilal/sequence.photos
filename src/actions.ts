import type { Draft } from 'immer';
import { getImage, putImage, type StoredImage } from './db';
import { importFiles, setUrl } from './images';
import { newPhotoId, newSpreadId, type PhotoId, type SpreadId } from './ids';
import { allSpreads, findSpread, frameIndex, hasFrames, middleIndex, sheetOf } from './spreads';
import { projectStore } from './store';
import { cleanCrop, cropFrom, cropOf, WHOLE, wholeRect } from './crop';
import { dropBox, fitCentered, pageRect, pileSize, type Rect } from './geometry';
import type { DropTarget } from './drag';
import type { Arrangement, Crop, Project, PageSide, PhotoMeta, Placement, Spread } from './types';
import { deskGeometry, viewToFit } from './deskGeometry';
import { leaveTour, ui } from './ui';

/** Photos per row when several land on the desk at once. */
const DESK_COLUMNS = 6;
/** Space between desk photos, as a share of the largest one. */
const DESK_GAP = 0.08;

type Box = { x: number; y: number; w: number; h: number };

/**
 * Places sizes in a grid of `columns`, starting at `origin`: cells as wide as the widest
 * and as tall as the tallest, each photo centered in its cell, with a gap in proportion.
 * Returns the placements and the grid's bounds.
 */
function deskGrid(
  sizes: { w: number; h: number }[],
  origin: { x: number; y: number },
  columns = DESK_COLUMNS,
): { at: Box[]; bounds: Box } {
  const cw = Math.max(...sizes.map((s) => s.w));
  const ch = Math.max(...sizes.map((s) => s.h));
  const gap = Math.max(cw, ch) * DESK_GAP;
  const cols = Math.min(columns, sizes.length);
  const rows = Math.ceil(sizes.length / cols);
  const at = sizes.map((s, i) => ({
    x: origin.x + (i % cols) * (cw + gap) + (cw - s.w) / 2,
    y: origin.y + Math.floor(i / cols) * (ch + gap) + (ch - s.h) / 2,
    w: s.w,
    h: s.h,
  }));
  return { at, bounds: { x: origin.x, y: origin.y, w: cols * (cw + gap) - gap, h: rows * (ch + gap) - gap } };
}

/**
 * New photos land on the desk at full size (as large as their preview stays sharp at
 * 100%), in rows of six below anything already there, and the view zooms to fit them.
 */
/** Zoom the desk to show every photo on it (or reset it, with none). */
export function fitDesk(): void {
  const { pile } = projectStore.project;
  if (!pile.length) {
    ui.set({ view: { panX: 40, panY: 40, zoom: 1 } });
    return;
  }
  const x = Math.min(...pile.map((p) => p.x));
  const y = Math.min(...pile.map((p) => p.y));
  const w = Math.max(...pile.map((p) => p.x + p.w)) - x;
  const h = Math.max(...pile.map((p) => p.y + p.h)) - y;
  ui.set({ view: viewToFit({ x, y, w, h }, deskGeometry.size()) });
}

export function addPhotosToPile(photos: PhotoMeta[]): void {
  if (!photos.length) return;
  const sizes = photos.map(pileSize);
  const pile = projectStore.project.pile;
  const vis = deskGeometry.visible();
  const gap = Math.max(...sizes.map((s) => Math.max(s.w, s.h))) * DESK_GAP;
  const origin = pile.length
    ? { x: Math.min(...pile.map((p) => p.x)), y: Math.max(...pile.map((p) => p.y + p.h)) + gap }
    : { x: vis.x + gap, y: vis.y + gap };
  const { at, bounds } = deskGrid(sizes, origin);

  projectStore.apply((d) => {
    photos.forEach((photo, i) => {
      d.photos[photo.id] = photo;
      const box = at[i];
      if (box) d.pile.push({ photoId: photo.id, ...box, z: d.nextZ++ });
    });
  });
  ui.set({ view: viewToFit(bounds, deskGeometry.size()) });
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
  if (l.kind === 'spreads') l.spreads.splice(middleIndex(l.spreads, index), 0, { kind: 'middle', id, items: [] });
  else l.frames.splice(frameIndex(l.frames, index), 0, { kind: 'frame', id, items: [] });
  return id;
}

/** Recipe: add a spread before position `index` and put photos on it (a new spread's left page). */
export function putOnNewSpread(d: Draft<Project>, photoIds: PhotoId[], index: number): void {
  const id = addSpread(d, index);
  putOnPage(d, photoIds, id, d.layout.kind === 'spreads' ? 'left' : 'whole');
}

/** Recipe: return a photo to the pile, centered on a desk point (defaults to the visible center). */
export function putInPile(d: Draft<Project>, photoId: PhotoId, at?: { x: number; y: number }): void {
  const photo = d.photos[photoId];
  if (!photo) return;
  removeFromSpreads(d, photoId);
  if (locate(d, photoId)?.where === 'desk') return;
  const { w, h } = pileSize(photo);
  // Where asked; else the nearest place to the middle of the view clear of other photos.
  const box = at ? { x: at.x - w / 2, y: at.y - h / 2 } : freeSpot(d.pile, { w, h }, centerOf(deskGeometry.visible()));
  d.pile.push({ photoId, ...box, w, h, z: d.nextZ++ });
}

function centerOf(r: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * Where a photo of `size` can go on the desk without overlapping any other (a gap apart):
 * the clear spot nearest `near`, trying a grid around it in widening rings. Its top-left
 * corner, in desk inches.
 */
export function freeSpot(
  pile: readonly { x: number; y: number; w: number; h: number }[],
  size: { w: number; h: number },
  near: { x: number; y: number },
): { x: number; y: number } {
  const gap = DESK_GAP * Math.max(size.w, size.h);
  const step = { x: size.w + gap, y: size.h + gap };
  const clear = (x: number, y: number) =>
    pile.every(
      (p) => x + size.w + gap <= p.x || p.x + p.w + gap <= x || y + size.h + gap <= p.y || p.y + p.h + gap <= y,
    );
  const origin = { x: near.x - size.w / 2, y: near.y - size.h / 2 };
  for (let ring = 0; ring <= 40; ring++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = origin.x + i * step.x;
        const y = origin.y + j * step.y;
        const d = Math.hypot(i * step.x, j * step.y);
        if (clear(x, y) && (!best || d < best.d)) best = { x, y, d };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return origin;
}

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

  const big = Math.max(...items.map((p) => Math.max(p.w, p.h)));
  const gap = big * DESK_GAP;
  const cell = big + gap;
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
      p.x = left + at.col * cell + (big - p.w) / 2;
      p.y = top + at.row * cell + (big - p.h) / 2;
    }
  });
}

/** "IMG_2103.jpg" → "IMG_2103 copy.jpg". */
export function copyName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} copy${name.slice(dot)}` : `${name} copy`;
}

/** A photo being copied: the original, and the new photo's id. */
export interface PhotoCopy {
  from: PhotoId;
  id: PhotoId;
}

/** New ids for copies of these photos. */
export function copiesOf(photoIds: readonly PhotoId[]): PhotoCopy[] {
  return photoIds.map((from) => ({ from, id: newPhotoId() }));
}

/**
 * Add the copies to the project: each a new photo ("… copy") placed where its original is
 * (on the desk, or on the same spread), above everything, `offset` inches down and right.
 * On a page, the step is the share of its width `offset` inches is of a 10 in page, in any
 * unit (0.25 in on 10 in; 27 px of 1,080). Their images are stored by `storeCopies`.
 */
export function placeCopies(d: Draft<Project>, copies: readonly PhotoCopy[], offset = 0): void {
  const sheet = sheetOf(d);
  const onSpread = (offset * sheet.pageW) / 10;
  for (const { from, id } of copies) {
    const meta = d.photos[from];
    if (!meta) continue;
    d.photos[id] = { ...meta, id, name: copyName(meta.name) };
    const at = locate(d, from);
    if (!at) {
      putInPile(d, id);
      continue;
    }
    const p = at.placement;
    // On the desk, in proportion to the photo (0.25 in for the old 2 in desk photos).
    const step = at.where === 'desk' ? (offset * Math.max(p.w, p.h)) / 2 : onSpread;
    const copy = { ...p, photoId: id, x: p.x + step, y: p.y + step, z: d.nextZ++ };
    (at.where === 'desk' ? d.pile : at.spread.items).push(copy);
  }
}

/**
 * Store each copy's image (its own copy of the original's data) and show it. Call once the
 * project refers to the copies, so a background cleanup of unreferenced images can't remove
 * them in between. Returns the copies whose originals had an image.
 */
export async function storeCopies(copies: readonly PhotoCopy[]): Promise<PhotoCopy[]> {
  const stored: PhotoCopy[] = [];
  for (const c of copies) {
    const img = await getImage(c.from);
    if (!img) continue;
    setUrl(c.id, img.thumb);
    await putImage(c.id, img);
    stored.push(c);
  }
  return stored;
}

/**
 * Show the copies' images while they're dragged out (before they're stored), from the
 * originals'.
 */
export function showCopies(copies: readonly PhotoCopy[]): void {
  for (const c of copies) void getImage(c.from).then((img) => img && setUrl(c.id, img.thumb));
}

const DUPLICATE_OFFSET = 0.25;

/**
 * Duplicate photos as new, independent photos (each with its own copy of the image data),
 * placed down and right of the originals (see `placeCopies`). One undo step. Returns the new
 * photos' ids.
 */
export async function duplicatePhotos(photoIds: PhotoId[], offset = DUPLICATE_OFFSET): Promise<PhotoId[]> {
  const sources: (PhotoCopy & { img: StoredImage })[] = [];
  for (const c of copiesOf(photoIds)) {
    const img = await getImage(c.from);
    if (img && projectStore.project.photos[c.from]) sources.push({ ...c, img });
  }
  if (!sources.length) return [];
  for (const { id, img } of sources) setUrl(id, img.thumb);
  // Reference the new photos before storing their images (see storeCopies).
  projectStore.apply((d) => placeCopies(d, sources, offset));
  for (const { id, img } of sources) await putImage(id, img);
  return sources.map((s) => s.id);
}

/**
 * Crop a photo, or show all of it (none), wherever it is: its frame changes to show the new
 * crop, and the photo itself stays where it was under it (as trimming a print does).
 */
export function setCrop(d: Draft<Project>, photoId: PhotoId, crop: Crop | undefined): void {
  const photo = d.photos[photoId];
  if (!photo) return;
  const at = locate(d, photoId);
  if (at) {
    const whole = wholeRect(at.placement, cropOf(photo));
    const c = crop ?? WHOLE;
    Object.assign(at.placement, {
      x: whole.x + c.x * whole.w,
      y: whole.y + c.y * whole.h,
      w: c.w * whole.w,
      h: c.h * whole.h,
    });
  }
  if (crop) photo.crop = crop;
  else delete photo.crop;
}

/** A crop made in crop mode: the frame where it's been dragged, over the whole photo at `whole`. */
export function setCropFrame(d: Draft<Project>, photoId: PhotoId, frame: Rect, whole: Rect): void {
  const photo = d.photos[photoId];
  const at = locate(d, photoId);
  if (!photo || !at) return;
  const crop = cleanCrop(cropFrom(frame, whole));
  Object.assign(at.placement, crop ? frame : whole);
  if (crop) photo.crop = crop;
  else delete photo.crop;
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
/** Whether a spread can move or be deleted: a book's middle spreads, and any frame. */
export function isMovable(spread: Pick<Spread, 'kind'>): boolean {
  return spread.kind === 'middle' || spread.kind === 'frame';
}

/**
 * Delete spreads (or frames) as one undo step, their photos back on the desk in a small
 * grid in the middle of the view. A book's first and last spreads stay, and so does a
 * sequence's last frame.
 */
export function deleteSpreads(spreadIds: readonly SpreadId[]): void {
  const doomed = new Set(spreadIds);
  projectStore.apply((d) => {
    const l = d.layout;
    const removed: Draft<Spread>[] = [];
    if (l.kind === 'spreads') {
      removed.push(...l.spreads.filter((s) => doomed.has(s.id)));
      l.spreads = l.spreads.filter((s) => !doomed.has(s.id));
    } else {
      // A sequence keeps at least one frame: its first, if all were asked for.
      const kept = l.frames.filter((s) => !doomed.has(s.id));
      const next = hasFrames(kept) ? kept : ([l.frames[0]] as const);
      removed.push(...l.frames.filter((s) => !next.includes(s)));
      l.frames = [...next];
    }
    // Back on the desk in a small grid in the middle of the view.
    const ids = removed.flatMap((s) => s.items.map((i) => i.photoId));
    const sizes = ids.flatMap((id) => {
      const photo = d.photos[id];
      return photo ? [pileSize(photo)] : [];
    });
    if (!sizes.length) return;
    const v = deskGeometry.visible();
    const { bounds } = deskGrid(sizes, { x: 0, y: 0 }, 4);
    const { at } = deskGrid(sizes, { x: v.x + (v.w - bounds.w) / 2, y: v.y + (v.h - bounds.h) / 2 }, 4);
    ids.forEach((id, n) => {
      const box = at[n];
      if (box) putInPile(d, id, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
    });
  });
  const editing = ui.get().editingSpreadId;
  if (editing && !findSpread(projectStore.project, editing)) ui.set({ editingSpreadId: null });
  ui.set((u) => ({ spreadSelection: u.spreadSelection.filter((id) => findSpread(projectStore.project, id)) }));
}

export function deleteSpread(spreadId: SpreadId): void {
  deleteSpreads([spreadId]);
}

/**
 * Move spreads (or frames) together, keeping their order, to just before position
 * `dropIndex` in the whole run (counted before they're taken out). A book's first and
 * last spreads don't move, and nothing goes before the first or after the last.
 */
export function moveSpreads(spreadIds: readonly SpreadId[], dropIndex: number): void {
  const moving = new Set(spreadIds);
  /** The run with the moving ones taken out and put back together at `at` (in the run). */
  const reorder = <T extends { id: SpreadId }>(run: T[], at: number): T[] => {
    const i = Math.max(0, Math.min(run.length, at));
    const stays = (s: T) => !moving.has(s.id);
    return [...run.slice(0, i).filter(stays), ...run.filter((s) => moving.has(s.id)), ...run.slice(i).filter(stays)];
  };
  projectStore.apply((d) => {
    const l = d.layout;
    // A book's middle spreads start at position 1 in the whole run.
    if (l.kind === 'spreads') l.spreads = reorder(l.spreads, dropIndex - 1);
    else {
      const next = reorder(l.frames, dropIndex);
      if (hasFrames(next)) l.frames = next;
    }
  });
}

/** Move a book's middle spread, or a frame, to position `toIndex` (counted after its removal). */
export function moveSpread(spreadId: SpreadId, toIndex: number): void {
  const all = allSpreads(projectStore.project);
  const from = all.findIndex((s) => s.id === spreadId);
  // As a drop index (before removal): one further along when moving later.
  moveSpreads([spreadId], from >= 0 && toIndex >= from ? toIndex + 1 : toIndex);
}

/**
 * Folio-style labels, zero-padded like a book's page numbers: "01", "02–03", "08" for a
 * book's spreads, or "01", "02", … for a sequence's frames.
 */
export function folioLabel(index: number, total: number, arrangement: Arrangement): string {
  const width = Math.max(2, String(arrangement === 'spreads' ? total * 2 : total).length);
  return spreadLabel(index, total, arrangement)
    .split('–')
    .map((n) => n.padStart(width, '0'))
    .join('–');
}

/** Page labels, e.g. "1", "2–3", counting a book's single first and last pages; a frame's number. */
export function spreadLabel(index: number, total: number, arrangement: Arrangement): string {
  if (arrangement === 'frames' || index === 0) return String(index + 1);
  const left = index * 2;
  if (index === total - 1) return String(left);
  return `${left}–${left + 1}`;
}

/** Said when the browser won't store photos at all, as in Safari's Private Browsing. */
export const STORAGE_REFUSED =
  'This browser won’t store photos here (as in a private window), so they couldn’t be added. Open Sequence in a regular window.';

export async function importPhotos(files: File[]): Promise<void> {
  if (ui.get().importing) return;
  leaveTour();
  try {
    const { photos, failed, storageRefused } = await importFiles(files, (done, total) =>
      ui.set({ importing: { done, total } }),
    );
    addPhotosToPile(photos);
    if (storageRefused) {
      ui.set({ notice: STORAGE_REFUSED });
    } else if (failed.length) {
      ui.set({
        notice: `Couldn't read ${failed.length} file${failed.length > 1 ? 's' : ''}: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`,
      });
    }
  } finally {
    ui.set({ importing: null });
  }
}
