import { emitTo, listen } from '@tauri-apps/api/event';
import { projectStore } from '../../store';
import type { Project } from '../../types';

/**
 * The Mac app's Layout window edits the main window's project. The main window holds it
 * (with its history, saving, and the document); the Layout window keeps a copy in step:
 * the main window sends it the project whenever it changes, and the Layout window sends
 * back each edit, as the project it made and the step it belongs to, so the main window
 * records it as its own undoable step (a guide dragged in many moves is still one step).
 */

const READY = 'layout-ready';
const CLOSED = 'layout-closed';
const PROJECT = 'layout-project';
const EDIT = 'layout-edit';

interface Edit {
  project: Project;
  /** Edits with the same key, in a row, are one undo step (as `apply`'s `coalesce`). */
  step: string;
}

/** In the main window: send the project to the Layout window while it's open, and take its edits. */
export function serveLayoutWindow(): void {
  let open = false;
  const send = () => void emitTo('layout', PROJECT, projectStore.project);
  void listen(READY, () => {
    open = true;
    send();
  });
  void listen(CLOSED, () => (open = false));
  projectStore.subscribe(() => open && send());
  void listen<Edit>(EDIT, (e) => projectStore.apply(() => e.payload.project, { coalesce: e.payload.step }));
}

/** In the Layout window: keep the project in step with the main window's, and send it each edit. */
export function mirrorMainProject(): void {
  let steps = 0;
  const send = (step: string) => void emitTo('main', EDIT, { project: projectStore.project, step } satisfies Edit);
  // The editing calls, sending what they did. History stays in the main window.
  const { apply, replace, end } = projectStore;
  projectStore.apply = (recipe, opts = {}) => {
    const before = projectStore.project;
    apply.call(projectStore, recipe, opts);
    if (projectStore.project !== before) send(opts.coalesce ?? `layout-${++steps}`);
  };
  projectStore.replace = (project) => {
    replace.call(projectStore, project);
    send(`layout-${++steps}`);
  };
  projectStore.end = () => {
    const before = projectStore.gestureStart;
    end.call(projectStore);
    if (projectStore.project !== before) send(`layout-${++steps}`);
  };
  void listen<Project>(PROJECT, (e) => projectStore.reset(e.payload));
  void emitTo('main', READY);
  window.addEventListener('pagehide', () => void emitTo('main', CLOSED));
}
