// End-to-end test of the Mac app's projects (npm run test:app). Makes fixture
// projects, runs a test build of the real app on them (see src/platform/macos/e2e.ts), then checks
// the files it saved from outside the app too.
//
// The test build keeps its storage apart from the real app's and the dev build's,
// and it's deleted afterwards. Its window shows for a few seconds while it runs.

import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createZip, readZip } from '../src/zip.ts';

const ID = 'io.salem.PhotobookSequencer.e2e';
// Run outside an app bundle, WebKit keeps the app's storage under the executable's name,
// so the test runs a copy under a name of its own (not the dev build's).
const EXE = 'sequence-e2e';
// Its own build folder, so switching between it and the real app doesn't rebuild everything.
const TARGET = resolve('src-tauri/target/e2e');
const TIMEOUT_MS = 120_000;
const storage = [join(homedir(), 'Library/WebKit', EXE), join(homedir(), 'Library/Caches', EXE)];
const forget = () => storage.forEach((p) => rmSync(p, { recursive: true, force: true }));

function fixture(names) {
  const photos = {};
  const files = {};
  const entries = [];
  const spreads = ['first', 'middle', 'middle', 'last'].map((kind, i) => ({ id: `s${i}`, kind, items: [] }));
  const pile = [];
  names.forEach((name, i) => {
    const id = `p${i}`;
    photos[id] = { id, name: `${name}.jpg`, pxW: 795, pxH: 1200 };
    files[id] = { image: `images/${name}.jpg` };
    entries.push({ name: `images/${name}.jpg`, data: new Blob([readFileSync(`src/tour/${name}.jpg`)]) });
    const at = { photoId: id, w: 1.325, h: 2, z: i + 1 };
    if (i === 0) pile.push({ ...at, x: 1, y: 1 });
    else spreads[1].items.push({ ...at, x: i === 1 ? -6 : 2, y: 2 });
  });
  const doc = {
    schemaVersion: 1,
    photos,
    pile,
    spreads,
    settings: { pageW: 10, pageH: 8, centerV: true, centerH: true, keepRelative: true, borders: [0.5, 1.25] },
    nextZ: names.length + 1,
  };
  const manifest = { format: 'photo-sequencer-project', version: 1, exportedAt: '', doc, files };
  return createZip([{ name: 'project.json', data: new Blob([JSON.stringify(manifest)]) }, ...entries]);
}

async function savedDoc(path) {
  const zip = await readZip(new Blob([readFileSync(path)]));
  return JSON.parse(await (await zip.get('project.json').blob()).text()).doc;
}

/**
 * The App Sandbox, as on the App Store: a signed app bundle, opened by LaunchServices
 * the way Finder does (which is what grants it access to the file), then relaunched
 * without a file, when only its bookmark can get it access again.
 */
const SANDBOX_ID = 'io.salem.PhotobookSequencer.e2e-sandbox';
const SANDBOX_APP = join(TARGET, 'release/bundle/macos/Sequence Sandbox Test.app');
// Sandboxed, the app can't write to our log; it reports to a file in its container instead.
const SANDBOX_REPORT = join(homedir(), 'Library/Containers', SANDBOX_ID, 'Data/tmp/sequence-e2e.log');

async function sandboxed(dir) {
  console.log('\nBuilding the sandboxed test app…');
  const config = {
    identifier: SANDBOX_ID,
    productName: 'Sequence Sandbox Test',
    // Not a handler for project files: it mustn't take over double-clicks.
    bundle: { fileAssociations: null },
  };
  const build = spawnSync(
    'npx',
    ['tauri', 'build', '--bundles', 'app', '--features', 'e2e', '--config', JSON.stringify(config)],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, PBS_E2E_BUILD: '1', CARGO_TARGET_DIR: TARGET },
    },
  );
  if (build.status !== 0) throw new Error('The sandboxed test app failed to build.');
  const file = join(dir, 'Sandbox.photo-sequence');
  writeFileSync(file, readFileSync(join(dir, 'Fixture A.photo-sequence')));
  const openApp = (phase, ...files) => {
    rmSync(SANDBOX_REPORT, { force: true });
    const run = spawnSync(
      'open',
      ['-n', '-W', '--env', `PBS_E2E=${dir}`, '--env', `PBS_E2E_PHASE=${phase}`, '-a', SANDBOX_APP, ...files],
      { timeout: TIMEOUT_MS },
    );
    if (run.error) spawnSync('pkill', ['-f', SANDBOX_APP]);
    const out = existsSync(SANDBOX_REPORT) ? readFileSync(SANDBOX_REPORT, 'utf8').trim() : '';
    console.log(
      out
        .split('\n')
        .filter((l) => !l.startsWith('…'))
        .join('\n') || '(no report)',
    );
    if (run.error) console.log(`FAIL finishes within ${TIMEOUT_MS / 1000} s`);
    return !run.error && run.status === 0 && out.includes('ok') && !out.includes('FAIL');
  };
  try {
    console.log('Running sandboxed…\n');
    let ok = openApp('sandbox-open', file);
    console.log('\nRelaunching sandboxed…\n');
    ok = openApp('sandbox-relaunch') && ok;
    const saved = (await savedDoc(file)).layout.page.w === 14;
    console.log(`${saved ? 'ok  ' : 'FAIL'} the sandboxed app's saves are in the file (read outside the app)`);
    return ok && saved;
  } finally {
    spawnSync(
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
      ['-u', SANDBOX_APP],
    );
    rmSync(SANDBOX_APP, { recursive: true, force: true });
    // Its container (~/Library/Containers) is left: macOS protects containers from other
    // processes. Each run replaces what's in it (the project it opens, the file it remembers).
  }
}

const dir = mkdtempSync(join(tmpdir(), 'sequence-e2e-'));
let failed = false;
try {
  writeFileSync(
    join(dir, 'Fixture A.photo-sequence'),
    Buffer.from(await (await fixture(['taxi', 'lily', 'door'])).arrayBuffer()),
  );
  writeFileSync(join(dir, 'Fixture B.photo-sequence'), Buffer.from(await (await fixture(['leaves'])).arrayBuffer()));

  console.log('Building the test app…');
  const build = spawnSync(
    'npx',
    ['tauri', 'build', '--no-bundle', '--features', 'e2e', '--config', JSON.stringify({ identifier: ID })],
    { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PBS_E2E_BUILD: '1', CARGO_TARGET_DIR: TARGET } },
  );
  if (build.status !== 0) throw new Error('The test app failed to build.');
  copyFileSync(join(TARGET, 'release/sequence'), join(TARGET, 'release', EXE));

  forget();
  const run = async (phase) => {
    const app = spawn(join(TARGET, 'release', EXE), { env: { ...process.env, PBS_E2E: dir, PBS_E2E_PHASE: phase } });
    let output = '';
    app.stdout.on('data', (d) => (output += d));
    const timer = setTimeout(() => app.kill(), TIMEOUT_MS);
    const code = await new Promise((resolve) => app.on('exit', resolve));
    clearTimeout(timer);
    console.log(output.trim() || '(no report)');
    if (code === null) console.log(`FAIL finishes within ${TIMEOUT_MS / 1000} s`);
    if (code !== 0) failed = true;
  };
  console.log('Running…\n');
  await run('main');
  // Quit and start again: the app should pick up where it left off.
  console.log('\nRelaunching…\n');
  await run('relaunch');

  // What the app stored: each photo on its own, never a copy of a whole project file.
  const projects = ['Fixture A', 'Fixture B'].map((f) => statSync(join(dir, `${f}.photo-sequence`)).size);
  const stored = readdirSync(storage[0], { recursive: true })
    .filter((f) => f.endsWith('.blob'))
    .map((f) => statSync(join(storage[0], f)).size);
  const own = stored.length > 0 && !stored.some((size) => projects.includes(size));
  console.log(`${own ? 'ok  ' : 'FAIL'} stores each photo on its own, not a copy of the project file`);
  if (!own) failed = true;

  // The saved files, read from outside the app.
  const outside = [
    [
      'saved file has the change (read outside the app)',
      (await savedDoc(join(dir, 'Fixture A.photo-sequence'))).layout.page.w === 11,
    ],
    [
      'saved-as file has the change (read outside the app)',
      (await savedDoc(join(dir, 'Saved As.photo-sequence'))).layout.page.w === 12,
    ],
  ];
  for (const [name, ok] of outside) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) failed = true;
  }

  if (!(await sandboxed(dir))) failed = true;
} catch (e) {
  console.error(`FAIL ${e.message}`);
  failed = true;
} finally {
  forget();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? '\nThe Mac app end-to-end test failed.' : '\nThe Mac app end-to-end test passed.');
process.exit(failed ? 1 : 0);
