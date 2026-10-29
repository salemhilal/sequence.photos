import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { PhotoImg } from '../components/PhotoImg';
import { placedSoft } from '../resolution';
import type { Frame, PageSetup, PhotoMeta } from '../types';
import { itemStyle } from './layout';

/**
 * A frame, as it exports: its background, and its photos cropped and bordered, at `width`
 * screen pixels. `soft` marks it when a photo has less detail than the frame asks for.
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
  const marked = soft && frame.items.some((i) => placedSoft(photos[i.photoId], i, page));
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
      {marked && (
        <span className="soft-mark" role="img" aria-label="A photo is enlarged">
          <TriangleAlert />
        </span>
      )}
      {children}
    </div>
  );
}
