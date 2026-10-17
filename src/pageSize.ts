import type { Draft } from 'immer';
import { clampBorder, relayoutRect } from './geometry';
import { allSpreads, findSpread, sheetOf } from './spreads';
import { projectStore } from './store';
import { convertLayout } from './convertLayout';
import type { LayoutKind, Project, Sheet, Size } from './types';

/**
 * The project a run of size changes is computed from. Relaying out from this fixed
 * starting point (not from the previous size) keeps a run of changes order-independent and
 * exactly reversible: 10 → 8 → 10 puts every photo, and every border guide, back where it
 * was. The run ends when anything else changes the project.
 */
let resizeRun: { base: Project; out: Project } | null = null;

/** The last switch between print and digital, so switching straight back restores what was there. */
let lastSwitch: { from: Project; to: Project } | null = null;

/**
 * Turn the project into a print book or a digital sequence (see convertLayout), at `size`
 * (default: that format's last size): one undo step. Photos moved with the guides to a new shape don't come back exactly when moved
 * back, so switching straight back, with nothing changed between, restores the project
 * as it was.
 */
export function switchLayout(kind: LayoutKind, size?: Size): void {
  const now = projectStore.project;
  if (now.layout.kind === kind) return;
  // At a size other than the format's last one: converted straight to it, in the same step.
  const target = size ?? now.settings.sizes[kind];
  const from = lastSwitch?.from;
  const back = lastSwitch?.to === now && from?.layout.kind === kind && sameSize(sheetOf(from), target);
  const base = { ...now, settings: { ...now.settings, sizes: { ...now.settings.sizes, [kind]: { ...target } } } };
  projectStore.replace(back && from ? from : convertLayout(base, kind));
  lastSwitch = { from: now, to: projectStore.project };
}

function sameSize(sheet: Sheet, size: Size): boolean {
  return sheet.pageW === size.w && sheet.pageH === size.h;
}

/** Set the page's (print) or frames' (digital) size, and remember it for its layout kind. */
export function setLayoutSize(d: Draft<Project>, size: Size): void {
  const l = d.layout;
  // Field by field, so setting the size it already is changes nothing.
  for (const s of [l.kind === 'print' ? l.page : l.frame, d.settings.sizes[l.kind]]) {
    s.w = size.w;
    s.h = size.h;
  }
}

/**
 * Change the page or frame size (Layout's Apply): one undo step. Photos keep their place
 * relative to the guides (if chosen), and border guides stay on the page.
 */
export function setPageSize(size: Size): void {
  const now = projectStore.project;
  const current = sheetOf(now);
  if (current.pageW === size.w && current.pageH === size.h) return;
  if (resizeRun?.out !== now) resizeRun = { base: now, out: now };
  const { base } = resizeRun;
  const from = sheetOf(base);
  const to: Sheet = { ...from, pageW: size.w, pageH: size.h };
  projectStore.apply((d) => {
    setLayoutSize(d, size);
    // From the run's start, not from now: each guide and photo as it was before the run.
    d.settings.borders = base.settings.borders.map((b) => {
      const g = { ...b };
      clampBorder(g, to);
      return g;
    });
    if (!to.keepRelative) return;
    for (const spread of allSpreads(d)) {
      const was = findSpread(base, spread.id);
      for (const item of spread.items) {
        const start = was?.items.find((i) => i.photoId === item.photoId);
        if (start) Object.assign(item, relayoutRect(start, from, to));
      }
    }
  });
  resizeRun.out = projectStore.project;
}
