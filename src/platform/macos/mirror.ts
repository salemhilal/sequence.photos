import { emitTo, listen } from '@tauri-apps/api/event';
import { projectStore } from '../../store';
import type { Project } from '../../types';

/**
 * The Mac app's Layout window edits the main window's project. The main window holds it
 * (with its history, saving, and the document); the Layout window keeps a copy in step:
 * the main window sends it the project whenever it changes, and the Layout window sends
 * back each edit, as the project it made and the step it belongs to, so the main window
 * records it as its own undoable step (a guide dragged in many moves is still one step).
 *
 * Edits cross on the way: the main window may send a project from before the Layout
 * window's latest edit arrived. So each edit is numbered, and the main window says with
 * each project the last one it took; the Layout window passes over a project that predates
 * an edit of its own still on the way (that edit replaces it), and the main window doesn't
 * send back the project an edit made (the Layout window already has it).
 */

const READY = 'layout-ready';
const CLOSED = 'layout-closed';
const PROJECT = 'layout-project';
const EDIT = 'layout-edit';

interface Edit {
  project: Project;
  /** Edits with the same key, in a row, are one undo step (as `apply`'s `coalesce`). */
  step: string;
  /** Which edit this is, counting from 1 since the Layout window opened. */
  n: number;
}

interface Sync {
  project: Project;
  /** The last of the Layout window's edits the main window took (0 for none). */
  seen: number;
}

/** In the main window: send the project to the Layout window while it's open, and take its edits. */
export function serveLayoutWindow(): void {
  let open = false;
  let seen = 0;
  // Taking an edit: its project is the Layout window's already.
  let taking = false;
  const send = () => void emitTo('layout', PROJECT, { project: projectStore.project, seen } satisfies Sync);
  void listen(READY, () => {
    open = true;
    seen = 0;
    send();
  });
  void listen(CLOSED, () => (open = false));
  projectStore.subscribe(() => open && !taking && send());
  void listen<Edit>(EDIT, (e) => {
    seen = e.payload.n;
    taking = true;
    try {
      projectStore.apply(() => e.payload.project, { coalesce: e.payload.step });
    } finally {
      taking = false;
    }
  });
}

/** In the Layout window: keep the project in step with the main window's, and send it each edit. */
export function mirrorMainProject(): void {
  let steps = 0;
  let sent = 0;
  const send = (step: string) =>
    void emitTo('main', EDIT, { project: projectStore.project, step, n: ++sent } satisfies Edit);
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
  void listen<Sync>(PROJECT, (e) => {
    // From before an edit made here reached the main window: that edit, on its way, replaces it.
    if (e.payload.seen < sent) return;
    projectStore.reset(e.payload.project);
  });
  void emitTo('main', READY);
  window.addEventListener('pagehide', () => void emitTo('main', CLOSED));
}
