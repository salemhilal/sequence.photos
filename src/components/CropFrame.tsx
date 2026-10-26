import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setCropFrame } from '../actions';
import { cropOf, dragCropHandle, frameToRatio, panCrop, wholeRect, type CropHandle } from '../crop';
import { startDrag } from '../drag';
import type { GuideLines, Rect, SnapFeedback } from '../geometry';
import { usePageStatus } from '../hooks';
import { isMac } from '../input';
import { projectStore } from '../store';
import type { PhotoId } from '../ids';
import { ui } from '../ui';
import { PhotoImg } from './PhotoImg';

/**
 * Crop mode, over a photo's frame (on the desk or a page): the whole photo shows, dimmed
 * outside the crop. Drag the frame's edges and corners to crop, or the photo inside it to
 * choose what shows; pick a shape from the bar below it. Return, Done, or a click elsewhere
 * keeps the crop (one undo step); Esc puts it back.
 *
 * Rendered inside the photo's item, whose box is the frame (it moves as the crop does). The
 * crop is previewed in the project as it's made, so every view shows it.
 */

const EDGES: CropHandle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

/** A shape the bar offers, as width over height; null is any. */
interface Shape {
  label: string;
  ratio: number | null;
}

interface Props {
  photoId: PhotoId;
  /** The frame now (the photo's placement), in its parent's units. */
  frame: Rect;
  /** Screen pixels per unit, to turn drags into the frame's units. */
  scale: number;
  /** The smallest side, in units. */
  min: number;
  /** The page's shape, for the bar's Page (or Frame) choice. */
  page: { label: string; ratio: number };
  /** What the edges snap to (the spread editor's guides), unless Option is held. */
  lines?: GuideLines | null;
  threshold?: number;
  onSnap?: (hit: SnapFeedback | null) => void;
}

export function CropFrame({ photoId, frame, scale, min, page, lines = null, threshold = 0, onSnap }: Props) {
  const photo = projectStore.project.photos[photoId];
  // Where the whole photo is, from the crop and frame as crop mode started; it moves only
  // when the photo is dragged in its frame.
  const [whole, setWhole] = useState<Rect>(() => wholeRect(frame, cropOf(photo ?? {})));
  const [ratio, setRatio] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  usePageStatus(
    `Drag the edges to crop · drag the photo to move it · Shift keeps the shape${
      lines ? ` · ${isMac ? 'Option' : 'Alt'}: no snapping` : ''
    } · Return to finish, Esc to cancel`,
  );

  const show = (f: Rect, w: Rect) => projectStore.preview((d) => setCropFrame(d, photoId, f, w));
  const finish = (keep: boolean) => {
    if (keep) projectStore.end();
    else projectStore.cancel();
    onSnap?.(null);
    ui.set({ cropping: null });
  };

  // One gesture from here to Done or Esc.
  useEffect(() => {
    projectStore.begin();
    return () => {
      // Left some other way (the photo deleted, the view closed): keep what was made, and
      // leave crop mode once nothing shows it (not when React only remounts this).
      if (ui.get().cropping !== photoId) return;
      projectStore.end();
      setTimeout(() => {
        if (ui.get().cropping === photoId && !document.querySelector('.crop-frame')) ui.set({ cropping: null });
      });
    };
  }, [photoId]);

  // Return keeps the crop and Esc puts it back; other keys wait (nothing else mid-crop).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && bar.current?.contains(e.target) && e.key === 'Tab') return;
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      else if (['Shift', 'Alt', 'Meta', 'Control'].includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // A press anywhere but the photo or its bar keeps the crop (and goes on to what was pressed).
    const press = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || bar.current?.contains(t)) return;
      finish(true);
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', press, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointerdown', press, true);
    };
  });

  const dragHandle = (e: React.PointerEvent, handle: CropHandle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = frame;
    startDrag(e, {
      onMove: ({ e: ev, dx, dy }) => {
        // Shift keeps the shape it has; a shape from the bar is kept anyway.
        const keep = ratio ?? (ev.shiftKey ? start.w / start.h : null);
        const snapping = lines && !ev.altKey ? lines : null;
        const { frame: f, hit } = dragCropHandle(start, whole, handle, dx / scale, dy / scale, {
          ratio: keep,
          min,
          lines: snapping,
          threshold,
        });
        onSnap?.(hit);
        show(f, whole);
      },
      onEnd: () => onSnap?.(null),
    });
  };

  const dragPhoto = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = whole;
    startDrag(e, {
      onMove: ({ dx, dy }) => {
        const w = panCrop(frame, start, dx / scale, dy / scale);
        setWhole(w);
        show(frame, w);
      },
    });
  };

  const choose = (shape: Shape) => {
    setRatio(shape.ratio);
    if (shape.ratio !== null) show(frameToRatio(frame, whole, shape.ratio), whole);
  };
  const shapes: Shape[] = [
    { label: 'Original', ratio: whole.w / whole.h },
    { label: '1:1', ratio: 1 },
    { label: '4:5', ratio: 4 / 5 },
    { label: '3:2', ratio: 3 / 2 },
    { label: page.label, ratio: page.ratio },
    { label: 'Free', ratio: null },
  ];
  const chosen = (s: Shape) => (s.ratio === null ? ratio === null : ratio !== null && Math.abs(s.ratio - ratio) < 1e-6);

  // The whole photo, placed against the frame (the item's box): as shares of the frame.
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const wholeStyle = {
    left: pct(whole.x - frame.x, frame.w),
    top: pct(whole.y - frame.y, frame.h),
    width: pct(whole.w, frame.w),
    height: pct(whole.h, frame.h),
  };
  const l = (frame.x - whole.x) / whole.w;
  const t = (frame.y - whole.y) / whole.h;
  const r = (frame.x + frame.w - whole.x) / whole.w;
  const b = (frame.y + frame.h - whole.y) / whole.h;
  const at = (x1: number, y1: number, x2: number, y2: number) => ({
    left: `${x1 * 100}%`,
    top: `${y1 * 100}%`,
    width: `${(x2 - x1) * 100}%`,
    height: `${(y2 - y1) * 100}%`,
  });
  const windowStyle = at(l, t, r, b);

  return (
    // Presses stay here: the photo under crop mode (its item) would take them as a move.
    <div ref={ref} className="crop-frame" onPointerDown={(e) => e.stopPropagation()}>
      <div className="crop-whole" style={wholeStyle}>
        <PhotoImg id={photoId} crop={null} />
        {/* What's cropped off, dimmed: above, below, and to each side of the crop. */}
        <div className="crop-dim" style={at(0, 0, 1, t)} />
        <div className="crop-dim" style={at(0, b, 1, 1)} />
        <div className="crop-dim" style={at(0, t, l, b)} />
        <div className="crop-dim" style={at(r, t, 1, b)} />
        <div className="crop-window" style={windowStyle} onPointerDown={dragPhoto} />
      </div>
      <div className="crop-thirds" />
      {EDGES.filter((h) => ratio === null || h.length === 2).map((h) => (
        <div key={h} className={`crop-handle crop-${h}`} onPointerDown={(e) => dragHandle(e, h)} />
      ))}
      <CropBar anchor={ref} barRef={bar}>
        {shapes.map((s) => (
          <button key={s.label} className={`crop-shape${chosen(s) ? ' on' : ''}`} onClick={() => choose(s)}>
            {s.label}
          </button>
        ))}
        <span className="crop-bar-gap" />
        <button
          className="crop-shape"
          onClick={() => {
            setRatio(null);
            show(whole, whole);
          }}
        >
          Reset
        </button>
        <button className="btn primary crop-done" onClick={() => finish(true)}>
          Done
        </button>
      </CropBar>
    </div>
  );
}

/** The bar of shapes, under the frame on screen (at its size whatever the zoom). */
function CropBar({
  anchor,
  barRef,
  children,
}: {
  anchor: React.RefObject<HTMLDivElement | null>;
  barRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const follow = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) {
        const y = Math.min(innerHeight - 52, r.bottom + 12);
        setAt((was) => (was && was.x === r.left + r.width / 2 && was.y === y ? was : { x: r.left + r.width / 2, y }));
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [anchor]);
  if (!at) return null;
  return createPortal(
    // Events from a portal still reach its React parents (the photo's item): not these.
    <div
      ref={barRef}
      className="crop-bar"
      style={{ left: at.x, top: at.y }}
      role="toolbar"
      aria-label="Crop"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
