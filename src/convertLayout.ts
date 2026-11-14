import { clampBorder, pageRect, pageSides, relayoutRect, sideAt } from './geometry';
import { newSpreadId } from './ids';
import { allSpreads, hasFrames, mapItems, sheetOf } from './spreads';
import type {
  Arrangement,
  BorderGuide,
  Frame,
  LastSpread,
  PageSide,
  MiddleSpread,
  PageSetup,
  Placement,
  Project,
  Sheet,
  Size,
  Unit,
} from './types';

/**
 * Changing a project's page: its arrangement, its unit, and its size. Each is a pure step;
 * pageSetup.ts runs them in turn for the Layout view's Apply.
 */

/**
 * Re-paginate, keeping the page size and unit.
 *
 * Spreads → frames: each page becomes a frame, in book order (a book's single first and
 * last pages become one frame each, a spread two). Each photo goes to the page holding its
 * center, and may hang off that frame's edge.
 *
 * Frames → spreads: the first frame becomes the first (right-hand) page, the rest pair up
 * into spreads, and one left over becomes the last (left-hand) page. A book turned into
 * frames and back comes back with the same spreads.
 */
export function rearrange(project: Project, arrangement: Arrangement): Project {
  if (project.layout.kind === arrangement) return project;
  const from = sheetOf(project);
  /**
   * A page's photos onto their new page: measured from the old page's left edge (`shift`
   * is where that edge is), placed on the new layout's page (a book's left page sits left
   * of the gutter).
   */
  const fit = (items: Placement[], shift: number, toLeftPage: boolean): Placement[] =>
    items.map((p) => ({ ...p, x: p.x - shift - (toLeftPage ? from.pageW : 0) }));

  if (arrangement === 'frames') {
    const pages: { id: Frame['id']; items: Placement[]; background?: Frame['background'] }[] = [];
    for (const spread of allSpreads(project)) {
      const sides = pageSides(spread.kind);
      for (const [i, side] of sides.entries()) {
        const mine = spread.items.filter((p) => {
          const at = sideAt(from, p.x + p.w / 2);
          // A single page takes all of its spread's photos.
          return sides.length === 1 || at === side;
        });
        const shift = side === 'left' ? pageRect('left', from).x : 0;
        pages.push({
          id: i === 0 ? spread.id : newSpreadId(),
          items: fit(mine, shift, false),
          ...(spread.background ? { background: spread.background } : {}),
        });
      }
    }
    const frames = pages.map((p): Frame => ({ kind: 'frame', ...p }));
    // A book always has at least its first and last pages.
    if (!hasFrames(frames)) return project;
    return { ...project, layout: { kind: 'frames', frames } };
  }

  // Frames → spreads: frame 1 is the first page; the rest pair up; one left over is the last page.
  if (project.layout.kind !== 'frames') return project;
  const [firstFrame, ...others] = project.layout.frames;
  const spreads: MiddleSpread[] = [];
  let lastSpread: LastSpread = { kind: 'last', id: newSpreadId(), items: [] };
  for (let i = 0; i < others.length; i += 2) {
    const left = others[i]!;
    const right = others[i + 1];
    if (!right) {
      lastSpread = { kind: 'last', id: left.id, items: fit(left.items, 0, true) };
      break;
    }
    spreads.push({ kind: 'middle', id: left.id, items: [...fit(left.items, 0, true), ...fit(right.items, 0, false)] });
  }
  return {
    ...project,
    layout: {
      kind: 'spreads',
      firstSpread: { kind: 'first', id: firstFrame.id, items: fit(firstFrame.items, 0, false) },
      spreads,
      lastSpread,
    },
  };
}

/**
 * Every stored size and position on the pages (the page, its photos, and its guides)
 * multiplied by `f`, now in `unit`. The desk isn't touched: it's always inches.
 */
export function scaleProject(project: Project, f: number, unit: Unit, pxPerUnit: number): Project {
  const s = project.settings;
  const borders = s.borders.map((g): BorderGuide =>
    g.kind === 'even'
      ? { ...g, inset: g.inset * f }
      : { ...g, top: g.top * f, bottom: g.bottom * f, inside: g.inside * f, outside: g.outside * f },
  );
  const scaled = (items: Placement[]) =>
    items.map((p) => ({
      ...p,
      x: p.x * f,
      y: p.y * f,
      w: p.w * f,
      h: p.h * f,
      ...(p.border ? { border: { ...p.border, width: p.border.width * f } } : {}),
    }));
  const page: PageSetup = { w: project.page.w * f, h: project.page.h * f, unit, pxPerUnit };
  return {
    ...project,
    page,
    layout: mapItems(project.layout, scaled),
    settings: { ...s, borders, lines: s.lines.map((g) => ({ ...g, at: g.at * f })) },
  };
}

/**
 * Store the project in another unit, at the same physical size: everything multiplied by
 * the dpi (inches → pixels) or divided by it (pixels → inches). Not rounded, so a round trip
 * comes back. The page's pxPerUnit becomes `dpi` for inches, 1 for pixels.
 */
export function convertUnits(project: Project, unit: Unit, dpi: number): Project {
  if (project.page.unit === unit) return project;
  return unit === 'px' ? scaleProject(project, dpi, 'px', 1) : scaleProject(project, 1 / dpi, 'in', dpi);
}

/**
 * What photos kept fixed on a resized page stay put relative to: each page's top-left
 * corner, its center, or (spreads) its inside edge, at the gutter.
 */
export type Anchor = 'top-left' | 'center' | 'inside';

/**
 * How far a photo kept fixed moves when its page changes size by (dw, dh): with the
 * point it's anchored to. A left page grows leftward from the gutter.
 */
export function anchorShift(anchor: Anchor, side: PageSide, dw: number, dh: number): { dx: number; dy: number } {
  if (anchor === 'center') return { dx: side === 'left' ? -dw / 2 : dw / 2, dy: dh / 2 };
  // The top-left corner moves only on a left page (it's at the outside edge); the inside edge stays at the gutter.
  if (anchor === 'top-left' && side === 'left') return { dx: -dw, dy: 0 };
  return { dx: 0, dy: 0 };
}

/**
 * The page at a new size: border guides stay on the page, and photos keep their place
 * relative to the guides (`relative`) or stay fixed relative to `anchor`.
 */
export function resizePage(project: Project, size: Size, relative: boolean, anchor: Anchor = 'inside'): Project {
  const from = sheetOf(project);
  if (from.pageW === size.w && from.pageH === size.h) return project;
  const to: Sheet = { ...from, pageW: size.w, pageH: size.h };
  const borders = from.borders.map((b) => {
    const g = { ...b };
    clampBorder(g, to);
    return g;
  });
  const dw = size.w - from.pageW;
  const dh = size.h - from.pageH;
  const fixed = (p: Placement): Placement => {
    const { dx, dy } = anchorShift(anchor, sideAt(from, p.x + p.w / 2), dw, dh);
    return { ...p, x: p.x + dx, y: p.y + dy };
  };
  const moved = (items: Placement[]) =>
    items.map((p) => (relative ? { ...p, ...relayoutRect(p, from, to) } : fixed(p)));
  return {
    ...project,
    page: { ...project.page, w: size.w, h: size.h },
    layout: mapItems(project.layout, moved),
    settings: { ...project.settings, borders },
  };
}
