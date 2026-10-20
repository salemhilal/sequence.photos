import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  /** Which one is shown (from 0), of how many. */
  at: number;
  count: number;
  go: (step: number) => void;
  /** What's paged through, for the buttons' names ("spread", "frame", "page"). */
  noun: string;
  /** Said after the count (an export page's size). */
  extra?: ReactNode;
  className?: string;
}

/** ‹ 2 / 4 › below a spread or page: Layout's and Export's previews, and the spread editor. */
export function Pager({ at, count, go, noun, extra, className = '' }: Props) {
  return (
    <div className={`page-preview-controls ${className}`}>
      <button className="btn ghost icon" aria-label={`Previous ${noun}`} disabled={at === 0} onClick={() => go(-1)}>
        <ChevronLeft />
      </button>
      <span className="muted data">
        {at + 1} / {count}
        {extra}
      </span>
      <button className="btn ghost icon" aria-label={`Next ${noun}`} disabled={at >= count - 1} onClick={() => go(1)}>
        <ChevronRight />
      </button>
    </div>
  );
}
