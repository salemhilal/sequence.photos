import { useState } from 'react';
import { Copy, Crop, Crosshair, Link2, Maximize, Plus } from 'lucide-react';
import { duplicatePhotos } from '../actions';
import { borderBox, dropGuide, pageRect } from '../geometry';
import type { PhotoId } from '../ids';
import { usePhotoUrl } from '../images';
import { resolutionNote } from '../resolution';
import { sheetOf } from '../spreads';
import { projectStore, useProject } from '../store';
import type { Frame, Ink, Placement } from '../types';
import { centerPhoto, deskPhotos, fitPhoto, framesOf, setBackground, setBorder } from './frameActions';
import { NumberField } from './FrameSizeSheet';
import { addPhotoFiles, pickPhotos } from './importing';
import { navigate, phone } from './nav';
import { ActionSheet, Segmented } from './Sheets';

/** How far a finger goes up before a desk photo comes off the tray, in screen pixels. */
const LIFT = 8;
/** The widest border the slider gives, as a share of the frame's width. */
const MAX_BORDER = 0.06;

const INKS: readonly { value: Ink; label: React.ReactNode; aria: string }[] = [
  {
    value: 'white',
    label: (
      <>
        <span className="swatch" style={{ background: '#fff' }} />
        White
      </>
    ),
    aria: 'White',
  },
  {
    value: 'black',
    label: (
      <>
        <span className="swatch" style={{ background: '#000' }} />
        Black
      </>
    ),
    aria: 'Black',
  },
];

/**
 * The desk, under the frame: photos not on any frame. Drag one up onto the frame to place it
 * (the tray scrolls sideways, so only a drag upward lifts a photo).
 */
export function DeskTray({
  onDrag,
  onDrop,
  onCancel,
}: {
  onDrag: (clientX: number, clientY: number) => void;
  onDrop: (id: PhotoId, clientX: number, clientY: number) => void;
  onCancel: () => void;
}) {
  const { project } = useProject();
  const ids = deskPhotos(project);
  const [ghost, setGhost] = useState<{ id: PhotoId; x: number; y: number; w: number; h: number } | null>(null);

  const press = (e: React.PointerEvent<HTMLDivElement>, id: PhotoId) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    let lifted = false;
    // While a photo is up, the tray doesn't scroll under it.
    const still = (ev: TouchEvent) => {
      if (lifted) ev.preventDefault();
    };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!lifted) {
        // Sideways is the tray scrolling; up is a photo coming off it.
        if (-dy < LIFT || Math.abs(dy) < Math.abs(dx)) return;
        lifted = true;
      }
      setGhost({ id, x: ev.clientX, y: ev.clientY, w: box.width * 1.1, h: box.height * 1.1 });
      onDrag(ev.clientX, ev.clientY);
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('touchmove', still);
      setGhost(null);
      if (!lifted) return;
      if (ev.type === 'pointerup') onDrop(id, ev.clientX, ev.clientY);
      else onCancel();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('touchmove', still, { passive: false });
  };

  const add = async () => {
    const files = await pickPhotos();
    if (files.length) await addPhotoFiles(files, 'desk');
  };

  return (
    <>
      <div className="panel-row spread" style={{ paddingRight: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Desk{' '}
          <span className="muted" style={{ fontWeight: 400 }}>
            · {ids.length}
          </span>
        </span>
        <button className="btn" onClick={() => void add()}>
          <Plus style={{ width: 18, height: 18 }} />
          Add photos
        </button>
      </div>
      <div className="tray" aria-label="Desk">
        {ids.length === 0 && <div className="tray-empty">Photos not on a frame wait here.</div>}
        {ids.map((id) => (
          <TrayPhoto key={id} id={id} gone={ghost?.id === id} onPointerDown={(e) => press(e, id)} />
        ))}
      </div>
      <span className="note" style={{ padding: '0 16px' }}>
        Drag a photo onto the frame to place it. Drag a placed photo down here to take it off.
      </span>
      {ghost && <Ghost {...ghost} />}
    </>
  );
}

function TrayPhoto({
  id,
  gone,
  onPointerDown,
}: {
  id: PhotoId;
  gone: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const { project } = useProject();
  const url = usePhotoUrl(id);
  const photo = project.photos[id];
  const ratio = photo ? photo.pxW / photo.pxH : 2 / 3;
  return (
    <div
      className={`tray-photo${gone ? ' gone' : ''}`}
      style={{ width: 108 * Math.min(1.5, ratio) }}
      role="img"
      aria-label={photo?.name ?? 'Photo'}
      data-photo={id}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {url && <img src={url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  );
}

function Ghost({ id, x, y, w, h }: { id: PhotoId; x: number; y: number; w: number; h: number }) {
  const url = usePhotoUrl(id);
  return (
    <div className="ghost" style={{ left: x, top: y, width: w, height: h }}>
      {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  );
}

/** The frame selected: its background, for it or every frame. */
export function FramePanel({ frame, index }: { frame: Frame; index: number }) {
  const { project } = useProject();
  const ink: Ink = frame.background ?? 'white';
  const all = framesOf(project).map((f) => f.id);
  const everyFrame = framesOf(project).every((f) => (f.background ?? 'white') === ink);
  return (
    <>
      <div className="panel-row spread">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Frame {String(index + 1).padStart(2, '0')}</span>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {project.page.w} × {project.page.h} px
        </span>
      </div>
      <div className="panel-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <span className="note" style={{ padding: 0 }}>
          Background
        </span>
        <Segmented
          label="Background"
          options={INKS}
          value={ink}
          onChange={(v) => projectStore.apply((d) => setBackground(d, [frame.id], v))}
        />
      </div>
      <div className="panel-row">
        <button
          className="btn raised"
          style={{ flex: 1, minHeight: 40 }}
          disabled={everyFrame}
          onClick={() => projectStore.apply((d) => setBackground(d, all, ink))}
        >
          Use on every frame
        </button>
      </div>
      <span className="note" style={{ padding: '0 16px' }}>
        Tap outside the frame for the desk.
      </span>
    </>
  );
}

/** A photo selected: its detail, place and size, border, and what can be done with it. */
export function PhotoPanel({ item, frame }: { item: Placement; frame: Frame }) {
  const { project } = useProject();
  const sheet = sheetOf(project);
  const photo = project.photos[item.photoId];
  const [lock, setLock] = useState(true);
  const [fitting, setFitting] = useState(false);
  // The color a border gets: its own, or the one last picked.
  const [picked, setPicked] = useState<Ink>('white');
  const color = item.border?.color ?? picked;
  if (!photo) return null;
  const note = resolutionNote(photo, item, sheet);
  const id = item.photoId;
  const border = item.border?.width ?? 0;
  const maxBorder = Math.round(sheet.pageW * MAX_BORDER);

  const setBox = (k: 'x' | 'y' | 'w' | 'h', v: number) =>
    projectStore.apply((d) => {
      const it = framesOf(d)
        .find((f) => f.id === frame.id)
        ?.items.find((i) => i.photoId === id);
      if (!it) return;
      if (k === 'w' || k === 'h') {
        const n = Math.max(10, v);
        if (lock) {
          const aspect = it.w / it.h;
          it.w = k === 'w' ? n : n * aspect;
          it.h = k === 'h' ? n : n / aspect;
        } else it[k] = n;
      } else it[k] = v;
    });

  const guide = dropGuide(sheet);
  const fits = [
    { label: 'Fit the frame', box: pageRect('whole', sheet) },
    ...(guide ? [{ label: 'Fit the border guide', box: borderBox('whole', sheet, guide) }] : []),
  ];

  return (
    <>
      <div className="panel-row spread" style={{ gap: 12 }}>
        <span
          className="mono"
          style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {photo.name}
        </span>
        {note && (
          <span style={{ fontSize: 13, color: note.soft ? 'var(--warn)' : 'var(--muted)', flex: 'none' }}>
            {note.text}
          </span>
        )}
      </div>
      <div className="panel-row" style={{ gap: 6 }}>
        <NumberField label="X" value={item.x} onChange={(v) => setBox('x', v)} />
        <NumberField label="Y" value={item.y} onChange={(v) => setBox('y', v)} />
        <NumberField label="W" value={item.w} onChange={(v) => setBox('w', v)} />
        <NumberField label="H" value={item.h} onChange={(v) => setBox('h', v)} />
        <button
          className={`btn${lock ? ' on' : ''}`}
          style={{ minWidth: 36, minHeight: 36, padding: 0 }}
          aria-label="Keep proportions"
          aria-pressed={lock}
          onClick={() => setLock(!lock)}
        >
          <Link2 style={{ width: 18, height: 18 }} />
        </button>
      </div>
      <div className="panel-row" style={{ gap: 10 }}>
        <label htmlFor="border-width" className="muted" style={{ fontSize: 13, flex: 'none' }}>
          Border
        </label>
        <input
          id="border-width"
          type="range"
          min={0}
          max={maxBorder}
          step={1}
          value={Math.min(border, maxBorder)}
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => {
            const width = Number(e.target.value);
            projectStore.apply((d) => setBorder(d, id, width > 0 ? { width, color } : null), {
              coalesce: `border-${id}`,
            });
          }}
        />
        <span className="mono" style={{ fontSize: 12, width: 44, textAlign: 'right' }}>
          {Math.round(border)} px
        </span>
        <Segmented
          label="Border color"
          options={INKS.map((o) => ({
            ...o,
            label: <span className="swatch" style={{ background: o.value === 'white' ? '#fff' : '#000' }} />,
          }))}
          value={color}
          onChange={(v) => {
            setPicked(v);
            if (border > 0) projectStore.apply((d) => setBorder(d, id, { width: border, color: v }));
            else projectStore.apply((d) => setBorder(d, id, { width: Math.round(sheet.pageW / 90), color: v }));
          }}
        />
      </div>
      <div className="tools">
        <button className="tool" onClick={() => navigate('fade', () => phone.set({ cropping: id }))}>
          <Crop />
          Crop
        </button>
        <button className="tool" onClick={() => setFitting(true)}>
          <Maximize />
          Fit
        </button>
        <button className="tool" onClick={() => projectStore.apply((d) => centerPhoto(d, id))}>
          <Crosshair />
          Center
        </button>
        <button
          className="tool"
          onClick={() =>
            void duplicatePhotos([id]).then(([copy]) => copy && phone.set({ editing: { kind: 'photo', id: copy } }))
          }
        >
          <Copy />
          Duplicate
        </button>
      </div>
      {fitting && (
        <ActionSheet
          onCancel={() => setFitting(false)}
          actions={fits.map((f) => ({
            label: f.label,
            run: () => {
              setFitting(false);
              projectStore.apply((d) => fitPhoto(d, id, f.box));
            },
          }))}
        />
      )}
    </>
  );
}
