// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runFromMenu } from './commands';
import { projectStore, emptyProject } from './store';
import { ui } from './ui';
import { setLayoutSize } from './pageSize';
import { sheetOf } from './spreads';

afterEach(() => {
  document.body.replaceChildren();
  ui.set({ modal: null });
  projectStore.reset(emptyProject());
});

describe('runFromMenu', () => {
  it('runs the command', () => {
    projectStore.apply((d) => setLayoutSize(d, { w: 12, h: 8 }));
    expect(runFromMenu('undo')).toBe(true);
    expect(sheetOf(projectStore.project).pageW).toBe(10);
  });

  it('gives a focused text field its own editing instead', () => {
    projectStore.apply((d) => setLayoutSize(d, { w: 12, h: 8 }));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const fallback = vi.fn();
    expect(runFromMenu('undo', fallback)).toBe(false);
    expect(fallback).toHaveBeenCalled();
    expect(sheetOf(projectStore.project).pageW).toBe(12);
  });

  it('leaves desk commands alone while something covers the desk', () => {
    ui.set({ modal: 'settings', selection: [] });
    expect(runFromMenu('selectAll')).toBe(false);
  });
});
