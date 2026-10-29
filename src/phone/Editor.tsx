import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleEllipsis, Redo2, Undo2 } from 'lucide-react';
import { borderBox, dropGuide, pageRect, resizeRect, snapLines, type Corner, type Rect } from '../geometry';
import type { PhotoId } from '../ids';
import { sheetOf } from '../spreads';
import { projectStore, useProject } from '../store';
import type { Frame } from '../types';
import { CropMode } from './CropMode';
import { framesOf, outerRect, placeAt, snapPhoto, toDesk } from './frameActions';
import { photoAt } from './layout';
import { FrameSizeSheet } from './FrameSizeSheet';
import { FrameView } from './FrameView';
import { DeskTray, FramePanel, PhotoPanel } from './EditorPanels';
import { useSize } from './hooks';
import { openEditor, phone, showFrames } from './nav';
import { ActionSheet } from './Sheets';

/** Room around the frame on the canvas, and under it for the pager, in screen pixels. */
const PAD = 20;
const PAGER = 60;
/** How far a finger moves before a press is a drag, and how near a guide it snaps, in screen pixels. */
const SLOP = 6;
const SNAP = 10;
const MAX_ZOOM = 6;

type Gesture =
  | { kind: 'move'; id: PhotoId; start: Rect; from: { x: number; y: number }; moved: boolean }
  | { kind: 'resize'; id: PhotoId; corner: Corner; start: Rect; from: { x: number; y: number } }
  | { kind: 'tap'; on: 'frame' | 'outside'; from: { x: number; y: number }; moved: boolean }
  | { kind: 'pinch'; dist: number; mid: { x: number; y: number }; view: View };

interface View {
  zoom: number;
  x: number;
  y: number;
}

const HOME: View = { zoom: 1, x: 0, y: 0 };

/**
 * One frame, edited: photos move and resize (by their corners) with snapping, the desk's
 * photos come on by dragging, and go back by dragging into the panel. Pinch zooms. Below it,
 * the desk, or what's selected: the frame, or a photo.
 */
export function Editor() {
  const { project, canUndo, canRedo } = useProject();
  const frameId = phone.use((s) => s.frameId);
  const editing = phone.use((s) => s.editing);
  const cropping = phone.use((s) => s.cropping);
  const guides = phone.use((s) => s.guides);
  const sheetOpen = phone.use((s) => s.sheet);
  const frames = framesOf(project);
  const index = frames.findIndex((f) => f.id === frameId);
  const frame = frames[index];

  // Undone past its making, or deleted: back to the grid.
  useEffect(() => {
    if (!frame) showFrames();
  }, [frame]);
  if (!frame) return null;

  const go = (i: number) => {
    const f = frames[i];
    if (f) openEditor(f.id);
  };

  return (
    <div className="screen">
      <EditorNav canUndo={canUndo && !cropping} canRedo={canRedo && !cropping} cropping={!!cropping} />
      {cropping ? (
        <CropMode key={cropping} photoId={cropping} frame={frame} />
      ) : (
        <FrameCanvas
          key={frame.id}
          frame={frame}
          index={index}
          count={frames.length}
          editing={editing}
          guides={guides}
          onGo={go}
        />
      )}
      {sheetOpen === 'size' && <FrameSizeSheet onDone={() => phone.set({ sheet: null })} />}
    </div>
  );
}

function EditorNav({ canUndo, canRedo, cropping }: { canUndo: boolean; canRedo: boolean; cropping: boolean }) {
  const [menu, setMenu] = useState(false);
  const guides = phone.use((s) => s.guides);
  if (cropping)
    return (
      <div className="nav solid" style={{ justifyContent: 'center' }}>
        <span className="nav-title" style={{ lineHeight: '44px' }}>
          Crop
        </span>
      </div>
    );
  return (
    <div className="nav solid">
      <button className="btn" style={{ paddingLeft: 4 }} onClick={showFrames}>
        <ChevronLeft />
        Frames
      </button>
      <div className="nav-group">
        <button className="btn" aria-label="Undo" disabled={!canUndo} onClick={() => projectStore.undo()}>
          <Undo2 />
        </button>
        <button className="btn" aria-label="Redo" disabled={!canRedo} onClick={() => projectStore.redo()}>
          <Redo2 />
        </button>
        <button className="btn" aria-label="More" onClick={() => setMenu(true)}>
          <CircleEllipsis />
        </button>
      </div>
      {menu && (
        <ActionSheet
          onCancel={() => setMenu(false)}
          actions={[
            {
              label: guides ? 'Hide guides' : 'Show guides',
              run: () => (setMenu(false), phone.set({ guides: !guides })),
            },
            { label: 'Frame size…', run: () => (setMenu(false), phone.set({ sheet: 'size' })) },
            { label: 'Export…', run: () => (setMenu(false), phone.set({ sheet: 'export' })) },
          ]}
        />
      )}
    </div>
  );
}

function FrameCanvas({
  frame,
  index,
  count,
  editing,
  guides,
  onGo,
}: {
  frame: Frame;
  index: number;
  count: number;
  editing: ReturnType<typeof phone.get>['editing'];
  guides: boolean;
  onGo: (i: number) => void;
}) {
  const { project } = useProject();
  const sheet = sheetOf(project);
  const [sizeRef, size] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>(HOME);
  const [hit, setHit] = useState<{ xs: number[]; ys: number[] } | null>(null);
  const [overPanel, setOverPanel] = useState(false);
  const [trayOver, setTrayOver] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // The frame fitted to the canvas, then zoomed and panned.
  const fit = Math.max(0.01, Math.min((size.w - 2 * PAD) / sheet.pageW, (size.h - PAD - PAGER) / sheet.pageH));
  const scale = fit * view.zoom;
  const baseLeft = (size.w - sheet.pageW * fit) / 2;
  const baseTop = PAD + (size.h - PAD - PAGER - sheet.pageH * fit) / 2;
  const left = baseLeft + view.x;
  const top = baseTop + view.y;

  /** A point on screen, in the frame's units. */
  const toUnits = (clientX: number, clientY: number) => {
    const r = canvas.current?.getBoundingClientRect();
    return { x: (clientX - (r?.left ?? 0) - left) / scale, y: (clientY - (r?.top ?? 0) - top) / scale };
  };
  const overPanelAt = (clientY: number) => {
    const r = panel.current?.getBoundingClientRect();
    return !!r && clientY >= r.top;
  };

  const selectedId = editing.kind === 'photo' ? editing.id : null;
  const selected = selectedId ? frame.items.find((i) => i.photoId === selectedId) : undefined;
  // A photo that's left this frame (undone, or moved) isn't selected anymore.
  useEffect(() => {
    if (selectedId && !selected) phone.set({ editing: { kind: 'none' } });
  }, [selectedId, selected]);

  const lines = snapLines(frame, sheet);

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    canvas.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...pointers.current.values()];
    if (ps.length === 2) {
      // A second finger: pinch and pan, dropping whatever the first had started.
      const g = gesture.current;
      if (g && (g.kind === 'resize' || (g.kind === 'move' && g.moved))) projectStore.cancel();
      const [a, b] = ps as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = {
        kind: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view,
      };
      setHit(null);
      setOverPanel(false);
      return;
    }
    if (ps.length > 2) return;
    const from = { x: e.clientX, y: e.clientY };
    const corner = (e.target as HTMLElement).dataset.corner as Corner | undefined;
    if (corner && selected) {
      gesture.current = { kind: 'resize', id: selected.photoId, corner, start: { ...selected }, from };
      projectStore.begin();
      return;
    }
    const u = toUnits(e.clientX, e.clientY);
    const item = photoAt(frame.items, u.x, u.y);
    if (item) {
      if (selectedId !== item.photoId) phone.set({ editing: { kind: 'photo', id: item.photoId } });
      gesture.current = { kind: 'move', id: item.photoId, start: { ...item }, from, moved: false };
      return;
    }
    const onFrame = u.x >= 0 && u.y >= 0 && u.x <= sheet.pageW && u.y <= sheet.pageH;
    gesture.current = { kind: 'tap', on: onFrame ? 'frame' : 'outside', from, moved: false };
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      const ps = [...pointers.current.values()];
      if (ps.length < 2) return;
      const [a, b] = ps as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoom = Math.max(1, Math.min(MAX_ZOOM, (g.view.zoom * dist) / Math.max(1, g.dist)));
      // The point under the fingers' middle stays under it.
      const ux = (g.mid.x - baseLeft - g.view.x) / (fit * g.view.zoom);
      const uy = (g.mid.y - baseTop - g.view.y) / (fit * g.view.zoom);
      const next =
        zoom === 1 ? HOME : { zoom, x: mid.x - baseLeft - ux * fit * zoom, y: mid.y - baseTop - uy * fit * zoom };
      setView(next);
      return;
    }
    const dxs = e.clientX - g.from.x;
    const dys = e.clientY - g.from.y;
    if (g.kind === 'tap') {
      if (Math.hypot(dxs, dys) > SLOP) g.moved = true;
      return;
    }
    if (g.kind === 'move' && !g.moved) {
      if (Math.hypot(dxs, dys) <= SLOP) return;
      g.moved = true;
      projectStore.begin();
    }
    const dx = dxs / scale;
    const dy = dys / scale;
    if (g.kind === 'move') {
      const item = frame.items.find((i) => i.photoId === g.id);
      const r = snapPhoto({ ...g.start, x: g.start.x + dx, y: g.start.y + dy }, item?.border, lines, SNAP / scale);
      setHit(r.hit);
      projectStore.preview((d) => {
        const it = framesOf(d)
          .find((f) => f.id === frame.id)
          ?.items.find((i) => i.photoId === g.id);
        if (!it) return;
        it.x = r.rect.x;
        it.y = r.rect.y;
        it.z = d.nextZ++;
      });
      setOverPanel(overPanelAt(e.clientY));
    } else {
      const r = resizeRect(g.start, g.corner, dx, dy, true, lines, SNAP / scale, 10);
      setHit(r.hit);
      projectStore.preview((d) => {
        const it = framesOf(d)
          .find((f) => f.id === frame.id)
          ?.items.find((i) => i.photoId === g.id);
        if (it) Object.assign(it, { x: r.rect.x, y: r.rect.y, w: r.rect.w, h: r.rect.h });
      });
    }
  };

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    setHit(null);
    if (g.kind === 'tap') {
      if (!g.moved) phone.set({ editing: g.on === 'frame' ? { kind: 'frame' } : { kind: 'none' } });
      return;
    }
    if (g.kind === 'move' && !g.moved) return;
    if (e.type === 'pointercancel') {
      projectStore.cancel();
    } else if (g.kind === 'move' && overPanelAt(e.clientY)) {
      // Dropped on the panel: back to the desk, as part of the same step.
      projectStore.preview((d) => toDesk(d, g.id));
      projectStore.end();
      phone.set({ editing: { kind: 'none' } });
    } else {
      projectStore.end();
    }
    setOverPanel(false);
  };

  // A desk photo dragged up from the tray: lands where it's let go, if that's on the frame.
  const trayDrag = (clientX: number, clientY: number) => {
    const u = toUnits(clientX, clientY);
    setTrayOver(u.x >= 0 && u.y >= 0 && u.x <= sheet.pageW && u.y <= sheet.pageH);
  };
  const trayDrop = (id: PhotoId, clientX: number, clientY: number) => {
    setTrayOver(false);
    const u = toUnits(clientX, clientY);
    if (u.x < 0 || u.y < 0 || u.x > sheet.pageW || u.y > sheet.pageH) return;
    projectStore.apply((d) => placeAt(d, id, frame.id, u));
    phone.set({ editing: { kind: 'photo', id } });
  };

  const guide = dropGuide(sheet);
  const box = guide ? borderBox('whole', sheet, guide) : null;
  const page = pageRect('whole', sheet);
  const sel = selected && outerRect(selected, selected.border);

  return (
    <>
      <div
        className="canvas"
        ref={(el) => {
          canvas.current = el;
          sizeRef(el);
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {size.w > 0 && (
          <div className="stage" style={{ left, top }}>
            <FrameView
              frame={frame}
              page={project.page}
              photos={project.photos}
              width={page.w * scale}
              className={editing.kind === 'frame' ? 'selected' : ''}
            >
              {(guides || trayOver) && (
                <div className="guides" style={{ zIndex: 1e6 }}>
                  {box && (
                    <div
                      className={`guide-box${trayOver ? ' lit' : ''}`}
                      style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}
                    />
                  )}
                  {hit?.xs.map((x) => (
                    <div
                      key={`x${x}`}
                      className="guide-line"
                      style={{ left: x * scale - 0.5, top: 0, width: 1, height: page.h * scale }}
                    />
                  ))}
                  {hit?.ys.map((y) => (
                    <div
                      key={`y${y}`}
                      className="guide-line"
                      style={{ top: y * scale - 0.5, left: 0, height: 1, width: page.w * scale }}
                    />
                  ))}
                </div>
              )}
            </FrameView>
            {sel && (
              <div
                className="selection"
                style={{ left: sel.x * scale, top: sel.y * scale, width: sel.w * scale, height: sel.h * scale }}
              >
                {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                  <span
                    key={c}
                    className="handle"
                    data-corner={c}
                    aria-label={`Resize from the ${c} corner`}
                    style={{ left: c.includes('w') ? 0 : '100%', top: c.includes('n') ? 0 : '100%' }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <div className="pager" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn" aria-label="Previous frame" disabled={index === 0} onClick={() => onGo(index - 1)}>
            <ChevronLeft />
          </button>
          <span>
            {index + 1} / {count}
          </span>
          <button
            className="btn"
            aria-label="Next frame"
            disabled={index === count - 1}
            onClick={() => onGo(index + 1)}
          >
            <ChevronRight />
          </button>
        </div>
      </div>
      <div className="panel" ref={panel}>
        {overPanel && <div className="panel-drop">Put it back on the desk</div>}
        {editing.kind === 'photo' && selected ? (
          <PhotoPanel item={selected} frame={frame} />
        ) : editing.kind === 'frame' ? (
          <FramePanel frame={frame} index={index} />
        ) : (
          <DeskTray onDrag={trayDrag} onDrop={trayDrop} onCancel={() => setTrayOver(false)} />
        )}
      </div>
    </>
  );
}
