import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { PhotoImg } from '../components/PhotoImg';
import { placedSoft } from '../resolution';
import type { Frame, PageSetup, PhotoMeta } from '../types';
import { itemStyle, markAt } from './layout';

/**
 * A frame, as it exports: its background, and its photos cropped and bordered, at `width`
 * screen pixels. `soft` marks each photo that has less detail than the frame asks for.
 */
export function FrameView({
  frame,
  page,
  photos,
  width,
  soft = false,
  className = '',
  children,
}: {
  frame: Frame;
  page: Pick<PageSetup, 'w' | 'h' | 'pxPerUnit'>;
  photos: Readonly<Record<string, PhotoMeta>>;
  width: number;
  soft?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const scale = width / page.w;
  const marked = soft ? frame.items.filter((i) => placedSoft(photos[i.photoId], i, page)) : [];
  // The mark grows with the frame, within reason.
  const mark = Math.max(12, Math.min(22, width / 9));
  return (
    <div
      className={`page${frame.background === 'black' ? ' black' : ''} ${className}`}
      style={{ width, height: page.h * scale }}
    >
      {frame.items.map((item) => (
        <div key={item.photoId} className="item" style={itemStyle(item, scale)}>
          <PhotoImg id={item.photoId} />
        </div>
      ))}
      {marked.map((item) => (
        <span
          key={item.photoId}
          className="soft-mark"
          role="img"
          aria-label={`${photos[item.photoId]?.name ?? 'A photo'} is enlarged`}
          style={{ ...markAt(item, page, scale, mark), width: mark, height: mark }}
        >
          <TriangleAlert style={{ width: mark * 0.65, height: mark * 0.65 }} />
        </span>
      ))}
      {children}
    </div>
  );
}
