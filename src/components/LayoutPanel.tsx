import { useState, type ReactNode } from 'react';
import { ChevronRight, Link2, Link2Off, Plus, SeparatorHorizontal, SeparatorVertical, X } from 'lucide-react';
import { clampBorder, dropGuide, edgesOf } from '../geometry';
import { newGuideId } from '../ids';
import { collapsedPref } from '../prefs';
import { projectStore } from '../store';
import type { BorderGuide, Edges, LayoutKind, Sheet } from '../types';
import { TERMS, UNITS } from '../units';
import { NumberField } from './NumberField';
import { PageSizeFields } from './PageSizeFields';
import { same, type Axis, type Selection } from './layoutSelection';

/**
 * The Layout view's settings: the size, center lines, border guides, and guides from the
 * rulers. Selecting a guide here or on the page highlights it in both.
 */

/** A border guide's fields, in pairs: a frame's left before its right. */
const EDGES: Record<LayoutKind, (keyof Edges)[]> = {
  print: ['top', 'bottom', 'inside', 'outside'],
  digital: ['top', 'bottom', 'outside', 'inside'],
};

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

export function LayoutPanel({ s, selected, onSelect, onRemove }: PanelProps) {
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
