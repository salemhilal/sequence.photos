import { useRef, useState, type ReactNode } from 'react';

/** How long a sheet takes to slide away (phone.css's --quick), in ms. */
const LEAVE_MS = 220;

/** Slide the sheet away, then do `then` (which takes it off the screen). */
export type Close = (then?: () => void) => void;

/** What a sheet's parts may be: as they are, or made with its `close`, to slide it away first. */
type Part = ReactNode | ((close: Close) => ReactNode);

/** A sheet's leaving: whether it's on its way out, and how to send it. */
function useLeave(dismiss?: () => void): [boolean, Close] {
  const [leaving, setLeaving] = useState(false);
  const gone = useRef(false);
  const close: Close = (then) => {
    if (gone.current) return;
    gone.current = true;
    setLeaving(true);
    setTimeout(() => (then ?? dismiss)?.(), LEAVE_MS);
  };
  return [leaving, close];
}

/** One choice in an action sheet. */
export interface Action {
  label: string;
  detail?: string;
  danger?: boolean;
  run: () => void;
}

/** iOS's action sheet: choices over the screen, and Cancel apart from them. It slides in and out. */
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
  const [leaving, close] = useLeave(onCancel);
  return (
    <>
      <div className={`dim${leaving ? ' leaving' : ''}`} onClick={() => close()} />
      <div className={`actions${leaving ? ' leaving' : ''}`} role="dialog" aria-label={title}>
        <div className="actions-group">
          {(title || head) && (
            <div className="actions-head">
              {head}
              {title}
            </div>
          )}
          {actions.map((a) => (
            <button key={a.label} className={`act${a.danger ? ' danger' : ''}`} onClick={() => close(a.run)}>
              {a.label}
              {a.detail && <small>{a.detail}</small>}
            </button>
          ))}
        </div>
        <div className="actions-group">
          <button className="act cancel" onClick={() => close()}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * A sheet over the screen, with a title, a button each side of it, what it holds, and a foot
 * that stays put while that scrolls. It slides up, and away again when its parts call `close`.
 */
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
  left?: Part;
  right?: Part;
  full?: boolean;
  children: Part;
  foot?: Part;
  onDismiss?: () => void;
}) {
  const [leaving, close] = useLeave(onDismiss);
  const made = (p: Part) => (typeof p === 'function' ? p(close) : p);
  return (
    <>
      {!full && <div className={`dim${leaving ? ' leaving' : ''}`} onClick={() => close()} />}
      <div className={`sheet${full ? ' full' : ''}${leaving ? ' leaving' : ''}`} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <div style={{ minWidth: 72, display: 'flex' }}>{made(left)}</div>
          <span className="nav-title">{title}</span>
          <div style={{ minWidth: 72, display: 'flex', justifyContent: 'flex-end' }}>{made(right)}</div>
        </div>
        <div className="sheet-body">{made(children)}</div>
        {foot && <div className="sheet-foot">{made(foot)}</div>}
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
