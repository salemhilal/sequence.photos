import { useState } from 'react';
import { fmt } from '../geometry';

interface Props {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  step?: number;
  label?: string;
  suffix?: string;
  /** The value as shown (default: inches, eighths exact). */
  format?: (n: number) => string;
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
  min,
  step = 0.125,
  label,
  suffix = 'in',
  format = fmt,
  onBegin,
  onEnd,
  commitOnBlur = false,
}: Props) {
  // While editing, show what's typed; otherwise show the live value.
  const [draft, setDraft] = useState<string | null>(null);

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
        inputMode="decimal"
        step={step}
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
      {suffix && <span className="num-suffix">{suffix}</span>}
    </label>
  );
}
