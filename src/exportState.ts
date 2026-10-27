import { projectStore } from './store';
import type { ExportState } from './types';

/**
 * Save the Export page's choices with the project: in its file and the browser's copy,
 * outside undo (see ProjectStore). Nothing changes, so nothing's marked unsaved, when the
 * choices are as they were.
 */
export function saveExportState(change: (state: ExportState) => ExportState): void {
  const was = projectStore.project.export ?? {};
  const next = change(was);
  if (JSON.stringify(next) === JSON.stringify(was)) return;
  projectStore.silent((d) => {
    d.export = next;
  });
}
