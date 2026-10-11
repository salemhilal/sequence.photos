import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { folioLabel } from '../actions';
import { useWindowEvent } from '../hooks';
import { saveFrames } from '../frames';
import { savePdf } from '../pdf';
import { useProject } from '../store';
import { closeModal, ui } from '../ui';
import { SpreadCanvas } from './SpreadCanvas';
import { allSpreads, sheetOf } from '../spreads';

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
  const [stage, setStage] = useState({ w: 900, h: 600 });
  const busy = ui.use((s) => s.busy);
  const sheet = sheetOf(project);
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
  const across = sheet.layout === 'print' ? 2 * sheet.pageW : sheet.pageW;
  const scale = Math.min((stage.w - 40) / across, (stage.h - 40) / sheet.pageH);
  const label = folioLabel(index, spreads.length, sheet.layout);

  return (
    <div className="preview" data-modal>
      <header className="preview-head">
        <span className="folio">{label}</span>
        <span className="muted data">
          {index + 1} / {spreads.length}
        </span>
        <span className="spacer" />
        <span className="hint">← → to turn pages · Esc to exit</span>
        <button
          className="btn"
          onClick={() => void (sheet.layout === 'print' ? savePdf() : saveFrames())}
          disabled={busy !== null}
        >
          {busy ?? (sheet.layout === 'print' ? 'Download PDF' : 'Save images')}
        </button>
        <button className="btn" onClick={close}>
          Exit preview
        </button>
      </header>
      <div className="preview-stage" ref={stageRef}>
        <button className="turn prev" aria-label="Previous spread" disabled={index === 0} onClick={() => go(-1)}>
          <ChevronLeft />
        </button>
        <div key={spread.id} className={`preview-spread turn-${dir}`}>
          <SpreadCanvas spread={spread} sheet={sheet} scale={scale} clip className="book" />
        </div>
        <button
          className="turn next"
          aria-label="Next spread"
          disabled={index === spreads.length - 1}
          onClick={() => go(1)}
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
