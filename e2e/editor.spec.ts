import { addTestImages, expect, openEditor, openLayout, statusText, test } from './fixtures';

test.describe('spread editor', () => {
  test('pages through spreads below the spread, with its hint in the status bar', async ({ page }) => {
    await openEditor(page, 1);
    const pager = page.locator('.editor-pager');
    await expect(pager).toContainText('2 / 4');
    await pager.getByRole('button', { name: 'Next spread' }).click();
    await expect(pager).toContainText('3 / 4');
    await page.mouse.move(4, 300);
    await expect(statusText(page)).toContainText('Arrows nudge');
    // The title bar has only the guides toggle and close.
    await expect(page.locator('.modal.editor .modal-head .hint')).toHaveCount(0);
  });

  test('zooms with a pinch or ⌘-scroll, and pans with scrolling', async ({ page }) => {
    await openEditor(page, 1);
    const canvas = page.locator('.modal.editor .spread-canvas').first();
    const before = (await canvas.boundingBox())!.width;
    const stage = (await page.locator('.modal.editor .editor-stage').boundingBox())!;
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    // A pinch arrives as a wheel event with Ctrl held.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(before * 1.5);
    const center = page.locator('.modal.editor .stage-center');
    await page.mouse.wheel(40, 0);
    await expect(center).toHaveAttribute('style', /translate\(-40px/);
  });

  test('places photos from the strip, returns them, and goes to each photo below the resolution', async ({ page }) => {
    await addTestImages(page, 2);
    // Every photo falls below the resolution at 1200 dpi.
    await openLayout(page);
    const dpi = page.getByLabel('Resolution, in dpi');
    await dpi.fill('1200');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.getByRole('dialog', { name: 'Layout' }).getByRole('button', { name: 'Close' }).click();

    await openEditor(page, 1);
    const strip = page.locator('.strip-item');
    await strip.first().click();
    await strip.first().click();
    await expect(strip).toHaveCount(0);
    const placed = page.locator('.modal.editor .spread-canvas .item');
    await expect(placed).toHaveCount(2);

    // Go to next error selects one, then the other; its resolution is a sentence.
    const next = page.getByRole('button', { name: 'Go to next error' });
    await next.click();
    await expect(page.locator('.inspector .help.warn')).toHaveText(
      /^This image is \d+ dpi, which is below the project’s 1200 dpi\.$/,
    );
    const first = await page.locator('.inspector-name').textContent();
    await next.click();
    await expect(page.locator('.inspector-name')).not.toHaveText(first ?? '');

    await page.getByRole('button', { name: 'Return to desk' }).click();
    await expect(placed).toHaveCount(1);
    await expect(strip).toHaveCount(1);
  });
});
