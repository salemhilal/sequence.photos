import type { Draft } from 'immer';
import type { SpreadId } from './ids';
import type { Frame, Project, Sheet, Spread } from './types';

/**
 * Reading a project's layout. A book keeps its first, middle, and last spreads apart (so
 * each stays in its place), and a sequence keeps frames; these read either as one
 * run of spreads, in order. Indexes elsewhere (labels, the sidebar, the editor's back and
 * forth) count through this order.
 */

/** Every spread (or frame), first to last. */
export function allSpreads(d: Project): Spread[];
export function allSpreads(d: Draft<Project>): Draft<Spread>[];
export function allSpreads(d: Project | Draft<Project>): (Spread | Draft<Spread>)[];
export function allSpreads(d: Project | Draft<Project>): (Spread | Draft<Spread>)[] {
  const l = d.layout;
  return l.kind === 'spreads' ? [l.firstSpread, ...l.spreads, l.lastSpread] : [...l.frames];
}

export function findSpread(d: Project, id: SpreadId): Spread | undefined;
export function findSpread(d: Draft<Project>, id: SpreadId): Draft<Spread> | undefined;
export function findSpread(d: Project | Draft<Project>, id: SpreadId): Spread | Draft<Spread> | undefined {
  return allSpreads(d).find((s) => s.id === id);
}

/** The page or frame photos are laid out on, with its size and guides (see Sheet). */
export function sheetOf(p: Project | Draft<Project>): Sheet {
  const s = p.settings;
  return {
    arrangement: p.layout.kind,
    unit: p.page.unit,
    pxPerUnit: p.page.pxPerUnit,
    pageW: p.page.w,
    pageH: p.page.h,
    centerV: s.centerV,
    centerH: s.centerH,
    keepRelative: s.keepRelative,
    borders: s.borders,
    lines: s.lines,
    dropBorder: s.dropBorder,
  };
}

/**
 * Where a spread inserted before book position `index` goes among a book's middle
 * spreads: never before the first spread or after the last.
 */
export function middleIndex(spreads: readonly unknown[], index: number): number {
  return Math.min(Math.max(0, index - 1), spreads.length);
}

/** Where a frame inserted before position `index` goes: within the sequence. */
export function frameIndex(frames: readonly unknown[], index: number): number {
  return Math.min(Math.max(0, index), frames.length);
}

/** Whether a list of frames has at least one, as a frames layout needs. */
export function hasFrames(frames: Frame[]): frames is [Frame, ...Frame[]] {
  return frames.length > 0;
}
