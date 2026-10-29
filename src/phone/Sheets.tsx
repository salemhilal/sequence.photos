import type { ReactNode } from 'react';

/** One choice in an action sheet. */
export interface Action {
  label: string;
  detail?: string;
  danger?: boolean;
  run: () => void;
}

/** iOS's action sheet: choices over the screen, and Cancel apart from them. */
export function ActionSheet({
  title,
  head,
  actions,
  onCancel,
}: {
  title?: string;
  head?: ReactNode;
  actions: readonly Action[];
  onCancel: () => void;
}) {
  return (
    <>
      <div className="dim" onClick={onCancel} />
      <div className="actions" role="dialog" aria-label={title}>
        <div className="actions-group">
          {(title || head) && (
            <div className="actions-head">
              {head}
              {title}
            </div>
          )}
          {actions.map((a) => (
            <button key={a.label} className={`act${a.danger ? ' danger' : ''}`} onClick={a.run}>
              {a.label}
              {a.detail && <small>{a.detail}</small>}
            </button>
          ))}
        </div>
        <div className="actions-group">
          <button className="act cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

/** A sheet over the screen, with a title, a button each side of it, and what it holds. */
export function Sheet({
  title,
  left,
  right,
  full = false,
  children,
  foot,
  onDismiss,
}: {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  full?: boolean;
  children: ReactNode;
  foot?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <>
      {!full && <div className="dim" onClick={onDismiss} />}
      <div className={`sheet${full ? ' full' : ''}`} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <div style={{ minWidth: 72, display: 'flex' }}>{left}</div>
          <span className="nav-title">{title}</span>
          <div style={{ minWidth: 72, display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
        </div>
        <div className="sheet-body">{children}</div>
        {foot && <div className="sheet-foot">{foot}</div>}
      </div>
    </>
  );
}

/** A choice of a few, as iOS's segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: ReactNode; aria?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} aria-label={o.aria} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
