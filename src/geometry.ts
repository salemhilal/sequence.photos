import type {
  BorderGuide,
  Edges,
  LayoutKind,
  LineGuide,
  PageSide,
  PhotoMeta,
  Sheet,
  Spread,
  SpreadKind,
} from './types';
import { UNITS } from './units';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Longest edge of a photo when it lands on the desk. */
export const PILE_PHOTO_SIZE = 2;

export function pageSides(kind: SpreadKind): PageSide[] {
  if (kind === 'frame') return ['whole'];
  if (kind === 'first') return ['right'];
  if (kind === 'last') return ['left'];
  return ['left', 'right'];
}

/** Page rectangle in spread coordinates: gutter-relative in print, from the left edge in a frame. */
export function pageRect(side: PageSide, s: Sheet): Rect {
  return { x: side === 'left' ? -s.pageW : 0, y: 0, w: s.pageW, h: s.pageH };
}

/** The page a point (or a photo's center) is on: a book's left or right page, or the frame. */
export function sideAt(s: Sheet, x: number): PageSide {
  if (s.layout === 'digital') return 'whole';
  return x < 0 ? 'left' : 'right';
}

/** The width of a spread's pages together: two pages, or one. */
export function spreadWidth(kind: SpreadKind, s: Sheet): number {
  return pageSides(kind).length * s.pageW;
}

/** Where a spread's pages start: the left page's outside edge, else the gutter (or a frame's left edge). */
export function spreadLeft(kind: SpreadKind, s: Sheet): number {
  return pageSides(kind)[0] === 'left' ? -s.pageW : 0;
}

/** Whether a page is laid out like a left page: outside at its left edge (a book's left pages, and frames). */
function outsideLeft(side: PageSide): boolean {
  return side !== 'right';
}

/** An edge's name: a frame has a left and right where a book page has an outside and inside. */
export function edgeLabel(edge: keyof Edges, layout: LayoutKind): string {
  if (layout === 'digital' && edge === 'outside') return 'Left';
  if (layout === 'digital' && edge === 'inside') return 'Right';
  return edge[0]!.toUpperCase() + edge.slice(1);
}

/** A border guide's distance from each edge, whichever kind it is. */
export function edgesOf(g: BorderGuide): Edges {
  if (g.kind === 'even') return { top: g.inset, bottom: g.inset, inside: g.inset, outside: g.inset };
  const { top, bottom, inside, outside } = g;
  return { top, bottom, inside, outside };
}

/** How far a border guide is from a page's left and right edges: outside and inside swap on left pages. */
function sideInsets(side: PageSide, e: Edges): { left: number; right: number } {
  return outsideLeft(side) ? { left: e.outside, right: e.inside } : { left: e.inside, right: e.outside };
}

/** A border guide's box on one page. */
export function borderBox(side: PageSide, s: Sheet, g: BorderGuide): Rect {
  const p = pageRect(side, s);
  const e = edgesOf(g);
  const { left, right } = sideInsets(side, e);
  return { x: p.x + left, y: e.top, w: Math.max(0.1, p.w - left - right), h: Math.max(0.1, p.h - e.top - e.bottom) };
}

/** The border guide photos fit inside when dropped on a page: the chosen one, or else the largest. */
export function dropGuide(s: Sheet): BorderGuide | null {
  const chosen = s.borders.find((g) => g.id === s.dropBorder);
  if (chosen) return chosen;
  const area = (g: BorderGuide) => {
    const e = edgesOf(g);
    return (s.pageW - e.inside - e.outside) * (s.pageH - e.top - e.bottom);
  };
  return s.borders.reduce<BorderGuide | null>((best, g) => (!best || area(g) > area(best) ? g : best), null);
}

/** Keeps a border guide's box on the page (after an edit, or when the page shrinks). */
export function clampBorder(g: BorderGuide, s: Pick<Sheet, 'layout' | 'pageW' | 'pageH'>): void {
  const min = UNITS[s.layout].minBox;
  if (g.kind === 'even') {
    g.inset = Math.max(0, Math.min(g.inset, (Math.min(s.pageW, s.pageH) - min) / 2));
    return;
  }
  g.top = Math.max(0, Math.min(g.top, s.pageH - g.bottom - min));
  g.bottom = Math.max(0, Math.min(g.bottom, s.pageH - g.top - min));
  g.inside = Math.max(0, Math.min(g.inside, s.pageW - g.outside - min));
  g.outside = Math.max(0, Math.min(g.outside, s.pageW - g.inside - min));
}

/** Where a photo dropped on a page is fitted: the drop guide's box, or the page. */
export function dropBox(side: PageSide, s: Sheet): Rect {
  const g = dropGuide(s);
  return g ? borderBox(side, s, g) : pageRect(side, s);
}

/** A line guide's position on a page, in spread coordinates: x for vertical guides, y for horizontal. */
export function linePosition(side: PageSide, s: Sheet, l: LineGuide): number {
  if (l.axis === 'horizontal') return l.at;
  const p = pageRect(side, s);
  return outsideLeft(side) ? p.x + l.at : p.x + p.w - l.at;
}

/** The inverse of linePosition: the `at` for a guide through `v` on a page. */
export function lineAt(side: PageSide, s: Sheet, axis: LineGuide['axis'], v: number): number {
  if (axis === 'horizontal') return v;
  const p = pageRect(side, s);
  return outsideLeft(side) ? v - p.x : p.x + p.w - v;
}

/** Whether a line guide falls on the page (it can end up off it when the page shrinks). */
export function lineOnPage(s: Sheet, l: LineGuide): boolean {
  return l.at > 0 && l.at < (l.axis === 'vertical' ? s.pageW : s.pageH);
}

/** Largest rect with the photo's aspect ratio that fits in `box`, centered in `center`. */
export function fitCentered(photo: Pick<PhotoMeta, 'pxW' | 'pxH'>, box: Rect, center: Rect = box): Rect {
  const aspect = photo.pxW / photo.pxH;
  let w = box.w;
  let h = w / aspect;
  if (h > box.h) {
    h = box.h;
    w = h * aspect;
  }
  return { x: center.x + (center.w - w) / 2, y: center.y + (center.h - h) / 2, w, h };
}

export function pileSize(photo: PhotoMeta): { w: number; h: number } {
  const aspect = photo.pxW / photo.pxH;
  return aspect >= 1
    ? { w: PILE_PHOTO_SIZE, h: PILE_PHOTO_SIZE / aspect }
    : { w: PILE_PHOTO_SIZE * aspect, h: PILE_PHOTO_SIZE };
}

export interface GuideLines {
  xs: number[];
  ys: number[];
}

/** Visible guides for a spread: center lines, border boxes, and line guides, per page. */
export function spreadGuides(spread: Spread, s: Sheet): GuideLines {
  const xs: number[] = [];
  const ys: number[] = [];
  const lines = s.lines.filter((l) => lineOnPage(s, l));
  for (const side of pageSides(spread.kind)) {
    const p = pageRect(side, s);
    if (s.centerV) xs.push(p.x + p.w / 2);
    for (const g of s.borders) {
      const { left, right } = sideInsets(side, edgesOf(g));
      xs.push(p.x + left, p.x + p.w - right);
    }
    for (const l of lines) if (l.axis === 'vertical') xs.push(linePosition(side, s, l));
  }
  if (s.centerH) ys.push(s.pageH / 2);
  for (const e of s.borders.map(edgesOf)) ys.push(e.top, s.pageH - e.bottom);
  for (const l of lines) if (l.axis === 'horizontal') ys.push(l.at);
  return { xs, ys };
}

/** Everything a photo can snap to: guides plus page edges (including the gutter). */
export function snapLines(spread: Spread, s: Sheet): GuideLines {
  const g = spreadGuides(spread, s);
  const xs = [...g.xs];
  for (const side of pageSides(spread.kind)) {
    const p = pageRect(side, s);
    xs.push(p.x, p.x + p.w);
  }
  return { xs: unique(xs), ys: unique([...g.ys, 0, s.pageH]) };
}

function unique(v: number[]): number[] {
  return [...new Set(v.map((n) => Math.round(n * 1e6) / 1e6))];
}

interface SnapResult {
  delta: number;
  line: number | null;
}

/** Find the smallest adjustment that lands one of `points` on one of `lines`. */
export function snapPoints(points: number[], lines: number[], threshold: number): SnapResult {
  let best: SnapResult = { delta: 0, line: null };
  let bestDist = threshold;
  for (const p of points) {
    for (const l of lines) {
      const d = Math.abs(l - p);
      if (d <= bestDist) {
        bestDist = d;
        best = { delta: l - p, line: l };
      }
    }
  }
  return best;
}

export interface SnapFeedback {
  xs: number[];
  ys: number[];
}

/** Snap a moving rect's edges and center to guides. */
export function snapMove(r: Rect, lines: GuideLines, threshold: number): { rect: Rect; hit: SnapFeedback } {
  const sx = snapPoints([r.x, r.x + r.w / 2, r.x + r.w], lines.xs, threshold);
  const sy = snapPoints([r.y, r.y + r.h / 2, r.y + r.h], lines.ys, threshold);
  return {
    rect: { ...r, x: r.x + sx.delta, y: r.y + sy.delta },
    hit: { xs: sx.line === null ? [] : [sx.line], ys: sy.line === null ? [] : [sy.line] },
  };
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * Resize `start` by dragging `corner` by (dx, dy), anchored at the opposite corner.
 * With `lockAspect`, the aspect ratio of `start` is preserved.
 */
export function resizeRect(
  start: Rect,
  corner: Corner,
  dx: number,
  dy: number,
  lockAspect: boolean,
  lines: GuideLines | null,
  threshold: number,
  /** The smallest a side gets: 0.1 in, or 10 px in a frame (see UNITS). */
  min = 0.1,
): { rect: Rect; hit: SnapFeedback } {
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  const ax = west ? start.x + start.w : start.x;
  const ay = north ? start.y + start.h : start.y;
  let mx = (west ? start.x : start.x + start.w) + dx;
  let my = (north ? start.y : start.y + start.h) + dy;
  const hit: SnapFeedback = { xs: [], ys: [] };
  const aspect = start.w / start.h;

  const sx = lines ? snapPoints([mx], lines.xs, threshold) : { delta: 0, line: null };
  const sy = lines ? snapPoints([my], lines.ys, threshold) : { delta: 0, line: null };

  if (!lockAspect) {
    mx += sx.delta;
    my += sy.delta;
    if (sx.line !== null) hit.xs.push(sx.line);
    if (sy.line !== null) hit.ys.push(sy.line);
  } else {
    // Size follows whichever axis the pointer moved further along, or the axis that snapped.
    let w = Math.abs(mx - ax);
    let h = Math.abs(my - ay);
    const useX =
      sx.line !== null && (sy.line === null || Math.abs(sx.delta) <= Math.abs(sy.delta))
        ? true
        : sy.line !== null
          ? false
          : w / aspect >= h;
    if (useX) {
      if (sx.line !== null) {
        mx += sx.delta;
        hit.xs.push(sx.line);
      }
      w = Math.max(min, Math.abs(mx - ax));
      h = w / aspect;
    } else {
      if (sy.line !== null) {
        my += sy.delta;
        hit.ys.push(sy.line);
      }
      h = Math.max(min, Math.abs(my - ay));
      w = h * aspect;
    }
    mx = west ? ax - w : ax + w;
    my = north ? ay - h : ay + h;
  }

  const x1 = Math.min(ax, mx);
  const y1 = Math.min(ay, my);
  return {
    rect: {
      x: x1,
      y: y1,
      w: Math.max(min, Math.abs(mx - ax)),
      h: Math.max(min, Math.abs(my - ay)),
    },
    hit,
  };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Inches for display: to the hundredth, but eighths exactly (2.875, not 2.88). */
export function fmt(n: number): string {
  const eighths = Math.abs(n * 8 - Math.round(n * 8)) < 1e-9;
  return (eighths ? Math.round(n * 1000) / 1000 : Math.round(n * 100) / 100).toString();
}

type Knots = [old: number, next: number][];

/**
 * Guide positions along one axis of one page, paired old → new: its edges and center
 * always, then each guide (inches from the page's start or end), kept only if it's on
 * the page at both sizes and in the same order among the others.
 */
function pageKnots(
  knots: Knots,
  o0: number,
  n0: number,
  oldSize: number,
  newSize: number,
  fromStart: number[],
  fromEnd: number[],
): void {
  const candidates: Knots = [
    ...fromStart.map((d): [number, number] => [o0 + d, n0 + d]),
    ...fromEnd.map((d): [number, number] => [o0 + oldSize - d, n0 + newSize - d]),
  ];
  knots.push([o0, n0], [o0 + oldSize / 2, n0 + newSize / 2], [o0 + oldSize, n0 + newSize]);
  for (const k of candidates) {
    const onPage = k[0] > o0 && k[0] < o0 + oldSize && k[1] > n0 && k[1] < n0 + newSize;
    if (onPage && knots.every(([o, n]) => (k[0] - o) * (k[1] - n) > 1e-12)) knots.push(k);
  }
}

function sorted(knots: Knots): Knots {
  knots.sort((a, b) => a[0] - b[0]);
  return knots.filter((k, i) => i === 0 || k[0] - (knots[i - 1]?.[0] ?? -Infinity) > 1e-9);
}

/**
 * Piecewise-linear map through the knots. Guides land on guides; space between
 * them stretches proportionally. Beyond the outer page edges, offsets are kept.
 */
function mapAxis(v: number, knots: Knots): number {
  const first = knots[0];
  const last = knots[knots.length - 1];
  if (!first || !last) return v;
  if (v <= first[0]) return first[1] + (v - first[0]);
  if (v >= last[0]) return last[1] + (v - last[0]);
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1];
    const b = knots[i];
    if (!a || !b || v > b[0]) continue;
    const t = (v - a[0]) / (b[0] - a[0]);
    return a[1] + t * (b[1] - a[1]);
  }
  return v;
}

/**
 * Move a spread item (gutter-relative coordinates) so it keeps its relationship to the
 * page's guides after a page-size change. Its edges are mapped through the guides, and
 * the photo is refit into that box, keeping its proportions, around the box's center.
 */
export function relayoutRect(r: Rect, from: Sheet, to: Sheet): Rect {
  const b = from.borders.map(edgesOf);
  const vertical = from.lines.filter((l) => l.axis === 'vertical').map((l) => l.at);
  const horizontal = from.lines.filter((l) => l.axis === 'horizontal').map((l) => l.at);
  const outside = [...b.map((g) => g.outside), ...vertical];
  const inside = b.map((g) => g.inside);
  // Left page (and a frame): outside at its start. Right page: inside at its start.
  const xs: Knots = [];
  if (from.layout === 'digital') {
    pageKnots(xs, 0, 0, from.pageW, to.pageW, outside, inside);
  } else {
    pageKnots(xs, -from.pageW, -to.pageW, from.pageW, to.pageW, outside, inside);
    pageKnots(xs, 0, 0, from.pageW, to.pageW, inside, outside);
  }
  const ys: Knots = [];
  pageKnots(
    ys,
    0,
    0,
    from.pageH,
    to.pageH,
    [...b.map((g) => g.top), ...horizontal],
    b.map((g) => g.bottom),
  );
  return refit(r, sorted(xs), sorted(ys));
}

function refit(r: Rect, xs: Knots, ys: Knots): Rect {
  const x1 = mapAxis(r.x, xs);
  const x2 = mapAxis(r.x + r.w, xs);
  const y1 = mapAxis(r.y, ys);
  const y2 = mapAxis(r.y + r.h, ys);
  const boxW = Math.max(0.1, x2 - x1);
  const boxH = Math.max(0.1, y2 - y1);
  const aspect = r.w / r.h;
  const w = Math.min(boxW, boxH * aspect);
  const h = w / aspect;
  return { x: (x1 + x2) / 2 - w / 2, y: (y1 + y2) / 2 - h / 2, w, h };
}
