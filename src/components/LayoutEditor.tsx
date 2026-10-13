import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Link2, Link2Off, Plus, SeparatorHorizontal, SeparatorVertical, X } from 'lucide-react';
import { startDrag } from '../drag';
import {
  clampBorder,
  dropGuide,
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
import { useWindowEvent } from '../hooks';
import { isTyping } from '../input';
import { newGuideId, toSpreadId, type GuideId } from '../ids';
import { sheetOf } from '../spreads';
import { projectStore, useProject } from '../store';
import type { BorderGuide, Edges, LayoutKind, LineGuide, PageSide, Sheet, Spread } from '../types';
import { TERMS, UNITS } from '../units';
import { closeModal } from '../ui';
import { NumberField } from './NumberField';
import { PageSizeFields } from './PageSizeFields';
import { collapsedPref } from '../prefs';
import { SpreadCanvas } from './SpreadCanvas';

/**
 * The Layout view: a facing pair of empty pages (or one empty frame) with rulers along the
 * top and left, and the layout's settings (its size and guides) beside them. Guides apply to every spread, mirrored
 * on facing pages. Drag from a ruler to add a guide parallel to it; drag a guide off the
 * page to remove it. Clicking any guide selects it and highlights its settings.
 */

/** Room around the pages, as a share of a page's width (0.5 in on a 10 in page). */
const PAD_SHARE = 0.05;
/** Ruler thickness, in pixels. */
const RULER = 20;
const SAMPLES: Record<LayoutKind, Spread> = {
  print: { id: toSpreadId('layout'), kind: 'middle', items: [] },
  digital: { id: toSpreadId('layout'), kind: 'frame', items: [] },
};
/** A border guide's fields, in pairs: a frame's left before its right. */
const EDGES: Record<LayoutKind, (keyof Edges)[]> = {
  print: ['top', 'bottom', 'inside', 'outside'],
  digital: ['top', 'bottom', 'outside', 'inside'],
};

type Axis = LineGuide['axis'];

/** What's selected: a guide from the rulers or a border guide (by id), or a center line. */
type Selection = { kind: 'line' | 'border'; id: GuideId } | { kind: 'center'; axis: Axis };

function same(a: Selection | null, b: Selection): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === 'center' ? b.kind === 'center' && a.axis === b.axis : b.kind !== 'center' && a.id === b.id;
}

export function LayoutEditor() {
  const { project } = useProject();
  const s = sheetOf(project);
  const units = UNITS[s.layout];
  const terms = TERMS[s.layout];
  const sample = SAMPLES[s.layout];
  const sides = pageSides(sample.kind);
  const PAD = s.pageW * PAD_SHARE;
  /** The pages' (or frame's) left edge and width, around the canvas origin. */
  const extentLeft = spreadLeft(sample.kind, s);
  const across = spreadWidth(sample.kind, s);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 800, h: 500 });
  const [selected, setSelected] = useState<Selection | null>(null);
  const [dragLabel, setDragLabel] = useState<{ text: string; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  useWindowEvent('keydown', (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey) return;
    if (e.key === 'Escape') {
      if (selected) setSelected(null);
      else closeModal();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      remove(selected);
    }
  });

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
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal editor layout-editor" data-modal>
        <header className="modal-head">
          <div className="modal-title">
            <span className="folio">Layout</span>
            <span className="muted data">
              {units.format(s.pageW)} × {units.format(s.pageH)} {units.suffix}
            </span>
          </div>
          <span className="spacer" />
          <span className="hint">
            Drag from a ruler to add a guide · Shift: snap to {units.snapLabel} · Drag off the {terms.page} to remove
          </span>
          <button className="btn ghost icon" aria-label="Close" onClick={closeModal}>
            <X />
          </button>
        </header>
        <div className="editor-body">
          <div className="editor-stage" ref={stageRef}>
            <Ruler
              axis="horizontal"
              length={stage.w}
              origin={gutterX}
              scale={scale}
              size={s.pageW}
              steps={RULER_STEPS[s.layout]}
              mirrored={s.layout === 'print'}
              onPointerDown={(e) => dragGuide(e, 'horizontal', null)}
            />
            <Ruler
              axis="vertical"
              length={stage.h}
              origin={pageTop}
              scale={scale}
              size={s.pageH}
              steps={RULER_STEPS[s.layout]}
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
          <LayoutPanel s={s} selected={selected} onSelect={setSelected} onRemove={remove} />
        </div>
      </div>
    </div>
  );
}

/**
 * A ruler's markings: the finest ticks that stay a few pixels apart, and numbers at the
 * smallest interval that leaves room for them.
 */
interface RulerSteps {
  ticks: number[];
  numbers: number[];
  /** The least room between numbers, in screen pixels. */
  room: number;
}

const RULER_STEPS: Record<LayoutKind, RulerSteps> = {
  print: { ticks: [1 / 8, 1 / 4, 1 / 2, 1], numbers: [1, 2, 5], room: 16 },
  digital: { ticks: [10, 25, 50, 100, 250], numbers: [50, 100, 250, 500, 1000], room: 36 },
};

interface RulerProps {
  axis: 'horizontal' | 'vertical';
  /** The ruler's length, in pixels. */
  length: number;
  /** Where the measuring starts: the gutter (mirrored, for the top ruler) or the pages' top. */
  origin: number;
  scale: number;
  /** The page's size along the ruler, in inches or pixels. */
  size: number;
  steps: RulerSteps;
  /** Measure each page from its outside edge, meeting at the gutter. */
  mirrored?: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}

/** A ruler in inches (⅛ in ticks, numbered every inch) or pixels, coarser when zoomed out. */
function Ruler({ axis, length, origin, scale, size, steps, mirrored = false, onPointerDown }: RulerProps) {
  const every = steps.numbers.find((n) => n * scale >= steps.room) ?? steps.numbers.at(-1)!;
  const minor = steps.ticks.find((t) => t * scale >= 6 && every % t < 1e-9) ?? every;
  /** Whether a distance is a whole number of `step`s. */
  const on = (d: number, step: number) => Math.abs(d / step - Math.round(d / step)) < 1e-9;
  const ticks: ReactNode[] = [];
  // Pages along the ruler: [position of its 0, direction]. The top ruler measures each
  // page from its outside edge; the left one, from the top.
  const pages: [number, number][] = mirrored
    ? [
        [origin - size * scale, 1],
        [origin + size * scale, -1],
      ]
    : [[origin, 1]];
  pages.forEach(([zero, dir], p) => {
    for (let i = 0; i * minor <= size + 1e-9; i++) {
      const d = i * minor;
      const at = zero + dir * d * scale;
      const numbered = on(d, every);
      const half = on(d, every / 2);
      const len = numbered ? RULER * 0.55 : half ? RULER * 0.35 : RULER * 0.2;
      const key = `${p}-${i}`;
      ticks.push(
        axis === 'horizontal' ? (
          <line key={key} x1={at} x2={at} y1={RULER} y2={RULER - len} />
        ) : (
          <line key={key} y1={at} y2={at} x1={RULER} x2={RULER - len} />
        ),
      );
      // Not numbered at the gutter, where both pages end.
      if (numbered && !(mirrored && Math.abs(d - size) < 1e-9)) {
        const label = String(Math.round(d * 1000) / 1000);
        ticks.push(
          axis === 'horizontal' ? (
            <text key={`${key}t`} x={at + (dir > 0 ? 3 : -3)} y={9} textAnchor={dir > 0 ? 'start' : 'end'}>
              {label}
            </text>
          ) : (
            // Turned along the ruler when it's too long to fit across it.
            <text
              key={`${key}t`}
              x={3}
              y={at + 10}
              {...(label.length > 2 && { x: 9, y: at + 3, textAnchor: 'end', transform: `rotate(-90 9 ${at + 3})` })}
            >
              {label}
            </text>
          ),
        );
      }
    }
  });
  const box = axis === 'horizontal' ? { width: length, height: RULER } : { width: RULER, height: length };
  return (
    <svg
      className={`ruler ruler-${axis === 'horizontal' ? 'top' : 'left'}`}
      {...box}
      onPointerDown={onPointerDown}
      aria-label={`Ruler: drag to add a ${axis} guide`}
    >
      {ticks}
    </svg>
  );
}

interface PanelProps {
  s: Sheet;
  selected: Selection | null;
  onSelect: (sel: Selection | null) => void;
  onRemove: (sel: Selection) => void;
}

type SectionId = 'page' | 'center' | 'borders' | 'lines';

/** The section showing each kind of selection's settings. */
const SECTION_OF: Record<Selection['kind'], SectionId> = { center: 'center', border: 'borders', line: 'lines' };

interface SectionProps {
  id: SectionId;
  title: string;
  /** Buttons beside the title (e.g. Add); using one opens the section. */
  actions?: ReactNode;
  collapsed: ReadonlySet<string>;
  /** The section holding the selection, open even if folded. */
  shown: SectionId | null;
  onToggle: (id: SectionId, open: boolean) => void;
  children: ReactNode;
}

/** A panel section whose title folds it away. */
function PanelSection({ id, title, actions, collapsed, shown, onToggle, children }: SectionProps) {
  const open = !collapsed.has(id) || id === shown;
  return (
    <section className={open ? '' : 'collapsed'}>
      <header className="section-head">
        <button className="section-toggle" aria-expanded={open} onClick={() => onToggle(id, !open)}>
          <ChevronRight className="chevron" aria-hidden="true" />
          <h3>{title}</h3>
        </button>
        {actions && <div onClickCapture={() => onToggle(id, true)}>{actions}</div>}
      </header>
      {open && children}
    </section>
  );
}

function LayoutPanel({ s, selected, onSelect, onRemove }: PanelProps) {
  const [collapsed, setCollapsed] = useState(() => new Set(collapsedPref.load()));
  // A guide selected on the page shows its settings, even in a folded section.
  const shown = selected ? SECTION_OF[selected.kind] : null;
  const toggle = (id: SectionId, open: boolean) => {
    // Folding the selection's section lets the selection go.
    if (!open && id === shown) onSelect(null);
    const next = new Set(collapsed);
    if (open) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    collapsedPref.save([...next]);
  };
  const fold = { collapsed, shown, onToggle: toggle };
  const drop = dropGuide(s);
  const units = UNITS[s.layout];
  const terms = TERMS[s.layout];
  const addLine = (axis: Axis) => {
    const size = axis === 'vertical' ? s.pageW : s.pageH;
    const id = newGuideId();
    const at = Math.round(size / 3 / units.snap) * units.snap;
    projectStore.apply((d) => void d.settings.lines.push({ id, axis, at }));
    onSelect({ kind: 'line', id });
  };
  const addBorder = () => {
    const id = newGuideId();
    projectStore.apply((d) => {
      const last = d.settings.borders.at(-1);
      const step = units.guideStep;
      const b: BorderGuide = { id, kind: 'even', inset: (last ? edgesOf(last).top : step) + step };
      clampBorder(b, s);
      d.settings.borders.push(b);
    });
    onSelect({ kind: 'border', id });
  };
  const center = (axis: Axis, label: string) => {
    const sel: Selection = { kind: 'center', axis };
    const key = axis === 'vertical' ? 'centerV' : 'centerH';
    return (
      <label className={`check pick${same(selected, sel) ? ' selected' : ''}`} onPointerDown={() => onSelect(sel)}>
        <input
          type="checkbox"
          checked={s[key]}
          onChange={(e) => projectStore.apply((d) => void (d.settings[key] = e.target.checked))}
        />
        {label}
      </label>
    );
  };

  return (
    <aside className="inspector layout-panel">
      <PanelSection id="page" title="Spreads" {...fold}>
        <PageSizeFields />
        <label className="check">
          <input
            type="checkbox"
            checked={s.keepRelative}
            onChange={(e) => projectStore.apply((d) => void (d.settings.keepRelative = e.target.checked))}
          />
          Keep photos relative to guides
        </label>
        <p className="help">
          {s.keepRelative
            ? 'When the size changes, photos move and scale with the guides.'
            : 'When the size changes, photos keep their exact position.'}
        </p>
      </PanelSection>

      <PanelSection id="center" title="Center lines" {...fold}>
        <div className="inline">
          {center('vertical', 'Vertical')}
          {center('horizontal', 'Horizontal')}
        </div>
      </PanelSection>

      <PanelSection
        id="borders"
        title="Border guides"
        {...fold}
        actions={
          <button
            className="btn ghost icon small"
            aria-label="Add border guide"
            title="Add border guide"
            onClick={addBorder}
          >
            <Plus />
          </button>
        }
      >
        {s.borders.length === 0 && <p className="help">None. Dropped photos fill the page.</p>}
        {s.borders.map((g) => (
          <BorderRow
            key={g.id}
            g={g}
            s={s}
            isDrop={g.id === drop?.id}
            selected={same(selected, { kind: 'border', id: g.id })}
            onSelect={() => onSelect({ kind: 'border', id: g.id })}
            onRemove={() => onRemove({ kind: 'border', id: g.id })}
          />
        ))}
      </PanelSection>

      <PanelSection
        id="lines"
        title="Guides"
        {...fold}
        actions={
          <>
            <button
              className="btn ghost icon small"
              aria-label="Add horizontal guide"
              title="Add horizontal guide"
              onClick={() => addLine('horizontal')}
            >
              <SeparatorHorizontal />
            </button>
            <button
              className="btn ghost icon small"
              aria-label="Add vertical guide"
              title="Add vertical guide"
              onClick={() => addLine('vertical')}
            >
              <SeparatorVertical />
            </button>
          </>
        }
      >
        {s.lines.length === 0 && <p className="help">Drag from a ruler to add one.</p>}
        {s.lines.map((l) => (
          <div
            key={l.id}
            className={`inline guide-row pick${same(selected, { kind: 'line', id: l.id }) ? ' selected' : ''}`}
            onPointerDown={() => onSelect({ kind: 'line', id: l.id })}
          >
            <span className="guide-kind">{l.axis === 'horizontal' ? 'Horizontal' : 'Vertical'}</span>
            <NumberField
              units={units}
              suffix={false}
              value={l.at}
              min={0}
              onCommit={(n) =>
                projectStore.apply(
                  (d) => {
                    const line = d.settings.lines.find((x) => x.id === l.id);
                    const size = l.axis === 'vertical' ? s.pageW : s.pageH;
                    if (line) line.at = Math.min(units.round(n), size - units.nudge);
                  },
                  { coalesce: `line:${l.id}` },
                )
              }
            />
            <button
              className="btn ghost icon small"
              aria-label="Remove guide"
              onClick={() => onRemove({ kind: 'line', id: l.id })}
            >
              <X />
            </button>
          </div>
        ))}
      </PanelSection>

      <p className="help layout-note">
        {terms.guidesNote} Distances in {terms.unitName}. Shift snaps a dragged guide to {units.snapLabel}.
      </p>
    </aside>
  );
}

interface BorderRowProps {
  g: BorderGuide;
  s: Sheet;
  isDrop: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

/** A border guide's settings. A linked (even) guide edits all four distances at once. */
function BorderRow({ g, s, isDrop, selected, onSelect, onRemove }: BorderRowProps) {
  const e = edgesOf(g);
  const units = UNITS[s.layout];
  const terms = TERMS[s.layout];
  const linked = g.kind === 'even';
  const update = (change: (b: BorderGuide) => BorderGuide, coalesce?: string) =>
    projectStore.apply(
      (d) => {
        const i = d.settings.borders.findIndex((x) => x.id === g.id);
        const current = d.settings.borders[i];
        if (!current) return;
        const next = change(current);
        clampBorder(next, s);
        d.settings.borders[i] = next;
      },
      coalesce ? { coalesce: `border:${g.id}:${coalesce}` } : {},
    );
  const set = (edge: keyof Edges, n: number) =>
    update((b) => (b.kind === 'even' ? { ...b, inset: n } : { ...b, [edge]: n }), linked ? 'inset' : edge);
  // Unlinking keeps the distance on every edge; linking gives all four the top's.
  const toggleLinked = () =>
    update((b) =>
      b.kind === 'even' ? { id: b.id, kind: 'edges', ...edgesOf(b) } : { id: b.id, kind: 'even', inset: b.top },
    );

  return (
    <div className={`border-guide pick${selected ? ' selected' : ''}`} onPointerDown={onSelect}>
      <div className="grid2">
        {EDGES[s.layout].map((edge) => (
          <NumberField
            key={edge}
            label={terms.edges[edge]}
            value={e[edge]}
            units={units}
            suffix={false}
            min={0}
            onCommit={(n) => set(edge, units.round(n))}
          />
        ))}
      </div>
      <div className="inline border-tools">
        <button
          className={`drop-toggle${isDrop ? ' on' : ''}`}
          aria-pressed={isDrop}
          onClick={() => projectStore.apply((d) => void (d.settings.dropBorder = g.id))}
          data-tip={
            isDrop
              ? `Photos dropped on a ${terms.page} fit inside this guide.`
              : `Fit photos dropped on a ${terms.page} inside this guide instead.`
          }
        >
          On drop
        </button>
        <span className="spacer" />
        <button
          className={`btn ghost icon small${linked ? ' active' : ''}`}
          aria-label={linked ? 'Unlink edges' : 'Link edges'}
          aria-pressed={linked}
          title={linked ? 'Edges linked: editing one sets all four' : 'Link edges (all four take the top distance)'}
          onClick={toggleLinked}
        >
          {linked ? <Link2 /> : <Link2Off />}
        </button>
        <button className="btn ghost icon small" aria-label="Remove border guide" onClick={onRemove}>
          <X />
        </button>
      </div>
    </div>
  );
}
