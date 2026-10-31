// Draws the native iPhone app's App Store creative assets (npm run ios:store-art), from the
// photos in assets/screenshots/ and the screenshots ios-screenshots.mjs took. Everything that
// has to be seen sits inside the art safe area of Apple's templates (SAFE below; the rest can
// be cropped away on some devices). Writes docs/app-store/iphone/header-*.png and search-*.png.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = resolve('docs/app-store/iphone');
const work = mkdtempSync(join(tmpdir(), 'store-art-'));
const url = (path) => pathToFileURL(resolve(path)).href;
const photo = (name) => url(join(work, `${name}.jpg`));
const FONTS = `
  @font-face { font-family: 'Inter Tight'; font-weight: 600; src: url('${url('ios/Sequence/Fonts/InterTight-SemiBold.ttf')}'); }
  * { box-sizing: border-box; margin: 0; }
  body { background: #1b1b1b; overflow: hidden; position: relative; font-family: 'Inter Tight'; }
`;

/** A 4:5 frame with its photo, as the app shows one: white (or black) around the picture. */
function frame(name, h, black = false) {
  const w = h * 0.8;
  return `<div style="flex:none;width:${w}px;height:${h}px;background:${black ? '#000' : '#fff'};display:flex;align-items:center;justify-content:center;box-shadow:0 ${h / 40}px ${h / 12}px #0008"><img src="${photo(name)}" style="height:92%;width:auto;display:block"></div>`;
}

/** The strip of frames, running past both edges, centered on its middle frame. */
function strip(names, h, gap, y) {
  const inner = names.map((n) => frame(n, h, n === 'dancers')).join('');
  return `<div style="position:absolute;left:50%;top:${y}px;transform:translateX(-50%);display:flex;gap:${gap}px">${inner}</div>`;
}

const ASSETS = [
  {
    // Safe area: 1640 × 658, centered. Three frames fill it; the run carries on beyond.
    file: 'header-3840x1646.png',
    w: 3840,
    h: 1646,
    html: strip(['window', 'reflections', 'lily', 'taxi', 'dancers', 'hand', 'reflections'], 640, 36, 503),
  },
  {
    // Safe area: 2166 × 1026, centered. The purpose in words, and the app showing it.
    file: 'search-3840x2560.png',
    w: 3840,
    h: 2560,
    html: `
      <div style="position:absolute;left:870px;top:0;height:2560px;width:1180px;display:flex;align-items:center">
        <div style="color:#e6e6e6;font-size:172px;line-height:1.06;letter-spacing:-0.02em">Put your photos in order.</div>
      </div>
      <img src="${url('docs/app-store/iphone/6.3-inch/1-frames.png')}"
        style="position:absolute;left:2120px;top:320px;width:880px;border-radius:112px;box-shadow:0 0 0 10px #3a3a3a,0 60px 180px #000a">`,
  },
];

const browser = await chromium.launch();
try {
  // Smaller copies: the photos are far bigger than they'll be drawn.
  for (const name of ['lily', 'taxi', 'dancers', 'hand', 'reflections', 'window']) {
    execFileSync(
      'sips',
      ['-Z', '1400', resolve(`assets/screenshots/${name}.jpg`), '--out', join(work, `${name}.jpg`)],
      {
        stdio: 'ignore',
      },
    );
  }
  for (const { file, w, h, html } of ASSETS) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    // A file page, so it may load the photos and fonts from disk.
    const doc = join(work, `${file}.html`);
    writeFileSync(doc, `<!doctype html><style>${FONTS}</style><body>${html}`);
    await page.goto(pathToFileURL(doc).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const out = join(OUT, file);
    await page.screenshot({ path: out, omitBackground: false });
    // App Store Connect refuses images with an alpha channel.
    execFileSync('magick', [out, '-alpha', 'off', `PNG24:${out}`]);
    await page.close();
    console.log(`Wrote ${out}`);
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
