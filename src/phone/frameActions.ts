import type { Draft } from 'immer';
import { copiesOf, copyName, placementOnPage, putInPile, type PhotoCopy } from '../actions';
import { getImage, putImage } from '../db';
import { dropBox, fitCentered, pageRect, snapMove, type GuideLines, type Rect } from '../geometry';
import { newSpreadId, type PhotoId, type SpreadId } from '../ids';
import { setUrl } from '../images';
import { allSpreads, findSpread, sheetOf } from '../spreads';
import { projectStore } from '../store';
import type { Frame, Ink, PhotoBorder, PhotoMeta, Placement, Project } from '../types';

/**
 * What the phone does to a sequence's frames and photos, as recipes (for projectStore.apply)
 * where it can be, so it's tested apart from the screens.
 */

export function newFrame(): Frame {
  return { kind: 'frame', id: newSpreadId(), items: [] };
}

/** The sequence's frames (the phone only makes sequences). */
export function framesOf(p: Project | Draft<Project>): Frame[] {
  return p.layout.kind === 'frames' ? (p.layout.frames as Frame[]) : [];
}

/** Recipe: add an empty frame before position `index` (at the end, past the last); returns its id. */
export function addFrame(d: Draft<Project>, index = Infinity): SpreadId {
  const frame = newFrame();
  if (d.layout.kind === 'frames') d.layout.frames.splice(Math.min(index, d.layout.frames.length), 0, frame);
  return frame.id;
}

/** Where photos being added go: a new frame each, the empty frames first, or the desk. */
export type AddTo = 'frames' | 'fill' | 'desk';

/** Recipe: put a photo on a frame, fitted to the drop guide and centered, from wherever it was. */
export function placeOnFrame(d: Draft<Project>, photoId: PhotoId, frameId: SpreadId): void {
  const frame = findSpread(d, frameId);
  const p = placementOnPage(d, photoId, 'whole');
  if (!frame || !p) return;
  takeOff(d, photoId);
  p.z = d.nextZ++;
  frame.items.push(p);
}

/** Recipe: add new photos to the project, and put them where asked. */
export function addPhotos(d: Draft<Project>, photos: readonly PhotoMeta[], to: AddTo): void {
  for (const photo of photos) d.photos[photo.id] = photo;
  const empty = to === 'fill' ? framesOf(d).filter((f) => f.items.length === 0) : [];
  for (const photo of photos) {
    if (to === 'desk') {
      putInPile(d, photo.id);
      continue;
    }
    const frameId = empty.shift()?.id ?? addFrame(d);
    placeOnFrame(d, photo.id, frameId);
  }
}

/** The desk's photos, in the order they arrived there. */
export function deskPhotos(p: Project): PhotoId[] {
  return [...p.pile].sort((a, b) => a.z - b.z).map((i) => i.photoId);
}

/** Recipe: take a photo off whatever frame it's on, and off the desk. */
function takeOff(d: Draft<Project>, photoId: PhotoId): void {
  d.pile = d.pile.filter((i) => i.photoId !== photoId);
  for (const s of allSpreads(d)) s.items = s.items.filter((i) => i.photoId !== photoId);
}

/** Recipe: a photo back to the desk (dragged into the tray), without its border. */
export function toDesk(d: Draft<Project>, photoId: PhotoId): void {
  putInPile(d, photoId);
}

/**
 * Recipe: drop a photo on a frame at a point (in the frame's units): fitted to the drop
 * guide's size and centered there, kept on the frame.
 */
export function placeAt(d: Draft<Project>, photoId: PhotoId, frameId: SpreadId, at: { x: number; y: number }): void {
  const frame = findSpread(d, frameId);
  const photo = d.photos[photoId];
  if (!frame || !photo) return;
  const sheet = sheetOf(d);
  const box = dropBox('whole', sheet);
  const fit = fitCentered(photo, box);
  const page = pageRect('whole', sheet);
  // Its center on the frame, wherever the finger went.
  const cx = Math.min(page.w, Math.max(0, at.x));
  const cy = Math.min(page.h, Math.max(0, at.y));
  takeOff(d, photoId);
  frame.items.push({ photoId, x: cx - fit.w / 2, y: cy - fit.h / 2, w: fit.w, h: fit.h, z: d.nextZ++ });
}

/** Recipe: a frame's background (white, the default, is none). */
export function setBackground(d: Draft<Project>, frameIds: readonly SpreadId[], ink: Ink): void {
  for (const id of frameIds) {
    const frame = findSpread(d, id);
    if (!frame) continue;
    if (ink === 'white') delete frame.background;
    else frame.background = ink;
  }
}

/** Recipe: a photo's border, or none. */
export function setBorder(d: Draft<Project>, photoId: PhotoId, border: PhotoBorder | null): void {
  for (const s of allSpreads(d)) {
    const item = s.items.find((i) => i.photoId === photoId);
    if (!item) continue;
    if (border && border.width > 0) item.border = { ...border };
    else delete item.border;
  }
}

/** A placed photo's box with its border: what it takes up on the frame. */
export function outerRect(r: Rect, border: PhotoBorder | undefined): Rect {
  const b = border?.width ?? 0;
  return { x: r.x - b, y: r.y - b, w: r.w + 2 * b, h: r.h + 2 * b };
}

/** Snap a moving photo by its outer edge (border and all) to `lines`; returns the photo's box. */
export function snapPhoto(
  r: Rect,
  border: PhotoBorder | undefined,
  lines: GuideLines,
  threshold: number,
): { rect: Rect; hit: { xs: number[]; ys: number[] } } {
  const snapped = snapMove(outerRect(r, border), lines, threshold);
  const b = border?.width ?? 0;
  return { rect: { ...r, x: snapped.rect.x + b, y: snapped.rect.y + b }, hit: snapped.hit };
}

/** Recipe: fit a placed photo, border and all, into `box` (the frame, or a guide), centered there. */
export function fitPhoto(d: Draft<Project>, photoId: PhotoId, box: Rect): void {
  const at = placedOn(d, photoId);
  const photo = d.photos[photoId];
  if (!at || !photo) return;
  const b = at.border?.width ?? 0;
  const inner = { x: box.x + b, y: box.y + b, w: Math.max(1, box.w - 2 * b), h: Math.max(1, box.h - 2 * b) };
  Object.assign(at, fitCentered(photo, inner));
}

/** Recipe: center a placed photo on its frame. */
export function centerPhoto(d: Draft<Project>, photoId: PhotoId): void {
  const at = placedOn(d, photoId);
  if (!at) return;
  const page = pageRect('whole', sheetOf(d));
  at.x = (page.w - at.w) / 2;
  at.y = (page.h - at.h) / 2;
}

function placedOn(d: Draft<Project>, photoId: PhotoId): Draft<Placement> | undefined {
  for (const s of allSpreads(d)) {
    const item = s.items.find((i) => i.photoId === photoId);
    if (item) return item;
  }
  return undefined;
}

/**
 * Recipe: copies of frames, each just after its original, with copies of its photos (the
 * copies' images are stored by `duplicateFrames`). Returns the new frames' ids.
 */
export function copyFrames(d: Draft<Project>, frameIds: readonly SpreadId[], copies: readonly PhotoCopy[]): SpreadId[] {
  if (d.layout.kind !== 'frames') return [];
  const byFrom = new Map(copies.map((c) => [c.from, c.id]));
  const made: SpreadId[] = [];
  // Last first, so earlier indexes stay put.
  const order = framesOf(d)
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => frameIds.includes(f.id))
    .reverse();
  for (const { f, i } of order) {
    const frame: Frame = {
      ...newFrame(),
      ...(f.background ? { background: f.background } : {}),
      items: f.items.flatMap((item) => {
        const id = byFrom.get(item.photoId);
        const meta = d.photos[item.photoId];
        if (!id || !meta) return [];
        d.photos[id] = { ...meta, id, name: copyName(meta.name) };
        return [{ ...item, photoId: id, z: d.nextZ++ }];
      }),
    };
    d.layout.frames.splice(i + 1, 0, frame);
    made.unshift(frame.id);
  }
  return made;
}

/** Duplicate frames, photos and all, as one undo step. */
export async function duplicateFrames(frameIds: readonly SpreadId[]): Promise<void> {
  const project = projectStore.project;
  const photoIds = framesOf(project)
    .filter((f) => frameIds.includes(f.id))
    .flatMap((f) => f.items.map((i) => i.photoId));
  const copies = copiesOf(photoIds);
  const images = await Promise.all(copies.map((c) => getImage(c.from)));
  copies.forEach((c, i) => {
    const img = images[i];
    if (img) setUrl(c.id, img.thumb);
  });
  // Referred to before their images are stored, so a cleanup can't remove them in between.
  projectStore.apply((d) => void copyFrames(d, frameIds, copies));
  for (const [i, c] of copies.entries()) {
    const img = images[i];
    if (img) await putImage(c.id, img);
  }
}
