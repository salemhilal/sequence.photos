import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { folioLabel } from '../actions';
import { useWindowEvent } from '../hooks';
import { exportFrames } from '../frames';
import { savePdf } from '../pdf';
import { platform } from '#platform';
import { commandTitle } from '../commands';
import { useProject } from '../store';
import { closeModal, ui } from '../ui';
import { SpreadCanvas } from './SpreadCanvas';
import { sheetExtent } from '../geometry';
import { TERMS } from '../units';
import { allSpreads, sheetOf } from '../spreads';

/** How long the pointer rests before the controls fade, as a video player's do. */
const IDLE_MS = 1000;

/**
 * Whether the preview's controls should fade: the pointer has rested a moment, and isn't
 * over them. Moving it (or tabbing to a control) brings them back; turning pages with
 * the keys doesn't, so paging through stays undisturbed.
 */
function useIdle(root: React.RefObject<HTMLElement | null>, hold: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rest = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Not while pointing at a control, or while one has keyboard focus.
        const onControl = root.current?.querySelector('.preview-head:hover, .turn:hover, :focus-visible');
        if (!onControl && !hold) setIdle(true);
      }, IDLE_MS);
    };
    const wake = () => {
      setIdle(false);
      rest();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Tab' && wake();
    rest();
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', onKey);
    };
  }, [root, hold]);
  return idle && !hold;
}

export function Preview() {
  const { project } = useProject();
  const [index, setIndex] = useState(() => {
    const editing = ui.get().editingSpreadId;
    return Math.max(
      0,
      allSpreads(project).findIndex((s) => s.id === editing),
    );
  });
  const [dir, setDir] = useState<'next' | 'prev'>('next');
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 900, h: 600 });
  const busy = ui.use((s) => s.busy);
  const sheet = sheetOf(project);
  // Saving (a PDF or images) shows its progress in the header: keep it up until that's done.
  const idle = useIdle(rootRef, busy !== null);
  const spreads = allSpreads(project);
  const spread = spreads[Math.min(index, spreads.length - 1)];

  const close = closeModal;
  const go = (d: number) => {
    setDir(d > 0 ? 'next' : 'prev');
    setIndex((i) => Math.min(spreads.length - 1, Math.max(0, i + d)));
  };

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useWindowEvent(
    'keydown',
    (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === 'Home') go(-spreads.length);
      else if (e.key === 'End') go(spreads.length);
      else return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  if (!spread) return null;
  // A book shows both pages' width (single pages on their side); a frame, its own.
  const across = sheetExtent(sheet).width;
  const scale = Math.min((stage.w - 40) / across, (stage.h - 40) / sheet.pageH);
  const label = folioLabel(index, spreads.length, sheet.arrangement);
  const terms = TERMS[sheet.arrangement];

  return (
    <div className={`preview${idle ? ' idle' : ''}`} data-modal ref={rootRef}>
      <header className="preview-head">
        <span className="folio">{label}</span>
        <span className="muted data">
          {index + 1} / {spreads.length}
        </span>
        <span className="spacer" />
        <span className="hint">← → to {terms.turn} · Esc to exit</span>
        <button
          className="btn"
          onClick={() => void (sheet.arrangement === 'spreads' ? savePdf() : exportFrames())}
          disabled={busy !== null}
        >
          {/* The Mac app names it as its menu does (Save PDF…, Export Frames as Images…). */}
          {busy ??
            (platform.kind === 'macos'
              ? commandTitle(sheet.arrangement === 'spreads' ? 'savePdf' : 'exportFrames')
              : terms.save)}
        </button>
        <button className="btn" onClick={close}>
          Exit preview
        </button>
      </header>
      <div className="preview-stage" ref={stageRef}>
        <button
          className="turn prev"
          aria-label={`Previous ${terms.spread}`}
          disabled={index === 0}
          onClick={() => go(-1)}
        >
          <ChevronLeft />
        </button>
        <div key={spread.id} className={`preview-spread turn-${dir}`}>
          <SpreadCanvas spread={spread} sheet={sheet} scale={scale} clip className="book" />
        </div>
        <button
          className="turn next"
          aria-label={`Next ${terms.spread}`}
          disabled={index === spreads.length - 1}
          onClick={() => go(1)}
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
