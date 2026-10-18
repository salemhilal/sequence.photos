import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getImage } from '../../db';
import { projectLoaded } from '../../persistence';
import { tourSeenPref } from '../../prefs';
import { putOnPage } from '../../actions';
import { defaultOptions } from '../../exportOptions';
import { renderPdf } from '../../pdf';
import { renderImages } from '../../rasterExport';
import { outputPages } from '../../renderPlan';
import { toPhotoId } from '../../ids';
import { newProject } from '../../project';
import { applyPageSetup, draftOf, setLayoutSize } from '../../pageSetup';
import { DEFAULT_PAGE } from '../../units';
import { sheetOf } from '../../spreads';
import { projectStore } from '../../store';
import { endTour } from '../../tour';
import type { Project } from '../../types';
import { ui } from '../../ui';
import { readZip } from '../../zip';
import { openPath, save, saveAs } from './documents';

/**
 * End-to-end test of the Mac app's projects: opening, editing, Save, Save As and
 * opening another, in the real app (its WebKit, its Rust side, real files). Built in
 * only for `npm run test:app` (see scripts/e2e-app.mjs), which makes the fixtures,
 * runs the app, and checks the saved files from outside too.
 */

const results: string[] = [];
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
  if (!ok) failures++;
}

const pause = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const photoCount = () => Object.keys(projectStore.project.photos).length;
const title = () => ui.get().windowTitle;

async function savedProject(path: string): Promise<Project> {
  const bytes = await invoke<ArrayBuffer>('read_project', { path });
  const manifest = (await (await (await readZip(new Blob([bytes]))).get('project.json')?.blob())?.text()) ?? '{}';
  return (JSON.parse(manifest) as { doc: Project }).doc;
}

/** An edit to tell files apart by: the page width. */
function setWidth(w: number): void {
  projectStore.apply((d) => setLayoutSize(d, { w, h: sheetOf(d).pageH }));
}

function pageWidth(p: Project): number {
  return sheetOf(p).pageW;
}

async function scenarios(dir: string): Promise<void> {
  const a = `${dir}/Fixture A.photo-sequence`;
  const b = `${dir}/Fixture B.photo-sequence`;
  const copy = `${dir}/Saved As.photo-sequence`;

  // Opening, as when the app is launched by a double-click.
  await openPath(a, true);
  check('opens a project', photoCount() === 3, `${photoCount()} photos`);
  check('names the window after the file', title()?.name === 'Fixture A' && !title()?.edited, JSON.stringify(title()));
  for (const id of Object.keys(projectStore.project.photos)) {
    const img = await getImage(id);
    const bitmap = img && (await createImageBitmap(img.full).catch(() => null));
    check(`stores photo ${id} so it can be shown`, !!bitmap, img ? `${img.full.size} bytes` : 'missing');
    bitmap?.close();
  }
  await pause(200);
  check('shows the title in the toolbar', document.querySelector('.window-title')?.textContent === 'Fixture A');
  // What the app's content security policy has to allow.
  const shown = document.querySelector<HTMLImageElement>('.desk img.photo');
  if (shown && !shown.complete) await new Promise((r) => shown.addEventListener('load', r, { once: true }));
  check('shows photos on the desk', (shown?.naturalWidth ?? 0) > 0);
  await document.fonts.ready;
  check('loads its fonts', document.fonts.check('13px "Inter Tight"') && document.fonts.check('12px "IBM Plex Mono"'));
  // Checked after relaunching: set before first paint by app/index.html's inline script.
  localStorage.setItem('photobook-theme', 'dark');

  // Save.
  setWidth(11);
  check('marks unsaved changes', title()?.edited === true);
  check('saves over the file', (await save()) && !title()?.edited, ui.get().notice ?? '');
  check('the file has the change', pageWidth(await savedProject(a)) === 11);

  // Save As.
  setWidth(12);
  check('saves as a new file', await saveAs(copy), ui.get().notice ?? '');
  check(
    'names the window after the new file',
    title()?.name === 'Saved As' && !title()?.edited,
    JSON.stringify(title()),
  );
  check('the new file has the change', pageWidth(await savedProject(copy)) === 12);
  check('the old file keeps its own', pageWidth(await savedProject(a)) === 11);
  const copied = await savedProject(copy);
  check('the new file keeps every photo', Object.keys(copied.photos).length === 3);

  // Opening another, with everything saved: no questions.
  await openPath(b);
  check('opens another project without asking when saved', photoCount() === 1 && title()?.name === 'Fixture B');
  check('starts fresh history for each file', !projectStore.getSnapshot().canUndo);

  // Opening another, with unsaved changes: it asks first.
  setWidth(9);
  const opening = openPath(a);
  await pause();
  const asked = ui.get().confirm;
  check('asks before replacing unsaved changes', !!asked);
  asked?.choose(asked.actions.findIndex((a) => a.label === 'Cancel'));
  await opening;
  check('cancelling keeps the project', title()?.name === 'Fixture B' && pageWidth(projectStore.project) === 9);

  // A file opened from Finder while photos are importing waits its turn.
  setWidth(10);
  await save();
  ui.set({ importing: { done: 0, total: 1 } });
  const waiting = openPath(a);
  await pause(300);
  check('waits for an import before opening', title()?.name === 'Fixture B');
  ui.set({ importing: null });
  await waiting;
  check('then opens it', title()?.name === 'Fixture A' && photoCount() === 3);

  // A sequence of frames: switched to, saved and reopened as one, and rendered as images
  // in the app's WebKit (OffscreenCanvas, createImageBitmap).
  applyPageSetup({
    ...draftOf(projectStore.project),
    arrangement: 'frames',
    page: { w: 1080, h: 1350, unit: 'px', pxPerUnit: 1 },
  });
  const { layout, page } = projectStore.project;
  const frame = layout.kind === 'frames' ? layout.frames[0] : undefined;
  check('switches to frames', layout.kind === 'frames' && !!frame);
  if (layout.kind === 'frames' && frame) {
    projectStore.apply((d) => putOnPage(d, [toPhotoId('p0')], frame.id, 'whole'));
    const frames = `${dir}/Frames.photo-sequence`;
    check('saves a sequence of frames', await saveAs(frames), ui.get().notice ?? '');
    const saved = await savedProject(frames);
    check(
      'the file is frames, at its size',
      saved.layout.kind === 'frames' && saved.page.unit === 'px' && sheetOf(saved).pageW === page.w,
      saved.layout.kind,
    );
    const placed = outputPages(projectStore.project, 'page');
    const { files, missing } = await renderImages(placed, projectStore.project, () => undefined);
    const first = files[0] && (await createImageBitmap(files[0].data).catch(() => null));
    check(
      'renders frames as JPEGs at the frame size',
      missing === 0 && files.length === placed.length && first?.width === page.w && first.height === page.h,
      `${files.length} files, ${missing} missing, ${first?.width}×${first?.height}`,
    );
    await openPath(a);
    await openPath(frames);
    check(
      'reopens a sequence of frames',
      title()?.name === 'Frames' && projectStore.project.layout.kind === 'frames' && !title()?.edited,
    );
    // Back to a book in inches, through the same Apply.
    applyPageSetup({ ...draftOf(projectStore.project), arrangement: 'spreads', page: { ...DEFAULT_PAGE } });
    const book = projectStore.project;
    check(
      'switches back to spreads in inches',
      book.layout.kind === 'spreads' && book.page.unit === 'in' && book.page.w === 10,
      `${book.layout.kind} ${book.page.w} ${book.page.unit}`,
    );
    // A page in inches renders at its dpi: 10 × 8 in at 300 is 3000 × 2400.
    const pages = outputPages(book, 'page').slice(0, 2);
    const out = await renderImages(pages, book, () => undefined);
    const image = out.files[0] && (await createImageBitmap(out.files[0].data).catch(() => null));
    check(
      'renders a page in inches at its dpi',
      out.files.length === 2 && image?.width === 3000 && image.height === 2400,
      `${out.files.length} files, ${image?.width}×${image?.height}`,
    );
    // The PDF, from the photos' originals, in the app's WebKit.
    const pdf = await renderPdf(defaultOptions(sheetOf(book)), () => undefined).catch(() => null);
    check(
      'renders a PDF from the originals',
      !!pdf && pdf.missing === 0 && pdf.previews === 0 && pdf.blob.size > 0,
      pdf ? `${pdf.missing} missing, ${pdf.previews} previews` : 'failed',
    );
    // Leave the file as saved, so New Project doesn't ask.
    projectStore.undo();
  }

  await fullscreen();

  // New Project starts fresh history, so undo can't bring back a project without its file.
  await newProject();
  check('New Project starts an untitled, empty project', title()?.name === 'Untitled' && photoCount() === 0);
  check('New Project starts fresh history', !projectStore.getSnapshot().canUndo);

  // Leave the state the relaunch expects: Fixture B, with an unsaved change.
  await openPath(b);
  setWidth(9);
}

const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

/**
 * Preview's fullscreen: F makes the window fullscreen (macOS animates it, so each step
 * waits), Esc leaves it (and only it: pages aren't dismissed), and leaving it some other way
 * (the green button, here the window's own call) stops presenting.
 */
async function fullscreen(): Promise<void> {
  const win = getCurrentWindow();
  const isFull = () => win.isFullscreen();
  const settle = async (want: boolean) => {
    for (const start = Date.now(); (await isFull()) !== want && Date.now() - start < 5000;) await pause(100);
    // The resize that reports it can come a moment after.
    await pause(300);
  };
  ui.set({ page: 'preview' });
  await pause(200);
  press('f');
  await settle(true);
  check('Preview: F makes the window fullscreen', (await isFull()) && ui.get().presenting);
  press('Escape');
  await settle(false);
  check(
    'Preview: Esc leaves fullscreen, staying on the page',
    !(await isFull()) && !ui.get().presenting && ui.get().page === 'preview',
  );
  press('f');
  await settle(true);
  await win.setFullscreen(false);
  await settle(false);
  check('Preview: leaving fullscreen another way stops presenting', !ui.get().presenting);
  press('Escape');
  await pause(200);
  check('Preview: Esc again stays on the page', ui.get().page === 'preview');
  ui.set({ page: 'desk' });
}

/** The second run, after quitting: the last project should come back as it was left. */
async function afterRelaunch(): Promise<void> {
  await pause(500);
  check('reopens the last project', photoCount() === 1 && pageWidth(projectStore.project) === 9);
  check('runs the page’s startup script (the saved theme)', document.documentElement.dataset.theme === 'dark');
  check(
    'remembers it has unsaved changes',
    title()?.name === 'Fixture B' && title()?.edited === true,
    JSON.stringify(title()),
  );
  for (const id of Object.keys(projectStore.project.photos)) {
    const img = await getImage(id);
    const bitmap = img && (await createImageBitmap(img.full).catch(() => null));
    check(`photo ${id} still shows after relaunching`, !!bitmap, img ? `${img.full.size} bytes` : 'missing');
    bitmap?.close();
  }
}

/**
 * Sandboxed, like the App Store build. Launched to open a file (the way Finder does,
 * which grants access to it): it should open, and saving over it should work.
 */
async function sandboxOpen(): Promise<void> {
  await until(() => title()?.name === 'Sandbox');
  check(
    'opens the file it was launched with, sandboxed',
    photoCount() === 3,
    `${JSON.stringify(title())} ${ui.get().notice}`,
  );
  // Without its file, saving would ask where (a dialog nobody's there to answer).
  if (title()?.name !== 'Sandbox') return;
  setWidth(13);
  check('saves over it, sandboxed', await save(), ui.get().notice ?? '');
}

/** Sandboxed, relaunched without a file: only the bookmark gives access to it now. */
async function sandboxRelaunch(): Promise<void> {
  await until(() => title()?.name === 'Sandbox');
  check('remembers its file, sandboxed', title()?.name === 'Sandbox', JSON.stringify(title()));
  if (title()?.name !== 'Sandbox') return;
  setWidth(14);
  check('still saves over it after relaunching (bookmark)', await save(), ui.get().notice ?? '');
}

const PHASES: Record<string, (dir: string) => Promise<void>> = {
  main: scenarios,
  relaunch: afterRelaunch,
  'sandbox-open': sandboxOpen,
  'sandbox-relaunch': sandboxRelaunch,
};

async function until(ready: () => boolean, ms = 20_000): Promise<void> {
  for (const start = Date.now(); !ready() && Date.now() - start < ms;) await pause(100);
}

export async function runE2E(): Promise<void> {
  const dir = await invoke<string | null>('e2e_dir');
  if (!dir) return;
  const phase = (await invoke<string | null>('e2e_phase')) ?? 'main';
  const progress = (message: string) => void invoke('e2e_log', { message });
  progress(`started: ${phase}`);
  // A fresh app would start the tour; the test isn't about that.
  tourSeenPref.save(true);
  await projectLoaded;
  progress('project loaded');
  endTour();
  try {
    await PHASES[phase]?.(dir);
  } catch (e) {
    check('runs to the end', false, String(e));
  }
  // Let the working copy's save (a moment after each change) finish before quitting.
  await pause(1500);
  await invoke('e2e_finish', { ok: failures === 0, report: results.join('\n') });
}
