import type { CSSProperties, ReactNode } from 'react';
import { sameTarget } from '../drag';
import {
  pageRect,
  pageSides,
  sheetExtent,
  spreadGuides,
  spreadLeft,
  spreadWidth,
  type SnapFeedback,
} from '../geometry';
import type { Placement, Sheet, Spread } from '../types';
import { ui } from '../ui';
import { PhotoImg } from './PhotoImg';

interface Props {
  spread: Spread;
  sheet: Sheet;
  /** Screen pixels per unit (an inch in print, a pixel in digital). */
  scale: number;
  /** Margin around the spread, in its units, where off-page photo edges remain visible. */
  pad?: number;
  guides?: boolean;
  /** Clip photos to the pages (for preview). */
  clip?: boolean;
  /** Mark pages as drop targets. */
  droppable?: boolean;
  snapHit?: SnapFeedback | null;
  renderItem?: (p: Placement, style: CSSProperties) => ReactNode;
  overlay?: ReactNode;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  className?: string;
}

/** Renders a spread at a given scale. Item coordinates are relative to the gutter. */
export function SpreadCanvas({
  spread,
  sheet,
  scale,
  pad = 0,
  guides = false,
  clip = false,
  droppable = false,
  snapHit,
  renderItem,
  overlay,
  onPointerDown,
  className,
}: Props) {
  const hovered = ui.use((s) => s.hover);
  const sides = pageSides(spread.kind);
  // A book's canvas spans both pages (single first and last pages sit on their side); a
  // frame's spans the frame.
  const extent = sheetExtent(sheet);
  const originX = (pad - extent.left) * scale;
  const originY = pad * scale;
  const width = (extent.width + 2 * pad) * scale;
  const height = (sheet.pageH + 2 * pad) * scale;

  const box = (x: number, y: number, w: number, h: number): CSSProperties => ({
    left: originX + x * scale,
    top: originY + y * scale,
    width: w * scale,
    height: h * scale,
  });

  const pagesX = spreadLeft(spread.kind, sheet);
  const pagesW = spreadWidth(spread.kind, sheet);
  // Center lines are drawn in their own color.
  const g = guides ? spreadGuides(spread, { ...sheet, centerV: false, centerH: false }) : null;
  const vLines = g
    ? [
        ...g.xs.map((at) => ({ at, center: false })),
        ...(sheet.centerV
          ? sides.map((side) => ({ at: pageRect(side, sheet).x + sheet.pageW / 2, center: true }))
          : []),
      ]
    : [];
  const hLines = g
    ? [...g.ys.map((at) => ({ at, center: false })), ...(sheet.centerH ? [{ at: sheet.pageH / 2, center: true }] : [])]
    : [];
  const items = [...spread.items].sort((a, b) => a.z - b.z);

  return (
    <div className={`spread-canvas ${className ?? ''}`} style={{ width, height }} onPointerDown={onPointerDown}>
      {sides.map((side) => {
        const r = pageRect(side, sheet);
        const hover = sameTarget(hovered, { kind: 'page', spreadId: spread.id, side });
        return (
          <div
            key={side}
            className={`page page-${side}${hover ? ' drop-hover' : ''}`}
            style={box(r.x, r.y, r.w, r.h)}
            data-drop={droppable ? 'page' : undefined}
            data-spread={spread.id}
            data-side={side}
          />
        );
      })}

      <div
        className="spread-items"
        style={
          clip ? { ...box(pagesX, 0, pagesW, sheet.pageH), overflow: 'hidden' } : { left: 0, top: 0, width, height }
        }
      >
        {items.map((p) => {
          const style: CSSProperties = clip
            ? {
                left: (p.x - pagesX) * scale,
                top: p.y * scale,
                width: p.w * scale,
                height: p.h * scale,
              }
            : box(p.x, p.y, p.w, p.h);
          return renderItem ? (
            renderItem(p, style)
          ) : (
            <div key={p.photoId} className="item" style={style}>
              <PhotoImg id={p.photoId} />
            </div>
          );
        })}
      </div>

      {!clip && pad > 0 && <div className="offpage-mask" style={box(pagesX, 0, pagesW, sheet.pageH)} />}
      {!clip && (
        <div className="page-outline" style={box(pagesX, 0, pagesW, sheet.pageH)}>
          {sides.length === 2 && <div className="gutter" style={{ left: sheet.pageW * scale }} />}
        </div>
      )}

      {g && (
        <div className="guides">
          {vLines.map(({ at, center }, i) => (
            <div
              key={`x${i}`}
              className={`guide guide-v${center ? ' center' : ''}${snapHit?.xs.includes(round(at)) ? ' hit' : ''}`}
              style={{ left: originX + at * scale, top: originY, height: sheet.pageH * scale }}
            />
          ))}
          {sides.map((side) =>
            hLines.map(({ at, center }, i) => (
              <div
                key={`${side}y${i}`}
                className={`guide guide-h${center ? ' center' : ''}${snapHit?.ys.includes(round(at)) ? ' hit' : ''}`}
                style={{
                  top: originY + at * scale,
                  left: originX + pageRect(side, sheet).x * scale,
                  width: sheet.pageW * scale,
                }}
              />
            )),
          )}
        </div>
      )}
      {snapHit && (
        <div className="guides">
          {snapHit.xs.map((x) => (
            <div key={`sx${x}`} className="guide guide-v hit" style={{ left: originX + x * scale, top: 0, height }} />
          ))}
          {snapHit.ys.map((y) => (
            <div key={`sy${y}`} className="guide guide-h hit" style={{ top: originY + y * scale, left: 0, width }} />
          ))}
        </div>
      )}
      {overlay}
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
