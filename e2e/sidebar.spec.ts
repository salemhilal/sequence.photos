import { expect, goTo, MOD, test } from './fixtures';

/** The spreads' glide animations running now (not CSS transitions elsewhere). */
const glides = () =>
  document
    .getAnimations()
    .filter(
      (a) =>
        a.effect instanceof KeyframeEffect &&
        a.effect.target instanceof Element &&
        a.effect.target.matches('[data-spread-id]'),
    ).length;

test.describe('sidebar', () => {
  test('spreads glide into new columns, and only then', async ({ page }) => {
    // Wide enough for two columns of spreads.
    const edge = (await page.locator('.sidebar-resize').boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
    await page.mouse.down();
    await page.mouse.move(edge.x - 240, edge.y + 200, { steps: 6 });
    await page.mouse.up();
    const slider = page.locator('.columns-slider');
    await expect(slider).toBeVisible();
    await expect.poll(() => page.evaluate(glides)).toBe(0);
    const animations = () => page.evaluate(glides);
    await slider.fill('2');
    expect(await animations()).toBeGreaterThan(0);
    await expect.poll(animations).toBe(0);
    // Other changes (a scroll, a selection) don't glide.
    await page.locator('.spread-row').first().click();
    expect(await animations()).toBe(0);
  });
});

test.describe('Layout’s shortcut', () => {
  test('works while typing in a field', async ({ page }) => {
    await goTo(page, 'Export');
    await page.getByLabel('Photos at, in dpi').focus();
    await page.keyboard.press(`${MOD}+Alt+KeyP`);
    await expect(page.getByRole('dialog', { name: 'Layout' })).toBeVisible();
  });
});
