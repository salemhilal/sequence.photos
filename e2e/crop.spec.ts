import { addTestImages, expect, MOD, test } from './fixtures';

test.describe('cropping', () => {
  test('on the desk: double-click, drag an edge, Done; Esc puts it back; one undo step', async ({ page }) => {
    await addTestImages(page, 1);
    await page.keyboard.press('Escape');
    const item = page.locator('.desk .item').first();
    const before = (await item.boundingBox())!;
    await item.dblclick();
    await expect(page.locator('.crop-bar')).toBeVisible();
    await expect(page.locator('.statusbar .status-text')).toContainText('Drag the edges to crop');

    // Drag the right edge in by a third: the photo's frame narrows, its left stays.
    const edge = (await page.locator('.crop-e').boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 - before.width / 3, edge.y + edge.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.crop-bar')).toHaveCount(0);
    const after = (await item.boundingBox())!;
    expect(after.width).toBeCloseTo((before.width * 2) / 3, -1);
    expect(after.x).toBeCloseTo(before.x, 0);

    // Undo is the whole crop at once.
    await page.keyboard.press(`${MOD}+Z`);
    await expect.poll(async () => (await item.boundingBox())!.width).toBeCloseTo(before.width, 0);

    // Esc leaves crop mode as it was.
    await item.dblclick();
    await page.getByRole('button', { name: '1:1' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.crop-bar')).toHaveCount(0);
    expect((await item.boundingBox())!.width).toBeCloseTo(before.width, 0);
  });

  test('a shape from the bar crops to it; Reset shows the whole photo again', async ({ page }) => {
    await addTestImages(page, 1);
    await page.keyboard.press('Escape');
    const item = page.locator('.desk .item').first();
    const before = (await item.boundingBox())!;
    await item.dblclick();
    await page.getByRole('button', { name: '1:1' }).click();
    await page.keyboard.press('Enter');
    const square = (await item.boundingBox())!;
    expect(square.width).toBeCloseTo(square.height, 0);

    await item.dblclick();
    await page.getByRole('button', { name: 'Reset' }).click();
    await page.keyboard.press('Enter');
    const back = (await item.boundingBox())!;
    expect(back.width).toBeCloseTo(before.width, 0);
    expect(back.height).toBeCloseTo(before.height, 0);
  });
});
