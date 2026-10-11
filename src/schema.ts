import { newGuideId } from './ids';
import { emptyProject } from './store';
import { CURRENT_SCHEMA, type Project } from './types';
import { DEFAULT_FRAME } from './units';
import { InvalidProjectError, validateProject } from './validate';

/**
 * Upgrading saved projects. Projects are saved in the browser and in exported
 * files, so the app must read every shape it has ever saved.
 *
 * When what gets saved changes: bump CURRENT_SCHEMA (types.ts), add a step here
 * that turns the previous version into the new one, and add a sample of the
 * previous version to schema.test.ts. Each step only needs to know its neighbors.
 */

/** Loosely typed: older shapes don't match today's Project type. */
type Raw = Record<string, unknown>;

const migrations: Record<number, (project: Raw) => Raw> = {
  /** 0 → 1: projects from before versioning. Fill in any missing settings. */
  0: (project) => {
    const base = emptyProject();
    // Version 1's defaults: the page size was in the settings, borders were numbers, and
    // there were no line guides.
    const v1: Raw = { ...base.settings, pageW: 10, pageH: 8, borders: [0.5, 1.25] };
    delete v1.lines;
    delete v1.dropBorder;
    delete v1.sizes;
    return { ...project, settings: { ...v1, ...(project.settings as object) } };
  },
  /**
   * 1 → 2: guides get ids, border guides can have a distance per edge (these stay even),
   * line guides arrive, and the guide dropped photos fit is chosen: as before, the largest.
   * The spreads, one list with each one's kind, become the first spread, the ones between,
   * and the last, each in its own place (whatever kinds the list claimed).
   */
  1: (project) => {
    const settings = project.settings as Raw;
    const insets = settings.borders as number[];
    const borders = insets.map((inset) => ({ id: newGuideId(), kind: 'even', inset }));
    const largest = borders.reduce<(typeof borders)[number] | null>((a, b) => (!a || b.inset < a.inset ? b : a), null);
    const { spreads, ...rest } = project;
    const list = [...(spreads as Raw[])];
    const first = list.shift();
    const last = list.pop();
    return {
      ...rest,
      firstSpread: first && { ...first, kind: 'first' },
      spreads: list.map((s) => ({ ...s, kind: 'middle' })),
      lastSpread: last && { ...last, kind: 'last' },
      settings: { ...settings, borders, lines: [], dropBorder: largest?.id ?? null },
    };
  },
  /**
   * 2 → 3: a project is a print book or a digital sequence. Every project so far is a
   * book: its spreads, and its page size (from the settings), become a print layout. The
   * settings keep a size for each kind, digital's starting at the default.
   */
  2: (project) => {
    const { firstSpread, spreads, lastSpread, ...rest } = project;
    const { pageW, pageH, ...settings } = project.settings as Raw;
    const page = { w: pageW, h: pageH };
    return {
      ...rest,
      layout: { kind: 'print', page, firstSpread, spreads, lastSpread },
      settings: { ...settings, sizes: { print: { ...page }, digital: { ...DEFAULT_FRAME } } },
    };
  },
};

export class NewerProjectError extends Error {
  constructor() {
    super('This project was saved by a newer version of Sequence.');
  }
}

/** The shape version of saved data; projects from before versioning have none (version 0). */
export function schemaVersionOf(project: unknown): number {
  const v = (project as Raw | null)?.schemaVersion;
  return typeof v === 'number' ? v : 0;
}

/**
 * Upgrade saved data to the current shape, then check all of it (see validate.ts), so
 * nothing past here meets a project in any other shape. Throws NewerProjectError if it's
 * from a newer app, and InvalidProjectError if it's damaged.
 */
export function migrateProject(stored: unknown): Project {
  let version = schemaVersionOf(stored);
  if (version > CURRENT_SCHEMA) throw new NewerProjectError();
  let project = stored as Raw;
  try {
    while (version < CURRENT_SCHEMA) {
      const step = migrations[version];
      if (!step) throw new InvalidProjectError(`no upgrade from version ${version}`);
      project = step(project);
      version += 1;
    }
  } catch (e) {
    // An upgrade step meeting something it didn't expect: the project is damaged.
    throw e instanceof InvalidProjectError ? e : new InvalidProjectError(`version ${version}: ${String(e)}`);
  }
  return validateProject({ ...project, schemaVersion: CURRENT_SCHEMA });
}
