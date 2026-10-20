import { allSpreads, sheetOf } from './spreads';
import type { Project } from './types';
import type { UiState } from './ui';
import { TERMS } from './units';

/**
 * What the status bar says at its left: the hint for what's under the pointer; else what the
 * open page or the spread editor says (its size, how to use it); else, on the desk, what's
 * selected, or with nothing selected, how many photos are on the desk and placed.
 */
export function statusText(
  project: Project,
  s: Pick<UiState, 'hint' | 'pageStatus' | 'page' | 'selection' | 'spreadSelection'>,
): string | null {
  if (s.hint) return s.hint;
  if (s.pageStatus || s.page !== 'desk') return s.pageStatus;
  const photos = s.selection.length;
  if (photos) return `${photos} ${photos === 1 ? 'photo' : 'photos'} selected`;
  const spreads = s.spreadSelection.length;
  const terms = TERMS[sheetOf(project).arrangement];
  if (spreads) return `${spreads} ${spreads === 1 ? terms.spread : terms.spreads} selected`;
  const placed = new Set(allSpreads(project).flatMap((sp) => sp.items.map((i) => i.photoId))).size;
  return `${project.pile.length} on desk, ${placed} placed`;
}
