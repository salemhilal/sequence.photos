import { useId } from 'react';
import { usePageDraft } from './pageDraft';
import {
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

const ARRANGEMENTS: { value: Arrangement; label: string }[] = [
  { value: 'spreads', label: 'Spreads' },
  { value: 'frames', label: 'Frames' },
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
      suffix={false}
      value={draft.page[dim]}
      // Applied as it's made: once the number is typed, not at every keystroke.
      commitOnBlur={immediate}
      onCommit={(n) => onChange({ ...draft, page: { ...draft.page, [dim]: units.round(n) } })}
    />
  );

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

      <span className="field-label">Size</span>
      <div className="size-form">
        <div className="inline">
          {field('w', 'W')}
          {field('h', 'H')}
          <select aria-label="Unit" value={draft.page.unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            <option value="in">in</option>
            <option value="px">px</option>
          </select>
        </div>
        <select
          aria-label="Preset"
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

      <span className="field-label">{printAt ? 'Print at' : 'Resolution'}</span>
      <div className="size-form">
        {draft.page.unit === 'in' ? (
          <div className="inline dpi">
            <NumberField
              units={UNITS.px}
              min={1}
              suffix={false}
              value={draft.page.pxPerUnit}
              ariaLabel={printAt ? 'Print at, in dpi' : 'Resolution, in dpi'}
              commitOnBlur={immediate}
              onCommit={(n) => setDpi(Math.max(1, Math.round(n)))}
            />
            <span className="muted data">dpi</span>
          </div>
        ) : (
          <span className="muted data" data-tip="Pixel density" role="img" aria-label="Pixel density 1×">
            1×
          </span>
        )}
      </div>

      {showContent && (
        <fieldset className="page-content" disabled={!contentMatters}>
          <legend className="field-label">Content</legend>
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
          <p className="help">
            {contentMatters ? CONTENT.find((c) => c.value === draft.content)?.help : 'Matters when the size changes.'}
          </p>
        </fieldset>
      )}

      {!immediate && (
        <div className="inline">
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
