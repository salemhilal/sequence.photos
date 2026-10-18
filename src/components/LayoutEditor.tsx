import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { startDrag } from '../drag';
import {
  edgesOf,
  lineAt,
  lineOnPage,
  linePosition,
  pageRect,
  pageSides,
  sideAt,
  spreadLeft,
  spreadWidth,
} from '../geometry';
import { useElementSize, useWindowEvent } from '../hooks';
import { isTyping } from '../input';
import { newGuideId, toSpreadId, type GuideId } from '../ids';
import { sheetOf } from '../spreads';
import { projectStore, useProject } from '../store';
import type { Arrangement, LineGuide, PageSide, Spread } from '../types';
import { TERMS, UNITS } from '../units';
import { ask, setPageGuard, ui, type LayoutTab } from '../ui';
import { applyPageSetup, draftOf, sameDraft } from '../pageSetup';
import { usePageDraft } from './pageDraft';
import { PagePreview } from './PagePreview';
import { LayoutPanel } from './LayoutPanel';
import { same, type Axis, type Selection } from './layoutSelection';
import { Ruler, RULER } from './Ruler';
import { SpreadCanvas } from './SpreadCanvas';

/**
 * The Layout view: a facing pair of empty pages (or one empty frame) with rulers along the
 * top and left, and the layout's settings beside them, in two tabs. The Page tab's settings
 * wait for Apply; while they differ, the stage previews the project with them. Guides apply
 * to every spread, mirrored on facing pages. Drag from a ruler to add a guide parallel to
 * it; drag a guide off the page to remove it. Clicking any guide selects it and
 * highlights its settings.
 */

/** Room around the pages, as a share of a page's width (0.5 in on a 10 in page). */
const PAD_SHARE = 0.05;
const SAMPLES: Record<Arrangement, Spread> = {
  spreads: { id: toSpreadId('layout'), kind: 'middle', items: [] },
  frames: { id: toSpreadId('layout'), kind: 'frame', items: [] },
};

export function LayoutEditor() {
  const { project } = useProject();
  const s = sheetOf(project);
  const units = UNITS[s.unit];
  const terms = TERMS[s.arrangement];
  const sample = SAMPLES[s.arrangement];
  const sides = pageSides(sample.kind);
  const PAD = s.pageW * PAD_SHARE;
  /** The pages' (or frame's) left edge and width, around the canvas origin. */
  const extentLeft = spreadLeft(sample.kind, s);
  const across = spreadWidth(sample.kind, s);
  const [stageRef, stage, measureStage] = useElementSize<HTMLDivElement>({ w: 800, h: 500 });
  const [selected, setSelected] = useState<Selection | null>(null);
  const [dragLabel, setDragLabel] = useState<{ text: string; x: number; y: number } | null>(null);
  // The Page tab's draft, kept across tabs until Apply or Revert.
  const [draft, setDraft] = usePageDraft();
  const tab = ui.use((u) => u.layoutTab);
  const pending = !sameDraft(draft, draftOf(project));
  // The Page tab always shows the pages as Apply would leave them (as they are, with no
  // changes), so nudging a setting doesn't swap the view. The Guides tab shows them too
  // while changes wait, since guides can't be edited then.
  const previewing = tab === 'page' || pending;

  // Hidden behind the preview, the stage measures nothing: measure it as it shows, before
  // it's painted, so the page doesn't flash at the wrong size.
  useLayoutEffect(() => {
    if (!previewing) measureStage();
  }, [previewing]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (sel: Selection) => {
    if (sel.kind === 'center') return;
    projectStore.apply((d) => {
      const g = d.settings;
      if (sel.kind === 'line') g.lines = g.lines.filter((l) => l.id !== sel.id);
      else {
        g.borders = g.borders.filter((b) => b.id !== sel.id);
        // Photos fit the largest remaining guide instead.
        if (g.dropBorder === sel.id) g.dropBorder = null;
      }
    });
    setSelected(null);
  };

  /**
   * Page changes waiting for Apply: ask what to do with them before closing Layout or going
   * to Guides. Resolves whether to go on (applied, or discarded).
   */
  const settlePage = async (): Promise<boolean> => {
    if (!pending) return true;
    const answer = await ask({
      title: 'Apply the page changes?',
      message: 'Your changes on the Page tab haven’t been applied yet.',
      actions: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Discard', value: 'discard' },
        { label: 'Apply', value: 'apply', primary: true },
      ],
    });
    if (answer === 'apply') applyPageSetup(draft);
    if (answer === 'discard') setDraft(draftOf(projectStore.project));
    return answer === 'apply' || answer === 'discard';
  };
  // Leaving Layout (Esc, the switcher, a shortcut or menu) asks first.
  useEffect(() => {
    if (!pending) return;
    setPageGuard(settlePage);
    return () => setPageGuard(null);
  });
  const goToTab = (t: LayoutTab) => {
    if (t === 'page') return ui.set({ layoutTab: t });
    void settlePage().then((ok) => ok && ui.set({ layoutTab: t }));
  };

  useWindowEvent('keydown', (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || ui.get().confirm) return;
    if (e.key === 'Escape') {
      if (selected) setSelected(null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      remove(selected);
    }
  });

  // Its size, and while previewing, how to flip through, in the status bar.
  const status = `${units.format(s.pageW)} × ${units.format(s.pageH)} ${units.suffix}${
    previewing ? `${pending ? ' · Preview of the changes' : ''} · ← → to flip through` : ''
  }`;
  useEffect(() => {
    ui.set({ pageStatus: status });
  }, [status]);
  useEffect(() => () => ui.set({ pageStatus: null }), []);

  // Where the spread sits in the stage: centered in the space beside the rulers.
  const scale = Math.min((stage.w - RULER) / (across + 2 * PAD), (stage.h - RULER) / (s.pageH + 2 * PAD));
  const left = RULER + Math.max(0, (stage.w - RULER - (across + 2 * PAD) * scale) / 2);
  const top = RULER + Math.max(0, (stage.h - RULER - (s.pageH + 2 * PAD) * scale) / 2);
  /** The canvas origin (a book's gutter, a frame's left edge) and the pages' top, in stage pixels. */
  const gutterX = left + (PAD - extentLeft) * scale;
  const pageTop = top + PAD * scale;

  /** The guide the pointer is placing, or null over the ruler or off the page (to remove it). */
  const guideAt = (axis: Axis, id: GuideId, e: PointerEvent): LineGuide | null => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return null;
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const x = (px - gutterX) / scale;
    let at = axis === 'horizontal' ? (py - pageTop) / scale : lineAt(sideAt(s, x), s, 'vertical', x);
    if (e.shiftKey) at = Math.round(at / units.snap) * units.snap;
    const overRuler = axis === 'horizontal' ? py < RULER : px < RULER;
    const size = axis === 'horizontal' ? s.pageH : s.pageW;
    return overRuler || at <= 0 || at >= size ? null : { id, axis, at: units.round(at) };
  };

  /** Drag a new guide out of a ruler (`existing` null) or an existing one, by id. */
  const dragGuide = (e: React.PointerEvent, axis: Axis, existing: GuideId | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = s.lines;
    const id = existing ?? newGuideId();
    // The guide where the pointer is: added, moved, or (off the page) removed.
    const place = (g: LineGuide | null): LineGuide[] => {
      if (!existing) return g ? [...start, g] : start;
      return g ? start.map((l) => (l.id === id ? g : l)) : start.filter((l) => l.id !== id);
    };
    startDrag(e, {
      onStart: () => projectStore.begin(),
      onMove: ({ e: ev }) => {
        const g = guideAt(axis, id, ev);
        projectStore.preview((d) => void (d.settings.lines = place(g)));
        const r = stageRef.current?.getBoundingClientRect();
        const from = axis === 'horizontal' ? 'top' : terms.edges.outside.toLowerCase();
        setDragLabel({
          text: g ? `${units.format(g.at)} ${units.suffix} from ${from}` : 'Remove',
          x: ev.clientX - (r?.left ?? 0),
          y: ev.clientY - (r?.top ?? 0),
        });
      },
      onEnd: ({ e: ev }, moved) => {
        setDragLabel(null);
        if (!moved) {
          if (existing) setSelected({ kind: 'line', id });
          return;
        }
        const g = guideAt(axis, id, ev);
        projectStore.end();
        setSelected(g ? { kind: 'line', id } : null);
      },
      onCancel: () => {
        setDragLabel(null);
        projectStore.cancel();
      },
    });
  };

  // Every guide, drawn over the canvas (whose origin is the gutter, at the pages' top).
  // Guides from the rulers can be dragged; the others are only selected.
  const oX = gutterX - left;
  const oY = PAD * scale;
  const guides: ReactNode[] = [];
  const draw = (key: string, axis: Axis, at: number, sel: Selection, side: PageSide | null) => {
    const page = side ? pageRect(side, s) : { x: extentLeft, w: across };
    const style =
      axis === 'horizontal'
        ? { top: oY + at * scale, left: oX + page.x * scale, width: page.w * scale }
        : { left: oX + at * scale, top: oY, height: s.pageH * scale };
    const kind = sel.kind === 'line' ? 'movable' : sel.kind === 'center' ? 'fixed center' : 'fixed';
    guides.push(
      <div
        key={key}
        className={`line-guide line-guide-${axis === 'horizontal' ? 'h' : 'v'} ${kind}${same(selected, sel) ? ' selected' : ''}`}
        style={style}
        onPointerDown={(e) => {
          if (sel.kind === 'line') return dragGuide(e, axis, sel.id);
          if (e.button !== 0) return;
          e.stopPropagation();
          setSelected(sel);
        }}
      />,
    );
  };
  if (s.centerV) {
    for (const side of sides) {
      const p = pageRect(side, s);
      draw(`cv-${side}`, 'vertical', p.x + p.w / 2, { kind: 'center', axis: 'vertical' }, side);
    }
  }
  if (s.centerH) draw('ch', 'horizontal', s.pageH / 2, { kind: 'center', axis: 'horizontal' }, null);
  for (const b of s.borders) {
    const sel: Selection = { kind: 'border', id: b.id };
    const e = edgesOf(b);
    for (const side of sides) {
      const p = pageRect(side, s);
      const [l, r] = side === 'right' ? [e.inside, e.outside] : [e.outside, e.inside];
      draw(`${b.id}-${side}-l`, 'vertical', p.x + l, sel, side);
      draw(`${b.id}-${side}-r`, 'vertical', p.x + p.w - r, sel, side);
      draw(`${b.id}-${side}-t`, 'horizontal', e.top, sel, side);
      draw(`${b.id}-${side}-b`, 'horizontal', s.pageH - e.bottom, sel, side);
    }
  }
  for (const l of s.lines) {
    if (!lineOnPage(s, l)) continue;
    const sel: Selection = { kind: 'line', id: l.id };
    if (l.axis === 'horizontal') draw(l.id, 'horizontal', l.at, sel, null);
    else for (const side of sides) draw(`${l.id}-${side}`, 'vertical', linePosition(side, s, l), sel, side);
  }

  return (
    <div className="page-view layout-editor">
      <div className="editor-body">
        {previewing && <PagePreview draft={draft} />}
        <div className="editor-stage" ref={stageRef} hidden={previewing}>
          <Ruler
            axis="horizontal"
            length={stage.w}
            origin={gutterX}
            scale={scale}
            size={s.pageW}
            unit={s.unit}
            mirrored={s.arrangement === 'spreads'}
            onPointerDown={(e) => dragGuide(e, 'horizontal', null)}
          />
          <Ruler
            axis="vertical"
            length={stage.h}
            origin={pageTop}
            scale={scale}
            size={s.pageH}
            unit={s.unit}
            onPointerDown={(e) => dragGuide(e, 'vertical', null)}
          />
          <div className="ruler-corner" />
          <div className="layout-canvas" style={{ left, top }}>
            <SpreadCanvas
              spread={sample}
              sheet={s}
              scale={scale}
              pad={PAD}
              overlay={guides}
              onPointerDown={() => setSelected(null)}
            />
          </div>
          {dragLabel && (
            <div className="guide-drag-label data" style={{ left: dragLabel.x + 14, top: dragLabel.y + 14 }}>
              {dragLabel.text}
            </div>
          )}
        </div>
        <LayoutPanel
          s={s}
          tab={tab}
          draft={draft}
          onDraft={setDraft}
          onTab={goToTab}
          selected={selected}
          onSelect={setSelected}
          onRemove={remove}
        />
      </div>
    </div>
  );
}
