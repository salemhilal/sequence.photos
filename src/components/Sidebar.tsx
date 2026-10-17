import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { GripVertical, Pencil, Plus, X } from 'lucide-react';
import { deleteSpread, dropPhotos, folioLabel, insertSpread, isMovable, moveSpreads } from '../actions';
import { clearGhost, sameTarget, startDrag, trackGhost } from '../drag';
import { projectStore, useProject } from '../store';
import type { SpreadId } from '../ids';
import { isMac } from '../input';
import type { Arrangement, Placement, Sheet, Spread } from '../types';
import { sheetExtent, sideAt } from '../geometry';
import { TERMS } from '../units';
import { DESK_PPI, deskGeometry } from '../deskGeometry';
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_COLUMNS, SIDEBAR_MIN_WIDTH, sidebarColumnsPref } from '../prefs';
import { openPhotoMenu, setSidebarWidth, ui } from '../ui';
import { placedSoft, softLabel } from '../resolution';
import { PhotoImg } from './PhotoImg';
import { SoftBadge } from './SoftBadge';
import { SpreadCanvas } from './SpreadCanvas';
import { allSpreads, sheetOf } from '../spreads';

const GHOST_MAX = 140;
/** The narrowest a spread's (or frame's) picture gets: columns beyond that don't fit. */
const MIN_THUMB: Record<Arrangement, number> = { spreads: 120, frames: 60 };
/** How long the count stays after scrolling stops. */
const COUNT_MS = 1000;
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
 * The columns asked for (the header's slider), as many as fit. Worked out from the list's
 * whole width, not its content's: the grid's padding differs, and measuring inside it would
 * flip between one column and two at some widths.
 */
function listLayout(listWidth: number, arrangement: Arrangement, wanted: number): { cols: number; thumbW: number } {
  const inGrid = listWidth - 2 * GRID_PAD_X;
  const fit = Math.floor((inGrid + GRID_GAP_X) / (MIN_THUMB[arrangement] + ROW_PAD_X + GRID_GAP_X));
  const cols = Math.max(1, Math.min(wanted, fit));
  const contentWidth = cols > 1 ? inGrid : listWidth - 2 * LIST_PAD_X;
  const cellW = (contentWidth - GRID_GAP_X * (cols - 1)) / cols;
  return { cols, thumbW: Math.max(MIN_THUMB[arrangement], cellW - ROW_PAD_X) };
}

export function Sidebar() {
  const { project } = useProject();
  const listRef = useRef<HTMLDivElement>(null);
  const [reorder, setReorder] = useState<{ ids: readonly SpreadId[]; dropIndex: number } | null>(null);
  const selection = ui.use((s) => s.spreadSelection);
  // The last spread clicked, where a Shift-click's range starts.
  const anchor = useRef<SpreadId | null>(null);
  const [columns, setColumns] = useState(sidebarColumnsPref.load);
  // The count, shown while scrolling and a moment after.
  const [counting, setCounting] = useState(false);
  const countTimer = useRef(0);
  const sheet = sheetOf(project);
  const book = sheet.arrangement === 'spreads';
  const terms = TERMS[sheet.arrangement];
  // The whole book (or sequence), in order; indexes below count through it.
  const spreads = allSpreads(project);
  const preferredWidth = ui.use((s) => s.sidebarWidth);
  const width = Math.max(SIDEBAR_MIN_WIDTH, Math.min(preferredWidth, window.innerWidth - MIN_DESK_WIDTH));
  const [listWidth, setListWidth] = useState(width);
  const { cols, thumbW } = listLayout(listWidth, sheet.arrangement, columns);
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

  /** Select a spread as clicked: on its own, toggled (⌘ or Ctrl), or a range from the last (Shift). */
  const select = (spread: Spread, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    const ids = spreads.map((s) => s.id);
    if (e.shiftKey && anchor.current && ids.includes(anchor.current)) {
      const [from, to] = [ids.indexOf(anchor.current), ids.indexOf(spread.id)];
      ui.set({ spreadSelection: ids.slice(Math.min(from, to), Math.max(from, to) + 1) });
      return;
    }
    anchor.current = spread.id;
    const toggle = isMac ? e.metaKey : e.ctrlKey;
    const was = ui.get().spreadSelection;
    ui.set({
      spreadSelection: toggle
        ? was.includes(spread.id)
          ? was.filter((id) => id !== spread.id)
          : [...was, spread.id]
        : [spread.id],
    });
  };

  /**
   * A spread pressed: clicking selects it; dragging moves it, with the rest of the
   * selection, in order (a book's first and last spreads stay put).
   */
  const onRowDown = (e: React.PointerEvent, spread: Spread) => {
    if (e.button !== 0) return;
    const click = { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey };
    let ids: readonly SpreadId[] | null = null;
    let dropIndex = -1;
    startDrag(e, {
      onMove: ({ e: ev }) => {
        if (!isMovable(spread)) return;
        if (!ids) {
          // Dragging a spread outside the selection drags it alone.
          const chosen = ui.get().spreadSelection.includes(spread.id) ? ui.get().spreadSelection : [spread.id];
          if (chosen !== ui.get().spreadSelection) ui.set({ spreadSelection: chosen });
          ids = spreads.filter((s) => chosen.includes(s.id) && isMovable(s)).map((s) => s.id);
        }
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
        setReorder({ ids, dropIndex });
      },
      onEnd: (_, moved) => {
        setReorder(null);
        if (!moved) return select(spread, click);
        if (ids && dropIndex >= 0) moveSpreads(ids, dropIndex);
      },
      onCancel: () => setReorder(null),
    });
  };

  const onListScroll = () => {
    setCounting(true);
    clearTimeout(countTimer.current);
    countTimer.current = window.setTimeout(() => setCounting(false), COUNT_MS);
  };
  const pickColumns = (n: number) => {
    setColumns(n);
    sidebarColumnsPref.save(n);
  };

  return (
    <aside className="sidebar" style={{ width }}>
      <div
        className="sidebar-resize"
        data-tip="Drag to resize · double-click to reset"
        onPointerDown={onResizeDown}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH, true)}
      />
      <div className="sidebar-head">
        <span className="caps">{terms.Spreads}</span>
        <button
          className="btn ghost icon small"
          aria-label={`Add ${terms.spread} at the end`}
          data-tip={terms.addAtEnd}
          onClick={() => insertSpread(book ? spreads.length - 1 : spreads.length)}
        >
          <Plus />
        </button>
        <span className="spacer" />
        <input
          className="columns-slider"
          type="range"
          min={1}
          max={SIDEBAR_MAX_COLUMNS}
          step={1}
          list="sidebar-columns"
          value={columns}
          aria-label="Columns"
          data-tip={`${columns} ${columns === 1 ? 'column' : 'columns'}`}
          onChange={(e) => pickColumns(e.target.valueAsNumber)}
        />
        <datalist id="sidebar-columns">
          {Array.from({ length: SIDEBAR_MAX_COLUMNS }, (_, i) => (
            <option key={i} value={i + 1} />
          ))}
        </datalist>
      </div>
      <div
        className={`sidebar-list${grid ? ' grid' : ''}`}
        ref={listRef}
        style={grid ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
        onScroll={onListScroll}
        // Pressing the list itself, between spreads, lets the selection go.
        onPointerDown={(e) => e.target === e.currentTarget && ui.set({ spreadSelection: [] })}
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
              soft={spread.items.filter((it) => placedSoft(project.photos[it.photoId], it, sheet)).length}
              selected={selection.includes(spread.id)}
              dragging={reorder?.ids.includes(spread.id) ?? false}
              onRowDown={onRowDown}
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
      <div className={`sidebar-count${counting ? ' on' : ''}`} aria-hidden="true">
        {terms.count(spreads.length)}
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
          data-tip={vertical ? `Add a ${noun} here` : undefined}
          aria-label={vertical ? `Add a ${noun} here` : undefined}
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
  /** How many of its photos have less detail than the page asks for. */
  soft: number;
  selected: boolean;
  dragging: boolean;
  onRowDown: (e: React.PointerEvent, s: Spread) => void;
}

function SpreadRow({ spread, index, total, sheet, thumbW, soft, selected, dragging, onRowDown }: RowProps) {
  const editing = ui.use((s) => s.editingSpreadId === spread.id);
  // Thumbnails are as wide as a book's two pages, or a frame.
  const scale = thumbW / sheetExtent(sheet).width;
  // A book's middle spreads move and delete; so does any frame but a sequence's only one.
  const movable = spread.kind === 'middle' || (spread.kind === 'frame' && total > 1);
  const label = folioLabel(index, total, sheet.arrangement);

  const open = () => ui.set({ editingSpreadId: spread.id });

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
        // A click on a photo selects its spread, as a click anywhere else on it does.
        if (!moved) return ui.set({ spreadSelection: [spread.id] });
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
    <div
      className={`spread-row${editing ? ' editing' : ''}${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}${movable ? ' draggable' : ''}`}
      data-row-index={index}
      aria-selected={selected}
      onPointerDown={(e) => onRowDown(e, spread)}
      onDoubleClick={open}
    >
      <div
        className="spread-row-head"
        data-tip={movable || spread.kind === 'frame' ? undefined : 'The first and last pages stay in place'}
      >
        <span className={`grip${movable ? '' : ' locked'}`} aria-hidden="true">
          <GripVertical />
        </span>
        <span className="spread-label">{label}</span>
        {soft > 0 && <SoftBadge note={softLabel(soft, sheet)} />}
        <span className="spacer" />
        <button
          className="row-edit"
          aria-label={`Edit ${spread.kind === 'frame' ? 'frame' : 'pages'} ${label}`}
          data-tip="Edit"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={open}
        >
          <Pencil />
        </button>
        {movable && (
          <button
            className="row-delete"
            aria-label={spread.kind === 'frame' ? `Delete frame ${label}` : `Delete pages ${label}`}
            data-tip={`Delete ${spread.kind === 'frame' ? 'frame' : 'spread'} (photos return to the desk)`}
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
        className="thumb"
      />
    </div>
  );
}
