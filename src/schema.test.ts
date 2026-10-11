import { describe, expect, it } from 'vitest';
import { toGuideId, toPhotoId, toSpreadId } from './ids';
import { migrateProject, NewerProjectError } from './schema';
import { CURRENT_SCHEMA, type Project } from './types';
import { DEFAULT_FRAME } from './units';
import { InvalidProjectError } from './validate';

/**
 * A saved project in each past shape. When you bump CURRENT_SCHEMA, add a sample
 * of the previous version here (copy one from a real save) and extend `expected`.
 */
const samples: Record<number, unknown> = {
  // Before versioning: no schemaVersion, and no keepRelative setting.
  0: {
    photos: { a: { id: 'a', name: 'a.jpg', pxW: 1200, pxH: 800 } },
    pile: [{ photoId: 'a', x: 1, y: 1, w: 2, h: 1.33, z: 1 }],
    spreads: [
      { id: 's1', kind: 'first', items: [] },
      { id: 's2', kind: 'last', items: [] },
    ],
    settings: { pageW: 10, pageH: 8, centerV: true, centerH: false, borders: [0.5] },
    nextZ: 2,
  },
  // Border guides as one distance from every edge, and no line guides.
  1: {
    schemaVersion: 1,
    photos: { a: { id: 'a', name: 'a.jpg', pxW: 1200, pxH: 800 } },
    pile: [{ photoId: 'a', x: 1, y: 1, w: 2, h: 1.33, z: 1 }],
    spreads: [
      { id: 's1', kind: 'first', items: [] },
      { id: 's2', kind: 'last', items: [] },
    ],
    settings: { pageW: 10, pageH: 8, centerV: true, centerH: false, keepRelative: true, borders: [0.5] },
    nextZ: 2,
  },
  // A book's spreads at the top level, and the page size among the settings.
  2: {
    schemaVersion: 2,
    photos: { a: { id: 'a', name: 'a.jpg', pxW: 1200, pxH: 800 } },
    pile: [{ photoId: 'a', x: 1, y: 1, w: 2, h: 1.33, z: 1 }],
    firstSpread: { kind: 'first', id: 's1', items: [] },
    spreads: [],
    lastSpread: { kind: 'last', id: 's2', items: [] },
    settings: {
      pageW: 10,
      pageH: 8,
      centerV: true,
      centerH: false,
      keepRelative: true,
      borders: [{ id: 'm', kind: 'even', inset: 0.5 }],
      lines: [],
      dropBorder: 'm',
    },
    nextZ: 2,
  },
};

/**
 * What every sample should become. Upgrading gives guides new ids, so they're compared
 * with the ids set aside (see `withoutIds`), and checked to line up separately.
 */
const a = toPhotoId('a');
const expected: Project = {
  schemaVersion: CURRENT_SCHEMA,
  photos: { [a]: { id: a, name: 'a.jpg', pxW: 1200, pxH: 800 } },
  pile: [{ photoId: a, x: 1, y: 1, w: 2, h: 1.33, z: 1 }],
  // A print book: the first and last spreads, each in its place, and none between.
  layout: {
    kind: 'print',
    page: { w: 10, h: 8 },
    firstSpread: { kind: 'first', id: toSpreadId('s1'), items: [] },
    spreads: [],
    lastSpread: { kind: 'last', id: toSpreadId('s2'), items: [] },
  },
  settings: {
    sizes: { print: { w: 10, h: 8 }, digital: DEFAULT_FRAME },
    centerV: true,
    centerH: false,
    keepRelative: true,
    borders: [{ id: toGuideId('m'), kind: 'even', inset: 0.5 }],
    lines: [],
    dropBorder: toGuideId('m'),
  },
  nextZ: 2,
};

/** A project with its guides' ids replaced by their position, and the drop guide's by its. */
function withoutIds(project: Project): unknown {
  const ids = project.settings.borders.map((b) => b.id);
  return {
    ...project,
    settings: {
      ...project.settings,
      borders: project.settings.borders.map((b, i) => ({ ...b, id: i })),
      dropBorder: project.settings.dropBorder === null ? null : ids.indexOf(project.settings.dropBorder),
    },
  };
}

describe('migrateProject', () => {
  it('has a sample for every past version', () => {
    for (let v = 0; v < CURRENT_SCHEMA; v++) expect(samples[v], `missing sample for version ${v}`).toBeDefined();
  });

  it.each(Object.entries(samples))('upgrades version %s to the current shape', (_, sample) => {
    expect(withoutIds(migrateProject(structuredClone(sample)))).toEqual(withoutIds(expected));
  });

  it('leaves current projects as they are', () => {
    expect(migrateProject(structuredClone(expected))).toEqual(expected);
  });

  it('refuses projects from a newer version', () => {
    expect(() => migrateProject({ ...expected, schemaVersion: CURRENT_SCHEMA + 1 })).toThrow(NewerProjectError);
  });
});

describe('migrating version 0 without border guides', () => {
  it('gives it version 1’s default guides, then upgrades them', () => {
    const project = migrateProject({ ...(samples[0] as object), settings: { pageW: 10, pageH: 8 } });
    expect(project.settings.borders.map(({ kind, ...b }) => kind === 'even' && 'inset' in b && b.inset)).toEqual([
      0.5, 1.25,
    ]);
    expect(project.settings.lines).toEqual([]);
    // Dropped photos fit the largest box, as before: the 0.5 in guide.
    expect(project.settings.dropBorder).toBe(project.settings.borders[0]!.id);
  });
});

describe('damaged projects', () => {
  // The checks themselves are tested in validate.test.ts.
  it('reports damage an upgrade step runs into the same way as damage the check finds', () => {
    expect(() => migrateProject({ ...(samples[1] as object), spreads: 'none' })).toThrow(InvalidProjectError);
    expect(() => migrateProject({ ...expected, pile: 'none' })).toThrow(InvalidProjectError);
  });
});
