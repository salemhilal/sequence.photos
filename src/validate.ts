import { cleanCrop } from './crop';
import { toGuideId, toPhotoId, toSpreadId, type PhotoId } from './ids';
import {
  CURRENT_SCHEMA,
  type BorderGuide,
  type Crop,
  type ExportState,
  type Project,
  type Layout,
  type LineGuide,
  type PageSetup,
  type PhotoMeta,
  type Placement,
  type Settings,
  type SpreadKind,
} from './types';
import { hasFrames } from './spreads';
import { isRecord } from './guards';

/**
 * Checking a whole project before the app uses it. Projects come from outside the code's
 * control (a file someone opened, or what the browser kept), so this is where their shape
 * is established: every field of the right type and in range, every id unique, every
 * placement's photo real, and each photo in one place at most. Past here, a Project is a Project.
 *
 * It builds the Project as it goes, so what comes out holds only what was checked.
 */

export class InvalidProjectError extends Error {
  constructor(where: string) {
    super(`Damaged project (${where})`);
  }
}

type Raw = Record<string, unknown>;

function fail(where: string): never {
  throw new InvalidProjectError(where);
}

function record(v: unknown, where: string): Raw {
  return isRecord(v) ? v : fail(where);
}

function list(v: unknown, where: string): unknown[] {
  return Array.isArray(v) ? v : fail(where);
}

function text(v: unknown, where: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fail(where);
}

function num(v: unknown, where: string, { min = -Infinity, above = false } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(where);
  return (above ? v > min : v >= min) ? v : fail(where);
}

function bool(v: unknown, where: string): boolean {
  return typeof v === 'boolean' ? v : fail(where);
}

/** Fails on a repeated id, so each one names exactly one thing. */
function unique<T extends string>(seen: Set<string>, id: T, where: string): T {
  if (seen.has(id)) fail(`${where}: repeated id`);
  seen.add(id);
  return id;
}

/**
 * A photo's crop, kept inside the photo; a damaged one is left out (the whole photo shows,
 * in its frame's shape) rather than refusing the project.
 */
function cropOf(v: unknown): { crop?: Crop } {
  if (!isRecord(v)) return {};
  const { x, y, w, h } = v;
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return {};
  const crop = cleanCrop({ x: x as number, y: y as number, w: w as number, h: h as number });
  return crop ? { crop } : {};
}

function photo(v: unknown, key: string, where: string): PhotoMeta {
  const p = record(v, where);
  const id = toPhotoId(text(p.id, `${where}.id`));
  if (id !== key) fail(`${where}.id`);
  return {
    id,
    name: typeof p.name === 'string' ? p.name : fail(`${where}.name`),
    pxW: num(p.pxW, `${where}.pxW`, { min: 0, above: true }),
    pxH: num(p.pxH, `${where}.pxH`, { min: 0, above: true }),
    ...cropOf(p.crop),
  };
}

function placement(v: unknown, placed: Set<string>, photos: Record<PhotoId, PhotoMeta>, where: string): Placement {
  const p = record(v, where);
  const photoId = toPhotoId(text(p.photoId, `${where}.photoId`));
  if (!photos[photoId]) fail(`${where}.photoId: no such photo`);
  // One place per photo: the desk, or one spread, once.
  unique(placed, photoId, `${where}.photoId`);
  return {
    photoId,
    x: num(p.x, `${where}.x`),
    y: num(p.y, `${where}.y`),
    w: num(p.w, `${where}.w`, { min: 0, above: true }),
    h: num(p.h, `${where}.h`, { min: 0, above: true }),
    z: num(p.z, `${where}.z`),
  };
}

function spread<K extends SpreadKind>(
  v: unknown,
  kind: K,
  ids: Set<string>,
  items: (v: unknown, where: string) => Placement,
  where: string,
): { kind: K; id: ReturnType<typeof toSpreadId>; items: Placement[] } {
  const s = record(v, where);
  if (s.kind !== kind) fail(`${where}.kind`);
  return {
    kind,
    id: unique(ids, toSpreadId(text(s.id, `${where}.id`)), `${where}.id`),
    items: list(s.items, `${where}.items`).map((p, i) => items(p, `${where}.items[${i}]`)),
  };
}

function border(v: unknown, ids: Set<string>, where: string): BorderGuide {
  const g = record(v, where);
  const id = unique(ids, toGuideId(text(g.id, `${where}.id`)), `${where}.id`);
  const d = (k: string) => num(g[k], `${where}.${k}`, { min: 0 });
  if (g.kind === 'even') return { id, kind: 'even', inset: d('inset') };
  if (g.kind === 'edges')
    return { id, kind: 'edges', top: d('top'), bottom: d('bottom'), inside: d('inside'), outside: d('outside') };
  return fail(`${where}.kind`);
}

function line(v: unknown, ids: Set<string>, where: string): LineGuide {
  const g = record(v, where);
  const id = unique(ids, toGuideId(text(g.id, `${where}.id`)), `${where}.id`);
  if (g.axis !== 'vertical' && g.axis !== 'horizontal') fail(`${where}.axis`);
  return { id, axis: g.axis, at: num(g.at, `${where}.at`) };
}

function settings(v: unknown, where: string): Settings {
  const s = record(v, where);
  const guideIds = new Set<string>();
  const borders = list(s.borders, `${where}.borders`).map((g, i) => border(g, guideIds, `${where}.borders[${i}]`));
  const lines = list(s.lines, `${where}.lines`).map((g, i) => line(g, guideIds, `${where}.lines[${i}]`));
  // A drop guide that's gone isn't damage: it means the largest (see dropGuide).
  const dropBorder = s.dropBorder === null ? null : toGuideId(text(s.dropBorder, `${where}.dropBorder`));
  return {
    centerV: bool(s.centerV, `${where}.centerV`),
    centerH: bool(s.centerH, `${where}.centerH`),
    keepRelative: bool(s.keepRelative, `${where}.keepRelative`),
    borders,
    lines,
    dropBorder,
  };
}

/** The page: a size above zero, a known unit, and a resolution above zero. */
function page(v: unknown, where: string): PageSetup {
  const p = record(v, where);
  if (p.unit !== 'in' && p.unit !== 'px') fail(`${where}.unit`);
  return {
    w: num(p.w, `${where}.w`, { min: 0, above: true }),
    h: num(p.h, `${where}.h`, { min: 0, above: true }),
    unit: p.unit,
    pxPerUnit: num(p.pxPerUnit, `${where}.pxPerUnit`, { min: 0, above: true }),
  };
}

/** The layout: a book's spreads, each in its place, or a sequence's frames (at least one). */
function layout(v: unknown, item: (p: unknown, where: string) => Placement): Layout {
  const l = record(v, 'layout');
  const ids = new Set<string>();
  if (l.kind === 'spreads') {
    return {
      kind: 'spreads',
      firstSpread: spread(l.firstSpread, 'first', ids, item, 'layout.firstSpread'),
      spreads: list(l.spreads, 'layout.spreads').map((s, i) => spread(s, 'middle', ids, item, `layout.spreads[${i}]`)),
      lastSpread: spread(l.lastSpread, 'last', ids, item, 'layout.lastSpread'),
    };
  }
  if (l.kind === 'frames') {
    const frames = list(l.frames, 'layout.frames').map((s, i) => spread(s, 'frame', ids, item, `layout.frames[${i}]`));
    if (!hasFrames(frames)) fail('layout.frames: none');
    return { kind: 'frames', frames };
  }
  return fail('layout.kind');
}

/** A value if it's one of `options`, else undefined. */
function oneOf<T extends string>(v: unknown, options: readonly T[]): T | undefined {
  return options.find((o) => o === v);
}

/** A finite number in [min, max], else undefined. */
function within(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

/** Room for a caption Instagram would take, with some to spare. */
const MAX_CAPTION = 10_000;
const MAX_CHOSEN = 1_000;
const TAGGED_USERNAME = /^[a-z0-9._]{1,30}$/;

/**
 * The Export choices, checked leniently: they only save retyping, so any that's damaged
 * is left out (the app's default takes its place) rather than refusing the whole project.
 */
function exportState(v: unknown): ExportState | undefined {
  if (!isRecord(v)) return undefined;
  const state: ExportState = {};
  const to = oneOf(v.to, ['pdf', 'images', 'indesign', 'instagram'] as const);
  if (to) state.to = to;

  if (isRecord(v.options)) {
    const o = v.options;
    const per = oneOf(o.per, ['spread', 'page'] as const);
    const format = oneOf(o.format, ['jpeg', 'png'] as const);
    const quality = within(o.quality, 0, 1);
    const printAt = within(o.printAt, 1, 10_000);
    state.options = {
      ...(per && { per }),
      ...(format && { format }),
      ...(quality !== undefined && { quality }),
      ...(printAt !== undefined && { printAt }),
    };
  }

  if (isRecord(v.instagram)) {
    const ig = v.instagram;
    const kind = oneOf(ig.kind, ['feed', 'story'] as const);
    const fit = oneOf(ig.fit, ['crop', 'expand'] as const);
    const caption = typeof ig.caption === 'string' ? ig.caption.slice(0, MAX_CAPTION) : undefined;
    const chosen = Array.isArray(ig.chosen)
      ? ig.chosen.filter((k): k is string => typeof k === 'string').slice(0, MAX_CHOSEN)
      : undefined;
    const tags: Record<string, { username: string; x: number; y: number }[]> = {};
    if (isRecord(ig.tags)) {
      for (const [key, list] of Object.entries(ig.tags)) {
        if (key === '__proto__' || !Array.isArray(list)) continue;
        const kept = list.flatMap((t) => {
          if (!isRecord(t) || typeof t.username !== 'string' || !TAGGED_USERNAME.test(t.username)) return [];
          const x = within(t.x, 0, 1);
          const y = within(t.y, 0, 1);
          return x === undefined || y === undefined ? [] : [{ username: t.username, x, y }];
        });
        if (kept.length) tags[key] = kept.slice(0, 20);
      }
    }
    state.instagram = {
      ...(kind && { kind }),
      ...(fit && { fit }),
      ...(caption !== undefined && { caption }),
      ...(chosen && { chosen }),
      ...(Object.keys(tags).length && { tags }),
    };
  }
  return state;
}

const withExport = (state: ExportState | undefined) => (state ? { export: state } : {});

/** The project, checked; throws InvalidProjectError, naming the first problem, if it's damaged. */
export function validateProject(v: unknown): Project {
  const d = record(v, 'project');
  if (d.schemaVersion !== CURRENT_SCHEMA) fail('schemaVersion');

  const photos: Record<PhotoId, PhotoMeta> = {};
  for (const [key, p] of Object.entries(record(d.photos, 'photos'))) {
    // As a key, it would set the table's prototype rather than file a photo.
    if (key === '__proto__') fail('photos.__proto__');
    photos[toPhotoId(key)] = photo(p, key, `photos.${key}`);
  }

  const placed = new Set<string>();
  const item = (p: unknown, where: string) => placement(p, placed, photos, where);
  const pile = list(d.pile, 'pile').map((p, i) => item(p, `pile[${i}]`));
  const book = layout(d.layout, item);

  // New placements go on top: nextZ stays above every z (repaired if it isn't).
  const spreads = book.kind === 'spreads' ? [book.firstSpread, ...book.spreads, book.lastSpread] : book.frames;
  const zs = [...pile, ...spreads.flatMap((s) => s.items)].map((p) => p.z);
  const nextZ = Math.max(num(d.nextZ, 'nextZ'), ...zs.map((z) => z + 1));

  return {
    schemaVersion: CURRENT_SCHEMA,
    photos,
    pile,
    page: page(d.page, 'page'),
    layout: book,
    settings: settings(d.settings, 'settings'),
    nextZ,
    ...withExport(exportState(d.export)),
  };
}
