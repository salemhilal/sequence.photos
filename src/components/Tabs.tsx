/**
 * Tabs across the top of a panel: for switching between views (Settings' General and
 * Advanced; Layout's Page and Guides). Binary choices within a view use Segmented.
 * `id` names the panel the tabs control (`${id}-panel`, set by the caller).
 */
export function Tabs<T extends string>({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((t) => (
        <button
          key={t.value}
          role="tab"
          id={`${id}-tab-${t.value}`}
          aria-selected={value === t.value}
          aria-controls={`${id}-panel`}
          className={value === t.value ? 'on' : ''}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
