import { beforeEach, describe, expect, it } from 'vitest';
import { addPhotosToPile, putOnPage } from './actions';
import { setPageSize } from './pageSize';
import { newGuideId, toPhotoId } from './ids';
import { allSpreads, sheetOf } from './spreads';
import { projectStore, emptyProject } from './store';

const P = toPhotoId('p');
/** Change one of the page's dimensions, as Settings' Apply does. */
function resize(dim: 'w' | 'h', n: number): void {
  const s = sheetOf(projectStore.project);
  setPageSize({ w: s.pageW, h: s.pageH, [dim]: n });
}
const placed = () => allSpreads(projectStore.project)[1]!.items[0]!;

beforeEach(() => {
  projectStore.reset(emptyProject());
  addPhotosToPile([{ id: P, name: 'p.jpg', pxW: 1500, pxH: 1000 }]);
  projectStore.apply((d) => putOnPage(d, [P], allSpreads(d)[1]!.id, 'right'));
});

describe('setPageSize', () => {
  it('puts photos back exactly when a size goes back', () => {
    const before = { ...placed() };
    resize('w', 8);
    expect(placed()).not.toEqual(before);
    resize('w', 10);
    expect(placed()).toEqual(before);
  });

  it('gives the same layout whatever order the edits come in', () => {
    const before = { ...placed() };
    resize('w', 7);
    resize('h', 6);
    resize('w', 10);
    resize('h', 8);
    expect(placed()).toEqual(before);
  });

  it('keeps border guides on a page that shrinks, and restores them when it grows back', () => {
    const id = newGuideId();
    projectStore.apply((d) => void d.settings.borders.push({ id, kind: 'even', inset: 3 }));
    resize('h', 4);
    const shrunk = projectStore.project.settings.borders.find((b) => b.id === id)!;
    expect(shrunk.kind === 'even' && shrunk.inset).toBeLessThan(2);
    resize('h', 8);
    expect(projectStore.project.settings.borders.find((b) => b.id === id)).toEqual({ id, kind: 'even', inset: 3 });
  });

  it('is one undo step per edit', () => {
    const before = projectStore.project;
    resize('w', 8);
    projectStore.undo();
    expect(projectStore.project).toBe(before);
  });

  it('starts over from the current layout after any other change', () => {
    resize('w', 8);
    projectStore.apply((d) => void (allSpreads(d)[1]!.items[0]!.x += 0.5));
    const moved = { ...placed() };
    resize('w', 8.5);
    resize('w', 8);
    expect(placed()).toEqual(moved);
  });
});
