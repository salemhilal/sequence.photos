import { toPhotoId } from './ids';
import { allSpreads } from './spreads';
import { platform } from '#platform';
import { produce } from 'immer';
import { putOnPage } from './actions';
import { DESK_PPI } from './deskGeometry';
import { pileSize } from './geometry';
import { showUrl } from './images';
import { isMac } from './input';
import { tourSeenPref } from './prefs';
import { projectStore, emptyProject } from './store';
import type { Project, PhotoMeta } from './types';
import { putImage } from './db';
import { onLeaveTour, ui, type Modal, type Page, type UiState } from './ui';
import taxi from './tour/taxi.jpg';
import spire from './tour/spire.jpg';
import reflections from './tour/reflections.jpg';
import leaves from './tour/leaves.jpg';
import lily from './tour/lily.jpg';
import door from './tour/door.jpg';

/**
 * The product tour: a few steps that each point at part of the app. While it runs, a
 * sample project stands in for the user's, and it's theirs to try things on: nothing is
 * saved (see maySave), and their project comes back, history and all, when the tour ends.
 * Adding, opening, or saving their own work ends it first (see leaveTour).
 */

export interface TourStep {
  title: string;
  body: string;
  /** CSS selector for what to highlight; none centers the card over everything. */
  target?: string;
  /** The page it shows (the desk by default). */
  page?: Page;
  /** Open the spread editor on the sample spread. */
  editor?: boolean;
  modal?: Modal;
}

const MOD = isMac ? '⌘' : 'Ctrl';
const OPTION = isMac ? 'Option' : 'Alt';

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to Sequence',
    body: 'Here’s a quick look around, with a sample book. Try anything as you go: your own work is set aside, and comes back when the tour ends.',
  },
  {
    title: 'The desk',
    body: `Photos you add or drop in land here. Move them around like prints on a table, or ${OPTION}-drag one to duplicate it. Scroll to pan, pinch to zoom, and tap Space to see a photo full size.`,
    target: '.desk',
  },
  {
    title: 'Spreads',
    body: 'Drag a photo from the desk onto a page; it fits the page’s guides. Drag spreads to put them in order, or click + to add one.',
    target: '.sidebar',
  },
  {
    title: 'Arrange a spread',
    body: 'Double-click a spread to open it. Move and resize photos, and they snap to the page’s edges and guides, or type exact positions on the right. Drag one to the desk below to take it off the page.',
    target: '.modal.editor',
    editor: true,
  },
  {
    title: 'Layout',
    body: 'Choose spreads (for a book) or frames (for slides and carousels), inches or pixels, and the page size. On the Guides tab, set the margins photos fit to.',
    target: '.layout-editor',
    modal: 'layout',
  },
  {
    title: 'Preview',
    body: 'Page through the book as it will look. Press F for fullscreen.',
    target: '.preview',
    page: 'preview',
  },
  {
    title: 'Export',
    body: 'Save a PDF to print or share, images, or an InDesign file with every photo placed, or post to Instagram. The preview shows exactly what you’ll get.',
    target: '.export-view',
    page: 'export',
  },
  {
    ...(platform.kind === 'macos'
      ? {
          title: 'Save your project',
          body: `File → Save keeps your project, photos and all, in one file. Double-click it to pick up where you left off. Hold ${MOD} to see every shortcut.`,
        }
      : {
          title: 'Keep a copy',
          body: `Browsers can clear what sites store, so save your project now and then (File → Save project). It keeps the photos and layout in one file. Hold ${MOD} to see every shortcut.`,
          target: '.toolbar .menu > .btn',
        }),
  },
];

const SAMPLES: [string, string][] = [
  ['taxi', taxi],
  ['spire', spire],
  ['reflections', reflections],
  ['door', door],
  ['leaves', leaves],
  ['lily', lily],
];
const SAMPLE_PX = { pxW: 795, pxH: 1200 };
/** The sample desk photos' spacing, as a share of their width. */
const SAMPLE_STEP = 1.12;

/** The sample desk photos: the first few samples, the rest are in the book. */
const ON_DESK = 3;

/**
 * The sample project: three photos on the desk, and three in the book (the first page, and
 * the first two-page spread), so Preview and Export open on a photo. At 150 dpi, which the
 * small samples have enough detail for, so none is marked.
 */
export function sampleProject(): Project {
  const project = emptyProject();
  project.page.pxPerUnit = 150;
  SAMPLES.forEach(([name], i) => {
    const photo: PhotoMeta = { id: toPhotoId(`tour-${name}`), name: `${name}.jpg`, ...SAMPLE_PX };
    project.photos[photo.id] = photo;
    if (i >= ON_DESK) return;
    const { w, h } = pileSize(photo);
    // A loose row, like prints set down by hand.
    project.pile.push({
      photoId: photo.id,
      x: i * w * SAMPLE_STEP,
      y: [0.05, 0, 0.12][i]! * h,
      w,
      h,
      z: project.nextZ++,
    });
  });
  return produce(project, (d) => {
    // The sample is always spreads: a single first page, then two-page spreads.
    const [first, spread] = allSpreads(d);
    if (!first || !spread) return;
    putOnPage(d, [toPhotoId('tour-door')], first.id, 'right');
    putOnPage(d, [toPhotoId('tour-leaves')], spread.id, 'left');
    putOnPage(d, [toPhotoId('tour-lily')], spread.id, 'right');
  });
}

let restoreProject: (() => void) | null = null;
let before: Pick<UiState, 'view' | 'sidebarOpen'> | null = null;

export function startTour(): void {
  // Not over a project that's being opened (say, the file that launched the Mac app).
  if (ui.get().tour !== null || ui.get().busy || ui.get().importing) return;
  tourSeenPref.save(true);
  for (const [name, url] of SAMPLES) showUrl(`tour-${name}`, url);
  const s = ui.get();
  before = { view: s.view, sidebarOpen: s.sidebarOpen };
  // Stop saving before the sample project is shown.
  ui.set({
    tour: 0,
    selection: [],
    page: 'desk',
    modal: null,
    editingSpreadId: null,
    quickLook: null,
    contextMenu: null,
    sidebarOpen: true,
    view: frameSamples(),
  });
  restoreProject = projectStore.swap(sampleProject());
  void storeSamples();
}

/**
 * Store the sample photos as added photos are stored, so everything works on them during
 * the tour: exporting, Quick Look, duplicating. Nothing refers to them once the tour ends,
 * so the next save's cleanup removes them.
 */
async function storeSamples(): Promise<void> {
  for (const [name, url] of SAMPLES) {
    try {
      const blob = await (await fetch(url)).blob();
      await putImage(`tour-${name}`, { full: blob, thumb: blob });
    } catch {
      // Then they show, but don't export: the tour still works.
    }
  }
}

export function goToStep(index: number): void {
  const step = TOUR_STEPS[index];
  if (!step) return endTour();
  ui.set({
    tour: index,
    page: step.page ?? 'desk',
    modal: step.modal ?? null,
    ...(step.modal === 'layout' && { layoutTab: 'page' as const }),
    editingSpreadId: step.editor ? (allSpreads(projectStore.project)[1]?.id ?? null) : null,
  });
}

export function endTour(): void {
  if (ui.get().tour === null) return;
  ui.set({ page: 'desk', modal: null, editingSpreadId: null, selection: [], quickLook: null, ...before });
  restoreProject?.();
  restoreProject = null;
  // Saving resumes only once the user's project is back.
  ui.set({ tour: null });
}

/** A view that shows the sample photos on the desk, whatever the window size. */
function frameSamples() {
  const desk = document.querySelector('.desk')?.getBoundingClientRect();
  const w = desk?.width ?? 800;
  const h = desk?.height ?? 600;
  // The row of sample photos on the desk (see sampleProject), with room below for the tour's card.
  const { w: pw, h: ph } = pileSize({ id: toPhotoId('tour'), name: '', ...SAMPLE_PX });
  const box = { w: (ON_DESK - 1) * pw * SAMPLE_STEP + pw, h: ph * 1.12 };
  const zoom = Math.min(1, (w * 0.8) / (box.w * DESK_PPI), (h * 0.5) / (box.h * DESK_PPI));
  return { zoom, panX: (w - box.w * DESK_PPI * zoom) / 2, panY: (h - box.h * DESK_PPI * zoom) / 3 };
}

onLeaveTour(endTour);
