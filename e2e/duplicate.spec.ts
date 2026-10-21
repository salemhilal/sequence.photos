import { type Locator, type Page } from '@playwright/test';
import { addTestImages, expect, MOD, openEditor, test } from './fixtures';

/** Drag from the middle of `item` by (dx, dy), holding Option (Alt) from the press. */
async function optionDrag(page: Page, item: Locator, dx: number, dy: number) {
  const box = (await item.boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.keyboard.down('Alt');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  return box;
}

test.describe('Option-drag duplicates', () => {
  test('a desk photo: the copy goes where it was dragged, the original stays, one undo step', async ({ page }) => {
    await addTestImages(page, 1);
    await page.keyboard.press('Escape');
    const items = page.locator('.desk .item');
    const before = await optionDrag(page, items.first(), 160, 40);
    await expect(items).toHaveCount(2);
    const boxes = await Promise.all([0, 1].map(async (i) => (await items.nth(i).boundingBox())!));
    const [stayed, copy] = boxes.sort((a, b) => a.x - b.x);
    expect(Math.abs(stayed!.x - before.x)).toBeLessThan(2);
    expect(copy!.x - before.x).toBeGreaterThan(120);
    // The copy is selected.
    await expect(page.locator('.statusbar .status-text')).toContainText('1 photo selected');
    await page.keyboard.press(`${MOD}+Z`);
    await expect(items).toHaveCount(1);
    // Redone, it's saved with its own image.
    await page.keyboard.press(`${MOD}+Shift+Z`);
    await expect(items).toHaveCount(2);
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(items).toHaveCount(2);
    await expect(page.locator('.desk .item img')).toHaveCount(2);
  });

  test('a photo on a spread, in the spread editor', async ({ page }) => {
    await addTestImages(page, 1);
    await page.keyboard.press('Escape');
    await openEditor(page, 1);
    await page.locator('.strip-item').first().click();
    const placed = page.locator('.modal.editor .spread-canvas .item');
    await expect(placed).toHaveCount(1);
    await optionDrag(page, placed.first(), 120, 0);
    await expect(placed).toHaveCount(2);
    await expect(page.locator('.inspector-name')).toContainText('copy');
    await page.keyboard.press(`${MOD}+Z`);
    await expect(placed).toHaveCount(1);
  });
});
