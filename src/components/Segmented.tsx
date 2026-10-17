import { useId, type ReactNode } from 'react';

interface Props<T extends string> {
  /** Its accessible name: a label, or the id of the element that shows one. */
  label?: string;
  labelledBy?: string;
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Two choices, each half the control. */
  halves?: boolean;
}

/** A choice of one, as a row of segments: radio buttons underneath. */
export function Segmented<T extends string>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  disabled,
  halves = false,
}: Props<T>) {
  // Its radio group's name, unique to this copy.
  const name = useId();
  return (
    <div
      className={`segmented${halves ? ' halves' : ''}`}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
    >
      {options.map((o) => (
        <label key={o.value} className={value === o.value ? 'on' : ''}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
