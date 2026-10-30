import { useCallback, useLayoutEffect, useRef, useState } from 'react';

type Size = { w: number; h: number };

/**
 * An element's size as it lays out (following it as it changes), and the ref that measures it.
 * `onResize` hears each change after the first, with the size before it.
 */
export function useSize<T extends HTMLElement>(
  onResize?: (was: Size, now: Size) => void,
): [(el: T | null) => void, Size] {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const heard = useRef(onResize);
  useLayoutEffect(() => {
    heard.current = onResize;
  });
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    let last: Size | null = null;
    const measure = () => {
      const now = { w: el.clientWidth, h: el.clientHeight };
      if (last && (last.w !== now.w || last.h !== now.h)) heard.current?.(last, now);
      last = now;
      setSize((was) => (was.w === now.w && was.h === now.h ? was : now));
    };
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
  }, []);
  return [ref, size];
}
