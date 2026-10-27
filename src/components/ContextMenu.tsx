import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Copy, CopyPlus, Crop as CropIcon, Eye, LayoutGrid, Trash2, Undo2 } from 'lucide-react';
import { deleteFromProject, locate, putInPile, setCrop, tidyPile } from '../actions';
import { cropToRatio, isWhole, pageShape, visibleSize } from '../crop';
import { sheetOf } from '../spreads';
import type { PhotoId } from '../ids';
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
        className="menu-item"
        role="menuitem"
        onClick={() => {
          startCropping(menu.photoId);
          onClose();
        }}
      >
        <CropIcon />
        <span className="menu-label">Crop…</span>
        <kbd className="menu-shortcut">{shortcutLabel('crop')}</kbd>
      </button>
      <CropToMenu photoId={menu.photoId} onClose={onClose} />
      {!isWhole(project.photos[menu.photoId]?.crop) && (
        <button
          className="menu-item"
          role="menuitem"
          onClick={() => {
            projectStore.apply((d) => setCrop(d, menu.photoId, undefined));
            onClose();
          }}
        >
          <span className="menu-icon-space" />
          <span className="menu-label">Reset crop</span>
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

/** Crop mode on a photo: on the desk where it is, or for one on a page, in its spread's editor. */
function startCropping(photoId: PhotoId): void {
  const at = locate(projectStore.project, photoId);
  if (!at) return;
  if (at.where === 'desk') ui.set({ cropping: photoId, selection: [photoId] });
  else ui.set({ editingSpreadId: at.spread.id, editorSelect: photoId, cropping: photoId });
}

/** Crop to ›: the common shapes, and the page's, each as large as the photo allows. */
function CropToMenu({ photoId, onClose }: { photoId: PhotoId; onClose: () => void }) {
  const { project } = useProject();
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const photo = project.photos[photoId];
  if (!photo) return null;
  const page = pageShape(sheetOf(project));
  const shapes = [
    { label: 'Square', note: '1:1', ratio: 1 },
    { label: '4:5', note: '', ratio: 4 / 5 },
    { label: '3:2', note: '', ratio: 3 / 2 },
    { label: '16:9', note: '', ratio: 16 / 9 },
    { label: `The ${page.label.toLowerCase()}`, note: '', ratio: page.ratio },
  ];
  const { pxW, pxH } = visibleSize(photo);
  const now = pxW / pxH;
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    setFlip(!!r && r.right + 200 > window.innerWidth);
    setOpen(true);
  };
  return (
    <div ref={ref} className="menu-sub" onPointerEnter={show} onPointerLeave={() => setOpen(false)}>
      <button
        className={`menu-item${open ? ' active' : ''}`}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={show}
      >
        <span className="menu-icon-space" />
        <span className="menu-label">Crop to</span>
        <ChevronRight />
      </button>
      {open && (
        <div className={`menu-list context-submenu${flip ? ' flip' : ''}`} role="menu" aria-label="Crop to">
          {shapes.map((shape) => (
            <button
              key={shape.label}
              className="menu-item"
              role="menuitemradio"
              aria-checked={Math.abs(shape.ratio - now) < 0.005}
              onClick={() => {
                projectStore.apply((d) => setCrop(d, photoId, cropToRatio(photo, shape.ratio)));
                onClose();
              }}
            >
              {Math.abs(shape.ratio - now) < 0.005 ? <Check /> : <span className="menu-icon-space" />}
              <span className="menu-label">{shape.label}</span>
              {shape.note && <span className="menu-shortcut">{shape.note}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
