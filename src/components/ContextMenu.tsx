import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, CopyPlus, Eye, LayoutGrid, Trash2, Undo2 } from 'lucide-react';
import { deleteFromProject, locate, putInPile, tidyPile } from '../actions';
import { copyPhotos, duplicateAndSelect } from '../clipboard';
import { shortcutLabel } from '../commands';
import { projectStore, useProject } from '../store';
import { openQuickLook, ui, type ContextMenuState } from '../ui';
import { DeskColorPicker } from './DeskColorPicker';

/** Renders whichever right-click menu is open. */
export function ContextMenus() {
  const menu = ui.use((s) => s.contextMenu);
  if (!menu) return null;
  const close = () => ui.set({ contextMenu: null });
  return (
    <MenuShell key={`${menu.x},${menu.y}`} x={menu.x} y={menu.y} onClose={close}>
      {menu.kind === 'desk' ? <DeskItems onClose={close} /> : <PhotoItems menu={menu} onClose={close} />}
    </MenuShell>
  );
}

/** Positions a menu at the pointer (kept on screen) and closes it on outside click, Escape, or blur. */
function MenuShell({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.min(x, window.innerWidth - r.width - 8),
      top: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu-list context-menu"
      role="menu"
      style={pos}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

function DeskItems({ onClose }: { onClose: () => void }) {
  const { project } = useProject();
  const selection = ui.use((s) => s.selection);
  const tidySelection = selection.length > 1;
  const canTidy = tidySelection || project.pile.length > 1;
  return (
    <>
      <button
        className="menu-item"
        role="menuitem"
        disabled={!canTidy}
        onClick={() => {
          tidyPile(tidySelection ? selection : undefined);
          onClose();
        }}
      >
        <LayoutGrid />
        <span className="menu-label">{tidySelection ? `Tidy up ${selection.length} photos` : 'Tidy up desk'}</span>
      </button>
      <div className="menu-separator" />
      <div className="menu-section">
        <span className="section-label muted">Desk color</span>
        <DeskColorPicker />
      </div>
    </>
  );
}

function PhotoItems({ menu, onClose }: { menu: Extract<ContextMenuState, { kind: 'photo' }>; onClose: () => void }) {
  const { project } = useProject();
  const name = project.photos[menu.photoId]?.name ?? 'Photo';
  const onPage = locate(project, menu.photoId)?.where === 'spread';
  return (
    <>
      <div className="menu-caption data muted" data-tip={name}>
        {name}
      </div>
      <button className="menu-item" role="menuitem" onClick={() => openQuickLook([menu.photoId])}>
        <Eye />
        <span className="menu-label">Quick Look</span>
        {!onPage && <kbd className="menu-shortcut">Space</kbd>}
      </button>
      <button
        className="menu-item"
        role="menuitem"
        onClick={() => {
          // The clipboard write must start inside the click, so it isn't awaited first.
          copyPhotos([menu.photoId]).then(
            () => ui.set({ notice: `Copied ${name}` }),
            () => ui.set({ notice: "Couldn't copy the image. Your browser may not allow it." }),
          );
          onClose();
        }}
      >
        <Copy />
        <span className="menu-label">Copy image</span>
        <kbd className="menu-shortcut">{shortcutLabel('copy')}</kbd>
      </button>
      <button
        className="menu-item"
        role="menuitem"
        onClick={() => {
          void duplicateAndSelect([menu.photoId]);
          onClose();
        }}
      >
        <CopyPlus />
        <span className="menu-label">Duplicate</span>
        <kbd className="menu-shortcut">{shortcutLabel('duplicate')}</kbd>
      </button>
      {onPage && (
        <button
          className="menu-item"
          role="menuitem"
          onClick={() => {
            projectStore.apply((d) => putInPile(d, menu.photoId));
            onClose();
          }}
        >
          <Undo2 />
          <span className="menu-label">Return to desk</span>
        </button>
      )}
      <div className="menu-separator" />
      <button
        className="menu-item danger"
        role="menuitem"
        onClick={() => {
          deleteFromProject([menu.photoId]);
          ui.set({ notice: `Deleted ${name}. Undo to bring it back.` });
          onClose();
        }}
      >
        <Trash2 />
        <span className="menu-label">Delete</span>
      </button>
    </>
  );
}
