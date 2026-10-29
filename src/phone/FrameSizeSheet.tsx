import { useId, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { projectStore, useProject } from '../store';
import { framesOf } from './frameActions';
import { SIZES, setupOf, withFrameSetup } from './frameSetup';
import { FrameView } from './FrameView';
import { Sheet } from './Sheets';

/** The largest a side gets, and the smallest, in pixels. */
const MAX_SIDE = 8000;
const MIN_SIDE = 100;

const clampSide = (n: number) => Math.round(Math.max(MIN_SIDE, Math.min(MAX_SIDE, n || 0)));

/** Frame size: a preset or a custom size, and the guides; Apply makes it one undo step. */
export function FrameSizeSheet({ onDone }: { onDone: () => void }) {
  const { project } = useProject();
  const [setup, setSetup] = useState(() => setupOf(project));
  const [custom, setCustom] = useState(() => !SIZES.some((s) => s.w === setup.w && s.h === setup.h));
  const preview = useMemo(() => withFrameSetup(project, setup), [project, setup]);
  const apply = () => {
    const was = setupOf(project);
    if (JSON.stringify(was) !== JSON.stringify(setup)) projectStore.replace(preview);
    onDone();
  };
  const thumb = Math.min(64, (64 * setup.w) / setup.h);

  return (
    <Sheet
      title="Frame size"
      onDismiss={onDone}
      left={
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
      }
      right={
        <button className="btn" style={{ fontWeight: 600 }} onClick={apply}>
          Apply
        </button>
      }
    >
      <div className="strip" style={{ alignItems: 'flex-end' }}>
        {framesOf(preview).map((f) => (
          <FrameView key={f.id} frame={f} page={preview.page} photos={preview.photos} width={thumb} />
        ))}
      </div>
      <div>
        <div className="label">Size</div>
        <div className="group">
          {SIZES.map((s) => {
            const on = !custom && s.w === setup.w && s.h === setup.h;
            return (
              <button
                key={s.label}
                className="group-row"
                aria-pressed={on}
                onClick={() => {
                  setCustom(false);
                  setSetup({ ...setup, w: s.w, h: s.h });
                }}
              >
                {s.label}
                <span className="value">
                  {s.w} × {s.h}
                </span>
                <span className="tick">{on && <Check />}</span>
              </button>
            );
          })}
          <button className="group-row" aria-pressed={custom} onClick={() => setCustom(true)}>
            Custom
            <span className="value" />
            <span className="tick">{custom && <Check />}</span>
          </button>
        </div>
        {custom && (
          <div className="panel-row" style={{ padding: '10px 0 0' }}>
            <NumberField label="W" value={setup.w} onChange={(w) => setSetup({ ...setup, w: clampSide(w) })} />
            <NumberField label="H" value={setup.h} onChange={(h) => setSetup({ ...setup, h: clampSide(h) })} />
          </div>
        )}
      </div>
      <div>
        <div className="label">Guides</div>
        <div className="group">
          <div className="group-row">
            Border
            <span style={{ marginLeft: 'auto', width: 110 }}>
              <NumberField
                label="px"
                after
                value={setup.inset}
                onChange={(inset) => setSetup({ ...setup, inset: Math.max(0, Math.round(inset || 0)) })}
              />
            </span>
          </div>
          <button
            className="group-row"
            role="switch"
            aria-checked={setup.center}
            onClick={() => setSetup({ ...setup, center: !setup.center })}
          >
            Center lines
            <span className="switch" />
          </button>
        </div>
      </div>
      <span className="note">
        Photos dropped on a frame fit inside the border. Applies to every frame, as one undo step.
      </span>
    </Sheet>
  );
}

/**
 * A number typed in a field, taken when it's done (Return, or leaving it), so a half-typed
 * one doesn't apply on the way.
 */
export function NumberField({
  label,
  value,
  onChange,
  after = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  after?: boolean;
}) {
  const shown = String(Math.round(value * 10) / 10);
  const [text, setText] = useState<string | null>(null);
  const take = () => {
    if (text === null) return;
    const n = Number(text);
    setText(null);
    if (Number.isFinite(n) && text.trim() !== '') onChange(n);
  };
  const id = useId();
  return (
    <div className="field">
      {!after && <label htmlFor={id}>{label}</label>}
      <input
        id={id}
        inputMode="decimal"
        enterKeyHint="done"
        value={text ?? shown}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={take}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {after && <label htmlFor={id}>{label}</label>}
    </div>
  );
}
