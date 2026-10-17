import type { Draft } from 'immer';
import { convertUnits, rearrange, resizePage, scaleProject } from './convertLayout';
import { projectStore } from './store';
import type { Arrangement, PageSetup, Project, Size, Unit } from './types';
import { DEFAULT_DPI, PRESETS, type Preset } from './units';

/**
 * The page's settings, applied together: the Layout view's Page tab (and a new project's
 * setup card) edits a draft of them, and Apply makes the whole change one undo step.
 */

/** What photos do when the page size changes. */
export type Content = 'rescale' | 'fixed';

export interface PageDraft {
  arrangement: Arrangement;
  /** The size in `page.unit`; `page.pxPerUnit` is the dpi (inches) or 1 (pixels). */
  page: PageSetup;
  /** Move and scale photos with the guides, or keep their size and place. */
  content: Content;
}

/** The project's page settings as a draft. */
export function draftOf(p: Project): PageDraft {
  return {
    arrangement: p.layout.kind,
    page: { ...p.page },
    content: p.settings.keepRelative ? 'rescale' : 'fixed',
  };
}

export function sameDraft(a: PageDraft, b: PageDraft): boolean {
  return (
    a.arrangement === b.arrangement &&
    a.content === b.content &&
    a.page.w === b.page.w &&
    a.page.h === b.page.h &&
    a.page.unit === b.page.unit &&
    a.page.pxPerUnit === b.page.pxPerUnit
  );
}

/**
 * A page's size in another unit, at the same physical size: multiplied by the dpi going
 * to pixels, divided by it going to inches.
 */
export function convertedSize(page: Pick<PageSetup, 'w' | 'h' | 'unit'>, unit: Unit, dpi: number): Size {
  if (page.unit === unit) return { w: page.w, h: page.h };
  const f = unit === 'px' ? dpi : 1 / dpi;
  return { w: page.w * f, h: page.h * f };
}

/** The dpi a draft converts at: the project's going to pixels, the draft's ("Print at") going to inches. */
function conversionDpi(project: Project, draft: PageDraft): number {
  return draft.page.unit === 'in' ? draft.page.pxPerUnit : project.page.pxPerUnit;
}

/** The draft's size after its unit change alone: what Apply converts to before resizing. */
export function draftConvertedSize(project: Project, draft: PageDraft): Size {
  return convertedSize(project.page, draft.page.unit, conversionDpi(project, draft));
}

/** Whether applying the draft changes the page's size beyond converting its unit, so Content matters. */
export function resizes(project: Project, draft: PageDraft): boolean {
  const c = draftConvertedSize(project, draft);
  return c.w !== draft.page.w || c.h !== draft.page.h;
}

/**
 * The project as it'd be with `draft` applied. First the unit: Rescale scales the guides
 * and photos by the page's width, so they keep their place on the new page (a 0.5 in margin
 * on a 10 in page becomes 54 px on a 1080 px frame); Keep fixed converts at the dpi, so
 * photos keep their physical size and resolution. Then the arrangement (re-paginated), then
 * the size (photos moved with the guides, or kept; border guides kept on the page). Pure,
 * apart from new spread ids for pages that become frames.
 */
export function withPageSetup(project: Project, draft: PageDraft): Project {
  const rescale = draft.content === 'rescale';
  const { unit } = draft.page;
  const pxPerUnit = unit === 'px' ? 1 : draft.page.pxPerUnit;
  let p = project;
  if (p.page.unit !== unit) {
    p = rescale
      ? scaleProject(p, draft.page.w / p.page.w, unit, pxPerUnit)
      : convertUnits(p, unit, conversionDpi(project, draft));
  }
  p = rearrange(p, draft.arrangement);
  p = resizePage(p, { w: draft.page.w, h: draft.page.h }, rescale);
  if (p.page.pxPerUnit !== pxPerUnit) p = { ...p, page: { ...p.page, pxPerUnit } };
  if (p.settings.keepRelative !== rescale) p = { ...p, settings: { ...p.settings, keepRelative: rescale } };
  return p;
}

/**
 * The project a run of Applies is computed from, and its latest result. Applying from this
 * fixed start (not from the previous result) keeps a run order-independent and exactly
 * reversible: 10 → 8 → 10 puts every photo and guide back, and switching straight back to
 * spreads restores the book. The run ends when anything else changes the project.
 *
 * A unit conversion applied in the run ends its use as a start for anything but going
 * straight back: after inches → pixels (or back), later changes start from the converted
 * project, so a dpi changed afterwards is the page's resolution, not a new conversion.
 */
let run: { base: Project; out: Project } | null = null;

/** The run, if the project is still the one it last made. */
function liveRun(): { base: Project; out: Project } | null {
  return run?.out === projectStore.project ? run : null;
}

/** The project the next Apply converts and resizes from (see `run`). */
export function pageSetupBase(): Project {
  const now = projectStore.project;
  const r = liveRun();
  return r && r.base.page.unit === now.page.unit ? r.base : now;
}

/** The project a draft makes: the run's start, exactly, when the draft goes straight back to it. */
function projectFor(draft: PageDraft): Project {
  const r = liveRun();
  if (r && sameDraft(draftOf(r.base), draft)) return r.base;
  const base = pageSetupBase();
  return sameDraft(draftOf(base), draft) ? base : withPageSetup(base, draft);
}

/** The project after Apply, as the preview shows it (see applyPageSetup). */
export function previewPageSetup(draft: PageDraft): Project {
  const now = projectStore.project;
  return sameDraft(draftOf(now), draft) ? now : projectFor(draft);
}

/** Apply a draft of the page's settings as one undo step. */
export function applyPageSetup(draft: PageDraft): void {
  const now = projectStore.project;
  if (sameDraft(draftOf(now), draft)) return;
  const r = liveRun();
  const base = r && r.base.page.unit === now.page.unit ? r.base : now;
  const next = projectFor(draft);
  projectStore.replace(next);
  // A new run starts where this one can no longer be computed from.
  run = { base: r && (base === r.base || next === r.base) ? r.base : base, out: projectStore.project };
}

/**
 * The draft with another unit: its size converted from the page Apply starts from, at that
 * page's dpi (or the default dpi, to print at, going from pixels to inches).
 */
export function draftWithUnit(base: Project, draft: PageDraft, unit: Unit): PageDraft {
  if (unit === draft.page.unit) return draft;
  const pxPerUnit = unit === 'px' ? 1 : base.page.unit === 'in' ? base.page.pxPerUnit : DEFAULT_DPI;
  const next: PageDraft = { ...draft, page: { ...draft.page, unit, pxPerUnit } };
  const size = unit === base.page.unit ? base.page : draftConvertedSize(base, next);
  return { ...next, page: { ...next.page, w: size.w, h: size.h } };
}

/**
 * Whether the draft's dpi is the one to print pixels at: going from a pixel page to inches,
 * where the dpi sets the size. Otherwise it's only the page's resolution.
 */
export function printsAt(project: Project, draft: PageDraft): boolean {
  return project.page.unit === 'px' && draft.page.unit === 'in';
}

/**
 * The draft at another dpi. Printing pixels at it, the size follows (unless it's been
 * edited); otherwise nothing but the resolution changes.
 */
export function draftWithDpi(base: Project, project: Project, draft: PageDraft, dpi: number): PageDraft {
  let { w, h } = draft.page;
  const was = convertedSize(base.page, 'in', draft.page.pxPerUnit);
  if (printsAt(project, draft) && was.w === w && was.h === h) ({ w, h } = convertedSize(base.page, 'in', dpi));
  return { ...draft, page: { ...draft.page, w, h, pxPerUnit: dpi } };
}

/** The preset a draft matches, if any. */
export function presetOf(d: PageDraft): Preset | undefined {
  return PRESETS.find(
    (p) =>
      p.arrangement === d.arrangement && p.page.unit === d.page.unit && p.page.w === d.page.w && p.page.h === d.page.h,
  );
}

/** A draft taking a preset's arrangement, unit, and size; inches keep the draft's dpi. */
export function withPreset(d: PageDraft, preset: Preset): PageDraft {
  const pxPerUnit = preset.page.unit === 'px' ? 1 : d.page.unit === 'in' ? d.page.pxPerUnit : DEFAULT_DPI;
  return { ...d, arrangement: preset.arrangement, page: { ...preset.page, pxPerUnit } };
}

/** Recipe: set the page size, nothing else (no photos or guides move). */
export function setLayoutSize(d: Draft<Project>, size: Size): void {
  // Field by field, so setting the size it already is changes nothing.
  d.page.w = size.w;
  d.page.h = size.h;
}
