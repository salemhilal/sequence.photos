import { useId, useState } from 'react';
import { setPageSize, switchLayout } from '../pageSize';
import { sheetOf } from '../spreads';
import { useProject } from '../store';
import type { LayoutKind, Size } from '../types';
import { FRAME_PRESETS, UNITS } from '../units';
import { NumberField } from './NumberField';
import { Segmented } from './Segmented';

const KINDS: { value: LayoutKind; label: string }[] = [
  { value: 'print', label: 'For print' },
  { value: 'digital', label: 'For digital' },
];

/**
 * What the project is (a print book or a digital sequence) and its page or frame size, in
 * inches or pixels. Changes wait for Apply, the format included, so the project changes
 * once, not with every keystroke or click. Used in the Layout view and on a new project's
 * empty desk.
 */
export function PageSizeFields() {
  const { project } = useProject();
  const sheet = sheetOf(project);
  const current: Size = { w: sheet.pageW, h: sheet.pageH };
  // A new form whenever the project changes some other way (undo, another copy's Apply).
  return (
    <LayoutForm
      key={`${sheet.layout}:${current.w}x${current.h}`}
      kind={sheet.layout}
      current={current}
      remembered={project.settings.sizes}
    />
  );
}

interface FormProps {
  kind: LayoutKind;
  current: Size;
  /** Each format's last size, for when the toggle picks the other one. */
  remembered: Record<LayoutKind, Size>;
}

function LayoutForm({ kind: currentKind, current, remembered }: FormProps) {
  // Unique per copy: the new-project card and the Layout view can both be open.
  const id = useId();
  const [kind, setKind] = useState<LayoutKind>(currentKind);
  const [draft, setDraft] = useState<Size>(current);
  const units = UNITS[kind];
  const switching = kind !== currentKind;
  const changed = switching || draft.w !== current.w || draft.h !== current.h;
  const preset = FRAME_PRESETS.find((p) => p.size.w === draft.w && p.size.h === draft.h);
  const apply = () => {
    if (switching) switchLayout(kind, draft);
    else if (changed) setPageSize(draft);
  };
  const pick = (k: LayoutKind) => {
    setKind(k);
    setDraft(k === currentKind ? current : { ...remembered[k] });
  };
  const revert = () => {
    setKind(currentKind);
    setDraft(current);
  };
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
      className="layout-fields"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <span className="field-label" id={`${id}-label`}>
        Layout format
      </span>
      <Segmented halves labelledBy={`${id}-label`} options={KINDS} value={kind} onChange={pick} />
      <div className="size-form">
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
        {switching && (
          <p className="help">
            {kind === 'digital'
              ? 'Apply to make this a digital sequence: each page becomes a frame.'
              : 'Apply to make this a print book: frames pair up into spreads.'}
          </p>
        )}
        <div className="inline">
          <button type="submit" className={`btn${changed ? ' primary' : ''}`} disabled={!changed}>
            Apply
          </button>
          {changed && (
            <button
              type="button"
              className="btn ghost"
              title={`Back to ${current.w} × ${current.h} ${UNITS[currentKind].suffix}`}
              onClick={revert}
            >
              Revert
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
