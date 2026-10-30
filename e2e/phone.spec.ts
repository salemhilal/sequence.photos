import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The iPhone app's UI (src/phone/), at /phone/ in a phone-sized window: sequences, frames,
 * the editor with its desk, crop, and export. Taps are clicks here; the iOS app itself is
 * checked in the simulator (see docs/testing.md).
 */

const photo = (name: string) => fileURLToPath(new URL(`../src/tour/${name}.jpg`, import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Screens change at once (no transitions, which take no taps while they run).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('../phone/');
  await expect(page.getByRole('heading', { name: 'Sequences' })).toBeVisible();
});

/** Start a sequence and add photos to it, each on a frame of its own (after the empty first frame). */
async function newSequenceWith(page: Page, names: string[], to = 'A frame for each') {
  await page.getByRole('button', { name: 'New sequence' }).first().click();
  await expect(page.getByRole('heading', { name: 'Untitled sequence' })).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photos' }).click();
  await (await chooser).setFiles(names.map(photo));
  await page.getByRole('button', { name: new RegExp(`^${to}`) }).click();
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 30_000 });
}

/** Drag with the mouse in steps, as a finger would. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold = 0) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.move(from.x + (to.x - from.x) / 4, from.y + (to.y - from.y) / 4, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

const center = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

test('a new sequence takes photos, a frame each, and is kept', async ({ page }) => {
  await newSequenceWith(page, ['door', 'lily']);
  await expect(page.locator('.cell')).toHaveCount(3);
  await expect(page.locator('.cell').nth(1).locator('.item')).toHaveCount(1);
  await expect(page.getByText('3 frames')).toBeVisible();

  // Back in the list after a reload, as it was left.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByText('3 frames · 1080 × 1350 px')).toBeVisible();
});

test('the editor: drag a photo to the desk and back, border it, and crop it pinned', async ({ page }) => {
  await newSequenceWith(page, ['door'], 'Fill empty frames first');
  await page.locator('.cell').first().click();
  const item = page.locator('.stage .item');
  await expect(item).toHaveCount(1);

  // Down into the panel: back on the desk.
  await drag(page, center((await item.boundingBox())!), { x: 195, y: 760 });
  await expect(item).toHaveCount(0);
  await expect(page.getByLabel('Desk').locator('.tray-photo')).toHaveCount(1);

  // Up from the tray onto the frame: placed where it's let go, and selected.
  const tray = page.getByLabel('Desk').locator('.tray-photo').first();
  const page0 = (await page.locator('.stage .page').boundingBox())!;
  await drag(page, center((await tray.boundingBox())!), center(page0));
  await expect(item).toHaveCount(1);
  await expect(page.locator('.selection')).toBeVisible();

  // A border, outside the photo.
  await page.getByLabel('Border', { exact: true }).fill('30');
  await expect(item).toHaveCSS('box-shadow', /30|\d+(\.\d+)?px/);

  // Crop: a square, pinned, the photo dragged in it; Done keeps it as one step.
  await page.getByRole('button', { name: 'Crop' }).click();
  await page.getByRole('button', { name: 'Square' }).click();
  await page.getByRole('button', { name: 'Pin' }).click();
  await expect(page.getByText('Crop pinned: drag to move the photo in it')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset' })).toBeDisabled();
  const win = (await page.locator('.crop-window').boundingBox())!;
  await drag(page, center(win), { x: center(win).x, y: center(win).y + 40 });
  await page.getByRole('button', { name: 'Done' }).click();
  const box = (await item.boundingBox())!;
  expect(box.width).toBeCloseTo(box.height, 0);

  // Undo takes the crop back whole.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(async () => {
      const back = (await item.boundingBox())!;
      return back.height / back.width;
    })
    .toBeGreaterThan(1.2);
});

test('the frame selected: a black background, for it or every frame', async ({ page }) => {
  await newSequenceWith(page, ['door'], 'A new frame');
  await page.locator('.cell').first().click();
  // The empty first frame: tap it to select it.
  await page.locator('.stage .page').click();
  await page.getByRole('button', { name: 'Black' }).click();
  await expect(page.locator('.stage .page')).toHaveClass(/black/);
  await page.getByRole('button', { name: 'Use on every frame' }).click();
  await page.getByRole('button', { name: 'Frames' }).click();
  await expect(page.locator('.cell .page.black')).toHaveCount(2);
});

test('frames: hold and drag one to move it; select two to delete them', async ({ page }) => {
  await newSequenceWith(page, ['door', 'lily', 'taxi']);
  const cells = page.locator('.cell');
  await expect(cells).toHaveCount(4);
  // The last frame (taxi) to the front.
  await drag(
    page,
    center((await cells.nth(3).boundingBox())!),
    { x: 30, y: center((await cells.nth(0).boundingBox())!).y },
    500,
  );
  await expect(cells.first().locator('.item')).toHaveCount(1);
  await expect(cells.nth(1).locator('.item')).toHaveCount(0);

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await cells.nth(1).click();
  await cells.nth(2).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect(cells).toHaveCount(2);
});

test('export: images are made from the frames chosen, then shared; Instagram previews a story', async ({ page }) => {
  await newSequenceWith(page, ['door', 'lily']);
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText('3 JPEGs, 01.jpg to 03.jpg.')).toBeVisible();
  // The empty first frame left out.
  await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Frame 1', exact: true }).click();
  await expect(page.getByText('2 JPEGs, 01.jpg to 02.jpg.')).toBeVisible();
  await page.getByRole('button', { name: 'Make 2 images' }).click();
  await expect(page.getByRole('button', { name: 'Share 2 images…' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Instagram' }).click();
  await expect(page.getByRole('button', { name: 'Connect Instagram' })).toBeVisible();
  await expect(page.getByText('2 of 10 chosen')).toBeVisible();
  await page.getByRole('button', { name: 'Stories' }).click();
  await expect(page.locator('.story .story-bars span')).toHaveCount(2);
});

test('the editor: guides hide, the tools tuck away, and the preview shows every frame', async ({ page }) => {
  await newSequenceWith(page, ['door', 'lily']);
  await page.locator('.cell').nth(1).click();
  await expect(page.locator('.guide-box')).toBeVisible();
  await page.getByRole('button', { name: 'Hide guides' }).click();
  await expect(page.locator('.guide-box')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show guides' }).click();
  await expect(page.locator('.guide-box')).toBeVisible();

  // The drawer: tucked away, the frame gets more room.
  const before = (await page.locator('.canvas').boundingBox())!;
  await page.getByRole('button', { name: 'Hide the tools' }).click();
  await expect
    .poll(async () => (await page.locator('.canvas').boundingBox())!.height)
    .toBeGreaterThan(before.height + 100);
  await page.getByRole('button', { name: 'Show the tools' }).click();
  await expect(page.getByLabel('Desk')).toBeVisible();

  // A swipe on the background, beside the frame, goes to the next frame and back.
  const canvas = (await page.locator('.canvas').boundingBox())!;
  const pager = page.locator('.pager span');
  await expect(pager).toHaveText('2 / 3');
  await drag(
    page,
    { x: canvas.x + canvas.width - 6, y: canvas.y + canvas.height / 2 },
    { x: canvas.x + 40, y: canvas.y + canvas.height / 2 },
  );
  await expect(pager).toHaveText('3 / 3');
  await drag(
    page,
    { x: canvas.x + 6, y: canvas.y + canvas.height / 2 },
    { x: canvas.x + canvas.width - 40, y: canvas.y + canvas.height / 2 },
  );
  await expect(pager).toHaveText('2 / 3');

  // The preview, from this frame (the second); closing it comes back here.
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('2 / 3')).toBeVisible();
  await page.getByRole('button', { name: 'Close the preview' }).click();
  await expect(page.getByRole('button', { name: 'Frames' })).toBeVisible();
});
