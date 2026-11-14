// Runs in Node (vitest), writing files: Node's types, for this file.
/// <reference types="node" />

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { migrateProject } from './schema';
import {
  dropBox,
  fitCentered,
  pageSides,
  pileSize,
  relayoutRect,
  resizeRect,
  snapLines,
  snapMove,
  spreadGuides,
  type Corner,
} from './geometry';
import { outputPages, planPage, slideKey, fitPixels } from './renderPlan';
import { createZip, readZip } from './zip';
import { buildIdml, type LinkedImage } from './idml';
import { fits, hashtagCount, postImageLayout, ratioLabel, targetRatio } from './instagramImage';
import { graphErrorMessage, quoteIds } from './instagramPost';
import { userTagsParam, usernameOf } from './instagramTags';
import { enrollmentExpiry, parseSignInReturn } from './instagram';
import { encodeBase64Url } from './base64url';
import { allSpreads, sheetOf } from './spreads';
import type { Project, Sheet } from './types';

/**
 * Golden files for the GPUI Mac app's Rust port (native/core): what this code makes from a
 * set of inputs, as JSON in shared/goldens/, which the Rust tests must match. This test
 * fails when the TypeScript makes something different from the files, so a change here
 * shows up there; `UPDATE_GOLDENS=1 npx vitest run src/goldens.test.ts` rewrites them.
 */

const DIR = join(import.meta.dirname, '..', 'shared', 'goldens');
const update = process.env.UPDATE_GOLDENS === '1';

interface Case {
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
}

function check(file: string, cases: Case[]): void {
  const path = join(DIR, file);
  if (update) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(path, `${JSON.stringify(cases, null, 2)}\n`);
    return;
  }
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(JSON.parse(JSON.stringify(cases)));
}

/** Fresh ids in order (g1, g2, …), so files don't change from run to run. */
function deterministicIds() {
  let n = 0;
  return vi
    .spyOn(crypto, 'randomUUID')
    .mockImplementation(() => `g${++n}` as `${string}-${string}-${string}-${string}-${string}`);
}

afterAll(() => vi.restoreAllMocks());

const photo = { a: { id: 'a', name: 'a.jpg', pxW: 1200, pxH: 800 } };
const pile = [{ photoId: 'a', x: 1, y: 1, w: 2, h: 1.33, z: 1 }];
const today = {
  schemaVersion: 7,
  photos: photo,
  pile,
  page: { w: 10, h: 8, unit: 'in', pxPerUnit: 300 },
  layout: {
    kind: 'spreads',
    firstSpread: { kind: 'first', id: 's1', items: [] },
    spreads: [],
    lastSpread: { kind: 'last', id: 's2', items: [] },
  },
  settings: {
    centerV: true,
    centerH: false,
    keepRelative: true,
    borders: [{ id: 'm', kind: 'even', inset: 0.5 }],
    lines: [],
    dropBorder: 'm',
  },
  nextZ: 2,
};
const pair = { firstSpread: { kind: 'first', id: 's1', items: [] }, lastSpread: { kind: 'last', id: 's2', items: [] } };
const listed = [
  { id: 's1', kind: 'first', items: [] },
  { id: 's2', kind: 'last', items: [] },
];

/** Saved projects in every shape, and damaged ones; schema.test.ts and validate.test.ts say why each matters. */
function schemaInputs(): [string, unknown][] {
  const fixtures = readdirSync(join(import.meta.dirname, '..', 'shared', 'fixtures'))
    .filter((f) => f.endsWith('.json'))
    .map((f): [string, unknown] => [
      `fixture ${f}`,
      JSON.parse(readFileSync(join(import.meta.dirname, '..', 'shared', 'fixtures', f), 'utf8')),
    ]);
  const v3settings = { ...today.settings, sizes: { print: { w: 10, h: 8 }, digital: { w: 1080, h: 1350 } } };
  const v3 = {
    schemaVersion: 3,
    photos: photo,
    pile,
    layout: { kind: 'print', page: { w: 10, h: 8 }, ...pair, spreads: [] },
    settings: v3settings,
    nextZ: 2,
  };
  const frames = (kind: string) => ({
    ...v3,
    pile: [],
    layout: { kind, frame: { w: 1080, h: 1440 }, frames: [{ kind: 'frame', id: 's', items: [] }] },
  });
  const v0 = {
    photos: photo,
    pile,
    spreads: listed,
    settings: { pageW: 10, pageH: 8, centerV: true, centerH: false, borders: [0.5] },
    nextZ: 2,
  };
  const at = (patch: object) => ({ ...structuredClone(today), ...patch });
  return [
    ...fixtures,
    ['version 0', v0],
    ['version 0 without border guides', { ...v0, settings: { pageW: 10, pageH: 8 } }],
    ['version 0 with three guides', { ...v0, settings: { borders: [1, 0.25, 0.25] } }],
    ['version 1', { ...v0, schemaVersion: 1, settings: { ...v0.settings, keepRelative: true } }],
    [
      'version 2',
      {
        schemaVersion: 2,
        photos: photo,
        pile,
        ...pair,
        spreads: [],
        settings: { ...today.settings, pageW: 10, pageH: 8 },
        nextZ: 2,
      },
    ],
    ['version 3', v3],
    ['version 3 digital', frames('digital')],
    ['version 3 unknown layout', frames('scroll')],
    ['version 4', { ...today, schemaVersion: 4 }],
    ['version 5', { ...today, schemaVersion: 5 }],
    ['version 6', { ...today, schemaVersion: 6 }],
    ['current', today],
    ['newer', { ...today, schemaVersion: 8 }],
    ['version 1 with damaged spreads', { ...v0, schemaVersion: 1, spreads: 'none' }],
    ['damaged pile', at({ pile: 'none' })],
    ['photo in two places', at({ pile: [...pile, { ...pile[0] }] })],
    ['placement of a missing photo', at({ pile: [{ ...pile[0], photoId: 'zz' }] })],
    ['placement with no width', at({ pile: [{ ...pile[0], w: 0 }] })],
    ['photo id unlike its key', at({ photos: { a: { ...photo.a, id: 'b' } } })],
    ['photo with damaged crop', at({ photos: { a: { ...photo.a, crop: { x: 'no' } } } })],
    ['photo with crop outside', at({ photos: { a: { ...photo.a, crop: { x: 0.9, y: -1, w: 0.5, h: 0.333333333 } } } })],
    ['placement with damaged border', at({ pile: [{ ...pile[0], border: { width: -1, color: 'white' } }] })],
    ['placement with border', at({ pile: [{ ...pile[0], border: { width: 0.25, color: 'black' } }] })],
    ['unknown unit', at({ page: { ...today.page, unit: 'cm' } })],
    ['no frames', at({ layout: { kind: 'frames', frames: [] } })],
    ['repeated spread id', at({ layout: { ...today.layout, lastSpread: { kind: 'last', id: 's1', items: [] } } })],
    [
      'spread of the wrong kind',
      at({ layout: { ...today.layout, spreads: [{ kind: 'frame', id: 's3', items: [] }] } }),
    ],
    [
      'white and unknown backgrounds',
      at({
        layout: {
          ...today.layout,
          firstSpread: { kind: 'first', id: 's1', items: [], background: 'white' },
          lastSpread: { kind: 'last', id: 's2', items: [], background: 'teal' },
        },
      }),
    ],
    ['nextZ below a placement', at({ nextZ: 0, pile: [{ ...pile[0], z: 5 }] })],
    ['drop guide gone', at({ settings: { ...today.settings, dropBorder: 'gone' } })],
    ['no drop guide', at({ settings: { ...today.settings, dropBorder: null } })],
    ['repeated guide id', at({ settings: { ...today.settings, lines: [{ id: 'm', axis: 'vertical', at: 1 }] } })],
    [
      'edges guide',
      at({
        settings: {
          ...today.settings,
          borders: [{ id: 'e', kind: 'edges', top: 1, bottom: 2, inside: 0.5, outside: 0.75 }],
        },
      }),
    ],
    [
      'Export choices',
      at({
        export: {
          to: 'instagram',
          options: { per: 'page', format: 'png', quality: 0.8, printAt: 150 },
          instagram: {
            kind: 'story',
            fit: 'expand',
            caption: 'Hi #film',
            chosen: ['s1:whole'],
            tags: { 's1:whole': [{ username: 'salemhilal', x: 0.5, y: 0.25 }] },
          },
        },
      }),
    ],
    [
      'damaged Export choices',
      at({
        export: {
          to: 'fax',
          options: { per: 'both', quality: 7 },
          instagram: {
            caption: 3,
            chosen: ['ok', 4],
            tags: { a: [{ username: 'Has Space', x: 0.5, y: 0.5 }, { username: 'ok', x: 2, y: 0 }, 'x'], b: 'no' },
          },
        },
      }),
    ],
    ['nonsense Export choices', at({ export: 'nonsense' })],
    ['not a project', 'nonsense'],
  ];
}

describe('golden files for native/core', () => {
  it('schema.json: migrating and checking saved projects', () => {
    const ids = deterministicIds();
    const cases = schemaInputs().map(([name, input]): Case => {
      try {
        return { name, input, output: migrateProject(structuredClone(input)) };
      } catch (e) {
        return { name, input, error: (e as Error).message };
      }
    });
    ids.mockRestore();
    check('schema.json', cases);
  });

  it('render.json: what exports draw', () => {
    const cases = projects().flatMap(([name, project]) =>
      (['spread', 'page'] as const).flatMap((per) =>
        [undefined, 72].map((ppu): Case => {
          const sheet = sheetOf(project);
          const plans = outputPages(project, per).map((p) => {
            const plan = planPage(p, sheet, project.photos, ppu);
            return { key: slideKey(p), plan, fit: fitPixels(plan, 1_000_000) };
          });
          return {
            name: `${name}, per ${per}, at ${ppu ?? 'the page'}`,
            input: { project, per, pxPerUnit: ppu ?? null },
            output: plans,
          };
        }),
      ),
    );
    check('render.json', cases);
  });

  it('idml.json: the InDesign file', async () => {
    const cases: Case[] = [];
    for (const [name, project] of projects()) {
      const links = new Map<string, LinkedImage>(
        Object.values(project.photos).map((p, i) => [
          p.id,
          {
            path: `Links/${p.name.replace(/\.[^.]*$/, '')} & co ${i}.${i % 2 ? 'png' : 'jpg'}`,
            format: i % 2 ? 'png' : 'jpeg',
            ppi: i % 3 ? 300 : 72,
            pxW: p.pxW,
            pxH: p.pxH,
          },
        ]),
      );
      const files = await Promise.all(
        buildIdml(project, links).map(async (f) => ({ name: f.name, text: await new Blob([f.data]).text() })),
      );
      cases.push({ name, input: { project, links: [...links] }, output: files });
    }
    check('idml.json', cases);
  });

  it('instagram.json: post images, captions, tags, and sign-in returns', () => {
    const cases: Case[] = [];
    const sizes = [
      [1080, 1350],
      [1080, 1440],
      [1080, 1080],
      [1440, 400],
      [300, 3000],
      [4000, 300],
      [3000, 2400],
      [200, 250],
      [1003, 1254],
      [3300, 2550],
    ] as const;
    for (const [w, h] of sizes) {
      for (const kind of ['feed', 'story'] as const) {
        for (const fit of ['crop', 'expand'] as const) {
          cases.push({
            name: `layout ${w}x${h} ${kind} ${fit}`,
            input: { op: 'layout', size: { w, h }, kind, fit },
            output: {
              layout: postImageLayout({ w, h }, kind, fit),
              fits: fits({ w, h }, kind),
              ratio: targetRatio({ w, h }, kind),
            },
          });
        }
      }
      cases.push({ name: `ratio ${w}x${h}`, input: { op: 'ratio', r: w / h }, output: ratioLabel(w / h) });
    }
    for (const text of ['', '#one #two', 'a#b #c_d #é1 # x', '#a\n#b', 'no tags']) {
      cases.push({ name: `hashtags ${text}`, input: { op: 'hashtags', text }, output: hashtagCount(text) });
    }
    for (const text of ['{"id":12345678901234567890}', '{"id": 1, "user_id":22}', '{"ids":3}']) {
      cases.push({ name: `quote ${text}`, input: { op: 'quote', text }, output: quoteIds(text) });
    }
    for (const text of ['@Some.One ', 'bad name', 'a_b', '', '@' + 'x'.repeat(31)]) {
      cases.push({ name: `username ${text}`, input: { op: 'username', text }, output: usernameOf(text) });
    }
    const tags = [
      { username: 'a', x: -0.2, y: 0.33333 },
      { username: 'b', x: 0.5, y: 1.4 },
    ];
    cases.push({ name: 'user tags', input: { op: 'tags', tags }, output: userTagsParam(tags) });
    for (const [code, msg] of [[190], [4], [10], [9004], [36003], [1, 'Say this'], [5], [undefined]] as const) {
      const error = code === undefined ? null : { code, ...(msg && { error_user_msg: msg }) };
      cases.push({
        name: `graph error ${code}`,
        input: { op: 'graph', error, status: 400 },
        output: graphErrorMessage(error, 400),
      });
    }
    for (const hash of [
      '#state=s1&instagram=abc',
      '#state=s1&instagram_error=cancelled',
      '#state=s&instagram_error=weird',
      '#x=1',
      '',
    ]) {
      cases.push({ name: `return ${hash}`, input: { op: 'return', hash }, output: parseSignInReturn(hash) });
    }
    for (const e of [`${encodeBase64Url(new TextEncoder().encode('v1\nENROLL\n12\n1700000000'))}.sig`, 'junk', '']) {
      cases.push({ name: `enrollment ${e}`, input: { op: 'enrollment', e }, output: enrollmentExpiry(e) });
    }
    check('instagram.json', cases);
  });

  it('geometry.json: guides, snapping, fitting, and relayout', () => {
    const cases: Case[] = [];
    for (const [name, project] of projects()) {
      const sheet = sheetOf(project);
      const resized: Sheet = { ...sheet, pageW: sheet.pageW * 0.8, pageH: sheet.pageH * 1.25 };
      for (const spread of allSpreads(project)) {
        cases.push({
          name: `${name}: guides on ${spread.id}`,
          input: { op: 'guides', sheet, spread },
          output: {
            guides: spreadGuides(spread, sheet),
            snap: snapLines(spread, sheet),
            drop: pageSides(spread.kind).map((side) => dropBox(side, sheet)),
          },
        });
        for (const item of spread.items) {
          cases.push({
            name: `${name}: relayout ${item.photoId}`,
            input: { op: 'relayout', rect: item, from: sheet, to: resized },
            output: relayoutRect(item, sheet, resized),
          });
          const lines = snapLines(spread, sheet);
          for (const [dx, dy] of [
            [0.3, -0.2],
            [-1.7, 2.4],
            [0.05, 0.02],
          ]) {
            const moved = { x: item.x + dx!, y: item.y + dy!, w: item.w, h: item.h };
            cases.push({
              name: `${name}: snap ${item.photoId} by ${dx}, ${dy}`,
              input: { op: 'snapMove', rect: moved, lines, threshold: 0.2 },
              output: snapMove(moved, lines, 0.2),
            });
            for (const corner of ['nw', 'ne', 'sw', 'se'] as Corner[]) {
              for (const lock of [false, true]) {
                cases.push({
                  name: `${name}: resize ${item.photoId} ${corner} by ${dx}, ${dy}${lock ? ', locked' : ''}`,
                  input: { op: 'resize', rect: item, corner, dx, dy, lock, lines, threshold: 0.2, min: 0.1 },
                  output: resizeRect(item, corner, dx!, dy!, lock, lines, 0.2, 0.1),
                });
              }
            }
          }
        }
      }
      for (const photo of Object.values(project.photos)) {
        cases.push({
          name: `${name}: fit ${photo.id}`,
          input: { op: 'fit', photo, box: { x: -3, y: 1, w: 4, h: 2.5 } },
          output: { fit: fitCentered(photo, { x: -3, y: 1, w: 4, h: 2.5 }), pile: pileSize(photo) },
        });
      }
    }
    check('geometry.json', cases);
  });
});

describe('a project file the web app writes', () => {
  // As project.ts writes it, with stand-ins for the photos. Its date changes each time it's
  // written, so it's checked by reading it back rather than byte for byte.
  const path = join(DIR, 'book.photo-sequence');
  it('book.photo-sequence opens', async () => {
    if (update) {
      const doc = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'shared', 'fixtures', 'book.json'), 'utf8'));
      const ids = Object.keys(doc.photos);
      const files = Object.fromEntries(ids.map((id) => [id, { image: `images/${id}.jpg`, thumb: `thumbs/${id}.jpg` }]));
      const manifest = {
        format: 'photo-sequencer-project',
        version: 1,
        exportedAt: '2026-11-08T00:00:00.000Z',
        doc,
        files,
      };
      const zip = await createZip([
        { name: 'project.json', data: new Blob([JSON.stringify(manifest, null, 2)]) },
        ...ids.flatMap((id) => [
          { name: `images/${id}.jpg`, data: new Blob([`image ${id}`]) },
          { name: `thumbs/${id}.jpg`, data: new Blob([`thumb ${id}`]) },
        ]),
      ]);
      writeFileSync(path, new Uint8Array(await zip.arrayBuffer()));
    }
    const entries = await readZip(new Blob([readFileSync(path)]));
    expect([...entries.keys()]).toContain('project.json');
  });
});

/** The fixtures, and variations on them, as projects. */
function projects(): [string, Project][] {
  const fixtures = schemaInputs()
    .filter(([name]) => name.startsWith('fixture'))
    .map(([name, input]): [string, Project] => [name, migrateProject(structuredClone(input))]);
  const book = fixtures.find(([name]) => name.includes('book'))?.[1];
  if (!book) throw new Error('no book fixture');
  const frames = fixtures.find(([name]) => name.includes('frames'))?.[1];
  if (!frames) throw new Error('no frames fixture');
  return [
    ...fixtures,
    ['book at 150 dpi', { ...book, page: { ...book.page, pxPerUnit: 150 } }],
    [
      'book with no guides',
      {
        ...book,
        settings: { ...book.settings, centerV: false, centerH: false, borders: [], lines: [], dropBorder: null },
      },
    ],
    ['frames at 2x', { ...frames, page: { ...frames.page, pxPerUnit: 2 } }],
  ];
}
