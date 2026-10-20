import { useId } from 'react';
import { usePageDraft } from './pageDraft';
import { ArrowLeftRight } from 'lucide-react';
import type { Anchor } from '../convertLayout';
import {
  anchorFor,
  applyPageSetup,
  draftOf,
  draftWithDpi,
  draftWithUnit,
  pageSetupBase,
  printsAt,
  presetOf,
  resizes,
  sameDraft,
  withPreset,
  type Content,
  type PageDraft,
} from '../pageSetup';
import { useProject } from '../store';
import type { Arrangement, Unit } from '../types';
import { PRESETS, UNITS } from '../units';
import { NumberField } from './NumberField';
import { Segmented } from './Segmented';

const UNIT_CHOICES: { value: Unit; label: string }[] = [
  { value: 'in', label: 'Inches' },
  { value: 'px', label: 'Pixels' },
];

const ARRANGEMENTS: { value: Arrangement; label: string }[] = [
  { value: 'spreads', label: 'Spreads' },
  { value: 'frames', label: 'Frames' },
];

/** What photos kept fixed stay put relative to, on each page: spreads also have an inside edge. */
const FRAME_ANCHORS: { value: Anchor; label: string }[] = [
  { value: 'center', label: 'Center' },
  { value: 'top-left', label: 'Top left' },
];
const SPREAD_ANCHORS: { value: Anchor; label: string }[] = [
  ...FRAME_ANCHORS,
  { value: 'inside', label: 'Inside edge' },
];

const CONTENT: { value: Content; label: string; help: string }[] = [
  { value: 'rescale', label: 'Rescale with layout', help: 'Photos move and scale with the guides.' },
  {
    value: 'fixed',
    label: 'Keep fixed',
    help: 'Photos keep their size and place, so their resolution stays the same.',
  },
];

interface Props {
  draft: PageDraft;
  onChange: (d: PageDraft) => void;
  /** Show the choice of what photos do (not on a new project's card, where none are placed). */
  showContent: boolean;
  /** Apply each change as it's made, with no Apply button (a new, empty project: nothing to preview). */
  immediate?: boolean;
}

/**
 * The page's settings: spreads or frames, its size and unit (or a preset), its resolution,
 * and what photos do when the size changes. Changes wait for Apply, which makes them one
 * undo step. Used in the Layout view's Page tab and on a new project's empty desk.
 */
export function PageSettings({ draft, onChange: change, showContent, immediate = false }: Props) {
  // Unique per copy: the new-project card and the Layout view can both be open.
  const id = useId();
  const { project } = useProject();
  const base = pageSetupBase();
  const units = UNITS[draft.page.unit];
  const changed = !sameDraft(draft, draftOf(project));
  const onChange = immediate ? applyPageSetup : change;
  const preset = presetOf(draft);
  // What's shown follows the project; only conversions start from `base` (see pageSetup.ts).
  const printAt = printsAt(project, draft);
  const contentMatters = changed && resizes(base, draft);
  const note =
    draft.arrangement !== project.layout.kind
      ? draft.arrangement === 'frames'
        ? 'Each page becomes a frame.'
        : 'Frames pair up into spreads.'
      : null;

  const setUnit = (unit: Unit) => {
    if (unit !== draft.page.unit) onChange(draftWithUnit(base, draft, unit));
  };
  const setDpi = (dpi: number) => onChange(draftWithDpi(base, project, draft, dpi));
  const field = (dim: 'w' | 'h', label: string) => (
    <NumberField
      label={label}
      units={units}
      min={units.minSize}
      value={draft.page[dim]}
      // Applied as it's made: once the number is typed, not at every keystroke.
      commitOnBlur={immediate}
      onCommit={(n) => onChange({ ...draft, page: { ...draft.page, [dim]: units.round(n) } })}
    />
  );

  const anchors = draft.arrangement === 'spreads' ? SPREAD_ANCHORS : FRAME_ANCHORS;

  return (
    <form
      className="layout-fields page-settings"
      // Values are checked here: the browser's own check would hold sizes to the arrow keys' step.
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        applyPageSetup(draft);
      }}
    >
      {/* The settings scroll; Apply and Revert stay below them. */}
      <div className="page-settings-body">
        <div className="field-row">
          <span className="field-label" id={`${id}-pages`}>
            Pages
          </span>
          <Segmented
            halves
            labelledBy={`${id}-pages`}
            options={ARRANGEMENTS}
            value={draft.arrangement}
            onChange={(arrangement) => onChange({ ...draft, arrangement })}
          />
          {note && <p className="help">{note}</p>}
        </div>

        <div className="field-row">
          <span className="field-label" id={`${id}-preset`}>
            Preset
          </span>
          <select
            className="select"
            aria-labelledby={`${id}-preset`}
            value={preset?.label ?? ''}
            onChange={(e) => {
              const p = PRESETS.find((x) => x.label === e.target.value);
              if (p) onChange(withPreset(draft, p));
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label} · {p.page.w} × {p.page.h} {p.page.unit}
              </option>
            ))}
            {!preset && <option value="">Custom</option>}
          </select>
        </div>

        <div className="field-row">
          <span className="field-label" id={`${id}-unit`}>
            Unit
          </span>
          <Segmented
            halves
            labelledBy={`${id}-unit`}
            options={UNIT_CHOICES}
            value={draft.page.unit}
            onChange={setUnit}
          />
        </div>

        <div className="field-row">
          <span className="field-label">Size</span>
          <div className="inline size-fields">
            {field('w', 'W')}
            <button
              type="button"
              className="btn ghost icon small"
              aria-label="Swap width and height"
              data-tip="Swap width and height"
              onClick={() => onChange({ ...draft, page: { ...draft.page, w: draft.page.h, h: draft.page.w } })}
            >
              <ArrowLeftRight />
            </button>
            {field('h', 'H')}
          </div>
        </div>

        <div className="field-row">
          <span className="field-label">{printAt ? 'Print at' : 'Resolution'}</span>
          {draft.page.unit === 'in' ? (
            <NumberField
              units={UNITS.px}
              min={1}
              suffixText="dpi"
              value={draft.page.pxPerUnit}
              ariaLabel={printAt ? 'Print at, in dpi' : 'Resolution, in dpi'}
              commitOnBlur={immediate}
              onCommit={(n) => setDpi(Math.max(1, Math.round(n)))}
            />
          ) : (
            <span
              className="data"
              data-tip="Pixel density"
              role="img"
              aria-label={`Pixel density ${draft.page.pxPerUnit}×`}
            >
              {draft.page.pxPerUnit}×
            </span>
          )}
        </div>

        {showContent && (
          // A label, not a legend: a legend can't sit in the row's label column.
          <fieldset className="field-row page-content" disabled={!contentMatters} aria-labelledby={`${id}-content`}>
            <span className="field-label" id={`${id}-content`}>
              Content
            </span>
            <div className="page-content-choices">
              {CONTENT.map((c) => (
                <label key={c.value} className="check">
                  <input
                    type="radio"
                    name={`${id}-content`}
                    checked={draft.content === c.value}
                    onChange={() => onChange({ ...draft, content: c.value })}
                  />
                  {c.label}
                </label>
              ))}
            </div>
            {contentMatters && draft.content === 'fixed' && (
              <>
                <span className="field-label" id={`${id}-anchor`}>
                  Relative to
                </span>
                <Segmented
                  labelledBy={`${id}-anchor`}
                  options={anchors}
                  value={anchorFor(draft)}
                  onChange={(anchor) => onChange({ ...draft, anchor })}
                />
              </>
            )}
            <p className="help">
              {contentMatters ? CONTENT.find((c) => c.value === draft.content)?.help : 'Matters when the size changes.'}
            </p>
          </fieldset>
        )}
      </div>

      {!immediate && (
        <div className="inline page-settings-actions">
          <button type="submit" className={`btn${changed ? ' primary' : ''}`} disabled={!changed}>
            Apply
          </button>
          {changed && (
            <button type="button" className="btn ghost" onClick={() => change(draftOf(project))}>
              Revert
            </button>
          )}
        </div>
      )}
    </form>
  );
}

/**
 * The page's settings on a new project's card: applied as they're made, since an empty
 * project has nothing to preview and adding photos shouldn't leave a choice behind.
 */
export function OwnPageSettings() {
  const [draft, setDraft] = usePageDraft();
  return <PageSettings draft={draft} onChange={setDraft} showContent={false} immediate />;
}
