import { useEffect, useRef, useState } from 'react';
import { platform } from '#platform';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { useElementSize, usePageStatus, useWindowEvent } from '../hooks';
import { useProject } from '../store';
import { ui } from '../ui';
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [stageRef, stage] = useElementSize<HTMLDivElement>({ w: 900, h: 600 });
  const busy = ui.use((s) => s.busy);
  const presenting = ui.use((s) => s.presenting);
  const sheet = sheetOf(project);
  // Fullscreen, the controls fade while the pointer rests (not while saving shows its progress).
  const idle = useIdle(rootRef, busy !== null || !presenting);
  const spreads = allSpreads(project);
  const spread = spreads[Math.min(index, spreads.length - 1)];

  const present = (on: boolean) => {
    ui.set({ presenting: on });
    platform.setFullscreen(on);
  };
  // Leaving fullscreen some other way (the browser's Esc, the green button) stops presenting;
  // so does leaving the page.
  useEffect(() => {
    const stop = platform.watchFullscreen((on) => !on && ui.set({ presenting: false }));
    return () => {
      stop();
      if (ui.get().presenting) present(false);
    };
  }, []);
  const go = (d: number) => {
    setDir(d > 0 ? 'next' : 'prev');
    setIndex((i) => Math.min(spreads.length - 1, Math.max(0, i + d)));
  };

  useWindowEvent(
    'keydown',
    (e) => {
      if (ui.get().modal || ui.get().confirm) return;
      // Esc leaves fullscreen (pages aren't dismissed: the switcher changes them).
      if (e.key === 'Escape') {
        if (!ui.get().presenting) return;
        present(false);
      } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) present(!ui.get().presenting);
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

  const terms = TERMS[sheet.arrangement];
  // How to use it, in the status bar (fullscreen hides that, so its header says it instead).
  const keys = `← → to ${terms.turn}`;
  usePageStatus(`${keys} · F for fullscreen`);

  if (!spread) return null;
  // A book shows both pages' width (single pages on their side); a frame, its own. Room
  // below for the count.
  const across = sheetExtent(sheet).width;
  const scale = Math.min((stage.w - 40) / across, (stage.h - 72) / sheet.pageH);

  return (
    <div className={`preview${idle ? ' idle' : ''}${presenting ? ' presenting' : ''}`} ref={rootRef}>
      <header className="preview-head">
        <span className="spacer" />
        {presenting && <span className="hint">{keys} · Esc to leave fullscreen</span>}
        {presenting && busy !== null && <span className="muted">{busy}</span>}
        <button className="btn" onClick={() => present(!presenting)}>
          {presenting ? <Minimize2 /> : <Maximize2 />}
          {presenting ? 'Exit fullscreen' : 'Fullscreen'}
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
        {/* The count, just below the spread. */}
        <div className="preview-column">
          <div key={spread.id} className={`preview-spread turn-${dir}`}>
            <SpreadCanvas spread={spread} sheet={sheet} scale={scale} clip className="book" />
          </div>
          <span className="preview-count data">
            {index + 1} / {spreads.length}
          </span>
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
