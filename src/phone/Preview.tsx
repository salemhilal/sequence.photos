import { useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useProject } from '../store';
import { framesOf } from './frameActions';
import { FrameView } from './FrameView';
import { useSize } from './hooks';
import { fitWidth } from './layout';
import { closePreview, phone } from './nav';

/** Room around each frame, in screen pixels. */
const PAD = 16;

/**
 * Every frame, one at a time and as large as it fits, swiped through as the carousel will be.
 * A tap hides or shows the controls.
 */
export function Preview() {
  const { project } = useProject();
  const from = phone.use((s) => s.preview.from);
  const frames = framesOf(project);
  const [ref, size] = useSize<HTMLDivElement>();
  const strip = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState(from);
  const [chrome, setChrome] = useState(true);
  const width = fitWidth(project.page, { w: size.w - 2 * PAD, h: size.h - 2 * PAD });

  // Open on the frame it was asked for.
  useLayoutEffect(() => {
    if (size.w && strip.current) strip.current.scrollLeft = from * size.w;
  }, [from, size.w]);

  return (
    <div className="screen preview" ref={ref}>
      <div
        className="preview-strip"
        ref={strip}
        role="region"
        aria-label="Preview"
        onScroll={(e) => size.w && setAt(Math.round(e.currentTarget.scrollLeft / size.w))}
        onClick={() => setChrome(!chrome)}
      >
        {width > 0 &&
          frames.map((f, i) => (
            <div key={f.id} className="preview-slide" aria-label={`Frame ${i + 1}`}>
              <FrameView frame={f} page={project.page} photos={project.photos} width={width} />
            </div>
          ))}
      </div>
      <div className={`preview-chrome${chrome ? '' : ' hidden'}`}>
        <button className="btn" aria-label="Close the preview" onClick={closePreview}>
          <X />
        </button>
        <span className="mono">
          {Math.min(at, frames.length - 1) + 1} / {frames.length}
        </span>
        <span style={{ width: 44 }} />
      </div>
    </div>
  );
}
