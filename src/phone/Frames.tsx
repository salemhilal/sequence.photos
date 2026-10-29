import { useRef, useState } from 'react';
import { Check, ChevronLeft, CircleEllipsis, Copy, Plus, Share, Trash2 } from 'lucide-react';
import { deleteSpreads, moveSpreads } from '../actions';
import type { SpreadId } from '../ids';
import { projectStore, useProject } from '../store';
import type { Frame } from '../types';
import { addFrame, duplicateFrames, framesOf } from './frameActions';
import { FrameSizeSheet } from './FrameSizeSheet';
import { FrameView } from './FrameView';
import { fitWidth } from './layout';
import { useSize } from './hooks';
import { addPhotoFiles, pickPhotos } from './importing';
import { closeAndSave, openProjectId, renameProject } from './library';
import { dropIndex, openEditor, phone, toggled } from './nav';
import { RenameSheet } from './RenameSheet';
import { ActionSheet } from './Sheets';

/** How long a press lasts before it picks a frame up to move. */
const HOLD_MS = 350;
/** How far a finger may wander and still be holding still, in screen pixels. */
const SLOP = 8;

interface Lift {
  ids: SpreadId[];
  /** The frame under the finger, shown lifted. */
  id: SpreadId;
  x: number;
  y: number;
  /** Where they'd land: an index into the frames, and the bar showing it. */
  at: number;
  bar: { left: number; top: number; height: number } | null;
}

/**
 * A sequence's frames, as the sidebar shows them on the desktop: tap one to edit it, hold
 * and drag to move it, Select to duplicate or delete several. Photos come in from +.
 */
export function Frames() {
  const { project, canUndo, canRedo } = useProject();
  const name = phone.use((s) => s.name);
  const sheet = phone.use((s) => s.sheet);
  const pending = phone.use((s) => s.pending);
  const selecting = phone.use((s) => s.selecting);
  const selected = phone.use((s) => s.selected);
  const [menu, setMenu] = useState<'add' | 'more' | 'delete' | null>(null);
  const [lift, setLift] = useState<Lift | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const frames = framesOf(project);
  const { page } = project;

  const back = () => {
    void closeAndSave().then(() => phone.set({ screen: 'library', selecting: false, selected: [] }));
  };

  const choosePhotos = async () => {
    setMenu(null);
    const files = await pickPhotos();
    if (files.length) phone.set({ pending: files, sheet: 'add' });
  };

  // Hold a frame still to pick it up (with the rest of the selection, when it's chosen),
  // then drag it to a gap.
  const press = (e: React.PointerEvent, id: SpreadId) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let lifted: Lift | null = null;
    let moved = false;
    const cells = () => [...(grid.current?.querySelectorAll<HTMLElement>('.cell') ?? [])];
    const place = (x: number, y: number): Lift | null => {
      if (!lifted) return null;
      const boxes = cells().map((c) => c.getBoundingClientRect());
      const at = dropIndex(boxes, x, y);
      const g = grid.current?.getBoundingClientRect();
      const near = boxes[Math.min(at, boxes.length - 1)];
      const bar =
        g && near
          ? {
              left: (at < boxes.length ? near.left - 7 : near.right + 5) - g.left,
              top: near.top - g.top,
              height: near.height - 22,
            }
          : null;
      return { ...lifted, x, y, at, bar };
    };
    // While a frame is up, the page doesn't scroll under it.
    const still = (ev: TouchEvent) => {
      if (lifted) ev.preventDefault();
    };
    const timer = setTimeout(() => {
      if (moved) return;
      const ids =
        selecting && selected.includes(id) ? frames.filter((f) => selected.includes(f.id)).map((f) => f.id) : [id];
      lifted = { ids, id, x: start.x, y: start.y, at: 0, bar: null };
      lifted = place(start.x, start.y);
      setLift(lifted);
      navigator.vibrate?.(10);
    }, HOLD_MS);
    const move = (ev: PointerEvent) => {
      if (!lifted) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > SLOP) moved = true;
        return;
      }
      lifted = place(ev.clientX, ev.clientY);
      setLift(lifted);
    };
    const up = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', still);
      if (lifted) {
        moveSpreads(lifted.ids, lifted.at);
        setLift(null);
        // A lift isn't a tap.
        suppressClick.current = true;
      }
    };
    const cancel = () => {
      // The page took the gesture to scroll (before anything was lifted).
      if (lifted) return;
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', still);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', still, { passive: false });
  };
  const suppressClick = useRef(false);

  const tap = (id: SpreadId) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (selecting) phone.set({ selected: toggled(selected, id) });
    else openEditor(id);
  };

  const liftedFrame = lift && frames.find((f) => f.id === lift.id);
  const ratio = `${page.w} / ${page.h}`;

  return (
    <div className="screen">
      <div className="nav">
        {selecting ? (
          <>
            <button className="btn" onClick={() => phone.set({ selecting: false, selected: [] })}>
              Cancel
            </button>
            <span className="nav-title">{selected.length ? `${selected.length} selected` : 'Select frames'}</span>
            <button
              className="btn"
              onClick={() => phone.set({ selected: selected.length === frames.length ? [] : frames.map((f) => f.id) })}
            >
              {selected.length === frames.length ? 'None' : 'All'}
            </button>
          </>
        ) : (
          <>
            <button className="btn" style={{ paddingLeft: 4 }} onClick={back}>
              <ChevronLeft />
              Sequences
            </button>
            <div className="nav-group">
              <button className="btn" aria-label="Export" onClick={() => phone.set({ sheet: 'export' })}>
                <Share />
              </button>
              <button className="btn" aria-label="More" onClick={() => setMenu('more')}>
                <CircleEllipsis />
              </button>
            </div>
          </>
        )}
      </div>
      <div className="title">
        <h1>{name}</h1>
        <span className="sub">
          {page.w} × {page.h} px frames
        </span>
      </div>
      <div className="scroll">
        <div className="grid" ref={grid} style={{ ['--well-ratio' as string]: ratio }}>
          {frames.map((f, i) => {
            const on = selecting && selected.includes(f.id);
            return (
              <button
                key={f.id}
                className={`cell${on ? ' sel' : ''}${lift?.ids.includes(f.id) ? ' lifted' : ''}`}
                aria-label={`Frame ${i + 1}`}
                aria-pressed={selecting ? on : undefined}
                onPointerDown={(e) => press(e, f.id)}
                onClick={() => tap(f.id)}
                onContextMenu={(e) => e.preventDefault()}
              >
                <div className="well">
                  <FrameWell frame={f} />
                  {selecting && <span className="check">{on && <Check />}</span>}
                </div>
                <span className="num">{String(i + 1).padStart(2, '0')}</span>
              </button>
            );
          })}
          {lift?.bar && <div className="insert-bar" style={lift.bar} />}
        </div>
      </div>
      {lift && liftedFrame && (
        <div className="lift" style={{ left: lift.x - 75, top: lift.y - 90, width: 150 }}>
          <FrameView frame={liftedFrame} page={page} photos={project.photos} width={132} />
          {lift.ids.length > 1 && <span className="lift-count">{lift.ids.length}</span>}
        </div>
      )}
      <div className="bar">
        {selecting ? (
          <>
            <button
              className="btn"
              disabled={!selected.length}
              onClick={() => void duplicateFrames(selected).then(() => phone.set({ selected: [] }))}
            >
              <Copy />
              Duplicate
            </button>
            <span className="hint">Hold and drag to move</span>
            <button
              className="btn danger"
              disabled={!selected.length || selected.length >= frames.length}
              onClick={() => setMenu('delete')}
            >
              <Trash2 />
              Delete
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => phone.set({ selecting: true, selected: [] })}>
              Select
            </button>
            <span className="hint mono" style={{ fontSize: 12 }}>
              {frames.length} {frames.length === 1 ? 'frame' : 'frames'}
            </span>
            <button className="btn" aria-label="Add" onClick={() => setMenu('add')}>
              <Plus />
            </button>
          </>
        )}
      </div>

      {menu === 'add' && (
        <ActionSheet
          onCancel={() => setMenu(null)}
          actions={[
            { label: 'Add photos', run: () => void choosePhotos() },
            {
              label: 'Add an empty frame',
              run: () => {
                setMenu(null);
                projectStore.apply((d) => void addFrame(d));
              },
            },
          ]}
        />
      )}
      {menu === 'more' && (
        <ActionSheet
          onCancel={() => setMenu(null)}
          actions={[
            { label: 'Frame size…', run: () => (setMenu(null), phone.set({ sheet: 'size' })) },
            { label: 'Rename…', run: () => (setMenu(null), phone.set({ sheet: 'rename' })) },
            ...(canUndo ? [{ label: 'Undo', run: () => (setMenu(null), projectStore.undo()) }] : []),
            ...(canRedo ? [{ label: 'Redo', run: () => (setMenu(null), projectStore.redo()) }] : []),
          ]}
        />
      )}
      {menu === 'delete' && (
        <ActionSheet
          title={`Delete ${selected.length} ${selected.length === 1 ? 'frame' : 'frames'}? Their photos go to the desk.`}
          onCancel={() => setMenu(null)}
          actions={[
            {
              label: 'Delete',
              danger: true,
              run: () => {
                setMenu(null);
                deleteSpreads(selected);
                phone.set({ selected: [] });
              },
            },
          ]}
        />
      )}
      {sheet === 'add' && (
        <AddPhotosSheet
          files={pending}
          empty={frames.filter((f) => f.items.length === 0).length}
          last={frames.length}
          onDone={() => phone.set({ sheet: null, pending: [] })}
        />
      )}
      {sheet === 'size' && <FrameSizeSheet onDone={() => phone.set({ sheet: null })} />}
      {sheet === 'rename' && (
        <RenameSheet
          name={name}
          onCancel={() => phone.set({ sheet: null })}
          onDone={(n) => {
            const id = openProjectId();
            const named = n.trim() || name;
            phone.set({ sheet: null, name: named });
            if (id) void renameProject(id, named);
          }}
        />
      )}
    </div>
  );
}

/** A frame in its well, as large as the well allows. */
function FrameWell({ frame }: { frame: Frame }) {
  const { project } = useProject();
  const [ref, size] = useSize<HTMLDivElement>();
  const width = fitWidth(project.page, size);
  return (
    <div
      ref={ref}
      style={{ position: 'absolute', inset: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {width > 0 && <FrameView frame={frame} page={project.page} photos={project.photos} width={width} soft />}
    </div>
  );
}

/** Where the photos just chosen go: a frame each, the empty frames first, or the desk. */
function AddPhotosSheet({
  files,
  empty,
  last,
  onDone,
}: {
  files: readonly File[];
  empty: number;
  last: number;
  onDone: () => void;
}) {
  const n = files.length;
  const add = (to: 'frames' | 'fill' | 'desk') => {
    onDone();
    void addPhotoFiles(files, to);
  };
  const pad = (i: number) => String(i).padStart(2, '0');
  const range = (from: number, count: number) =>
    count === 1 ? `Frame ${pad(from)}` : `Frames ${pad(from)} to ${pad(from + count - 1)}`;
  const filled = Math.min(empty, n);
  return (
    <ActionSheet
      title={`Add ${n} ${n === 1 ? 'photo' : 'photos'}`}
      onCancel={onDone}
      actions={[
        {
          label: n === 1 ? 'A new frame' : 'A frame for each',
          detail: `${range(last + 1, n)}, after the last`,
          run: () => add('frames'),
        },
        ...(empty > 0
          ? [
              {
                label: 'Fill empty frames first',
                detail:
                  n > filled
                    ? `${filled} empty, then ${range(last + 1, n - filled).toLowerCase()}`
                    : `${filled} of the ${empty} empty`,
                run: () => add('fill'),
              },
            ]
          : []),
        { label: 'To the desk', detail: 'Drag them onto frames in the editor', run: () => add('desk') },
      ]}
    />
  );
}
