import { addTestImages, expect, MOD, openEditor, test } from './fixtures';

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

  test('right-click → Crop to a shape, then Reset crop', async ({ page }) => {
    await addTestImages(page, 1);
    await page.keyboard.press('Escape');
    const item = page.locator('.desk .item').first();
    const before = (await item.boundingBox())!;
    await item.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Crop to' }).hover();
    await page.getByRole('menuitemradio', { name: '16:9' }).click();
    const wide = (await item.boundingBox())!;
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);

    await item.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Reset crop' }).click();
    expect((await item.boundingBox())!.height).toBeCloseTo(before.height, 0);
  });

  test('in the spread editor, the crop’s edges snap to the guides (Option: not)', async ({ page }) => {
    await addTestImages(page, 1);
    await page.keyboard.press('Escape');
    await openEditor(page, 1);
    await page.locator('.strip-item').first().click();
    const placed = page.locator('.modal.editor .spread-canvas .item').first();
    await placed.dblclick();
    await expect(page.locator('.crop-bar')).toBeVisible();
    await expect(page.locator('.statusbar .status-text')).toContainText('no snapping');

    // Drag the top edge down, near the page's center line: it lands on it.
    const canvas = (await page.locator('.modal.editor .spread-canvas').first().boundingBox())!;
    const middle = canvas.y + canvas.height / 2;
    const drag = async (toY: number, alt = false) => {
      const h = (await page.locator('.crop-n').boundingBox())!;
      if (alt) await page.keyboard.down('Alt');
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + h.width / 2, toY, { steps: 6 });
      await page.mouse.up();
      if (alt) await page.keyboard.up('Alt');
    };
    await drag(middle + 3);
    const edge = async () => (await placed.boundingBox())!.y;
    expect(Math.abs((await edge()) - middle)).toBeLessThan(1);

    await drag(middle + 14, true);
    expect((await edge()) - middle).toBeGreaterThan(10);
    await page.keyboard.press('Enter');
    await expect(page.locator('.crop-bar')).toHaveCount(0);
  });

  test('C crops the selected photo, on the desk and in the editor', async ({ page }) => {
    await addTestImages(page, 1);
    await page.keyboard.press('Escape');
    // Nothing selected: nothing happens.
    await page.keyboard.press('c');
    await expect(page.locator('.crop-bar')).toHaveCount(0);
    await page.locator('.desk .item').first().click();
    await page.keyboard.press('c');
    await expect(page.locator('.crop-bar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.crop-bar')).toHaveCount(0);

    await openEditor(page, 1);
    await page.locator('.strip-item').first().click();
    await page.locator('.modal.editor .spread-canvas .item').first().click();
    await page.keyboard.press('c');
    await expect(page.locator('.crop-bar')).toBeVisible();
    await page.keyboard.press('Escape');
    // Esc left crop mode, not the editor.
    await expect(page.locator('.modal.editor')).toBeVisible();
  });

  test('dragging inside moves the crop across the photo; the photo stays put', async ({ page }) => {
    await addTestImages(page, 1);
    await page.keyboard.press('Escape');
    const item = page.locator('.desk .item').first();
    await item.dblclick();
    await page.getByRole('button', { name: '1:1' }).click();
    const photo = (await page.locator('.crop-whole').boundingBox())!;
    const before = (await item.boundingBox())!;
    // Square in a taller photo: room to move it down.
    const c = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y + 40, { steps: 6 });
    await page.mouse.up();
    const after = (await item.boundingBox())!;
    expect(after.y - before.y).toBeCloseTo(Math.min(40, photo.y + photo.height - before.y - before.height), 0);
    const still = (await page.locator('.crop-whole').boundingBox())!;
    expect(still.y).toBeCloseTo(photo.y, 0);
    await page.keyboard.press('Enter');
  });

  test('pinned, the crop stays put, dragging moves the photo in it, and only the crop shows', async ({ page }) => {
    await addTestImages(page, 1);
    await page.keyboard.press('Escape');
    const item = page.locator('.desk .item').first();
    await item.dblclick();
    // A smaller crop, by its corner: room to move the photo in it.
    const corner = (await page.locator('.crop-se').boundingBox())!;
    await page.mouse.move(corner.x + 4, corner.y + 4);
    await page.mouse.down();
    await page.mouse.move(corner.x - 120, corner.y - 120, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Pin the crop' }).click();
    await page.mouse.move(4, 300);
    await expect(page.getByRole('button', { name: 'Pin the crop' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.crop-handle')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '4:5' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reset' })).toBeDisabled();
    await expect(page.locator('.statusbar .status-text')).toContainText('Crop pinned');
    // What's cropped off is clipped away.
    await expect(page.locator('.crop-whole')).toHaveCSS('clip-path', /inset/);

    const frame = (await item.boundingBox())!;
    const photo = (await page.locator('.crop-whole').boundingBox())!;
    const c = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    // Up and left: the crop is at the photo's top left, so that's where there's photo to show.
    await page.mouse.move(c.x - 30, c.y - 30, { steps: 6 });
    await page.mouse.up();
    const after = (await item.boundingBox())!;
    expect(after.y).toBeCloseTo(frame.y, 0);
    expect((await page.locator('.crop-whole').boundingBox())!.y).not.toBeCloseTo(photo.y, 0);

    // Unpinned, the crop moves again, and its handles are back.
    await page.getByRole('button', { name: 'Pin the crop' }).click();
    await expect(page.locator('.crop-handle').first()).toBeVisible();
    await page.keyboard.press('Enter');
  });
});
