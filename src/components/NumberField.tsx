import { useRef, useState } from 'react';
import type { Units } from '../units';

interface Props {
  value: number;
  onCommit: (n: number) => void;
  /** The value's units: how it steps and is shown, and the suffix after it. */
  units: Units;
  min?: number;
  label?: string;
  /** Its accessible name, where no label is shown beside it (e.g. "Resolution in dpi"). */
  ariaLabel?: string;
  disabled?: boolean;
  /** Show the units after the number (default); false where they're shown once for a group. */
  suffix?: boolean;
  /** Units shown in place of the units' own (e.g. "dpi" for a resolution counted in pixels). */
  suffixText?: string;
  /** Called when editing starts and ends (focus and blur). */
  onBegin?: () => void;
  onEnd?: () => void;
  /** Commit only when done (blur or Enter; Escape reverts) instead of as you type. */
  commitOnBlur?: boolean;
}

/** Pixels of drag per step when scrubbing. */
const SCRUB_PX = 2;

/**
 * Numeric input that commits valid values as you type and reverts invalid ones on blur.
 * Its label and units sit inside the field; dragging on them scrubs the value, a step
 * every couple of pixels (Shift for ten, Option or Alt for a tenth), as in desktop apps.
 */
export function NumberField({
  value,
  onCommit,
  units,
  min,
  label,
  ariaLabel,
  disabled,
  suffix = true,
  suffixText,
  onBegin,
  onEnd,
  commitOnBlur = false,
}: Props) {
  // While editing, show what's typed; otherwise show the live value.
  const [draft, setDraft] = useState<string | null>(null);
  const { format } = units;

  const parse = (s: string): number | null => {
    const n = Number(s);
    if (s.trim() === '' || !Number.isFinite(n)) return null;
    if (min !== undefined && n < min) return null;
    return n;
  };

  // Set by a scrub, so the click that ends it doesn't also start typing.
  const scrubbed = useRef(false);
  const scrub = (e: React.PointerEvent<HTMLLabelElement>) => {
    if (disabled || e.button !== 0 || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    let last = value;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved) {
        if (Math.abs(dx) < 3) return;
        moved = true;
        onBegin?.();
      }
      const step = units.fieldStep * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1);
      let n = Number((value + Math.round(dx / SCRUB_PX) * step).toFixed(6));
      if (min !== undefined) n = Math.max(min, n);
      if (n === last) return;
      last = n;
      if (commitOnBlur) setDraft(format(n));
      else onCommit(n);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!moved) return;
      scrubbed.current = true;
      if (commitOnBlur && last !== value) onCommit(last);
      setDraft(null);
      onEnd?.();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <label
      className={`num-field${disabled ? ' disabled' : ''}`}
      onPointerDown={scrub}
      onClick={(e) => {
        if (scrubbed.current) e.preventDefault();
        scrubbed.current = false;
      }}
    >
      {label && <span className="num-label">{label}</span>}
      <input
        type="number"
        aria-label={ariaLabel}
        disabled={disabled}
        inputMode="decimal"
        step={units.fieldStep}
        min={min}
        value={draft ?? format(value)}
        onFocus={() => {
          setDraft(format(value));
          onBegin?.();
        }}
        onBlur={() => {
          const n = draft === null ? null : parse(draft);
          if (commitOnBlur && n !== null && n !== value) onCommit(n);
          setDraft(null);
          onEnd?.();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parse(e.target.value);
          if (!commitOnBlur && n !== null && n !== value) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape' && commitOnBlur) {
            // Leave it as it was.
            setDraft(format(value));
            e.stopPropagation();
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
      {suffix && <span className="num-suffix">{suffixText ?? units.suffix}</span>}
    </label>
  );
}
