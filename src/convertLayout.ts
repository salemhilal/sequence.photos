import { clampBorder, pageRect, pageSides, relayoutRect, sideAt } from './geometry';
import { newSpreadId } from './ids';
import { allSpreads, hasFrames, sheetOf } from './spreads';
import type {
  BorderGuide,
  Frame,
  LastSpread,
  LayoutKind,
  LineGuide,
  MiddleSpread,
  Placement,
  Project,
  Sheet,
} from './types';
import { UNITS } from './units';

/**
 * Turning a print book into a digital sequence, and back.
 *
 * Print → digital: each page becomes a frame, in book order (a book's single first and last
 * pages become one frame each, a spread two). Each photo goes to the page holding its
 * center, and may hang off that frame's edge.
 *
 * Digital → print: the first frame becomes the first (right-hand) page, the rest pair up
 * into spreads, and one left over becomes the last (left-hand) page. A book turned into a
 * sequence and back comes back with the same spreads.
 *
 * Sizes change units (inches ↔ pixels) in proportion to the page's width: a 0.5 in margin
 * on a 10 in page becomes 54 px on a 1080 px frame. Then the pages take the other kind's
 * remembered size, with photos moving as they do when the page size changes.
 */
export function convertLayout(project: Project, kind: LayoutKind): Project {
  if (project.layout.kind === kind) return project;
  const from = sheetOf(project);
  const size = project.settings.sizes[kind];
  const units = UNITS[kind];
  // Inches to pixels or back, measured against the page's width.
  const k = size.w / from.pageW;
  const scaled = (n: number) => units.round(n * k);

  const borders: BorderGuide[] = from.borders.map((g) =>
    g.kind === 'even'
      ? { ...g, inset: scaled(g.inset) }
      : { ...g, top: scaled(g.top), bottom: scaled(g.bottom), inside: scaled(g.inside), outside: scaled(g.outside) },
  );
  const lines: LineGuide[] = from.lines.map((l) => ({ ...l, at: scaled(l.at) }));
  // The pages as they are, in the new units, before they take the new size.
  const converted: Sheet = { ...from, layout: kind, pageW: from.pageW * k, pageH: from.pageH * k, borders, lines };
  const target: Sheet = { ...converted, pageW: size.w, pageH: size.h };
  /**
   * A page's photos onto their new page: measured from the old page's left edge (`shift`
   * is where that edge is), in the new units, placed on the new layout's page (a book's left
   * page sits left of the gutter), then moved with the guides to the new size.
   */
  const fit = (items: Placement[], shift: number, toLeftPage: boolean): Placement[] =>
    items.map((p) => {
      const r = { x: (p.x - shift) * k - (toLeftPage ? converted.pageW : 0), y: p.y * k, w: p.w * k, h: p.h * k };
      return { ...p, ...(target.keepRelative ? relayoutRect(r, converted, target) : r) };
    });

  const settings = {
    ...project.settings,
    borders: borders.map((g) => {
      const b = { ...g };
      clampBorder(b, target);
      return b;
    }),
    lines,
    sizes: { ...project.settings.sizes, [from.layout]: { w: from.pageW, h: from.pageH } },
  };

  if (kind === 'digital') {
    const pages: { id: Frame['id']; items: Placement[] }[] = [];
    for (const spread of allSpreads(project)) {
      const sides = pageSides(spread.kind);
      for (const [i, side] of sides.entries()) {
        const mine = spread.items.filter((p) => {
          const at = sideAt(from, p.x + p.w / 2);
          // A single page takes all of its spread's photos.
          return sides.length === 1 || at === side;
        });
        const shift = side === 'left' ? pageRect('left', from).x : 0;
        pages.push({ id: i === 0 ? spread.id : newSpreadId(), items: fit(mine, shift, false) });
      }
    }
    const frames = pages.map((p): Frame => ({ kind: 'frame', id: p.id, items: p.items }));
    // A book always has at least its first and last pages.
    if (!hasFrames(frames)) return project;
    return { ...project, layout: { kind: 'digital', frame: { ...size }, frames }, settings };
  }

  // Digital → print: frame 1 is the first page; the rest pair up; one left over is the last page.
  if (project.layout.kind !== 'digital') return project;
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
      kind: 'print',
      page: { ...size },
      firstSpread: { kind: 'first', id: firstFrame.id, items: fit(firstFrame.items, 0, false) },
      spreads,
      lastSpread,
    },
    settings,
  };
}
