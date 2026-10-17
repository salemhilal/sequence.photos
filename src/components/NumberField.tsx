import { useState } from 'react';
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
  /** Called when editing starts and ends (focus and blur). */
  onBegin?: () => void;
  onEnd?: () => void;
  /** Commit only when done (blur or Enter; Escape reverts) instead of as you type. */
  commitOnBlur?: boolean;
}

/** Numeric input that commits valid values as you type and reverts invalid ones on blur. */
export function NumberField({
  value,
  onCommit,
  units,
  min,
  label,
  ariaLabel,
  disabled,
  suffix = true,
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

  return (
    <label className="num-field">
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
      {suffix && <span className="num-suffix">{units.suffix}</span>}
    </label>
  );
}
