// Makes every app icon from the drawings in assets/icon/ (npm run icons): sequence-light.svg and
// sequence-dark.svg, and favicon-light.svg and favicon-dark.svg, a simpler version that reads
// at 16 px. Run it after changing a drawing, and commit what it writes:
//
//   assets/icon/      PNG renders of the drawings (the app icon on the macOS grid, and as
//                     full-bleed squares for places that want an opaque square, like Meta's
//                     app settings), and AppIcon.icon, the Mac icon as an Icon Composer file
//   src-tauri/icons/  the Mac app's icons: Assets.car (light and dark, macOS 26 and later)
//                     and the light icon for older macOS and the other bundle formats
//   site/public/      the website's favicon (light and dark) and its home-screen icons
//   src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/  the iPhone app's icons
//
// Where an icon can't follow the light or dark appearance, it's the light one.
// Rendering uses the Tauri CLI; Assets.car needs Xcode (for actool), and is skipped without it.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const LIGHT = readFileSync('assets/icon/sequence-light.svg', 'utf8');
const DARK = readFileSync('assets/icon/sequence-dark.svg', 'utf8');
const FAVICON_LIGHT = readFileSync('assets/icon/favicon-light.svg', 'utf8');
const FAVICON_DARK = readFileSync('assets/icon/favicon-dark.svg', 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'sequence-icons-'));

/** The drawing without its comment, so cut shapes don't claim to be the source. */
function body(svg) {
  return svg.replace(/<!--[\s\S]*?-->\s*/, '');
}

/** The tile cut to a full-bleed square: no rounding, no shadow, for places that mask it themselves. */
function square(svg) {
  return body(svg)
    .replace('viewBox="0 0 1024 1024"', 'width="1024" height="1024" viewBox="100 100 824 824"')
    .replace(/<g id="tile">[\s\S]*?<\/g>/, '<rect x="100" y="100" width="824" height="824" fill="url(#tileFill)"/>');
}

/** The tile cut close, rounded but without the shadow and its margin: web app icons. */
function rounded(svg) {
  return body(svg)
    .replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"')
    .replace(
      /<g id="tile">[\s\S]*?<\/g>/,
      '<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#tileFill)"/>',
    );
}

/** Renders an SVG to a size×size PNG at `out`. */
function png(svg, size, out) {
  const dir = mkdtempSync(join(tmp, 'png-'));
  writeFileSync(join(dir, 'in.svg'), svg);
  execFileSync('npx', ['tauri', 'icon', join(dir, 'in.svg'), '-o', dir, '-p', String(size)], { stdio: 'ignore' });
  copyFileSync(join(dir, `${size}x${size}.png`), out);
}

/**
 * One favicon for both appearances: browsers apply the page's color scheme inside an SVG
 * favicon, so it shows the drawing that matches. Each drawing's ids get a prefix so the
 * two don't collide.
 */
function favicon() {
  const inner = (svg, prefix) =>
    body(svg)
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '')
      .replace(/id="/g, `id="${prefix}`)
      .replace(/url\(#/g, `url(#${prefix}`);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
    '  <!-- Made by scripts/icons.mjs from assets/icon/favicon-*.svg: the light drawing, or the dark one in dark mode. -->',
    '  <style>.dark { display: none } @media (prefers-color-scheme: dark) { .light { display: none } .dark { display: inline } }</style>',
    `  <g class="light">${inner(FAVICON_LIGHT, 'l-')}</g>`,
    `  <g class="dark">${inner(FAVICON_DARK, 'd-')}</g>`,
    '</svg>',
    '',
  ].join('\n');
}

/** The Icon Composer file: one layer, light by default and dark in the dark appearance; no glass. */
function iconComposer() {
  const dir = 'assets/icon/AppIcon.icon';
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'Assets'), { recursive: true });
  copyFileSync('assets/icon/sequence-light-square.png', join(dir, 'Assets/light.png'));
  copyFileSync('assets/icon/sequence-dark-square.png', join(dir, 'Assets/dark.png'));
  const layer = {
    'image-name-specializations': [{ value: 'light.png' }, { appearance: 'dark', value: 'dark.png' }],
    name: 'Sequence',
    glass: false,
  };
  const json = {
    fill: { solid: 'extended-gray:1.00000,1.00000' },
    groups: [
      {
        layers: [layer],
        shadow: { kind: 'none', opacity: 0 },
        specular: false,
        translucency: { enabled: false, value: 0 },
      },
    ],
    'supported-platforms': { squares: ['macOS'] },
  };
  writeFileSync(join(dir, 'icon.json'), `${JSON.stringify(json, null, 2)}\n`);
}

/** Compiles AppIcon.icon into Assets.car with Xcode's actool, using Xcode's tools if the Command Line Tools are active. */
function assetCatalog() {
  let env = process.env;
  if (spawnSync('xcrun', ['--find', 'actool']).status !== 0) {
    const xcode = '/Applications/Xcode.app/Contents/Developer';
    if (!existsSync(xcode)) {
      console.warn('No Xcode, so src-tauri/icons/Assets.car (the light and dark Mac icon) was left as it was.');
      return;
    }
    env = { ...env, DEVELOPER_DIR: xcode };
  }
  const out = mkdtempSync(join(tmp, 'car-'));
  execFileSync(
    'xcrun',
    // actool's icon exporter runs elsewhere, so the path must be absolute.
    [
      'actool',
      resolve('assets/icon/AppIcon.icon'),
      '--compile',
      out,
      '--platform',
      'macosx',
      '--minimum-deployment-target',
      '14.0',
      '--app-icon',
      'AppIcon',
      '--output-partial-info-plist',
      join(out, 'partial.plist'),
    ],
    { env, stdio: 'ignore' },
  );
  copyFileSync(join(out, 'Assets.car'), 'src-tauri/icons/Assets.car');
}

/** The Tauri bundle's icons (icns for macOS before 26, and the rest), from the light drawing. */
function bundleIcons() {
  const dir = mkdtempSync(join(tmp, 'bundle-'));
  writeFileSync(join(dir, 'in.svg'), LIGHT);
  execFileSync('npx', ['tauri', 'icon', join(dir, 'in.svg'), '-o', dir], { stdio: 'ignore' });
  for (const f of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico', 'icon.png']) {
    copyFileSync(join(dir, f), join('src-tauri/icons', f));
  }
}

/**
 * The iPhone app's icons (its Xcode project's AppIcon set), from the light drawing cut to a
 * full-bleed square: iOS rounds the corners itself, and wants no transparency.
 */
function iosIcons() {
  const dir = mkdtempSync(join(tmp, 'ios-'));
  writeFileSync(join(dir, 'in.svg'), square(LIGHT));
  execFileSync('npx', ['tauri', 'icon', join(dir, 'in.svg'), '-o', dir, '--ios-color', '#ffffff'], { stdio: 'ignore' });
  const set = 'src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset';
  for (const f of readdirSync(join(dir, 'ios'))) {
    // Through JPEG and back, which drops the alpha channel the App Store refuses in an app icon.
    const jpeg = join(dir, `${f}.jpg`);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', join(dir, 'ios', f), '--out', jpeg], {
      stdio: 'ignore',
    });
    execFileSync('sips', ['-s', 'format', 'png', jpeg, '--out', join(set, f)], { stdio: 'ignore' });
  }
}

try {
  for (const [look, svg] of [
    ['light', LIGHT],
    ['dark', DARK],
  ]) {
    png(svg, 1024, `assets/icon/sequence-${look}.png`);
    png(square(svg), 1024, `assets/icon/sequence-${look}-square.png`);
  }
  png(body(FAVICON_LIGHT), 512, 'assets/icon/favicon-light.png');
  png(body(FAVICON_DARK), 512, 'assets/icon/favicon-dark.png');
  iconComposer();
  assetCatalog();
  bundleIcons();
  iosIcons();

  writeFileSync('site/public/favicon.svg', favicon());
  png(square(LIGHT), 180, 'site/public/apple-touch-icon.png');
  png(rounded(LIGHT), 192, 'site/public/icons/icon-192.png');
  png(rounded(LIGHT), 512, 'site/public/icons/icon-512.png');
  png(square(LIGHT), 512, 'site/public/icons/maskable-512.png');
  console.log("Icons written to assets/icon/, src-tauri/icons/, the iPhone app's AppIcon set, and site/public/.");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
