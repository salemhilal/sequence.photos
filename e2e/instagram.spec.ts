import { type Page } from '@playwright/test';
import { addTestImages, expect, goTo, MOD, openEditor, test } from './fixtures';

/** A photo on pages 2–3, then Export → Instagram. */
async function openInstagram(page: Page) {
  await addTestImages(page, 1);
  await page.keyboard.press('Escape');
  await openEditor(page, 1);
  await page.locator('.strip-item').first().click();
  await page.keyboard.press('Escape');
  await goTo(page, 'Export');
  await page.getByRole('radio', { name: 'Instagram' }).click();
  await expect(page.locator('.ig-image').first()).toBeVisible();
}

test.describe('Instagram: tagging people', () => {
  test('click the image, type a username, and the tag shows there; × removes it', async ({ page }) => {
    await openInstagram(page);
    const image = page.locator('.ig-image').first();
    const box = (await image.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
    const input = page.getByLabel('Username to tag');
    await input.fill('@Some.One');
    await input.press('Enter');
    const tag = image.locator('.ig-user-tag');
    await expect(tag).toHaveText('some.one');
    // Where it was clicked: a quarter of the way across.
    const left = await tag.evaluate((el) => (el as HTMLElement).style.left);
    expect(parseFloat(left)).toBeCloseTo(25, 0);
    await expect(page.locator('.export-panel')).toContainText('1 tagged.');

    await tag.getByRole('button', { name: 'Remove some.one' }).click();
    await expect(tag).toHaveCount(0);
  });

  test('a tag can be dragged to another spot, as far as the image’s edges', async ({ page }) => {
    await openInstagram(page);
    const image = page.locator('.ig-image').first();
    const box = (await image.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.getByLabel('Username to tag').fill('someone');
    await page.keyboard.press('Enter');
    const tag = image.locator('.ig-user-tag');
    const grip = (await tag.boundingBox())!;
    const [gx, gy] = [grip.x + 12, grip.y + grip.height / 2];
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(gx + box.width * 0.5, gy + box.height * 0.25, { steps: 6 });
    await page.mouse.up();
    const spot = async () =>
      tag.evaluate((el) => [parseFloat((el as HTMLElement).style.left), parseFloat((el as HTMLElement).style.top)]);
    const [x, y] = await spot();
    expect(x).toBeCloseTo(75, 0);
    expect(y).toBeCloseTo(50, 0);
    // Dragging didn't also start a new tag.
    await expect(page.getByLabel('Username to tag')).toHaveCount(0);

    // Past the edge, it stops at it.
    const moved = (await tag.boundingBox())!;
    await page.mouse.move(moved.x + 12, moved.y + moved.height / 2);
    await page.mouse.down();
    await page.mouse.move(moved.x + box.width * 2, moved.y, { steps: 6 });
    await page.mouse.up();
    expect((await spot())[0]).toBe(100);
  });

  test('a name that can’t be a username isn’t tagged; Esc leaves without one', async ({ page }) => {
    await openInstagram(page);
    const image = page.locator('.ig-image').first();
    const box = (await image.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const input = page.getByLabel('Username to tag');
    await input.fill('two words');
    await expect(input).toHaveClass(/invalid/);
    await input.press('Enter');
    await expect(image.locator('.ig-user-tag')).toHaveCount(0);

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByLabel('Username to tag').fill('someone');
    await page.keyboard.press('Escape');
    await expect(image.locator('.ig-user-tag')).toHaveCount(0);
    // Esc closed only the field, not the page.
    await expect(page.locator('.page-switcher button.on')).toHaveText('Export');
  });
});

test.describe('Instagram: the post is kept with the project', () => {
  test('a caption and its tags survive a reload, and undo leaves them be', async ({ page }) => {
    await openInstagram(page);
    await page.getByPlaceholder('Write a caption…').fill('City walks #film');
    const image = page.locator('.ig-image').first();
    const box = (await image.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByLabel('Username to tag').fill('@salemhilal');
    await page.keyboard.press('Enter');
    await expect(image.locator('.ig-user-tag')).toHaveText('salemhilal');

    // Undo is about the book: it takes the photo off the page, not the caption.
    await page.getByPlaceholder('Write a caption…').blur();
    await page.keyboard.press(`${MOD}+Z`);
    await page.keyboard.press(`${MOD}+Shift+Z`);
    await expect(page.getByPlaceholder('Write a caption…')).toHaveValue('City walks #film');

    await page.waitForTimeout(1000);
    await page.reload();
    await goTo(page, 'Export');
    await expect(page.getByRole('radio', { name: 'Instagram' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByPlaceholder('Write a caption…')).toHaveValue('City walks #film');
    await expect(page.locator('.ig-image').first().locator('.ig-user-tag')).toHaveText('salemhilal');
  });
});
