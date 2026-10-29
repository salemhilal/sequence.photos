import { produce } from 'immer';
import { draftOf, previewPageSetup } from '../pageSetup';
import type { Project } from '../types';

/** The sizes a sequence offers, all in pixels. */
export const SIZES = [
  { label: 'Instagram portrait', w: 1080, h: 1350 },
  { label: 'Square', w: 1080, h: 1080 },
  { label: 'Instagram landscape', w: 1080, h: 566 },
  { label: 'Story', w: 1080, h: 1920 },
  { label: 'Slides', w: 1920, h: 1080 },
] as const;

/** What the sheet sets: the size, the border guide's distance in, and the center lines. */
export interface FrameSetup {
  w: number;
  h: number;
  inset: number;
  center: boolean;
}

export function setupOf(p: Project): FrameSetup {
  const g = p.settings.borders[0];
  return {
    w: p.page.w,
    h: p.page.h,
    inset: g ? (g.kind === 'even' ? g.inset : g.top) : 0,
    center: p.settings.centerV && p.settings.centerH,
  };
}

/**
 * The project with a frame setup applied: resized as the Layout view's Page tab does (photos
 * moving with the guides), then the border guide (one, even all round, the one photos are
 * dropped in) and the center lines.
 */
export function withFrameSetup(project: Project, s: FrameSetup): Project {
  const sized = previewPageSetup({ ...draftOf(project), page: { ...project.page, w: s.w, h: s.h } });
  return produce(sized, (d) => {
    const inset = Math.max(0, Math.min(s.inset, Math.min(s.w, s.h) / 2 - 1));
    const [first] = d.settings.borders;
    if (inset > 0) {
      const id = first?.id ?? d.settings.dropBorder;
      if (id) {
        d.settings.borders = [{ id, kind: 'even', inset }];
        d.settings.dropBorder = id;
      }
    } else {
      d.settings.borders = [];
      d.settings.dropBorder = null;
    }
    d.settings.centerV = s.center;
    d.settings.centerH = s.center;
  });
}
