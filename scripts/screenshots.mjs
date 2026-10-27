// Takes the app's screenshots (npm run screenshots): the App Store's, the README's, and the
// landing page's, from the Mac app's interface with the six photos in assets/screenshots/.
//
// It runs the Mac build's web side (vite --mode app, on :5176) in headless Chromium at
// 1440 × 900 pt @2x, with Tauri stubbed out and the window's traffic lights drawn in, so
// the shots look like the app without driving it. Writes:
//   docs/app-store/1-desk.png … 6-instagram.png   2880 × 1800, for App Store Connect
//   docs/screenshot.jpg                        the desk, for the README
//   site/landing/landing-*.jpg                 2000 × 1250, the landing page's four
// Resizing uses sips, so it runs on a Mac. `--only desk,preview` takes some of them.

import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5176;
/** Where the dev server serves src/ from: the app's own URLs, so imports here share its modules. */
const SRC_URL = `/@fs${fileURLToPath(new URL('../src/', import.meta.url))}`;
const APP_URL = `http://localhost:${PORT}/app/index.html`;
/** The photos, assets/screenshots/<name>.jpg: large, so none is shown bigger than it is. */
const PHOTOS = ['lily', 'taxi', 'dancers', 'hand', 'reflections', 'window'];
const PHOTOS_DIR = fileURLToPath(new URL('../assets/screenshots/', import.meta.url));
/** The shots, in the App Store's order, and which of them the landing page shows (as what). */
const SHOTS = [
  { name: '1-desk', landing: 'landing-desk' },
  { name: '2-spread-editor', landing: 'landing-spreads' },
  { name: '3-preview', landing: 'landing-preview' },
  { name: '4-quick-look' },
  { name: '5-export' },
  { name: '6-instagram', landing: 'landing-instagram' },
];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const wanted = (name) => !only || only.some((o) => name.includes(o));

// Stands in for Tauri: every call succeeds and does nothing (no files were opened at launch).
const TAURI_STUB = `
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    unregisterCallback: () => {},
    convertFileSrc: (p) => p,
    invoke: async (cmd) => {
      if (cmd === 'take_opened_files' || cmd === 'take_opened_links') return [];
      if (cmd.startsWith('plugin:menu|new')) return [1, 'm'];
      if (cmd === 'plugin:event|listen') return 1;
      if (cmd === 'open_bookmark' || cmd === 'read_project') throw 'none';
      return null;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  // The tour has been seen (it would start on an empty project), in the dark theme.
  try { localStorage.setItem('photobook-tour', 'seen'); localStorage.setItem('photobook-theme', 'dark'); } catch {}
`;

// The window's traffic lights, where the app puts them: 14 pt in, 14 pt down, 23 pt apart.
const LIGHTS = `(() => {
  const lights = document.createElement('div');
  lights.style.cssText = 'position:fixed;left:14px;top:14px;display:flex;gap:9px;z-index:99999;pointer-events:none';
  for (const [fill, edge] of [['#ff5f57', '#e0443e'], ['#febc2e', '#dea123'], ['#28c840', '#1aab29']]) {
    const b = document.createElement('div');
    b.style.cssText = 'width:14px;height:14px;border-radius:50%;box-sizing:border-box;background:' + fill + ';border:0.5px solid ' + edge;
    lights.append(b);
  }
  document.body.append(lights);
})()`;

async function serverUp() {
  try {
    return (await fetch(APP_URL)).ok;
  } catch {
    return false;
  }
}

// The Mac build's web side: the one already running (npm run app:ui:dev), or one of our own.
let server = null;
if (!(await serverUp())) {
  server = spawn('npx', ['vite', '--mode', 'app', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 200));
}

const profile = mkdtempSync(join(tmpdir(), 'sequence-shots-'));
const context = await chromium.launchPersistentContext(profile, {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = context.pages()[0] ?? (await context.newPage());
await page.addInitScript(TAURI_STUB);
// Instagram's API, answered here: the shots' stand-in connection never reaches it, and has
// no profile picture (the preview shows its initial).
await page.route('https://graph.instagram.com/**', (route) => route.fulfill({ json: {} }));
page.on('pageerror', (e) => console.error('page error:', e.message));

try {
  await page.goto(APP_URL);
  await page.waitForSelector('.desk');

  // The book: three photos on the desk, three placed on its four pages, saved as "City Walks".
  const files = Object.fromEntries(
    PHOTOS.map((n) => [n, readFileSync(join(PHOTOS_DIR, `${n}.jpg`)).toString('base64')]),
  );
  await page.evaluate(
    async ([SRC, files]) => {
      const { projectStore, emptyProject } = await import(SRC + 'store.ts');
      const { putImage } = await import(SRC + 'db.ts');
      const { putOnPage } = await import(SRC + 'actions.ts');
      const { pileSize } = await import(SRC + 'geometry.ts');
      const { allSpreads } = await import(SRC + 'spreads.ts');
      const { thumbFromBlob } = await import(SRC + 'images.ts');
      const photos = {};
      for (const [n, b64] of Object.entries(files)) {
        const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' });
        // Stored as adding photos stores them: the original, and a display copy.
        await putImage('p-' + n, { full: blob, thumb: await thumbFromBlob(blob) });
        const bmp = await createImageBitmap(blob);
        photos['p-' + n] = { id: 'p-' + n, name: n + '.jpg', pxW: bmp.width, pxH: bmp.height };
      }
      projectStore.reset(emptyProject());
      projectStore.apply((d) => {
        d.photos = photos;
        // Four pages: 01, 02–03, 04.
        d.layout.spreads.splice(1);
        // A loose row, like prints dealt out on a table.
        ['hand', 'reflections', 'window'].forEach((n, i) => {
          const { w, h } = pileSize(photos['p-' + n]);
          d.pile.push({ photoId: 'p-' + n, x: i * w * 1.25, y: [0.06, 0, 0.1][i] * h, w, h, z: d.nextZ++ });
        });
        const spreads = allSpreads(d);
        putOnPage(d, ['p-lily'], spreads[0].id, 'right');
        putOnPage(d, ['p-taxi'], spreads[1].id, 'left');
        putOnPage(d, ['p-dancers'], spreads[1].id, 'right');
      });
      const saved = await (await import(SRC + 'persistence.ts')).saveProject();
      if (saved !== 'saved') throw new Error('not saved: ' + saved);
      // Opened from its file and saved: titled, with nothing unsaved.
      localStorage.setItem(
        'photobook-document',
        JSON.stringify({ path: '/Users/me/Documents/City Walks.photo-sequence', clean: true }),
      );
    },
    [SRC_URL, files],
  );
  await page.reload();
  await page.waitForSelector('.desk .item');
  await page.evaluate(LIGHTS);

  const ui = (fn, arg) =>
    page.evaluate(
      async ([SRC, src, arg]) => {
        const { projectStore } = await import(SRC + 'store.ts');
        const mod = {
          ...(await import(SRC + 'ui.ts')),
          ppi: (await import(SRC + 'deskGeometry.ts')).DESK_PPI,
          pile: projectStore.getSnapshot().project.pile,
        };
        const { allSpreads } = await import(SRC + 'spreads.ts');
        return new Function('mod', 'spreads', 'arg', `return (${src})(mod, spreads, arg)`)(
          mod,
          allSpreads(projectStore.getSnapshot().project),
          arg,
        );
      },
      [SRC_URL, fn.toString(), arg],
    );
  const shot = async (name) => {
    await page.waitForTimeout(800);
    const path = `docs/app-store/${name}.png`;
    writeFileSync(path, await page.screenshot());
    console.log('saved', path);
  };

  // 1. The desk: the photos centered, the reflections selected.
  if (wanted('desk')) {
    const box = await page.locator('.desk').boundingBox();
    await ui(
      ({ ui, ppi, pile }, _, { width, height }) => {
        const x0 = Math.min(...pile.map((p) => p.x));
        const y0 = Math.min(...pile.map((p) => p.y));
        const W = Math.max(...pile.map((p) => p.x + p.w)) - x0;
        const H = Math.max(...pile.map((p) => p.y + p.h)) - y0;
        const zoom = Math.min((width * 0.75) / (W * ppi), (height * 0.7) / (H * ppi));
        ui.set({
          view: {
            zoom,
            panX: (width - W * ppi * zoom) / 2 - x0 * ppi * zoom,
            panY: (height - H * ppi * zoom) / 2 - y0 * ppi * zoom,
          },
          selection: ['p-reflections'],
        });
      },
      { width: box.width, height: box.height },
    );
    await shot('1-desk');
  }

  // 2. The spread editor on pages 2–3, the dancers selected so their guides show.
  if (wanted('spread')) {
    await ui(({ ui }, spreads) => ui.set({ selection: [], editingSpreadId: spreads[1].id }));
    const items = page.locator('.modal.editor .item');
    await items.last().click();
    await shot('2-spread-editor');
    await ui(({ ui }) => ui.set({ editingSpreadId: null }));
  }

  // 3. Preview, open at pages 2–3.
  if (wanted('preview')) {
    await ui(({ goToPage }) => goToPage('preview'));
    await page.waitForSelector('.preview-head');
    await page.keyboard.press('ArrowRight');
    await shot('3-preview');
    await ui(({ goToPage }) => goToPage('desk'));
  }

  // 4. Quick Look on a desk photo.
  if (wanted('quick')) {
    await ui(({ openQuickLook }) => openQuickLook(['p-reflections', 'p-window', 'p-hand']));
    await shot('4-quick-look');
    await ui(({ closeQuickLook }) => closeQuickLook());
  }

  // 5. Export, to a PDF, showing pages 2–3.
  if (wanted('export')) {
    await ui(({ ui, goToPage }) => {
      ui.set({ exportTo: 'pdf', selection: [] });
      goToPage('export');
    });
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowRight');
    await shot('5-export');
    await ui(({ goToPage }) => goToPage('desk'));
  }

  // 6. Posting to Instagram: the book made a 4:5 carousel (1080 × 1350 px frames, one photo
  // each), saved so the title is clean, the lily first in the post's preview. Last, since it
  // changes the project.
  if (wanted('instagram')) {
    await page.evaluate(async (SRC) => {
      const { projectStore } = await import(SRC + 'store.ts');
      projectStore.apply((d) => {
        const W = 1080;
        const H = 1350;
        const M = 80;
        d.page = { w: W, h: H, unit: 'px', pxPerUnit: 1 };
        d.layout = {
          kind: 'frames',
          frames: ['lily', 'taxi', 'dancers'].map((n, i) => {
            const { pxW, pxH } = d.photos['p-' + n];
            const s = Math.min((W - 2 * M) / pxW, (H - 2 * M) / pxH);
            const [w, h] = [pxW * s, pxH * s];
            const item = { photoId: 'p-' + n, x: (W - w) / 2, y: (H - h) / 2, w, h, z: d.nextZ++ };
            return { kind: 'frame', id: 'f-' + i, items: [item] };
          }),
        };
      });
      const saved = await (await import(SRC + 'persistence.ts')).saveProject();
      if (saved !== 'saved') throw new Error('not saved: ' + saved);
      localStorage.setItem(
        'photobook-document',
        JSON.stringify({ path: '/Users/me/Documents/City Walks.photo-sequence', clean: true }),
      );
      // Connected as the owner's account, for the preview's name. A stand-in: its token is
      // nothing, and its server is nowhere, so nothing it could send would reach anyone.
      const enrollment = btoa('v1\nENROLL\n1\n4102444800').replace(/=+$/, '') + '.screenshot';
      localStorage.setItem(
        'photobook-instagram',
        JSON.stringify({
          token: 'screenshot',
          expiresAt: 4102444800,
          refreshedAt: Math.floor(Date.now() / 1000),
          userId: '1',
          username: 'salemsphotos',
          enrollment,
          server: 'http://127.0.0.1:9',
        }),
      );
    }, SRC_URL);
    await page.reload();
    await page.waitForSelector('.desk');
    await page.evaluate(LIGHTS);
    await ui(({ ui, goToPage }) => {
      ui.set({ exportTo: 'instagram', selection: [] });
      goToPage('export');
    });
    await shot('6-instagram');
  }
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
  server?.kill();
}

// The README's and the landing page's copies.
const sips = (...args) => execFileSync('sips', args, { stdio: 'ignore' });
if (wanted('desk'))
  sips(
    '-s',
    'format',
    'jpeg',
    '-s',
    'formatOptions',
    '85',
    'docs/app-store/1-desk.png',
    '--out',
    'docs/screenshot.jpg',
  );
for (const { name, landing } of SHOTS) {
  if (!landing || !wanted(name)) continue;
  const out = `site/landing/${landing}.jpg`;
  sips('-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '2000', `docs/app-store/${name}.png`, '--out', out);
  console.log('saved', out);
}
