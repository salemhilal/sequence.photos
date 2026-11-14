import { describe, expect, it } from 'vitest';
import { migrateProject } from './schema';

/**
 * The saved projects both apps share (shared/fixtures/): each is a sound project at the
 * current schema, and comes back exactly as it was saved. The iPhone app's tests read the
 * same files (ios/SequenceTests/FixtureTests.swift).
 */
const fixtures = Object.entries(
  import.meta.glob<unknown>('../shared/fixtures/*.json', { eager: true, import: 'default' }),
);

describe('shared fixtures', () => {
  it('has some', () => expect(fixtures.length).toBeGreaterThan(1));

  it.each(fixtures)('%s reads back exactly as saved', (_name, saved) => {
    expect(JSON.parse(JSON.stringify(migrateProject(structuredClone(saved))))).toEqual(saved);
  });
});
