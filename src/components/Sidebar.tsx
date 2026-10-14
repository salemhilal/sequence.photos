import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { GripVertical, Plus, X } from 'lucide-react';
import { deleteSpread, dropPhotos, folioLabel, insertSpread, moveSpread } from '../actions';
import { clearGhost, sameTarget, startDrag, trackGhost } from '../drag';
import { projectStore, useProject } from '../store';
import type { Arrangement, Placement, Sheet, Spread } from '../types';
import { sheetExtent, sideAt } from '../geometry';
import { TERMS } from '../units';
import { DESK_PPI, deskGeometry } from '../deskGeometry';
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH } from '../prefs';
import { openPhotoMenu, setSidebarWidth, ui } from '../ui';
import { placedSoft, softLabel } from '../resolution';
import { PhotoImg } from './PhotoImg';
import { SoftBadge } from './SoftBadge';
import { SpreadCanvas } from './SpreadCanvas';
import { allSpreads, sheetOf } from '../spreads';

const GHOST_MAX = 140;
/**
 * Narrowest a spread (or a frame, half as wide: a book's page) can be before the list
 * falls back to fewer columns, and the narrowest its picture gets.
 */
const GRID_MIN_CELL: Record<Arrangement, number> = { spreads: 280, frames: 96 };
const MIN_THUMB: Record<Arrangement, number> = { spreads: 120, frames: 60 };
/** Space between grid columns; the vertical insert gaps live here. */
const GRID_GAP_X = 20;
/** Horizontal padding inside each spread row. */
const ROW_PAD_X = 8;
/** The desk keeps at least this much room when the sidebar is widened. */
const MIN_DESK_WIDTH = 160;

/** The list's side padding, as in styles.css: one column, and the grid (roomier). */
const LIST_PAD_X = 16;
const GRID_PAD_X = 24;

/**
 * One column until two spreads fit side by side, then as many columns as fit. Worked out
 * from the list's whole width, not its content's: the grid's padding differs, and
 * measuring inside it would flip between one column and two at some widths.
 */
function listLayout(listWidth: number, arrangement: Arrangement): { cols: number; thumbW: number } {
  const min = GRID_MIN_CELL[arrangement];
  const inGrid = listWidth - 2 * GRID_PAD_X;
  const cols = Math.max(1, Math.floor((inGrid + GRID_GAP_X) / (min + GRID_GAP_X)));
  const contentWidth = cols > 1 ? inGrid : listWidth - 2 * LIST_PAD_X;
  const cellW = (contentWidth - GRID_GAP_X * (cols - 1)) / cols;
  return { cols, thumbW: Math.max(MIN_THUMB[arrangement], cellW - ROW_PAD_X) };
}

export function Sidebar() {
  const { project } = useProject();
  const listRef = useRef<HTMLDivElement>(null);
  const [reorder, setReorder] = useState<{ id: string; dropIndex: number } | null>(null);
  const sheet = sheetOf(project);
  const book = sheet.arrangement === 'spreads';
  const terms = TERMS[sheet.arrangement];
  // The whole book (or sequence), in order; indexes below count through it.
  const spreads = allSpreads(project);
  const preferredWidth = ui.use((s) => s.sidebarWidth);
  const width = Math.max(SIDEBAR_MIN_WIDTH, Math.min(preferredWidth, window.innerWidth - MIN_DESK_WIDTH));
  const [listWidth, setListWidth] = useState(width);
  const { cols, thumbW } = listLayout(listWidth, sheet.arrangement);
  const grid = cols > 1;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setListWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onResizeDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = width;
    const clamp = (w: number) => Math.max(SIDEBAR_MIN_WIDTH, Math.min(w, window.innerWidth - MIN_DESK_WIDTH));
    let last = start;
    document.body.classList.add('col-resizing');
    const done = () => document.body.classList.remove('col-resizing');
    startDrag(e, {
      onMove: ({ dx }) => {
        last = clamp(start - dx);
        setSidebarWidth(last, false);
      },
      onEnd: (_, moved) => {
        done();
        if (moved) setSidebarWidth(last, true);
      },
      onCancel: () => {
        done();
        setSidebarWidth(start, false);
      },
    });
  };

  /** Dragging a middle spread's header reorders it; clicking it opens the spread. */
  const onHeaderDown = (e: React.PointerEvent, spread: Spread) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const from = spreads.findIndex((s) => s.id === spread.id);
    let dropIndex = from;
    startDrag(e, {
      onMove: ({ e: ev }) => {
        // Nearest spread to the pointer; drop before or after it depending on which
        // half the pointer is in (left/right in a grid, top/bottom in a column).
        const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row-index]') ?? [])];
        let best: { idx: number; r: DOMRect } | null = null;
        let bestDist = Infinity;
        for (const row of rows) {
          const r = row.getBoundingClientRect();
          const dx = Math.max(r.left - ev.clientX, 0, ev.clientX - r.right);
          const dy = Math.max(r.top - ev.clientY, 0, ev.clientY - r.bottom);
          const dist = Math.hypot(dx, dy);
          if (dist < bestDist) {
            bestDist = dist;
            best = { idx: Number(row.dataset.rowIndex), r };
          }
        }
        if (!best) return;
        const before = grid ? ev.clientX < best.r.left + best.r.width / 2 : ev.clientY < best.r.top + best.r.height / 2;
        const at = before ? best.idx : best.idx + 1;
        // A book's first and last spreads stay put; frames can go anywhere.
        dropIndex = book ? Math.min(Math.max(1, at), spreads.length - 1) : at;
        setReorder({ id: spread.id, dropIndex });
      },
      onEnd: (_, moved) => {
        setReorder(null);
        if (!moved) return ui.set({ editingSpreadId: spread.id });
        if (dropIndex === from || dropIndex === from + 1) return;
        moveSpread(spread.id, dropIndex > from ? dropIndex - 1 : dropIndex);
      },
      onCancel: () => setReorder(null),
    });
  };

  return (
    <aside className="sidebar" style={{ width }}>
      <div
        className="sidebar-resize"
        title="Drag to resize · double-click to reset"
        onPointerDown={onResizeDown}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH, true)}
      />
      <div className="sidebar-head">
        <span className="caps">{terms.Spreads}</span>
        <button
          className="btn ghost icon small"
          aria-label={`Add ${terms.spread} at the end`}
          title={terms.addAtEnd}
          onClick={() => insertSpread(book ? spreads.length - 1 : spreads.length)}
        >
          <Plus />
        </button>
        <span className="spacer" />
        <span className="caps muted">{terms.count(spreads.length)}</span>
      </div>
      <div
        className={`sidebar-list${grid ? ' grid' : ''}`}
        ref={listRef}
        style={grid ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
      >
        {spreads.map((spread, i) => (
          <div key={spread.id} className="spread-cell">
            {/* A book's first and last spreads stay put; frames can go anywhere. */}
            {(i > 0 || !book) && (
              <InsertGap index={i} active={reorder?.dropIndex === i} vertical={grid} noun={terms.spread} />
            )}
            <SpreadRow
              spread={spread}
              index={i}
              total={spreads.length}
              sheet={sheet}
              thumbW={thumbW}
              dragging={reorder?.id === spread.id}
              onHeaderDown={onHeaderDown}
            />
          </div>
        ))}
        {!book && (
          <div className="spread-cell">
            <InsertGap
              index={spreads.length}
              active={reorder?.dropIndex === spreads.length}
              vertical={grid}
              noun="frame"
            />
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * The gap between two spreads: hover to add a spread there, or drop photos on it
 * to add a spread holding them.
 */
function InsertGap({
  index,
  active,
  vertical,
  noun,
}: {
  index: number;
  active: boolean;
  vertical: boolean;
  noun: 'spread' | 'frame';
}) {
  const dropHover = ui.use((s) => sameTarget(s.hover, { kind: 'insert', index }));
  const photoDrag = ui.use((s) => s.ghost !== null);
  return (
    <div
      className={`insert-gap${vertical ? ' vertical' : ''}${active ? ' active' : ''}${dropHover ? ' drop-hover' : ''}${photoDrag ? ' photo-drag' : ''}`}
      data-drop="insert"
      data-index={index}
    >
      {/* In the grid, gaps are narrow vertical gutters, so the button is just "+". */}
      {dropHover ? (
        <span className="insert-btn">{vertical ? '+' : `Drop to add a ${noun}`}</span>
      ) : (
        <button
          className="insert-btn"
          title={vertical ? `Add a ${noun} here` : undefined}
          onClick={() => insertSpread(index)}
        >
          {vertical ? '+' : `+ Add ${noun}`}
        </button>
      )}
    </div>
  );
}

interface RowProps {
  spread: Spread;
  index: number;
  total: number;
  sheet: Sheet;
  thumbW: number;
  dragging: boolean;
  onHeaderDown: (e: React.PointerEvent, s: Spread) => void;
}

function SpreadRow({ spread, index, total, sheet, thumbW, dragging, onHeaderDown }: RowProps) {
  const { project } = useProject();
  const editing = ui.use((s) => s.editingSpreadId === spread.id);
  // Photos here with less detail than the page asks for.
  const soft = spread.items.filter((i) => placedSoft(project.photos[i.photoId], i, sheet)).length;
  // Thumbnails are as wide as a book's two pages, or a frame.
  const scale = thumbW / sheetExtent(sheet).width;
  // A book's middle spreads move and delete; so does any frame but a sequence's only one.
  const movable = spread.kind === 'middle' || (spread.kind === 'frame' && total > 1);
  const label = folioLabel(index, total, sheet.arrangement);

  const open = () => ui.set({ editingSpreadId: spread.id });

  const onCanvasDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    startDrag(e, { onEnd: (_, moved) => !moved && open() });
  };

  const onItemDown = (e: React.PointerEvent, p: Placement) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const k = DESK_PPI * ui.get().view.zoom;
    const w = Math.min(GHOST_MAX, p.w * k);
    const ghost = { photoId: p.photoId, count: 1, w, h: (w * p.h) / p.w };
    const fromSide = sideAt(sheet, p.x + p.w / 2);
    startDrag(e, {
      onMove: ({ e: ev }) => trackGhost(ev, ghost),
      onEnd: ({ e: ev }, moved) => {
        const target = trackGhost(ev, null);
        clearGhost();
        if (!moved) return open();
        // Dropping back on the page it came from leaves it where it was.
        if (target?.kind === 'page' && target.spreadId === spread.id && target.side === fromSide) return;
        const at = deskGeometry.toDesk(ev.clientX, ev.clientY);
        projectStore.apply((d) => void dropPhotos(d, target, [p.photoId], at));
      },
      onCancel: clearGhost,
    });
  };

  const renderItem = (p: Placement, style: CSSProperties) => (
    <div
      key={p.photoId}
      className="item"
      style={style}
      onPointerDown={(e) => onItemDown(e, p)}
      onContextMenu={(e) => openPhotoMenu(e, p.photoId)}
    >
      <PhotoImg id={p.photoId} />
    </div>
  );

  return (
    <div className={`spread-row${editing ? ' editing' : ''}${dragging ? ' dragging' : ''}`} data-row-index={index}>
      <div
        className={`spread-row-head${movable ? ' draggable' : ''}`}
        title={movable ? 'Drag to reorder' : spread.kind === 'frame' ? '' : 'The first and last pages stay in place'}
        onPointerDown={movable ? (e) => onHeaderDown(e, spread) : undefined}
      >
        <span className={`grip${movable ? '' : ' locked'}`} aria-hidden="true">
          <GripVertical />
        </span>
        <span className="spread-label">{label}</span>
        {soft > 0 && <SoftBadge note={softLabel(soft, sheet)} />}
        <span className="spacer" />
        {movable && (
          <button
            className="row-delete"
            aria-label={spread.kind === 'frame' ? `Delete frame ${label}` : `Delete pages ${label}`}
            title={`Delete ${spread.kind === 'frame' ? 'frame' : 'spread'} (photos return to the desk)`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => deleteSpread(spread.id)}
          >
            <X />
          </button>
        )}
      </div>
      <SpreadCanvas
        spread={spread}
        sheet={sheet}
        scale={scale}
        clip
        droppable
        renderItem={renderItem}
        onPointerDown={onCanvasDown}
        className="thumb"
      />
    </div>
  );
}
