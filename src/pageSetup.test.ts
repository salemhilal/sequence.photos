import { beforeEach, describe, expect, it } from 'vitest';
import { addPhotosToPile, putOnPage } from './actions';
import {
  applyPageSetup,
  draftOf,
  draftWithDpi,
  draftWithUnit,
  pageSetupBase,
  presetOf,
  printsAt,
  previewPageSetup,
  resizes,
  withPageSetup,
  withPreset,
  type PageDraft,
} from './pageSetup';
import { newGuideId, toPhotoId } from './ids';
import { allSpreads } from './spreads';
import { projectStore, emptyProject } from './store';

const P = toPhotoId('p');
/** Change one of the page's dimensions, as Layout's Apply does. */
function resize(dim: 'w' | 'h', n: number): void {
  const d = draftOf(projectStore.project);
  applyPageSetup({ ...d, page: { ...d.page, [dim]: n } });
}
/** The current draft, changed. */
const draft = (change: Omit<Partial<PageDraft>, 'page'> & { page?: Partial<PageDraft['page']> } = {}): PageDraft => {
  const d = draftOf(projectStore.project);
  return { ...d, ...change, page: { ...d.page, ...change.page } };
};
const INSTAGRAM = { w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 } as const;
const placed = () => allSpreads(projectStore.project)[1]!.items[0]!;

beforeEach(() => {
  projectStore.reset(emptyProject());
  addPhotosToPile([{ id: P, name: 'p.jpg', pxW: 1500, pxH: 1000 }]);
  projectStore.apply((d) => putOnPage(d, [P], allSpreads(d)[1]!.id, 'right'));
});

describe('applyPageSetup: size', () => {
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

describe('applyPageSetup: arrangement', () => {
  it('changes nothing for the draft that’s already applied', () => {
    const before = projectStore.project;
    applyPageSetup(draft());
    expect(projectStore.project).toBe(before);
  });

  it('re-paginates at the same size and unit, and switching straight back restores the book', () => {
    const before = projectStore.project;
    applyPageSetup(draft({ arrangement: 'frames' }));
    expect(projectStore.project.layout.kind).toBe('frames');
    expect(projectStore.project.page).toEqual(before.page);
    applyPageSetup(draft({ arrangement: 'spreads' }));
    expect(projectStore.project).toBe(before);
  });

  it('is one undo step', () => {
    const before = projectStore.project;
    applyPageSetup(draft({ arrangement: 'frames' }));
    projectStore.undo();
    expect(projectStore.project).toBe(before);
  });

  it('converts afresh after any other change', () => {
    applyPageSetup(draft({ arrangement: 'frames' }));
    projectStore.apply((d) => void (d.settings.centerH = false));
    applyPageSetup(draft({ arrangement: 'spreads' }));
    expect(projectStore.project.settings.centerH).toBe(false);
  });
});

describe('applyPageSetup: unit and resolution', () => {
  it('converts at the dpi when only the unit changes, so photos keep their resolution', () => {
    const was = placed();
    applyPageSetup(draft({ page: { w: 3000, h: 2400, unit: 'px', pxPerUnit: 1 } }));
    expect(projectStore.project.page).toEqual({ w: 3000, h: 2400, unit: 'px', pxPerUnit: 1 });
    expect(placed().w).toBeCloseTo(was.w * 300);
    expect(placed().x).toBeCloseTo(was.x * 300);
  });

  it('converts pixels to inches at the dpi chosen to print at, which becomes the page’s', () => {
    applyPageSetup(draft({ page: INSTAGRAM, arrangement: 'frames' }));
    applyPageSetup(draft({ page: { w: 1080 / 150, h: 1350 / 150, unit: 'in', pxPerUnit: 150 } }));
    expect(projectStore.project.page).toEqual({ w: 7.2, h: 9, unit: 'in', pxPerUnit: 150 });
  });

  it('changes only the resolution when only the dpi changes', () => {
    const before = projectStore.project;
    applyPageSetup(draft({ page: { pxPerUnit: 150 } }));
    expect(projectStore.project.page.pxPerUnit).toBe(150);
    expect(projectStore.project.layout).toBe(before.layout);
    expect(projectStore.project.settings).toBe(before.settings);
  });

  it('rescales guides by the page’s width when the unit and size change together', () => {
    applyPageSetup(draft({ arrangement: 'frames', page: INSTAGRAM, content: 'rescale' }));
    // A 0.5 in margin on a 10 in page: 54 px on a 1080 px frame, as before.
    const borders = projectStore.project.settings.borders;
    expect(borders.map((b) => b.kind === 'even' && b.inset)).toEqual([54, 135]);
  });

  it('keeps converted photos and guides fixed when asked, clamped to the page', () => {
    const was = placed();
    applyPageSetup(draft({ arrangement: 'frames', page: INSTAGRAM, content: 'fixed' }));
    const p = projectStore.project;
    expect(p.settings.keepRelative).toBe(false);
    expect(p.settings.borders.map((b) => b.kind === 'even' && b.inset)).toEqual([150, 375]);
    // The photo keeps its size at 300 dpi.
    const item = allSpreads(p).flatMap((s) => s.items)[0]!;
    expect(item.w).toBeCloseTo(was.w * 300);
  });

  it('after converting, a dpi change is only the resolution: nothing moves or resizes', () => {
    applyPageSetup(draft({ page: INSTAGRAM, arrangement: 'frames' }));
    applyPageSetup(draft({ page: { w: 3.6, h: 4.5, unit: 'in', pxPerUnit: 300 } }));
    const converted = projectStore.project;
    expect(printsAt(converted, draftOf(converted))).toBe(false);
    const d = draftWithDpi(pageSetupBase(), converted, draftOf(converted), 150);
    expect(d.page).toEqual({ w: 3.6, h: 4.5, unit: 'in', pxPerUnit: 150 });
    applyPageSetup(d);
    expect(projectStore.project.page).toEqual({ w: 3.6, h: 4.5, unit: 'in', pxPerUnit: 150 });
    expect(projectStore.project.layout).toBe(converted.layout);
  });

  it('goes back exactly through the run', () => {
    const before = projectStore.project;
    applyPageSetup(draft({ arrangement: 'frames', page: INSTAGRAM }));
    applyPageSetup(draftOf(before));
    expect(projectStore.project).toBe(before);
  });
});

describe('the draft', () => {
  it('needs Content only when the size changes beyond converting', () => {
    const p = projectStore.project;
    expect(resizes(p, draft({ page: { w: 3000, h: 2400, unit: 'px', pxPerUnit: 1 } }))).toBe(false);
    expect(resizes(p, draft({ page: INSTAGRAM }))).toBe(true);
    expect(resizes(p, draft({ arrangement: 'frames' }))).toBe(false);
  });

  it('previews exactly what Apply makes', () => {
    const d = draft({ page: { w: 8 } });
    const preview = previewPageSetup(d);
    applyPageSetup(d);
    expect(allSpreads(projectStore.project).map((s) => s.items)).toEqual(allSpreads(preview).map((s) => s.items));
  });

  it('converts its size when the unit changes, and prints pixels at the dpi chosen', () => {
    const p = projectStore.project;
    expect(draftWithUnit(p, draftOf(p), 'px').page).toEqual({ w: 3000, h: 2400, unit: 'px', pxPerUnit: 1 });
    applyPageSetup(draft({ page: INSTAGRAM }));
    const px = projectStore.project;
    const toInches = draftWithUnit(pageSetupBase(), draftOf(px), 'in');
    expect(toInches.page).toEqual({ w: 3.6, h: 4.5, unit: 'in', pxPerUnit: 300 });
    expect(printsAt(px, toInches)).toBe(true);
    expect(draftWithDpi(pageSetupBase(), px, toInches, 150).page).toEqual({ w: 7.2, h: 9, unit: 'in', pxPerUnit: 150 });
  });

  it('previews the project itself when nothing changes', () => {
    const p = projectStore.project;
    expect(previewPageSetup(draftOf(p))).toBe(p);
  });

  it('is pure: the project is left alone', () => {
    const before = projectStore.project;
    withPageSetup(before, draft({ arrangement: 'frames', page: INSTAGRAM }));
    expect(projectStore.project).toBe(before);
  });
});

describe('presets', () => {
  it('match a draft, or none for a custom size', () => {
    expect(presetOf(draft())?.label).toBe('Book');
    expect(presetOf(draft({ page: { w: 9 } }))).toBeUndefined();
  });

  it('set the arrangement, unit, and size together, in one undo step', () => {
    const before = projectStore.project;
    const instagram = withPreset(draft(), { label: '', arrangement: 'frames', page: { w: 1080, h: 1350, unit: 'px' } });
    expect(instagram.page).toEqual(INSTAGRAM);
    applyPageSetup(instagram);
    expect(projectStore.project.layout.kind).toBe('frames');
    projectStore.undo();
    expect(projectStore.project).toBe(before);
  });

  it('keep the dpi in inches', () => {
    const zine = withPreset(draft({ page: { pxPerUnit: 200 } }), {
      label: '',
      arrangement: 'spreads',
      page: { w: 5.5, h: 8.5, unit: 'in' },
    });
    expect(zine.page.pxPerUnit).toBe(200);
  });
});

describe('pixel density', () => {
  it('is kept by an Apply that doesn’t change the unit, as exports use it', () => {
    applyPageSetup(draft({ page: INSTAGRAM }));
    projectStore.apply((d) => void (d.page.pxPerUnit = 2));
    applyPageSetup(draft({ page: { w: 1080, h: 1080 } }));
    expect(projectStore.project.page).toEqual({ w: 1080, h: 1080, unit: 'px', pxPerUnit: 2 });
  });
});
