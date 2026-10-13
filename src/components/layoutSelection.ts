import type { GuideId } from '../ids';
import type { LineGuide } from '../types';

/** What the Layout view and its panel have selected, shared between them. */

export type Axis = LineGuide['axis'];

/** What's selected: a guide from the rulers or a border guide (by id), or a center line. */
export type Selection = { kind: 'line' | 'border'; id: GuideId } | { kind: 'center'; axis: Axis };

export function same(a: Selection | null, b: Selection): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === 'center' ? b.kind === 'center' && a.axis === b.axis : b.kind !== 'center' && a.id === b.id;
}
