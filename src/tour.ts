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
import { ui, type Modal, type UiState } from './ui';
import taxi from './tour/taxi.jpg';
import spire from './tour/spire.jpg';
import reflections from './tour/reflections.jpg';
import leaves from './tour/leaves.jpg';
import lily from './tour/lily.jpg';
import door from './tour/door.jpg';

/**
 * The product tour: a few steps that each point at part of the app. While it runs,
 * a sample project stands in for the user's. Nothing is saved (see maySave), and the
 * user's project comes back, history and all, when the tour ends.
 */

export interface TourStep {
  title: string;
  body: string;
  /** CSS selector for what to highlight; none centers the card over everything. */
  target?: string;
  /** Open the spread editor on the sample spread. */
  editor?: boolean;
  modal?: Modal;
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to Sequence',
    body: 'Sequence is a tool for playing with photo sequences. Here’s a quick look around, using a few sample photos. Your own work will remain unchanged.',
  },
  {
    title: 'The desk',
    body: 'Add photos by importing them, or just drop them here. Scroll or hold space and drag to pan, and pinch to zoom. Tap space to see a full-size preview of a selected photo. Right-click the desk to tidy up your photos or change the desk’s color.',
    target: '.desk',
  },
  {
    title: 'Spreads',
    body: 'Drag photos from the desk onto a page; they’re sized to fit its guides. Drag a spread to reorder it, or click “+” to add one.',
    target: '.sidebar',
  },
  {
    title: 'Arrange a spread',
    body: 'Click a spread to open it. Move and resize photos; they snap to the page edges and guides.',
    target: '.modal.editor',
    editor: true,
  },
  {
    title: 'Layout',
    body: 'On the Page tab, choose spreads or frames, inches or pixels, and the size. On the Guides tab, set the border guides photos fit to when you drop them on a page, and drag guides out of the rulers. They apply to every spread, mirrored on facing pages.',
    target: '.layout-editor',
    modal: 'layout',
  },
  {
    title: 'Settings',
    body: 'Change how the app looks.',
    target: '.modal.settings',
    modal: 'settings',
  },
  {
    title: 'Preview the book',
    body: 'Flip through it page by page, then export it as a PDF, images, or for InDesign.',
    target: '[data-tour="preview"]',
  },
  {
    ...(platform.kind === 'macos'
      ? {
          title: 'Save your project',
          body: 'File → Save keeps your project, photos and all, in one file. Double-click it to pick up where you left off. Hold ⌘ to see every shortcut.',
        }
      : {
          title: 'Keep a copy',
          body: `Browsers can clear what sites store, so save your project now and then (File → Save project). It saves the photos and layout in one file. Hold ${isMac ? '⌘' : 'Ctrl'} to see every shortcut.`,
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

/** The sample project: four photos on the desk, two on the first middle spread. */
export function sampleProject(): Project {
  const project = emptyProject();
  SAMPLES.forEach(([name], i) => {
    const photo: PhotoMeta = { id: toPhotoId(`tour-${name}`), name: `${name}.jpg`, ...SAMPLE_PX };
    project.photos[photo.id] = photo;
    if (i >= 4) return;
    const { w, h } = pileSize(photo);
    // A loose row, like prints set down by hand.
    project.pile.push({
      photoId: photo.id,
      x: i * w * SAMPLE_STEP,
      y: [0.05, 0, 0.12, 0.02][i]! * h,
      w,
      h,
      z: project.nextZ++,
    });
  });
  return produce(project, (d) => {
    // The book's first two-page spread (the sample is always spreads).
    const spread = allSpreads(d)[1]!;
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
}

export function goToStep(index: number): void {
  const step = TOUR_STEPS[index];
  if (!step) return endTour();
  ui.set({
    tour: index,
    page: 'desk',
    modal: step.modal ?? null,
    // The Layout step shows the guides, which the sample book has.
    ...(step.modal === 'layout' && { layoutTab: 'guides' as const }),
    editingSpreadId: step.editor ? (allSpreads(projectStore.project)[1]?.id ?? null) : null,
  });
}

export function endTour(): void {
  if (ui.get().tour === null) return;
  ui.set({ page: 'desk', modal: null, editingSpreadId: null, selection: [], ...before });
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
  // The row of four sample photos (see sampleProject), with room below for the tour's card.
  const { w: pw, h: ph } = pileSize({ id: toPhotoId('tour'), name: '', ...SAMPLE_PX });
  const box = { w: 3 * pw * SAMPLE_STEP + pw, h: ph * 1.12 };
  const zoom = Math.min(1, (w * 0.8) / (box.w * DESK_PPI), (h * 0.5) / (box.h * DESK_PPI));
  return { zoom, panX: (w - box.w * DESK_PPI * zoom) / 2, panY: (h - box.h * DESK_PPI * zoom) / 3 };
}
