// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hitTest, sameTarget, type DropTarget } from './drag';
import { toSpreadId } from './ids';

/** An element with these `data-` attributes. */
function el(data: Record<string, string>): HTMLElement {
  const div = document.createElement('div');
  Object.assign(div.dataset, data);
  return div;
}

/** What's under the pointer, topmost first (happy-dom doesn't do layout). */
function under(...elements: Element[]): void {
  document.elementsFromPoint = vi.fn(() => elements);
}

const S1 = toSpreadId('s1');
const S2 = toSpreadId('s2');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hitTest', () => {
  it('finds a frame (a page that’s all one side)', () => {
    under(el({ drop: 'page', spread: 's1', side: 'whole' }));
    expect(hitTest(10, 10)).toEqual({ kind: 'page', spreadId: S1, side: 'whole' });
  });

  it('finds a book’s left and right pages', () => {
    under(el({ drop: 'page', spread: 's1', side: 'left' }));
    expect(hitTest(0, 0)).toEqual({ kind: 'page', spreadId: S1, side: 'left' });
    under(el({ drop: 'page', spread: 's2', side: 'right' }));
    expect(hitTest(0, 0)).toEqual({ kind: 'page', spreadId: S2, side: 'right' });
  });

  it('skips a page without a spread or a known side', () => {
    under(el({ drop: 'page', side: 'left' }), el({ drop: 'page', spread: 's1', side: 'middle' }), el({ drop: 'desk' }));
    expect(hitTest(0, 0)).toEqual({ kind: 'desk' });
  });

  it('finds the desk, the desk strip, and the gaps between spreads', () => {
    under(el({ drop: 'desk' }));
    expect(hitTest(0, 0)).toEqual({ kind: 'desk' });
    under(el({ drop: 'strip' }));
    expect(hitTest(0, 0)).toEqual({ kind: 'strip' });
    under(el({ drop: 'insert', index: '3' }));
    expect(hitTest(0, 0)).toEqual({ kind: 'insert', index: 3 });
  });

  it('skips a gap without a whole-number index', () => {
    under(el({ drop: 'insert', index: 'x' }), el({ drop: 'insert', index: '1.5' }), el({ drop: 'strip' }));
    expect(hitTest(0, 0)).toEqual({ kind: 'strip' });
  });

  it('takes the topmost target, looking through elements that aren’t targets', () => {
    under(el({}), el({ drop: 'page', spread: 's1', side: 'whole' }), el({ drop: 'desk' }));
    expect(hitTest(0, 0)).toEqual({ kind: 'page', spreadId: S1, side: 'whole' });
  });

  it('stops at a modal: nothing beneath it is a target', () => {
    under(el({ modal: '' }), el({ drop: 'desk' }));
    expect(hitTest(0, 0)).toBeNull();
  });

  it('is nothing over nothing', () => {
    under();
    expect(hitTest(0, 0)).toBeNull();
  });

  it('asks about the point it’s given', () => {
    under();
    hitTest(12, 34);
    expect(document.elementsFromPoint).toHaveBeenCalledWith(12, 34);
  });
});

describe('sameTarget', () => {
  const page = (spreadId = S1, side: 'left' | 'right' | 'whole' = 'left'): DropTarget => ({
    kind: 'page',
    spreadId,
    side,
  });

  it('matches a page by its spread and side', () => {
    expect(sameTarget(page(), page())).toBe(true);
    expect(sameTarget(page(S1, 'left'), page(S1, 'right'))).toBe(false);
    expect(sameTarget(page(S1), page(S2))).toBe(false);
    expect(sameTarget(page(S1, 'whole'), page(S1, 'whole'))).toBe(true);
  });

  it('matches a gap by its index', () => {
    expect(sameTarget({ kind: 'insert', index: 1 }, { kind: 'insert', index: 1 })).toBe(true);
    expect(sameTarget({ kind: 'insert', index: 1 }, { kind: 'insert', index: 2 })).toBe(false);
  });

  it('matches the desk and the strip as themselves', () => {
    expect(sameTarget({ kind: 'desk' }, { kind: 'desk' })).toBe(true);
    expect(sameTarget({ kind: 'strip' }, { kind: 'strip' })).toBe(true);
    expect(sameTarget({ kind: 'desk' }, { kind: 'strip' })).toBe(false);
  });

  it('never matches nothing', () => {
    expect(sameTarget(null, null)).toBe(false);
    expect(sameTarget({ kind: 'desk' }, null)).toBe(false);
    expect(sameTarget(null, { kind: 'desk' })).toBe(false);
  });
});
