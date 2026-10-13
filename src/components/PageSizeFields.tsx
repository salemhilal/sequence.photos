import { useId, useState } from 'react';
import { setPageSize, switchLayout } from '../pageSize';
import { sheetOf } from '../spreads';
import { useProject } from '../store';
import type { LayoutKind, Size } from '../types';
import { FRAME_PRESETS, UNITS } from '../units';
import { NumberField } from './NumberField';

const KINDS: { value: LayoutKind; label: string }[] = [
  { value: 'print', label: 'For print' },
  { value: 'digital', label: 'For digital' },
];

/**
 * What the project is (a print book or a digital sequence) and its page or frame size, in
 * inches or pixels. A typed size waits for Apply, so the project changes once, not with
 * every keystroke. Used in the Layout view and on a new project's empty desk.
 */
export function PageSizeFields() {
  const { project } = useProject();
  const sheet = sheetOf(project);
  // Unique per copy: the new-project card and the Layout view can both be open.
  const id = useId();
  const current: Size = { w: sheet.pageW, h: sheet.pageH };
  // A new form whenever the size changes some other way (undo, switching kinds).
  return (
    <div className="layout-fields">
      <span className="field-label" id={`${id}-label`}>
        Layout format
      </span>
      <div className="segmented halves" role="radiogroup" aria-labelledby={`${id}-label`}>
        {KINDS.map((k) => (
          <label key={k.value} className={sheet.layout === k.value ? 'on' : ''}>
            <input
              type="radio"
              name={id}
              value={k.value}
              checked={sheet.layout === k.value}
              onChange={() => switchLayout(k.value)}
            />
            {k.label}
          </label>
        ))}
      </div>
      <SizeForm key={`${sheet.layout}:${current.w}x${current.h}`} kind={sheet.layout} current={current} />
    </div>
  );
}

function SizeForm({ kind, current }: { kind: LayoutKind; current: Size }) {
  const [draft, setDraft] = useState<Size>(current);
  const units = UNITS[kind];
  const changed = draft.w !== current.w || draft.h !== current.h;
  const preset = FRAME_PRESETS.find((p) => p.size.w === draft.w && p.size.h === draft.h);
  const apply = () => changed && setPageSize(draft);
  const field = (dim: 'w' | 'h', label: string) => (
    <NumberField
      label={label}
      units={units}
      min={units.minSize}
      suffix={false}
      value={draft[dim]}
      onCommit={(n) => setDraft((d) => ({ ...d, [dim]: units.round(n) }))}
    />
  );

  return (
    <form
      className="size-form"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      {kind === 'digital' && (
        <select
          aria-label="Size preset"
          value={preset?.label ?? ''}
          onChange={(e) => {
            const p = FRAME_PRESETS.find((x) => x.label === e.target.value);
            if (p) setDraft({ ...p.size });
          }}
        >
          {FRAME_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label} · {p.size.w} × {p.size.h}
            </option>
          ))}
          {!preset && <option value="">Custom</option>}
        </select>
      )}
      <div className="inline">
        {field('w', 'W')}
        {field('h', 'H')}
        <span className="muted data">{units.suffix}</span>
      </div>
      <div className="inline">
        <button type="submit" className={`btn${changed ? ' primary' : ''}`} disabled={!changed}>
          Apply
        </button>
        {changed && (
          <button
            type="button"
            className="btn ghost"
            title={`Back to ${current.w} × ${current.h} ${units.suffix}`}
            onClick={() => setDraft(current)}
          >
            Revert
          </button>
        )}
      </div>
    </form>
  );
}
