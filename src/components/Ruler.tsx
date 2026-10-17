import type { ReactNode } from 'react';
import type { Unit } from '../types';

/** Ruler thickness, in pixels. */
export const RULER = 20;

/**
 * A ruler's markings: the finest ticks that stay a few pixels apart, and numbers at the
 * smallest interval that leaves room for them.
 */
interface RulerSteps {
  ticks: number[];
  numbers: number[];
  /** The least room between numbers, in screen pixels. */
  room: number;
}

const RULER_STEPS: Record<Unit, RulerSteps> = {
  in: { ticks: [1 / 8, 1 / 4, 1 / 2, 1], numbers: [1, 2, 5], room: 16 },
  px: { ticks: [10, 25, 50, 100, 250], numbers: [50, 100, 250, 500, 1000], room: 36 },
};

interface RulerProps {
  axis: 'horizontal' | 'vertical';
  /** The ruler's length, in pixels. */
  length: number;
  /** Where the measuring starts: the gutter (mirrored, for the top ruler) or the pages' top. */
  origin: number;
  scale: number;
  /** The page's size along the ruler, in inches or pixels. */
  size: number;
  unit: Unit;
  /** Measure each page from its outside edge, meeting at the gutter. */
  mirrored?: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}

/** A ruler in inches (⅛ in ticks, numbered every inch) or pixels, coarser when zoomed out. */
export function Ruler({ axis, length, origin, scale, size, unit, mirrored = false, onPointerDown }: RulerProps) {
  const steps = RULER_STEPS[unit];
  const every = steps.numbers.find((n) => n * scale >= steps.room) ?? steps.numbers.at(-1)!;
  const minor = steps.ticks.find((t) => t * scale >= 6 && every % t < 1e-9) ?? every;
  /** Whether a distance is a whole number of `step`s. */
  const on = (d: number, step: number) => Math.abs(d / step - Math.round(d / step)) < 1e-9;
  const ticks: ReactNode[] = [];
  // Pages along the ruler: [position of its 0, direction]. The top ruler measures each
  // page from its outside edge; the left one, from the top.
  const pages: [number, number][] = mirrored
    ? [
        [origin - size * scale, 1],
        [origin + size * scale, -1],
      ]
    : [[origin, 1]];
  pages.forEach(([zero, dir], p) => {
    for (let i = 0; i * minor <= size + 1e-9; i++) {
      const d = i * minor;
      const at = zero + dir * d * scale;
      const numbered = on(d, every);
      const half = on(d, every / 2);
      const len = numbered ? RULER * 0.55 : half ? RULER * 0.35 : RULER * 0.2;
      const key = `${p}-${i}`;
      ticks.push(
        axis === 'horizontal' ? (
          <line key={key} x1={at} x2={at} y1={RULER} y2={RULER - len} />
        ) : (
          <line key={key} y1={at} y2={at} x1={RULER} x2={RULER - len} />
        ),
      );
      // Not numbered at the gutter, where both pages end.
      if (numbered && !(mirrored && Math.abs(d - size) < 1e-9)) {
        const label = String(Math.round(d * 1000) / 1000);
        ticks.push(
          axis === 'horizontal' ? (
            <text key={`${key}t`} x={at + (dir > 0 ? 3 : -3)} y={9} textAnchor={dir > 0 ? 'start' : 'end'}>
              {label}
            </text>
          ) : (
            // Turned along the ruler when it's too long to fit across it.
            <text
              key={`${key}t`}
              x={3}
              y={at + 10}
              {...(label.length > 2 && { x: 9, y: at + 3, textAnchor: 'end', transform: `rotate(-90 9 ${at + 3})` })}
            >
              {label}
            </text>
          ),
        );
      }
    }
  });
  const box = axis === 'horizontal' ? { width: length, height: RULER } : { width: RULER, height: length };
  return (
    <svg
      className={`ruler ruler-${axis === 'horizontal' ? 'top' : 'left'}`}
      {...box}
      onPointerDown={onPointerDown}
      aria-label={`Ruler: drag to add a ${axis} guide`}
    >
      {ticks}
    </svg>
  );
}
