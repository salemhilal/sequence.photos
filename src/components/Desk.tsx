import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { bump, dropPhotos, importPhotos, raise } from '../actions';
import { addPhotos } from '../commands';
import { isProjectFile, openProjectFile } from '../project';
import { clearGhost, startDrag, trackGhost } from '../drag';
import { intersects, resizeRect, type Corner, type Rect } from '../geometry';
import { projectStore, useProject } from '../store';
import type { Placement } from '../types';
import { TERMS } from '../units';
import { DESK_PPI, deskGeometry, MAX_ZOOM, MIN_ZOOM } from '../deskGeometry';
import { isTyping } from '../input';
import { deskCovered, openPhotoMenu, openModal, openQuickLook, ui } from '../ui';
import { OwnPageSettings } from './PageSettings';
import { PhotoImg } from './PhotoImg';

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const GHOST_MAX = 140;
/** When moving photos on the desk, the drop border fades in within this distance of its edge. */
const EDGE_FADE_PX = 120;
/** Screen pixels between a photo and its selection frame. */
const FRAME_GAP_PX = 5;
/** A Space press shorter than this, without panning, opens Quick Look; longer is a held pan key. */
const SPACE_TAP_MS = 400;

export function Desk() {
  const { project } = useProject();
  const view = ui.use((s) => s.view);
  const selection = ui.use((s) => s.selection);
  const dropHover = ui.use((s) => s.hover?.kind === 'desk');
  const ref = useRef<HTMLDivElement>(null);
  const spaceHeld = useRef(false);
  /** When Space went down over the uncovered desk; cleared if it's used to pan. */
  const spaceTap = useRef<number | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [panning, setPanning] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** Files being dragged in from outside the app: what dropping them will do. */
  const [fileDrop, setFileDrop] = useState<'photos' | 'project' | null>(null);
  // dragenter/dragleave fire for every child element crossed, so count them.
  const fileDragDepth = useRef(0);
  const [resizingId, setResizingId] = useState<string | null>(null);

  useLayoutEffect(() => {
    deskGeometry.toDesk = (cx, cy) => {
      const r = ref.current?.getBoundingClientRect();
      const v = ui.get().view;
      const k = DESK_PPI * v.zoom;
      return { x: (cx - (r?.left ?? 0) - v.panX) / k, y: (cy - (r?.top ?? 0) - v.panY) / k };
    };
    deskGeometry.visible = () => {
      const r = ref.current?.getBoundingClientRect();
      const v = ui.get().view;
      const k = DESK_PPI * v.zoom;
      return { x: -v.panX / k, y: -v.panY / k, w: (r?.width ?? 800) / k, h: (r?.height ?? 600) / k };
    };
    deskGeometry.size = () => {
      const r = ref.current?.getBoundingClientRect();
      return { w: r?.width ?? 800, h: r?.height ?? 600 };
    };
  }, []);

  // Wheel pans; pinch or Ctrl/Cmd + wheel zooms around the cursor.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = ui.get().view;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM);
        zoomAround(zoom, e.clientX - r.left, e.clientY - r.top);
      } else {
        ui.set({ view: { ...v, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY } });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        spaceHeld.current = true;
        if (!e.repeat) spaceTap.current = deskCovered() ? null : performance.now();
        if (e.target === document.body) e.preventDefault();
      }
    };
    // Tapping Space opens Quick Look on the selection; holding it pans.
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceHeld.current = false;
      const down = spaceTap.current;
      spaceTap.current = null;
      if (down === null || performance.now() - down > SPACE_TAP_MS || deskCovered()) return;
      openQuickLook(ui.get().selection);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const startPan = (e: React.PointerEvent) => {
    spaceTap.current = null;
    const v0 = ui.get().view;
    setPanning(true);
    startDrag(e, {
      onMove: ({ dx, dy }) => ui.set({ view: { ...ui.get().view, panX: v0.panX + dx, panY: v0.panY + dy } }),
      onEnd: () => setPanning(false),
      onCancel: () => setPanning(false),
    });
  };

  const onBackgroundDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const additive = e.shiftKey || e.metaKey;
    const initial = additive ? ui.get().selection : [];
    if (!additive) ui.set({ selection: [] });
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    startDrag(e, {
      onMove: ({ dx, dy }) => {
        const m = { x: Math.min(sx, sx + dx), y: Math.min(sy, sy + dy), w: Math.abs(dx), h: Math.abs(dy) };
        setMarquee(m);
        const a = deskGeometry.toDesk(rect.left + m.x, rect.top + m.y);
        const b = deskGeometry.toDesk(rect.left + m.x + m.w, rect.top + m.y + m.h);
        const box = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
        const hit = projectStore.project.pile.filter((p) => intersects(p, box)).map((p) => p.photoId);
        ui.set({ selection: [...new Set([...initial, ...hit])] });
      },
      onEnd: () => setMarquee(null),
      onCancel: () => setMarquee(null),
    });
  };

  const onItemDown = (e: React.PointerEvent, p: Placement) => {
    if (e.button === 1 || spaceHeld.current) return; // falls through to panning
    if (e.button !== 0) return;
    e.stopPropagation();
    const toggle = e.shiftKey || e.metaKey;
    const current = ui.get().selection;
    const wasSelected = current.includes(p.photoId);
    if (!wasSelected) ui.set({ selection: toggle ? [...current, p.photoId] : [p.photoId] });
    const ids = ui.get().selection;
    const k = DESK_PPI * ui.get().view.zoom;
    const ghostW = Math.min(GHOST_MAX, p.w * k);
    const ghost = { photoId: p.photoId, count: ids.length, w: ghostW, h: (ghostW * p.h) / p.w };
    // The desk is where these photos already are, so its drop border only
    // appears near the edge, as a hint that you're about to leave it.
    const deskEl = ref.current;
    const setEdge = (ev: PointerEvent | null) => {
      if (!deskEl) return;
      if (!ev) return deskEl.style.removeProperty('--edge');
      const r = deskEl.getBoundingClientRect();
      const d = Math.min(ev.clientX - r.left, r.right - ev.clientX, ev.clientY - r.top, r.bottom - ev.clientY);
      deskEl.style.setProperty('--edge', String(Math.min(1, Math.max(0, 1 - d / EDGE_FADE_PX))));
    };

    startDrag(e, {
      onStart: () => projectStore.begin(),
      onMove: ({ e: ev, dx, dy }) => {
        const target = trackGhost(ev, null);
        setEdge(ev);
        ui.set({ ghost: target?.kind === 'desk' ? null : { ...ghost, clientX: ev.clientX, clientY: ev.clientY } });
        const set = new Set(ids);
        const ordered = [...projectStore.project.pile].sort((a, b) => a.z - b.z);
        projectStore.preview((d) => {
          for (const q of ordered) {
            if (!set.has(q.photoId)) continue;
            const item = d.pile.find((i) => i.photoId === q.photoId);
            if (!item) continue;
            item.x += dx / k;
            item.y += dy / k;
            bump(d, item);
          }
        });
      },
      onEnd: ({ e: ev }, moved) => {
        clearGhost();
        setEdge(null);
        if (!moved) {
          if (toggle && wasSelected) ui.set({ selection: current.filter((id) => id !== p.photoId) });
          else if (!toggle) ui.set({ selection: [p.photoId] });
          projectStore.silent((d) => {
            const item = d.pile.find((i) => i.photoId === p.photoId);
            if (item) raise(d, d.pile, item);
          });
          return;
        }
        const target = trackGhost(ev, null);
        clearGhost();
        if (target?.kind === 'desk') {
          // Moved around the desk: keep the new positions.
          projectStore.end();
        } else if (target) {
          projectStore.preview((d) => void dropPhotos(d, target, ids));
          projectStore.end();
          ui.set({ selection: [] });
        } else {
          projectStore.cancel();
        }
      },
      onCancel: () => {
        clearGhost();
        setEdge(null);
        projectStore.cancel();
      },
    });
  };

  const onHandleDown = (e: React.PointerEvent, p: Placement, corner: Corner) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const k = DESK_PPI * ui.get().view.zoom;
    setResizingId(p.photoId);
    startDrag(e, {
      onStart: () => projectStore.begin(),
      onMove: ({ e: ev, dx, dy }) => {
        const { rect } = resizeRect(p, corner, dx / k, dy / k, !ev.shiftKey, null, 0);
        projectStore.preview((d) => {
          const item = d.pile.find((i) => i.photoId === p.photoId);
          if (item) Object.assign(item, rect);
        });
      },
      onEnd: (_, moved) => {
        setResizingId(null);
        if (moved) projectStore.end();
      },
      onCancel: () => {
        setResizingId(null);
        projectStore.cancel();
      },
    });
  };

  // If a file drag ends anywhere else (dropped outside the desk, or cancelled), clear the indicator.
  useEffect(() => {
    const reset = () => {
      fileDragDepth.current = 0;
      setFileDrop(null);
    };
    window.addEventListener('drop', reset);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('drop', reset);
      window.removeEventListener('dragend', reset);
    };
  }, []);

  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  const onDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    fileDragDepth.current += 1;
    // Only MIME types are visible before the drop, not file names. Photos are image/*;
    // .photo-sequence files have no registered type, so they arrive with an empty one.
    const types = [...e.dataTransfer.items].map((i) => i.type);
    const projectFile = types.some((t) => t === '' || t === 'application/zip' || t === 'application/x-zip-compressed');
    setFileDrop(projectFile ? 'project' : 'photos');
  };

  const onDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
    if (fileDragDepth.current === 0) setFileDrop(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    fileDragDepth.current = 0;
    setFileDrop(null);
    const files = [...e.dataTransfer.files];
    const projectFile = files.find(isProjectFile);
    if (projectFile) void openProjectFile(projectFile);
    else if (files.length) void importPhotos(files);
  };

  const items = [...project.pile].sort((a, b) => a.z - b.z);
  const single = selection.length === 1 ? selection[0] : null;

  return (
    <div
      ref={ref}
      className={`desk${panning ? ' panning' : ''}${dropHover ? ' drop-hover' : ''}`}
      data-drop="desk"
      onPointerDown={onBackgroundDown}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.zoom, .desk-empty .btn')) return;
        e.preventDefault();
        ui.set({ contextMenu: { kind: 'desk', x: e.clientX, y: e.clientY } });
      }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => {
        e.preventDefault();
        if (isFileDrag(e)) e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="desk-world"
        style={{
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
          ['--inv' as string]: 1 / view.zoom,
        }}
      >
        {items.map((p) => (
          <DeskItem
            key={p.photoId}
            p={p}
            selected={selection.includes(p.photoId)}
            handles={single === p.photoId}
            onDown={onItemDown}
            onHandleDown={onHandleDown}
            onHover={setHoverId}
          />
        ))}
      </div>
      <SelectionFrames
        items={items.filter((p) => selection.includes(p.photoId))}
        view={view}
        handlesFor={single && (hoverId === single || resizingId === single) ? single : null}
      />
      {marquee && (
        <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
      )}
      {project.pile.length === 0 && (
        <div className="desk-empty">
          <p className="desk-empty-title">
            {Object.keys(project.photos).length ? 'Every photo is placed' : 'Start by adding photos'}
          </p>
          <p>
            Add or drop photos or saved projects here.
            <br />
            They land on this desk, where you can drag them onto {TERMS[project.layout.kind].pages}.
          </p>
          <button className="btn primary" onPointerDown={(e) => e.stopPropagation()} onClick={addPhotos}>
            Add photos
          </button>
          {Object.keys(project.photos).length === 0 && (
            // A new project: set the page size before placing anything.
            <div
              className="setup-card"
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
            >
              <span className="caps muted">Page</span>
              <OwnPageSettings />
              <p className="help">
                You can change this anytime in{' '}
                <button className="link" onClick={() => openModal('layout')}>
                  Layout
                </button>
                , along with the guides photos fit and snap to.
              </p>
            </div>
          )}
        </div>
      )}
      {fileDrop && (
        <div className="file-drop">
          <span>{fileDrop === 'project' ? 'Drop to open project' : 'Drop to add photos'}</span>
        </div>
      )}
      <ZoomControls />
    </div>
  );
}

interface ItemProps {
  p: Placement;
  selected: boolean;
  handles: boolean;
  onDown: (e: React.PointerEvent, p: Placement) => void;
  onHandleDown: (e: React.PointerEvent, p: Placement, c: Corner) => void;
  onHover: (id: string | null) => void;
}

const DeskItem = memo(function DeskItem({ p, selected, handles, onDown, onHandleDown, onHover }: ItemProps) {
  return (
    <div
      className={`item${selected ? ' selected' : ''}`}
      style={{ left: p.x * DESK_PPI, top: p.y * DESK_PPI, width: p.w * DESK_PPI, height: p.h * DESK_PPI }}
      onPointerDown={(e) => onDown(e, p)}
      onContextMenu={(e) => openPhotoMenu(e, p.photoId)}
      onPointerEnter={() => onHover(p.photoId)}
      onPointerLeave={() => onHover(null)}
    >
      <PhotoImg id={p.photoId} />
      {handles &&
        CORNERS.map((c) => (
          <div key={c} className={`handle handle-${c}`} onPointerDown={(e) => onHandleDown(e, p, c)} />
        ))}
    </div>
  );
});

/**
 * Selection frames, drawn in screen space over the desk rather than inside the
 * zoomed layer, with edges snapped to device pixels so all four sides match at any zoom.
 * (The resize hit areas stay on the photos; these are just the visuals.)
 */
function SelectionFrames({
  items,
  view,
  handlesFor,
}: {
  items: Placement[];
  view: { panX: number; panY: number; zoom: number };
  handlesFor: string | null;
}) {
  if (!items.length) return null;
  const k = DESK_PPI * view.zoom;
  const dpr = window.devicePixelRatio || 1;
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const out = FRAME_GAP_PX;
  return (
    <div className="selection-layer">
      {items.map((p) => {
        const x1 = snap(view.panX + p.x * k - out);
        const y1 = snap(view.panY + p.y * k - out);
        const x2 = snap(view.panX + (p.x + p.w) * k + out);
        const y2 = snap(view.panY + (p.y + p.h) * k + out);
        return (
          <div key={p.photoId} className="sel-frame" style={{ left: x1, top: y1, width: x2 - x1, height: y2 - y1 }}>
            {handlesFor === p.photoId && CORNERS.map((c) => <span key={c} className={`sel-handle sel-handle-${c}`} />)}
          </div>
        );
      })}
    </div>
  );
}

function ZoomControls() {
  const zoom = ui.use((s) => s.view.zoom);
  const step = (f: number) => {
    const el = document.querySelector('.desk');
    const r = el?.getBoundingClientRect();
    zoomAround(clamp(zoom * f, MIN_ZOOM, MAX_ZOOM), (r?.width ?? 0) / 2, (r?.height ?? 0) / 2);
  };
  return (
    <div className="zoom" onPointerDown={(e) => e.stopPropagation()}>
      <button className="btn icon" aria-label="Zoom out" onClick={() => step(1 / 1.25)}>
        <Minus />
      </button>
      <button className="btn zoom-level" onClick={() => zoomAround(1, 0, 0)} data-tip="Reset zoom">
        {Math.round(zoom * 100)}%
      </button>
      <button className="btn icon" aria-label="Zoom in" onClick={() => step(1.25)}>
        <Plus />
      </button>
    </div>
  );
}

/** Set zoom keeping the desk point under (sx, sy) — desk-relative pixels — fixed. */
function zoomAround(zoom: number, sx: number, sy: number): void {
  const v = ui.get().view;
  const f = zoom / v.zoom;
  ui.set({ view: { zoom, panX: sx - (sx - v.panX) * f, panY: sy - (sy - v.panY) * f } });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
