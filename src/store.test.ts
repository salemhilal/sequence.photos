import { beforeEach, describe, expect, it } from 'vitest';
import { projectStore, emptyProject } from './store';
import type { Draft } from 'immer';
import { setLayoutSize } from './pageSize';
import { sheetOf } from './spreads';
import type { Project } from './types';

const pageW = () => sheetOf(projectStore.project).pageW;
const setPageW = (n: number, coalesce?: string) =>
  projectStore.apply((d) => setLayoutSize(d, { w: n, h: 8 }), coalesce ? { coalesce } : {});
const widen = (d: Draft<Project>, n: number) => setLayoutSize(d, { w: sheetOf(d).pageW + n, h: 8 });

beforeEach(() => projectStore.reset(emptyProject()));

describe('undo and redo', () => {
  it('undoes and redoes discrete changes', () => {
    setPageW(11);
    setPageW(12);
    projectStore.undo();
    expect(pageW()).toBe(11);
    projectStore.undo();
    expect(pageW()).toBe(10);
    projectStore.redo();
    expect(pageW()).toBe(11);
  });

  it('clears redo after a new change', () => {
    setPageW(11);
    projectStore.undo();
    setPageW(9);
    expect(projectStore.getSnapshot().canRedo).toBe(false);
  });

  it('merges rapid changes that share a coalesce key into one step', () => {
    setPageW(11, 'w');
    setPageW(12, 'w');
    projectStore.undo();
    expect(pageW()).toBe(10);
  });

  it('ignores changes that change nothing', () => {
    setPageW(10);
    expect(projectStore.getSnapshot().canUndo).toBe(false);
  });
});

describe('gestures', () => {
  it('records a whole gesture as a single step, each preview starting from the beginning', () => {
    projectStore.begin();
    projectStore.preview((d) => widen(d, 1));
    projectStore.preview((d) => widen(d, 2));
    projectStore.end();
    expect(pageW()).toBe(12);
    projectStore.undo();
    expect(pageW()).toBe(10);
  });

  it('restores the starting project on cancel', () => {
    projectStore.begin();
    projectStore.preview((d) => setLayoutSize(d, { w: 20, h: 8 }));
    projectStore.cancel();
    expect(pageW()).toBe(10);
    expect(projectStore.getSnapshot().canUndo).toBe(false);
  });

  it('records nothing for a gesture that changes nothing', () => {
    projectStore.begin();
    projectStore.end();
    expect(projectStore.getSnapshot().canUndo).toBe(false);
  });
});

describe('replace and silent', () => {
  it('replaces the whole project as one undoable step', () => {
    const other = { ...emptyProject(), nextZ: 99 };
    projectStore.replace(other);
    expect(projectStore.project).toBe(other);
    projectStore.undo();
    expect(projectStore.project.nextZ).toBe(1);
  });

  it('changes the project without recording history', () => {
    projectStore.silent((d) => void (d.nextZ = 5));
    expect(projectStore.project.nextZ).toBe(5);
    expect(projectStore.getSnapshot().canUndo).toBe(false);
  });
});

describe('swap', () => {
  it('shows another project, then brings back the project with its history', () => {
    setPageW(11);
    setPageW(12);
    projectStore.undo();
    const restore = projectStore.swap({ ...emptyProject(), nextZ: 42 });
    expect(projectStore.project.nextZ).toBe(42);
    expect(projectStore.getSnapshot().canUndo).toBe(false);
    setPageW(3);

    restore();
    expect(pageW()).toBe(11);
    projectStore.redo();
    expect(pageW()).toBe(12);
    projectStore.undo();
    projectStore.undo();
    expect(pageW()).toBe(10);
  });
});
