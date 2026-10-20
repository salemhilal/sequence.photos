import type { PhotoId } from '../ids';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getImage } from '../db';
import { useWindowEvent } from '../hooks';
import { markMissing, usePhotoMissing, usePhotoUrl } from '../images';
import { useProject } from '../store';
import type { PhotoMeta } from '../types';
import { closeQuickLook, ui } from '../ui';

/** Space around the fitted image. */
const MARGIN = 32;
/** Pointer travel that turns a click on the image into a pan. */
const PAN_THRESHOLD = 4;

/**
 * A macOS-style Quick Look: the selected photos, full-window, one at a time.
 * Click the image to see it at actual pixels (and drag to look around), click again to fit.
 */
export function QuickLook() {
  const state = ui.use((s) => s.quickLook);
  return state && <QuickLookView ids={state.ids} index={state.index} />;
}

function QuickLookView(props: { ids: PhotoId[]; index: number }) {
  const { project } = useProject();
  // Undo can remove a photo while it's showing.
  const ids = props.ids.filter((id) => project.photos[id]);
  const index = Math.min(props.index, ids.length - 1);
  const current = ids[index];
  const photo = current && project.photos[current];

  useEffect(() => {
    if (!photo) closeQuickLook();
  }, [photo]);

  const go = (d: number) => {
    if (ids.length < 2) return;
    ui.set({ quickLook: { ids, index: (index + d + ids.length) % ids.length } });
  };

  useWindowEvent(
    'keydown',
    (e) => {
      if (e.key === ' ' || e.key === 'Escape') closeQuickLook();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  if (!photo) return null;
  return (
    <div className="quick-look" data-modal role="dialog" aria-label={`Quick Look: ${photo.name}`}>
      <header className="quick-look-head">
        {/* A native tip for a long name: Quick Look covers the status bar, where hints go. */}
        <span className="quick-look-name" title={photo.name}>
          {photo.name}
        </span>
        <span className="data muted">
          {photo.pxW} × {photo.pxH}
        </span>
        {ids.length > 1 && (
          <span className="data muted">
            {index + 1} / {ids.length}
          </span>
        )}
        <span className="spacer" />
        <span className="hint">{ids.length > 1 ? '← → to browse · ' : ''}Space to close</span>
        <button className="btn ghost icon" aria-label="Close" onClick={closeQuickLook}>
          <X />
        </button>
      </header>
      <QuickLookImage key={photo.id} photo={photo} />
      {ids.length > 1 && (
        <>
          <button className="turn prev" aria-label="Previous photo" onClick={() => go(-1)}>
            <ChevronLeft />
          </button>
          <button className="turn next" aria-label="Next photo" onClick={() => go(1)}>
            <ChevronRight />
          </button>
        </>
      )}
    </div>
  );
}

/** Where the zoomed view should scroll to keep a point of the image under the pointer. */
interface Anchor {
  fx: number;
  fy: number;
  x: number;
  y: number;
}

function QuickLookImage({ photo }: { photo: PhotoMeta }) {
  const thumb = usePhotoUrl(photo.id);
  const missing = usePhotoMissing(photo.id);
  const full = useOriginalUrl(photo.id);
  const [fullFailed, setFullFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const anchor = useRef<Anchor | null>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = stage ? Math.min(1, (stage.w - 2 * MARGIN) / photo.pxW, (stage.h - 2 * MARGIN) / photo.pxH) : 0;
  // Actual size is one image pixel per screen pixel; small images still get a closer look.
  const scale = zoomed ? Math.max(1 / devicePixelRatio, fit * 2) : fit;
  const w = photo.pxW * scale;
  const h = photo.pxH * scale;

  useLayoutEffect(() => {
    const el = stageRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    const ox = Math.max(0, (el.clientWidth - w) / 2);
    const oy = Math.max(0, (el.clientHeight - h) / 2);
    el.scrollLeft = ox + a.fx * w - a.x;
    el.scrollTop = oy + a.fy * h - a.y;
  }, [zoomed, w, h]);

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    const el = stageRef.current;
    if (e.button !== 0 || !el) return;
    e.preventDefault();
    const img = e.currentTarget;
    img.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    let panned = false;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - start.x;
      const dy = m.clientY - start.y;
      if (!panned && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
      panned = true;
      el.scrollLeft = start.left - dx;
      el.scrollTop = start.top - dy;
    };
    const up = (u: PointerEvent) => {
      img.removeEventListener('pointermove', move);
      img.removeEventListener('pointerup', up);
      img.removeEventListener('pointercancel', cancel);
      if (panned) return;
      const r = img.getBoundingClientRect();
      const s = el.getBoundingClientRect();
      anchor.current = {
        fx: (u.clientX - r.left) / r.width,
        fy: (u.clientY - r.top) / r.height,
        x: u.clientX - s.left,
        y: u.clientY - s.top,
      };
      setZoomed((z) => !z);
    };
    const cancel = () => {
      img.removeEventListener('pointermove', move);
      img.removeEventListener('pointerup', up);
      img.removeEventListener('pointercancel', cancel);
    };
    img.addEventListener('pointermove', move);
    img.addEventListener('pointerup', up);
    img.addEventListener('pointercancel', cancel);
  };

  // The original may not be decodable here (e.g. HEIC outside Safari); the display copy stands in.
  const src = full && !fullFailed ? full : thumb;
  return (
    <div
      ref={stageRef}
      className={`quick-look-stage${zoomed ? ' zoomed' : ''}`}
      onPointerDown={(e) => !(e.target instanceof HTMLImageElement) && closeQuickLook()}
    >
      {missing && <p className="quick-look-missing">This photo's image could no longer be found.</p>}
      {stage && src && !missing && (
        <div className="quick-look-canvas" style={{ width: Math.max(w, stage.w), height: Math.max(h, stage.h) }}>
          <img
            src={src}
            alt={photo.name}
            draggable={false}
            style={{ width: w, height: h }}
            onPointerDown={onPointerDown}
            onError={() => (src === full ? setFullFailed(true) : markMissing(photo.id))}
          />
        </div>
      )}
    </div>
  );
}

/** An object URL for a photo's original file, revoked when no longer shown. */
function useOriginalUrl(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    void getImage(id).then((img) => {
      if (!live || !img) return;
      made = URL.createObjectURL(img.full);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  return url;
}
