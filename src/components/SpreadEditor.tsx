import { useEffect, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, X } from 'lucide-react';
import { bump, dropPhotos, putInPile, putOnPage, raise } from '../actions';
import { clearGhost, startDrag, trackGhost } from '../drag';
import {
  borderBox,
  edgesOf,
  fitCentered,
  pageRect,
  pageSides,
  resizeRect,
  sheetExtent,
  sideAt,
  snapLines,
  snapMove,
  type Corner,
  type Rect,
  type SnapFeedback,
} from '../geometry';
import type { Draft } from 'immer';
import type { PhotoId, SpreadId } from '../ids';
import { allSpreads, findSpread, sheetOf } from '../spreads';
import { TERMS, UNITS, type Units } from '../units';
import { projectStore, useProject } from '../store';
import type { Arrangement, BorderGuide, Project, Placement } from '../types';
import { isMac, isTyping } from '../input';
import { openPhotoMenu, toggleGuides, ui } from '../ui';
import { shortcutLabel } from '../commands';
import { useElementSize, useWindowEvent } from '../hooks';
import { nextSoftPhoto, placedSoft, resolutionNote } from '../resolution';
import { clamp } from '../deskZoom';
import { NumberField } from './NumberField';
import { SoftBadge } from './SoftBadge';
import { PhotoImg } from './PhotoImg';
import { SpreadCanvas } from './SpreadCanvas';

/** Room around the spread, as a share of its width (0.75 in on a 10 in book page). */
const PAD_SHARE = 0.075;
const SNAP_PX = 8;
/** Room under the spread for its pager. */
const PAGER_PX = 52;
/** How far the stage zooms in and out from fitting the spread. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

export function SpreadEditor({ spreadId }: { spreadId: SpreadId }) {
  const { project } = useProject();
  const book = allSpreads(project);
  const index = book.findIndex((s) => s.id === spreadId);
  const spread = book[index];
  const sheet = sheetOf(project);
  const units = UNITS[sheet.unit];
  const PAD = sheet.pageW * PAD_SHARE;
  // A book's two pages (single ones on their side), or a frame.
  const { left: extentLeft, width: across } = sheetExtent(sheet);
  const [stageRef, stage] = useElementSize<HTMLDivElement>({ w: 800, h: 500 });
  const [selected, setSelected] = useState<PhotoId | null>(null);
  // A photo asked for ("Show me", from Export), whether the editor was open or not: taken once.
  const asked = ui.use((s) => s.editorSelect);
  const [seen, setSeen] = useState<PhotoId | null>(null);
  if (asked !== seen) {
    setSeen(asked);
    if (asked) setSelected(asked);
  }
  useEffect(() => {
    if (asked) ui.set({ editorSelect: null });
  }, [asked]);
  const [snapHit, setSnapHit] = useState<SnapFeedback | null>(null);
  /**
   * A guide box to glow while a Fit button is hovered, for the photo it was for: the
   * button can vanish under the pointer (the photo deselected) without a pointerleave.
   */
  const [hovered, setHovered] = useState<{ photoId: PhotoId; box: Rect } | null>(null);
  const glow = hovered && hovered.photoId === selected ? hovered.box : null;
  const guidesHidden = ui.use((s) => s.guidesHidden);

  // The stage's zoom (1 fits the spread) and pan, in screen pixels: pinch or ⌘-scroll zooms
  // around the pointer, scroll pans, as on the desk. Another spread starts fitted again.
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [viewFor, setViewFor] = useState(spreadId);
  if (viewFor !== spreadId) {
    setViewFor(spreadId);
    setView({ zoom: 1, x: 0, y: 0 });
  }
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        // The pointer, from where the spread's center sits before panning.
        const sx = e.clientX - r.left - r.width / 2;
        const sy = e.clientY - r.top - (r.height - PAGER_PX) / 2;
        setView((v) => {
          const zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM);
          const f = zoom / v.zoom;
          return { zoom, x: sx - (sx - v.x) * f, y: sy - (sy - v.y) * f };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [stageRef]);
  const fitScale = Math.min(stage.w / (across + 2 * PAD), (stage.h - PAGER_PX) / (sheet.pageH + 2 * PAD));
  const scale = fitScale * view.zoom;

  // How to move and resize, in the status bar.
  useEffect(() => {
    ui.set({ pageStatus: `Shift: free resize · ${isMac ? 'Option' : 'Alt'}: no snapping · Arrows nudge` });
    return () => ui.set({ pageStatus: null });
  }, []);

  const selectedItem = spread?.items.find((i) => i.photoId === selected) ?? null;

  const close = () => ui.set({ editingSpreadId: null });
  const go = (delta: number) => {
    const next = book[index + delta];
    if (next) {
      setSelected(null);
      ui.set({ editingSpreadId: next.id });
    }
  };

  const updateItem = (photoId: PhotoId, patch: Partial<Placement>, coalesce?: string) =>
    projectStore.apply(
      (d) => {
        const item = findItem(d, spreadId, photoId);
        if (item) Object.assign(item, patch);
      },
      coalesce ? { coalesce } : {},
    );

  const toPile = (photoId: PhotoId) => {
    projectStore.apply((d) => putInPile(d, photoId));
    setSelected(null);
  };

  // The editor's own keys; the desk's shortcuts are paused while it's open.
  useWindowEvent('keydown', (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey) return;
    if (ui.get().modal) return;
    const d = projectStore.project;
    const item = selected ? findItem(d, spreadId, selected) : null;
    if (e.key === 'Escape') {
      if (selected) setSelected(null);
      else close();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && item) {
      e.preventDefault();
      toPile(item.photoId);
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      if (!item) {
        if (e.key === 'ArrowLeft') go(-1);
        if (e.key === 'ArrowRight') go(1);
        return;
      }
      const n = e.shiftKey ? units.nudgeBig : units.nudge;
      const dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0;
      const dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
      updateItem(item.photoId, { x: item.x + dx, y: item.y + dy }, `nudge:${item.photoId}`);
    }
  });

  if (!spread) return null;
  // Hidden guides aren't snapped to either: only the page edges are.
  const lines = snapLines(
    spread,
    guidesHidden ? { ...sheet, centerV: false, centerH: false, borders: [], lines: [] } : sheet,
  );
  const threshold = SNAP_PX / scale;

  const onItemDown = (e: React.PointerEvent, p: Placement) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(p.photoId);
    const start: Rect = { x: p.x, y: p.y, w: p.w, h: p.h };
    startDrag(e, {
      onStart: () => projectStore.begin(),
      onMove: ({ e: ev, dx, dy }) => {
        trackGhost(ev, null);
        const moved = { ...start, x: start.x + dx / scale, y: start.y + dy / scale };
        const { rect, hit } = ev.altKey ? { rect: moved, hit: null } : snapMove(moved, lines, threshold);
        setSnapHit(hit);
        projectStore.preview((d) => {
          const item = findItem(d, spreadId, p.photoId);
          if (!item) return;
          item.x = rect.x;
          item.y = rect.y;
          bump(d, item);
        });
      },
      onEnd: ({ e: ev }, moved) => {
        setSnapHit(null);
        if (!moved) {
          projectStore.silent((d) => {
            const spread = findSpread(d, spreadId);
            const item = spread?.items.find((i) => i.photoId === p.photoId);
            if (spread && item) raise(d, spread.items, item);
          });
          return;
        }
        const target = trackGhost(ev, null);
        clearGhost();
        // Moves within the spread stay put; dropping on the desk strip returns the photo to the desk.
        if (target?.kind === 'strip') {
          projectStore.preview((d) => void dropPhotos(d, target, [p.photoId]));
          setSelected(null);
        }
        projectStore.end();
      },
      onCancel: () => {
        setSnapHit(null);
        clearGhost();
        projectStore.cancel();
      },
    });
  };

  const onHandleDown = (e: React.PointerEvent, p: Placement, corner: Corner) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    startDrag(e, {
      onStart: () => projectStore.begin(),
      onMove: ({ e: ev, dx, dy }) => {
        const { rect, hit } = resizeRect(
          p,
          corner,
          dx / scale,
          dy / scale,
          !ev.shiftKey,
          ev.altKey ? null : lines,
          threshold,
          units.minPhoto,
        );
        setSnapHit(hit);
        projectStore.preview((d) => {
          const item = findItem(d, spreadId, p.photoId);
          if (item) Object.assign(item, rect);
        });
      },
      onEnd: (_, moved) => {
        setSnapHit(null);
        if (moved) projectStore.end();
      },
      onCancel: () => {
        setSnapHit(null);
        projectStore.cancel();
      },
    });
  };

  const renderItem = (p: Placement, style: CSSProperties) => (
    <div
      key={p.photoId}
      className={`item${p.photoId === selected ? ' selected' : ''}`}
      style={style}
      onPointerDown={(e) => onItemDown(e, p)}
      onContextMenu={(e) => openPhotoMenu(e, p.photoId)}
    >
      <PhotoImg id={p.photoId} />
      {placedSoft(project.photos[p.photoId], p, sheet) && <SoftBadge note={softNote(p)} />}
      {p.photoId === selected &&
        CORNERS.map((c) => (
          <div key={c} className={`handle handle-${c}`} onPointerDown={(e) => onHandleDown(e, p, c)} />
        ))}
    </div>
  );

  const softNote = (p: Placement) => {
    const photo = project.photos[p.photoId];
    return (photo && resolutionNote(photo, p, sheet)?.text) ?? '';
  };
  const noun = TERMS[sheet.arrangement].spread;
  const nextError = nextSoftPhoto(project, selected);

  return (
    <div className="modal-backdrop" data-modal onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal editor" data-modal>
        <header className="modal-head">
          <span className="spacer" />
          <button
            className={`btn ghost icon${guidesHidden ? ' active' : ''}`}
            aria-label={guidesHidden ? 'Show guides' : 'Hide guides'}
            aria-pressed={guidesHidden}
            data-tip={`${guidesHidden ? 'Show' : 'Hide'} guides (${shortcutLabel('toggleGuides')})`}
            onClick={toggleGuides}
          >
            {guidesHidden ? <EyeOff /> : <Eye />}
          </button>
          <button className="btn ghost icon" aria-label="Close" onClick={close}>
            <X />
          </button>
        </header>
        <div className="editor-body">
          <div className="editor-stage" ref={stageRef}>
            <div
              className="stage-center"
              style={{ bottom: PAGER_PX, transform: `translate(${view.x}px, ${view.y}px)` }}
            >
              <SpreadCanvas
                spread={spread}
                sheet={sheet}
                scale={scale}
                pad={PAD}
                guides={!guidesHidden}
                droppable
                snapHit={snapHit}
                renderItem={renderItem}
                overlay={
                  glow && (
                    <div
                      className="guide-glow"
                      style={{
                        left: (PAD - extentLeft + glow.x) * scale,
                        top: (PAD + glow.y) * scale,
                        width: glow.w * scale,
                        height: glow.h * scale,
                      }}
                    />
                  )
                }
                onPointerDown={() => setSelected(null)}
              />
            </div>
            {/* Which spread of how many, below it, as elsewhere. */}
            <div className="page-preview-controls editor-pager">
              <button
                className="btn ghost icon"
                aria-label={`Previous ${noun}`}
                disabled={index === 0}
                onClick={() => go(-1)}
              >
                <ChevronLeft />
              </button>
              <span className="muted data">
                {index + 1} / {book.length}
              </span>
              <button
                className="btn ghost icon"
                aria-label={`Next ${noun}`}
                disabled={index === book.length - 1}
                onClick={() => go(1)}
              >
                <ChevronRight />
              </button>
            </div>
          </div>
          <Inspector
            project={project}
            item={selectedItem}
            onChange={(patch, key) => selectedItem && updateItem(selectedItem.photoId, patch, key)}
            onToPile={() => selectedItem && toPile(selectedItem.photoId)}
            onHoverBox={(box) => setHovered(box && selectedItem ? { photoId: selectedItem.photoId, box } : null)}
            onNextError={
              nextError && (() => ui.set({ editingSpreadId: nextError.spreadId, editorSelect: nextError.photoId }))
            }
          />
        </div>
        <PileStrip spreadId={spreadId} />
      </div>
    </div>
  );
}

/** A Fit button's name for a border guide: its distance, or the range of its distances. */
function guideLabel(g: BorderGuide, u: Units): string {
  if (g.kind === 'even') return `Fit ${u.format(g.inset)} ${u.suffix} guide`;
  const d = Object.values(edgesOf(g));
  return `Fit ${u.format(Math.min(...d))}–${u.format(Math.max(...d))} ${u.suffix} guide`;
}

/** A border guide's distances, for a tooltip: top, outside (left, in a frame), bottom, inside. */
function guideSummary(g: BorderGuide, u: Units, arrangement: Arrangement): string {
  const e = edgesOf(g);
  const { outside, inside } = TERMS[arrangement].edges;
  const f = u.format;
  return `Top ${f(e.top)} · ${outside} ${f(e.outside)} · Bottom ${f(e.bottom)} · ${inside} ${f(e.inside)} ${u.suffix}`;
}

function findItem(d: Project | Draft<Project>, spreadId: SpreadId, photoId: PhotoId): Placement | undefined {
  return findSpread(d, spreadId)?.items.find((i) => i.photoId === photoId);
}

interface InspectorProps {
  project: Project;
  item: Placement | null;
  onChange: (patch: Partial<Placement>, coalesce?: string) => void;
  onToPile: () => void;
  /** A Fit button's box while it's hovered (null when it isn't), to show which guide it means. */
  onHoverBox: (box: Rect | null) => void;
  /** Select the next photo below the page's resolution (on any spread); null if there's no other. */
  onNextError: (() => void) | null;
}

function Inspector(props: InspectorProps) {
  const { item, onToPile, onNextError } = props;
  return (
    <aside className="inspector editor-inspector">
      <div className="inspector-body">
        {item ? (
          <PhotoSettings {...props} item={item} />
        ) : (
          <>
            <p className="muted">Select a photo to adjust its position and size.</p>
            <p className="muted">
              Drag photos in from the desk strip below, or drag one onto the strip to send it back.
            </p>
          </>
        )}
      </div>
      {/* Kept at the panel's foot, as Layout's Apply is. */}
      {(onNextError || item) && (
        <div className="inspector-foot">
          {onNextError && (
            <button className="btn" onClick={onNextError}>
              Go to next error
            </button>
          )}
          {item && (
            <button className="btn" onClick={onToPile}>
              Return to desk
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

/** A selected photo's position, size, resolution, and fitting. */
function PhotoSettings({ project, item, onChange, onHoverBox }: InspectorProps & { item: Placement }) {
  const [lock, setLock] = useState(true);
  const sheet = sheetOf(project);
  const units = UNITS[sheet.unit];
  const side = sideAt(sheet, item.x + item.w / 2);
  const page = pageRect(side, sheet);
  const photo = project.photos[item.photoId];
  const aspect = item.w / item.h;
  const key = (f: string) => `inspect:${item.photoId}:${f}`;
  const fit = (box: Rect) => onChange(fitCentered({ pxW: item.w, pxH: item.h }, box, page));
  // Largest box first, as before per-edge guides: the outermost guide at the top.
  const boxes = sheet.borders
    .map((g) => ({ g, box: borderBox(side, sheet, g) }))
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  const where = side === 'whole' ? 'frame' : 'page';
  // Inches: the photo's pixels per inch. Pixels: how much it's enlarged, if it is.
  const quality = photo ? resolutionNote(photo, item, sheet) : null;

  return (
    <>
      <div className="inspector-name" title={photo?.name}>
        {photo?.name}
      </div>
      <div className="muted small">
        {side === 'whole' ? 'Frame' : side === 'left' ? 'Left page' : 'Right page'} · measured from its top-left corner
      </div>
      <div className="grid2">
        <NumberField
          units={units}
          label="X"
          value={item.x - page.x}
          onCommit={(n) => onChange({ x: page.x + units.round(n) }, key('x'))}
        />
        <NumberField
          units={units}
          label="Y"
          value={item.y}
          onCommit={(n) => onChange({ y: units.round(n) }, key('y'))}
        />
        <NumberField
          units={units}
          label="W"
          min={units.minPhoto}
          value={item.w}
          onCommit={(n) =>
            onChange(lock ? { w: units.round(n), h: units.round(n / aspect) } : { w: units.round(n) }, key('w'))
          }
        />
        <NumberField
          units={units}
          label="H"
          min={units.minPhoto}
          value={item.h}
          onCommit={(n) =>
            onChange(lock ? { h: units.round(n), w: units.round(n * aspect) } : { h: units.round(n) }, key('h'))
          }
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Keep proportions
      </label>
      {quality && <p className={`help${quality.soft ? ' warn' : ''}`}>{quality.text}</p>}
      <div className="inspector-actions">
        <button
          className="btn"
          onClick={() => onChange({ x: page.x + (page.w - item.w) / 2, y: (page.h - item.h) / 2 })}
        >
          Center on {where}
        </button>
        <button
          className="btn"
          onClick={() => fit(page)}
          onPointerEnter={() => onHoverBox(page)}
          onPointerLeave={() => onHoverBox(null)}
        >
          Fit {where}
        </button>
        {boxes.map(({ g, box }) => (
          <button
            key={g.id}
            className="btn"
            onClick={() => fit(box)}
            onPointerEnter={() => onHoverBox(box)}
            onPointerLeave={() => onHoverBox(null)}
            data-tip={g.kind === 'edges' ? guideSummary(g, units, sheet.arrangement) : undefined}
          >
            {guideLabel(g, units)}
          </button>
        ))}
      </div>
    </>
  );
}

function PileStrip({ spreadId }: { spreadId: SpreadId }) {
  const { project } = useProject();
  const hover = ui.use((s) => s.hover?.kind === 'strip');
  const pile = [...project.pile].sort((a, b) => a.y - b.y || a.x - b.x);

  const onDown = (e: React.PointerEvent, p: Placement) => {
    if (e.button !== 0) return;
    const w = 110;
    const ghost = { photoId: p.photoId, count: 1, w, h: (w * p.h) / p.w };
    startDrag(e, {
      onMove: ({ e: ev }) => trackGhost(ev, ghost),
      onEnd: ({ e: ev }, moved) => {
        const target = trackGhost(ev, null);
        clearGhost();
        if (!moved) {
          // A click places the photo on the first empty page, or the right page.
          const spread = findSpread(projectStore.project, spreadId);
          if (!spread) return;
          const sheet = sheetOf(projectStore.project);
          const side = pageSides(spread.kind)[0]!;
          const taken = spread.items.some((i) => sideAt(sheet, i.x + i.w / 2) === side);
          const pick = spread.kind === 'middle' && taken ? 'right' : side;
          projectStore.apply((d) => putOnPage(d, [p.photoId], spreadId, pick));
          return;
        }
        if (target?.kind === 'page') projectStore.apply((d) => void dropPhotos(d, target, [p.photoId]));
      },
      onCancel: clearGhost,
    });
  };

  return (
    <div className={`strip${hover ? ' drop-hover' : ''}`} data-drop="strip">
      <div className="strip-label section-label">Desk · {pile.length}</div>
      <div className="strip-items">
        {pile.length === 0 ? (
          <span className="muted small">Empty. Drag a photo here to send it back to the desk.</span>
        ) : (
          pile.map((p) => (
            <div
              key={p.photoId}
              className="strip-item"
              style={{ width: (56 * p.w) / p.h }}
              onPointerDown={(e) => onDown(e, p)}
              onContextMenu={(e) => openPhotoMenu(e, p.photoId)}
              data-tip={`Drag onto the ${TERMS[project.layout.kind].page}, or click to add`}
            >
              <PhotoImg id={p.photoId} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
