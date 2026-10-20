import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ownsArrowKeys } from './input';
import type { Size } from './types';
import { addPageStatus, ui, type PageStatus } from './ui';

/**
 * Listen for a window event with the latest `handler` (so it can read current
 * props and state) while subscribing only once.
 */
export function useWindowEvent<K extends keyof WindowEventMap>(
  type: K,
  handler: (e: WindowEventMap[K]) => void,
  capture = false,
): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const listener = (e: WindowEventMap[K]) => latest.current(e);
    window.addEventListener(type, listener, capture);
    return () => window.removeEventListener(type, listener, capture);
  }, [type, capture]);
}

/**
 * An element's content size, kept up to date as it resizes (`initial` until it's first
 * measured), and a way to measure it now (when it's just been shown, before it's painted).
 */
export function useElementSize<T extends HTMLElement>(initial: Size): [RefObject<T | null>, Size, () => void] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const measure = () => {
    const el = ref.current;
    if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
  };
  return [ref, size, measure];
}

/**
 * Going through `count` pages one at a time, with ‹ › buttons (`go`) and the ← → keys.
 * The position is kept within the pages as they change. Keys aimed at a control that uses
 * them itself (a text field, a radio group) are left to it.
 */
export function usePager(count: number): { at: number; go: (step: number) => void } {
  const [index, setIndex] = useState(0);
  const at = Math.max(0, Math.min(index, count - 1));
  const go = (step: number) => setIndex(Math.max(0, Math.min(count - 1, at + step)));
  useWindowEvent('keydown', (e) => {
    // Not behind a confirmation, either.
    if (ownsArrowKeys(e.target) || e.metaKey || e.ctrlKey || e.altKey || ui.get().confirm) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else return;
    e.preventDefault();
  });
  return { at, go };
}

/**
 * What a page (or the spread editor over the desk, or Layout over either) says in the status
 * bar while it's open: its size, how to use it (see statusText). Closing a dialog brings
 * back what the page under it says.
 */
export function usePageStatus(text: string | null): void {
  const status = useRef<PageStatus | null>(null);
  useEffect(() => {
    const added = addPageStatus(null);
    status.current = added;
    return () => {
      added.remove();
      status.current = null;
    };
  }, []);
  useEffect(() => status.current?.set(text), [text]);
}
