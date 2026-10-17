import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface MenuItem {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** A line under the label: e.g. why it's disabled. */
  note?: string;
  /** Draw a divider above this item. */
  separatorBefore?: boolean;
}

/** Toolbar dropdown for file actions. Closes on selection, outside click, or Escape. */
export function FileMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      const menuItems = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])];
      const i = menuItems.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        menuItems.at(next % menuItems.length)?.focus();
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={buttonRef}
        className={`btn ghost${open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        File
        <ChevronDown />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((item) => [
            item.separatorBefore && <div key={`${item.label}-sep`} className="menu-separator" />,
            <button
              key={item.label}
              className={`menu-item${item.note ? ' has-note' : ''}`}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              <span className="menu-label">
                <span className="menu-text">{item.label}</span>
                {item.note && <span className="menu-note">{item.note}</span>}
              </span>
              {item.shortcut && <kbd className="menu-shortcut">{item.shortcut}</kbd>}
            </button>,
          ])}
        </div>
      )}
    </div>
  );
}
