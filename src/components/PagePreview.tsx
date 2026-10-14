import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { folioLabel } from '../actions';
import { sheetExtent } from '../geometry';
import { useWindowEvent } from '../hooks';
import { isTyping } from '../input';
import { previewPageSetup, type PageDraft } from '../pageSetup';
import { allSpreads, sheetOf } from '../spreads';
import { useProject } from '../store';
import type { Placement, Project, Sheet } from '../types';
import { TERMS, UNITS } from '../units';
import { PhotoImg } from './PhotoImg';
import { SpreadCanvas } from './SpreadCanvas';

/** Room around the spread, as a share of a page's width. */
const PAD_SHARE = 0.05;

interface Props {
  draft: PageDraft;
  /** Draws a photo of the preview, e.g. with a badge; the default draws it plainly. */
  renderItem?: (p: Placement, style: CSSProperties, preview: Project, sheet: Sheet) => ReactNode;
  /** A line under the preview, about it as a whole. */
  footer?: (preview: Project) => ReactNode;
}

/**
 * The Page tab's live preview: the project's real spreads or frames as they'd be after
 * Apply (re-paginated, converted, and moved with the guides), read-only. ‹ › and the arrow
 * keys go through them. It's the same project Apply makes, so what's shown is what you get.
 */
export function PagePreview({ draft, renderItem, footer }: Props) {
  const { project } = useProject();
  // Memoized, so pages that become frames keep their new ids between renders.
  const preview = useMemo(() => previewPageSetup(draft), [project, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheet = sheetOf(preview);
  const spreads = allSpreads(preview);
  const [index, setIndex] = useState(0);
  const at = Math.min(index, spreads.length - 1);
  const spread = spreads[at];
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 800, h: 500 });

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = (d: number) => setIndex(Math.min(spreads.length - 1, Math.max(0, at + d)));
  useWindowEvent('keydown', (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else return;
    e.preventDefault();
  });

  const pad = sheet.pageW * PAD_SHARE;
  const across = sheetExtent(sheet).width;
  // Room below for the controls.
  const scale = Math.max(0, Math.min(stage.w / (across + 2 * pad), (stage.h - 56) / (sheet.pageH + 2 * pad)));
  const terms = TERMS[sheet.arrangement];
  const units = UNITS[sheet.unit];

  return (
    <div className="editor-stage page-preview" ref={stageRef}>
      {spread && (
        <div className="page-preview-canvas">
          <SpreadCanvas
            spread={spread}
            sheet={sheet}
            scale={scale}
            pad={pad}
            guides
            renderItem={
              renderItem
                ? (p, style) => renderItem(p, style, preview, sheet)
                : (p, style) => (
                    <div key={p.photoId} className="item" style={style}>
                      <PhotoImg id={p.photoId} />
                    </div>
                  )
            }
          />
        </div>
      )}
      <div className="page-preview-controls">
        <button
          className="btn ghost icon"
          aria-label={`Previous ${terms.spread}`}
          disabled={at === 0}
          onClick={() => go(-1)}
        >
          <ChevronLeft />
        </button>
        <span className="folio">{folioLabel(at, spreads.length, sheet.arrangement)}</span>
        <span className="muted data">
          {at + 1} / {spreads.length} · {units.format(sheet.pageW)} × {units.format(sheet.pageH)} {units.suffix}
        </span>
        <button
          className="btn ghost icon"
          aria-label={`Next ${terms.spread}`}
          disabled={at === spreads.length - 1}
          onClick={() => go(1)}
        >
          <ChevronRight />
        </button>
      </div>
      {footer && <div className="page-preview-footer">{footer(preview)}</div>}
    </div>
  );
}
