import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrateProject } from './schema';

/**
 * The saved projects both apps share (shared/fixtures/): each is a sound project at the
 * current schema, and comes back exactly as it was saved. The iPhone app's tests read the
 * same files (ios/SequenceTests/FixtureTests.swift).
 */
const dir = new URL('../shared/fixtures/', import.meta.url);
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('shared fixtures', () => {
  it('has some', () => expect(fixtures.length).toBeGreaterThan(1));

  it.each(fixtures)('%s reads back exactly as saved', (name) => {
    const saved: unknown = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    expect(JSON.parse(JSON.stringify(migrateProject(structuredClone(saved))))).toEqual(saved);
  });
});
