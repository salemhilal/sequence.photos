// Takes the native iPhone app's App Store screenshots (npm run ios:screenshots), with the six
// photos in assets/screenshots/. On a throwaway Simulator for each size (so nothing already on
// a Simulator is touched), it fills the app's library with a sequence, then runs
// ios/SequenceUITests/ScreenshotTests.swift. Writes docs/app-store/iphone/<size>/*.png.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DERIVED = resolve('ios/build/screenshots');
const OUT = resolve('docs/app-store/iphone');
const PHOTOS_DIR = resolve('assets/screenshots');
const APP_ID = 'io.salem.SequencePhotosMobile';
/** The sizes App Store Connect takes: the required one, and the largest. */
const DEVICES = [
  { folder: '6.3-inch', type: 'iPhone-18-Pro' },
  { folder: '6.9-inch', type: 'iPhone-18-Pro-Max' },
];

const env = existsSync('/Applications/Xcode.app/Contents/Developer')
  ? { ...process.env, DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer' }
  : process.env;
const sh = (cmd, ...args) => execFileSync(cmd, args, { encoding: 'utf8', env }).trim();
const simctl = (...args) => sh('xcrun', 'simctl', ...args);

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

/** A photo's upright size, from its file. */
function sizeOf(path) {
  const out = sh('sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path);
  return { w: Number(/pixelWidth: (\d+)/.exec(out)[1]), h: Number(/pixelHeight: (\d+)/.exec(out)[1]) };
}

const FRAME = { w: 1080, h: 1350 };
const INSET = 54;

/** A photo placed as big as the frame's border guide lets it be, centered. */
function placed(photo, z) {
  const ratio = photo.pxW / photo.pxH;
  const box = { w: FRAME.w - 2 * INSET, h: FRAME.h - 2 * INSET };
  const w = Math.min(box.w, box.h * ratio);
  const h = w / ratio;
  return { photoId: photo.id, x: (FRAME.w - w) / 2, y: (FRAME.h - h) / 2, w, h, z };
}

/** The sequence the screenshots show: five frames, and a photo waiting on the desk. */
function project() {
  const names = ['lily', 'taxi', 'dancers', 'hand', 'reflections', 'window'];
  const photos = Object.fromEntries(
    names.map((id) => {
      const { w, h } = sizeOf(join(PHOTOS_DIR, `${id}.jpg`));
      return [id, { id, name: `${id}.jpg`, pxW: w, pxH: h }];
    }),
  );
  const frames = names.slice(0, 5).map((id, i) => ({
    kind: 'frame',
    id: `f${i + 1}`,
    items: [placed(photos[id], i + 1)],
    ...(id === 'dancers' ? { background: 'black' } : {}),
  }));
  return {
    schemaVersion: 7,
    photos,
    pile: [{ photoId: 'window', x: 0.5, y: 0.5, w: 16, h: 24, z: 6 }],
    page: { ...FRAME, unit: 'px', pxPerUnit: 1 },
    layout: { kind: 'frames', frames },
    settings: {
      centerV: true,
      centerH: true,
      keepRelative: true,
      borders: [{ id: 'g1', kind: 'even', inset: INSET }],
      lines: [],
      dropBorder: 'g1',
    },
    nextZ: 7,
  };
}

/** Fill the installed app's library, in the files `Library` and `PhotoStore` read. */
function fillLibrary(udid) {
  const data = simctl('get_app_container', udid, APP_ID, 'data');
  const root = join(data, 'Library/Application Support/Library');
  mkdirSync(join(root, 'Projects'), { recursive: true });
  mkdirSync(join(root, 'Photos'), { recursive: true });
  const p = project();
  for (const id of Object.keys(p.photos)) {
    copyFileSync(join(PHOTOS_DIR, `${id}.jpg`), join(root, 'Photos', `${id}.original`));
    sh('sips', '-Z', '1400', join(PHOTOS_DIR, `${id}.jpg`), '--out', join(root, 'Photos', `${id}.jpg`));
  }
  const coverFrames = p.layout.frames.slice(0, 3);
  const coverPhotos = Object.fromEntries(
    coverFrames.flatMap((f) => f.items).map((i) => [i.photoId, p.photos[i.photoId]]),
  );
  writeFileSync(join(root, 'Projects/city-walks.json'), JSON.stringify(p));
  const entry = {
    id: 'city-walks',
    name: 'City walks',
    updated: Date.now(),
    page: p.page,
    frameCount: p.layout.frames.length,
    coverFrames,
    coverPhotos,
  };
  writeFileSync(join(root, 'index.json'), JSON.stringify([entry]));
}

const runtimes = JSON.parse(simctl('list', 'runtimes', '-j', 'available'))
  .runtimes.filter((r) => r.identifier.includes('iOS'))
  .reverse();

/** A throwaway Simulator of this type, on the newest runtime that has it. */
function createDevice(type) {
  const runtime = runtimes.find((r) => r.supportedDeviceTypes.some((d) => d.identifier.endsWith(`.${type}`)));
  if (!runtime) fail(`No iOS Simulator runtime has ${type}.`);
  return simctl('create', `Screenshots ${type}`, `com.apple.CoreSimulator.SimDeviceType.${type}`, runtime.identifier);
}

sh('xcodegen', 'generate', '--quiet', '--spec', 'ios/project.yml');
for (const { folder, type } of DEVICES) {
  const udid = createDevice(type);
  const dir = join(OUT, folder);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    simctl('boot', udid);
    simctl('bootstatus', udid);
    simctl(
      'status_bar',
      udid,
      'override',
      '--time',
      '9:41',
      '--dataNetwork',
      'wifi',
      '--wifiBars',
      '3',
      '--cellularBars',
      '4',
      '--batteryState',
      'charged',
      '--batteryLevel',
      '100',
    );
    const xcodebuild = (action) => {
      const args = [
        action,
        '-project',
        'ios/Sequence.xcodeproj',
        '-scheme',
        'Sequence',
        '-destination',
        `id=${udid}`,
        '-derivedDataPath',
        DERIVED,
        'CODE_SIGNING_ALLOWED=NO',
        '-collect-test-diagnostics',
        'never',
        '-quiet',
      ];
      if (action === 'test-without-building') args.push('-only-testing:SequenceUITests/ScreenshotTests');
      const result = spawnSync('xcodebuild', args, {
        stdio: 'inherit',
        // xcodebuild hands TEST_RUNNER_ variables to the tests, without the prefix.
        env: { ...env, TEST_RUNNER_SCREENSHOT_DIR: dir },
      });
      if (result.status !== 0) fail(`xcodebuild ${action} failed on ${type}.`);
    };
    xcodebuild('build-for-testing');
    simctl('install', udid, join(DERIVED, 'Build/Products/Debug-iphonesimulator/Sequence.app'));
    fillLibrary(udid);
    xcodebuild('test-without-building');
  } finally {
    spawnSync('xcrun', ['simctl', 'delete', udid], { env });
  }
  // App Store Connect refuses images with an alpha channel.
  for (const f of readdirSync(dir)) {
    const path = join(dir, f);
    sh('magick', path, '-background', 'black', '-alpha', 'remove', '-alpha', 'off', `PNG24:${path}`);
  }
  console.log(`Wrote ${readdirSync(dir).length} screenshots to ${dir}`);
}
