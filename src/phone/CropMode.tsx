import { useEffect, useRef, useState } from 'react';
import { Pin, RotateCcw } from 'lucide-react';
import { setCropFrame } from '../actions';
import { cropOf, dragCropHandle, frameToRatio, moveCrop, panCrop, wholeRect, type CropHandle } from '../crop';
import { snapLines, type Rect } from '../geometry';
import type { PhotoId } from '../ids';
import { PhotoImg } from '../components/PhotoImg';
import { sheetOf } from '../spreads';
import { projectStore, useProject } from '../store';
import type { Frame } from '../types';
import { useSize } from './hooks';
import { navigate, phone } from './nav';

const PAD = 28;
const SNAP = 10;
const EDGES: CropHandle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

/** A shape the bar offers, as width over height; null is any. */
interface Shape {
  label: string;
  ratio: number | null;
}

/**
 * Crop mode, for a photo on the frame: the whole photo shows, dimmed outside the crop. Drag
 * the crop's edges and corners to crop, or inside it to move it across the photo; pick a
 * shape below. Pinned, the crop stays where it is and dragging moves the photo behind it,
 * showing only what's in the crop. Done keeps the crop (one undo step); Cancel puts it back.
 */
export function CropMode({ photoId, frame }: { photoId: PhotoId; frame: Frame }) {
  const { project } = useProject();
  const sheet = sheetOf(project);
  const item = frame.items.find((i) => i.photoId === photoId);
  const photo = project.photos[photoId];
  const [ref, size] = useSize<HTMLDivElement>();
  // Where the whole photo is, from the crop as crop mode started; it moves only when the
  // photo is dragged behind a pinned crop.
  const [start] = useState<Rect>(() => (item && photo ? wholeRect(item, cropOf(photo)) : { x: 0, y: 0, w: 1, h: 1 }));
  const [whole, setWhole] = useState<Rect>(start);
  const [ratio, setRatio] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const finished = useRef(false);

  // One gesture from here to Done or Cancel; leaving any other way keeps what was made.
  useEffect(() => {
    projectStore.begin();
    return () => {
      if (!finished.current) projectStore.end();
    };
  }, []);

  const finish = (keep: boolean) => {
    finished.current = true;
    if (keep) projectStore.end();
    else projectStore.cancel();
    navigate('fade', () => phone.set({ cropping: null }));
  };

  if (!item || !photo) return null;
  const crop: Rect = { x: item.x, y: item.y, w: item.w, h: item.h };
  const show = (f: Rect, w: Rect) => projectStore.preview((d) => setCropFrame(d, photoId, f, w));

  // The frame and the whole photo (as it started, so the view holds still) fitted to the canvas.
  const ext = {
    x: Math.min(0, start.x),
    y: Math.min(0, start.y),
    r: Math.max(sheet.pageW, start.x + start.w),
    b: Math.max(sheet.pageH, start.y + start.h),
  };
  const s = Math.max(0.01, Math.min((size.w - 2 * PAD) / (ext.r - ext.x), (size.h - 2 * PAD) / (ext.b - ext.y)));
  const left = (size.w - (ext.r - ext.x) * s) / 2 - ext.x * s;
  const top = (size.h - (ext.b - ext.y) * s) / 2 - ext.y * s;
  const px = (r: Rect) => ({ left: left + r.x * s, top: top + r.y * s, width: r.w * s, height: r.h * s });
  const lines = snapLines(frame, sheet);
  const min = 10;

  const track = (e: React.PointerEvent, onMove: (dx: number, dy: number) => void) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => onMove((ev.clientX - start.x) / s, (ev.clientY - start.y) / s);
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  const dragHandle = (e: React.PointerEvent, handle: CropHandle) => {
    const from = crop;
    track(e, (dx, dy) => {
      const { frame: f } = dragCropHandle(from, whole, handle, dx, dy, { ratio, min, lines, threshold: SNAP / s });
      show(f, whole);
    });
  };

  const dragInside = (e: React.PointerEvent) => {
    const from = { crop, whole };
    track(e, (dx, dy) => {
      if (pinned) {
        const w = panCrop(from.crop, from.whole, dx, dy);
        setWhole(w);
        show(from.crop, w);
      } else {
        show(moveCrop(from.crop, from.whole, dx, dy, lines, SNAP / s).frame, from.whole);
      }
    });
  };

  const shapes: Shape[] = [
    { label: 'Free', ratio: null },
    { label: 'Original', ratio: whole.w / whole.h },
    { label: 'Square', ratio: 1 },
    { label: '4:5', ratio: 4 / 5 },
    { label: '3:2', ratio: 3 / 2 },
    { label: '16:9', ratio: 16 / 9 },
    { label: 'The frame', ratio: sheet.pageW / sheet.pageH },
  ];
  const chosen = (sh: Shape) =>
    sh.ratio === null ? ratio === null : ratio !== null && Math.abs(sh.ratio - ratio) < 1e-6;
  const choose = (sh: Shape) => {
    setRatio(sh.ratio);
    if (sh.ratio !== null) show(frameToRatio(crop, whole, sh.ratio), whole);
  };

  // What's cropped off, dimmed: above, below, and to each side of the crop.
  const dims: Rect[] = [
    { x: whole.x, y: whole.y, w: whole.w, h: crop.y - whole.y },
    { x: whole.x, y: crop.y + crop.h, w: whole.w, h: whole.y + whole.h - crop.y - crop.h },
    { x: whole.x, y: crop.y, w: crop.x - whole.x, h: crop.h },
    { x: crop.x + crop.w, y: crop.y, w: whole.x + whole.w - crop.x - crop.w, h: crop.h },
  ];
  const clip = `inset(${((crop.y - whole.y) / whole.h) * 100}% ${((whole.x + whole.w - crop.x - crop.w) / whole.w) * 100}% ${((whole.y + whole.h - crop.y - crop.h) / whole.h) * 100}% ${((crop.x - whole.x) / whole.w) * 100}%)`;
  const at = (h: CropHandle) => ({
    left: `${h.includes('w') ? 0 : h.includes('e') ? 100 : 50}%`,
    top: `${h.includes('n') ? 0 : h.includes('s') ? 100 : 50}%`,
  });

  return (
    <>
      <div className="canvas" ref={ref}>
        {size.w > 0 && (
          <>
            <div
              className={`page${frame.background === 'black' ? ' black' : ''}`}
              style={{
                position: 'absolute',
                ...px({ x: 0, y: 0, w: sheet.pageW, h: sheet.pageH }),
                boxShadow: 'var(--shadow)',
              }}
            />
            <div className="crop-whole" style={{ ...px(whole), ...(pinned ? { clipPath: clip } : {}) }}>
              <PhotoImg id={photoId} crop={null} />
            </div>
            {!pinned && dims.map((r, i) => r.w > 0 && r.h > 0 && <div key={i} className="crop-dim" style={px(r)} />)}
            <div
              className={`crop-window${pinned ? ' pinned' : ''}`}
              style={px(crop)}
              aria-label={pinned ? 'Drag to move the photo in the crop' : 'Drag to move the crop'}
              onPointerDown={dragInside}
            >
              {!pinned && (
                <>
                  {[1, 2].map((n) => (
                    <div
                      key={`v${n}`}
                      className="crop-third"
                      style={{ left: `${(n * 100) / 3}%`, top: 0, width: 1, height: '100%' }}
                    />
                  ))}
                  {[1, 2].map((n) => (
                    <div
                      key={`h${n}`}
                      className="crop-third"
                      style={{ top: `${(n * 100) / 3}%`, left: 0, height: 1, width: '100%' }}
                    />
                  ))}
                  {EDGES.filter((h) => ratio === null || h.length === 2).map((h) => (
                    <div
                      key={h}
                      className={`crop-handle ${h}${h.length === 2 ? ' corner' : ''}`}
                      style={at(h)}
                      onPointerDown={(e) => dragHandle(e, h)}
                    />
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
      <div className="panel" style={{ gap: 12 }}>
        <span className="note" style={{ textAlign: 'center', padding: '0 16px' }}>
          {pinned
            ? 'Crop pinned: drag to move the photo in it'
            : 'Drag an edge or corner to crop · drag inside to move the crop'}
        </span>
        <div className="chips" role="toolbar" aria-label="Crop shape">
          {shapes.map((sh) => (
            <button
              key={sh.label}
              className={`chip${chosen(sh) ? ' on' : ''}`}
              aria-pressed={chosen(sh)}
              disabled={pinned}
              onClick={() => choose(sh)}
            >
              {sh.label}
            </button>
          ))}
        </div>
        <div className="panel-row" style={{ padding: '0 12px', gap: 4 }}>
          <button
            className="btn"
            disabled={pinned}
            onClick={() => {
              setRatio(null);
              show(whole, whole);
            }}
          >
            <RotateCcw style={{ width: 18, height: 18 }} />
            Reset
          </button>
          <button className={`btn${pinned ? ' on' : ''}`} aria-pressed={pinned} onClick={() => setPinned(!pinned)}>
            <Pin style={{ width: 18, height: 18 }} />
            {pinned ? 'Pinned' : 'Pin'}
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => finish(false)}>
            Cancel
          </button>
          <button className="btn light" onClick={() => finish(true)}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}
