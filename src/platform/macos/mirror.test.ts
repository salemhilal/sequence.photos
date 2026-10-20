// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toGuideId } from '../../ids';
import type { Project } from '../../types';

/**
 * The Mac app's windows, simulated: each has its own project store (a fresh copy of the
 * modules), and events between them wait in one queue until delivered, as they take a
 * moment to cross between real windows.
 */
const bus = vi.hoisted(() => {
  type Handler = (e: { payload: unknown }) => void;
  const listeners = new Map<string, Handler[]>();
  const queue: { to: string; event: string; payload: unknown }[] = [];
  let current = 'main';
  return {
    queue,
    setWindow: (label: string) => void (current = label),
    reset() {
      listeners.clear();
      queue.length = 0;
    },
    listen(event: string, handler: Handler) {
      const key = `${current}:${event}`;
      listeners.set(key, [...(listeners.get(key) ?? []), handler]);
      return Promise.resolve(() => {});
    },
    emitTo(to: string, event: string, payload?: unknown) {
      // As over the real bridge: a copy, not the same object.
      queue.push({ to, event, payload: payload === undefined ? undefined : structuredClone(payload) });
      return Promise.resolve();
    },
    /** Deliver the first `count` events waiting (all of them by default), in order. */
    deliver(count = Infinity) {
      for (let i = 0; i < count && queue.length; i++) {
        const m = queue.shift();
        if (m) for (const h of listeners.get(`${m.to}:${m.event}`) ?? []) h({ payload: m.payload });
      }
    },
  };
});

vi.mock('@tauri-apps/api/event', () => ({ listen: bus.listen, emitTo: bus.emitTo }));

/** A window's own copy of the store, set up as the main window or the Layout window. */
async function openWindow(label: 'main' | 'layout') {
  vi.resetModules();
  const { projectStore } = await import('../../store');
  const mirror = await import('./mirror');
  bus.setWindow(label);
  if (label === 'main') mirror.serveLayoutWindow();
  else mirror.mirrorMainProject();
  return projectStore;
}

const guides = (p: Project) => p.settings.lines.map((l) => l.at);
const addGuide = (store: Awaited<ReturnType<typeof openWindow>>, at: number) =>
  store.apply((d) => void d.settings.lines.push({ id: toGuideId(`g${at}`), axis: 'vertical', at }));

beforeEach(() => bus.reset());

describe('the Layout window’s copy of the project', () => {
  it('starts as the main window’s, and follows its changes and undo', async () => {
    const main = await openWindow('main');
    const layout = await openWindow('layout');
    bus.deliver();
    expect(layout.project).toEqual(main.project);
    addGuide(main, 1);
    bus.deliver();
    expect(guides(layout.project)).toEqual([1]);
    main.undo();
    bus.deliver();
    expect(guides(layout.project)).toEqual([]);
  });

  it('sends its edits to the main window, each one undoable there', async () => {
    const main = await openWindow('main');
    const layout = await openWindow('layout');
    bus.deliver();
    addGuide(layout, 1);
    addGuide(layout, 2);
    bus.deliver();
    expect(guides(main.project)).toEqual([1, 2]);
    main.undo();
    bus.deliver();
    expect(guides(main.project)).toEqual([1]);
    expect(guides(layout.project)).toEqual([1]);
  });

  it('keeps an edit made while an earlier one is on its way', async () => {
    const main = await openWindow('main');
    const layout = await openWindow('layout');
    bus.deliver();
    addGuide(layout, 1);
    // The first edit reaches the main window; the next ones are made before anything comes back.
    bus.deliver(1);
    addGuide(layout, 2);
    bus.deliver(1);
    addGuide(layout, 3);
    bus.deliver();
    expect(guides(layout.project)).toEqual([1, 2, 3]);
    expect(guides(main.project)).toEqual([1, 2, 3]);
  });

  it('keeps a guide being dragged when its last edit reaches the main window', async () => {
    const main = await openWindow('main');
    const layout = await openWindow('layout');
    bus.deliver();
    addGuide(layout, 1);
    layout.begin();
    layout.preview((d) => void d.settings.lines.push({ id: toGuideId('drag'), axis: 'vertical', at: 2 }));
    bus.deliver();
    layout.end();
    bus.deliver();
    expect(guides(main.project)).toEqual([1, 2]);
  });

  it('ends up as the main window’s when both change at once', async () => {
    const main = await openWindow('main');
    const layout = await openWindow('layout');
    bus.deliver();
    addGuide(main, 1);
    addGuide(layout, 2);
    bus.deliver();
    bus.deliver();
    expect(layout.project).toEqual(main.project);
  });
});
